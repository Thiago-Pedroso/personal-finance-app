"""Inicializa o banco de dados no Google Sheets com dados de demonstração.

Cria as abas (`Ledger`, `Rules`, `Taxonomy`, `Config`) e as popula a partir dos *fixtures
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
from .config import SEED_DIR


def _read_fixtures(src: Path) -> dict:
    ledger = [json.loads(ln) for ln in
              (src / "ledger.jsonl").read_text().splitlines() if ln.strip()]
    rules = json.loads((src / "rules.json").read_text())
    taxonomy = yaml.safe_load((src / "taxonomy.yaml").read_text()) or {}
    budgets = json.loads((src / "budgets.json").read_text())
    pmap_file = src / "pluggy_map.yaml"
    pmap = yaml.safe_load(pmap_file.read_text()) if pmap_file.exists() else {}
    return {"ledger": ledger, "rules": rules.get("rules", rules),
            "taxonomy": taxonomy, "budgets": budgets, "pluggy_map": pmap or {}}


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
    # grava categorias + coluna Treatment (default via fallback legado por categoria)
    T.save(fx["taxonomy"])
    print(f"  Taxonomy: {len(fx['taxonomy'])} categorias (com Treatment)")
    pmap = [{"PluggyCategory": k, "Category": v[0],
             "Subcategory": (v[1] or None) if len(v) > 1 else None}
            for k, v in fx["pluggy_map"].items() if v]
    sheets.write_records("PluggyMap", pmap)
    print(f"  PluggyMap:{len(pmap)} categorias da Pluggy mapeadas")
    sheets.write_config("budgets", fx["budgets"])
    sheets.write_config("sync_state", {})
    sheets.write_config("schema_version", sheets.SCHEMA_VERSION)
    print("  Config:   budgets, sync_state, schema_version")

    info = sheets.check()
    print(f"\nPronto! Banco de demonstração criado em '{info['title']}'.")
    print(f"  {info['url']}")
    print("\nPróximo passo: uv run python -m finance.report "
          "&& (cd frontend && npm run dev)")


if __name__ == "__main__":
    main()
