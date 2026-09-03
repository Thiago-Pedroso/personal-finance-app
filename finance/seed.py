"""Inicializa o banco de dados no Google Sheets com dados de demonstração.

Cria as abas (`Ledger`, `Rules`, `Taxonomy`, `PluggyMap`, `Config`) a partir dos *fixtures
sintéticos* em `data/seed/`. Assim todo novo usuário começa com um banco funcional para entender
o app antes de conectar as próprias contas via Open Finance (Pluggy).

Uso:
  uv run python -m finance.seed                 # popula com data/seed/* (recusa abas não-vazias)
  uv run python -m finance.seed --force         # sobrescreve o que já existir
  uv run python -m finance.seed --source <DIR>  # usa fixtures de outro diretório (migração:
                                                #   DIR com ledger.jsonl/rules.json/
                                                #   taxonomy.yaml/budgets.json)
"""

import argparse
import json
import sys
from pathlib import Path

import yaml

from . import sheets
from . import taxonomy as T
from .config import DEFAULT_TIMEZONE, SEED_DIR


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


def _non_empty_tabs() -> list[str]:
    busy = []
    for tab in ("Ledger", "Rules", "Taxonomy", "PluggyMap"):
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
    args = ap.parse_args()

    src = Path(args.source)
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

    info = sheets.check()
    print(f"\nPronto! Banco de demonstração criado em '{info['title']}'.")
    print(f"  {info['url']}")
    print("\nPróximo passo: uv run python -m finance.report "
          "&& (cd frontend && npm run dev)")


if __name__ == "__main__":
    main()
