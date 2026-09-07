"""Inicializa o banco de dados no Google Sheets com dados de demonstração.

Cria as abas (`Ledger`, `Rules`, `Taxonomy`, `SubcategoryMeta`, `PluggyMap`, `Config` e as de
investimento) a partir dos *fixtures sintéticos* em `data/seed/`. Assim todo novo usuário começa com um banco funcional para entender
o app antes de conectar as próprias contas via Open Finance (Pluggy).

Uso:
  uv run python -m finance.seed                 # popula com data/seed/* (recusa abas não-vazias)
  uv run python -m finance.seed --force         # sobrescreve o que já existir
  uv run python -m finance.seed --source <DIR>  # usa fixtures de outro diretório (migração:
                                                #   DIR com ledger.jsonl/rules.json/
                                                #   taxonomy.yaml/budgets.json)
  uv run python -m finance.seed --invest        # só a carteira de demonstração
  uv run python -m finance.seed --no-invest     # só o controle de gastos
"""

import argparse
import json
import sys
from pathlib import Path

import yaml

from . import sheets
from . import taxonomy as T
from .config import DEFAULT_TIMEZONE, SEED_DIR
from .invest import accounts as ACC
from .invest import assets as A
from .invest import policy as P
from .invest import quotes as Q
from .invest import trades as T_INVEST


def _parse_taxonomy(raw: dict) -> tuple[dict, dict, dict]:
    """Aceita `Cat: [subs]` (formato antigo) e `Cat: {subs, color, icon,
    treatment, essential}`. Devolve (taxonomia, tratamentos, meta)."""
    tax, treats, meta = {}, {}, {}
    for cat, val in (raw or {}).items():
        if isinstance(val, dict):
            tax[cat] = list(val.get("subs") or [])
            if val.get("treatment"):
                treats[cat] = val["treatment"]
            if val.get("color") or val.get("icon") or val.get("essential"):
                meta[cat] = {"color": val.get("color"), "icon": val.get("icon"),
                             "essential": bool(val.get("essential"))}
        else:
            tax[cat] = list(val or [])
    return tax, treats, meta


def _read_fixtures(src: Path) -> dict:
    ledger = [json.loads(ln) for ln in
              (src / "ledger.jsonl").read_text().splitlines() if ln.strip()]
    rules = json.loads((src / "rules.json").read_text())
    tax_raw = yaml.safe_load((src / "taxonomy.yaml").read_text()) or {}
    taxonomy, tax_treats, tax_meta = _parse_taxonomy(tax_raw)
    budgets = json.loads((src / "budgets.json").read_text())
    pmap_file = src / "pluggy_map.yaml"
    pmap = yaml.safe_load(pmap_file.read_text()) if pmap_file.exists() else {}
    return {"ledger": ledger, "rules": rules.get("rules", rules),
            "taxonomy": taxonomy, "taxonomy_treatments": tax_treats,
            "taxonomy_meta": tax_meta, "budgets": budgets,
            "pluggy_map": pmap or {}}


INVEST_TABS = ("InvestAccounts", "InvestPolicy", "InvestAssets", "InvestTrades")


def _read_invest_fixtures(src: Path) -> dict | None:
    """Carteira de demonstração. Ausente nos fixtures, o seed simplesmente pula."""
    policy_file = src / "invest_policy.yaml"
    if not policy_file.exists():
        return None
    trades_file = src / "invest_trades.jsonl"
    trades = [json.loads(line) for line in
              trades_file.read_text().splitlines() if line.strip()] \
        if trades_file.exists() else []
    return {
        "policy": yaml.safe_load(policy_file.read_text()) or [],
        "assets": yaml.safe_load((src / "invest_assets.yaml").read_text()) or [],
        "accounts": yaml.safe_load((src / "invest_accounts.yaml").read_text()) or [],
        "trades": trades,
    }


def _seed_invest(fixtures: dict) -> None:
    """Grava a carteira e deixa as cotações prontas: quem abre o app pela primeira vez
    encontra uma carteira funcionando, não uma tela vazia."""
    accounts = ACC.load(fixtures["accounts"])
    tree = P.load(fixtures["policy"])
    assets = A.load(fixtures["assets"])
    ACC.save(accounts)
    P.save(tree)
    A.save(assets)
    sheets.write_records("InvestTrades",
                         [T_INVEST.normalize(t) for t in fixtures["trades"]])
    print(f"  InvestAccounts: {len(accounts)} contas")
    print(f"  InvestPolicy:   {len(tree)} nós da política")
    print(f"  InvestAssets:   {len(assets)} ativos")
    print(f"  InvestTrades:   {len(fixtures['trades'])} movimentações")
    pending = Q.missing({}, assets)
    if pending:
        Q.ensure(pending)
        print(f"  Quotes:         {len(pending)} fórmulas do Google Finance criadas")
    for problem in P.validate(tree):
        print(f"  ! {problem}")


def _non_empty_tabs() -> list[str]:
    busy = []
    for tab in ("Ledger", "Rules", "Taxonomy", "PluggyMap") + INVEST_TABS:
        try:
            if sheets.read_records(tab):
                busy.append(tab)
        except sheets.SheetsError:
            pass  # aba ainda não existe → será criada
    if sheets.read_config("budgets") is not None:
        busy.append("Config/budgets")
    return busy


def main() -> None:
    ap = argparse.ArgumentParser(description="Popula o banco no Google Sheets (demo).")
    ap.add_argument("--force", action="store_true",
                    help="sobrescreve abas que já contêm dados")
    ap.add_argument("--source", default=str(SEED_DIR),
                    help="diretório com os fixtures (default: data/seed)")
    ap.add_argument("--invest", action="store_true",
                    help="popula só a carteira de investimentos")
    ap.add_argument("--no-invest", action="store_true",
                    help="popula só o controle de gastos")
    args = ap.parse_args()

    src = Path(args.source)
    if args.invest:
        fixtures = _read_invest_fixtures(src)
        if not fixtures:
            sys.exit(f"Fixtures de investimento não encontrados em {src}.")
        sheets.ensure_tabs()
        if not args.force:
            busy = [tab for tab in _non_empty_tabs() if tab in INVEST_TABS]
            if busy:
                sys.exit(f"Estas abas já têm dados: {', '.join(busy)}.\n"
                         "Use --force para sobrescrever.")
        print(f"Populando a carteira a partir de {src}...")
        _seed_invest(fixtures)
        print("\nPronto! Rode: uv run python -m finance.invest report")
        return

    if not (src / "ledger.jsonl").exists():
        sys.exit(f"Fixtures não encontrados em {src} (esperado ledger.jsonl, rules.json, "
                 "taxonomy.yaml, budgets.json).")

    print(f"Conferindo a planilha (SHEET_ID) e criando as abas que faltam...")
    sheets.ensure_tabs()

    if not args.force:
        busy = _non_empty_tabs()
        if busy:
            sys.exit(f"Estas abas já têm dados: {', '.join(busy)}.\n"
                     "Use --force para sobrescrever (a versão anterior fica no histórico do "
                     "Google Sheets).")

    fx = _read_fixtures(src)
    print(f"Populando a partir de {src}...")
    sheets.write_records("Ledger", fx["ledger"])
    print(f"  Ledger:   {len(fx['ledger'])} transações")
    sheets.write_records("Rules", fx["rules"])
    print(f"  Rules:    {len(fx['rules'])} regras")
    T.save(fx["taxonomy"], fx["taxonomy_treatments"], fx["taxonomy_meta"])
    print(f"  Taxonomy: {len(fx['taxonomy'])} categorias "
          f"(Treatment, Color, Icon, Essential)")
    T.save_subcategory_meta()
    print("  SubcategoryMeta: metadados opcionais de subcategorias")
    pmap = [{"PluggyCategory": k, "Category": v[0],
             "Subcategory": (v[1] or None) if len(v) > 1 else None}
            for k, v in fx["pluggy_map"].items() if v]
    sheets.write_records("PluggyMap", pmap)
    print(f"  PluggyMap:{len(pmap)} categorias da Pluggy mapeadas")
    sheets.write_config("budgets", fx["budgets"])
    sheets.write_config("sync_state", {})
    sheets.write_config("timezone", DEFAULT_TIMEZONE)
    sheets.write_config("schema_version", sheets.SCHEMA_VERSION)
    print("  Config:   budgets, sync_state, timezone, schema_version")

    invest = None if args.no_invest else _read_invest_fixtures(src)
    if invest:
        _seed_invest(invest)
        sheets.write_config("invest_monthly_contribution", 1000)

    info = sheets.check()
    print(f"\nPronto! Banco de demonstração criado em '{info['title']}'.")
    print(f"  {info['url']}")
    print("\nPróximo passo: uv run python -m finance.report "
          "&& (cd frontend && npm run dev)")


if __name__ == "__main__":
    main()
