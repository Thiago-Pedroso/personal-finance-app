"""Edição pontual de linhas do Ledger, para o dashboard.

Caminho curto e separado do `categorize`: não lê a aba inteira, não carrega regras
e não gera relatório. Só localiza a linha e grava as células que mudaram. Criar
regra e categorizar em lote continuam no `categorize`, porque afetam outras linhas.

Uso: uv run python -m finance.edit data/.edits.json
"""

import argparse
import json
from pathlib import Path

from . import sheets
from .config import REPORTS_DIR
from .ledger import normalize_tags, update_tags

EDITABLE = {"category", "subcategory", "note", "tags", "splits",
            "amount_override", "excluded", "tags_add", "tags_remove"}


def _taxonomy() -> dict:
    """Taxonomia do dashboard.json em disco: valida sem gastar leitura do Sheets."""
    path = REPORTS_DIR / "dashboard.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text()).get("taxonomy") or {}


def _validate(fields: dict, tax: dict) -> None:
    desconhecidos = set(fields) - EDITABLE
    if desconhecidos:
        raise ValueError(f"campos não editáveis: {sorted(desconhecidos)}")
    category = fields.get("category")
    if not category or not tax:
        return
    if category not in tax:
        raise ValueError(f"categoria inexistente: {category!r}")
    subcategory = fields.get("subcategory")
    if subcategory and subcategory not in (tax[category] or []):
        raise ValueError(f"subcategoria inexistente em {category}: {subcategory!r}")


def _locate(precisa_tags: bool) -> tuple[dict, dict]:
    """Linha de cada id e, se preciso, as tags atuais — tudo num request."""
    campos = ["id", "tags"] if precisa_tags else ["id"]
    colunas = sheets.read_columns("Ledger", campos)
    rows, tags = {}, {}
    for index, value in enumerate(colunas["id"]):
        if not value:
            continue
        rows[value] = index + 2          # +1 do cabeçalho, +1 porque a planilha é 1-based
        if precisa_tags:
            tags[value] = colunas["tags"][index] or []
    return rows, tags


def apply_edits(edits: list[dict]) -> dict:
    """edits = [{"ids": [...], "fields": {...}}]. Retorna o que foi gravado."""
    tax = _taxonomy()
    for edit in edits:
        _validate(edit.get("fields") or {}, tax)

    precisa_tags = any(("tags_add" in (e.get("fields") or {})
                        or "tags_remove" in (e.get("fields") or {})) for e in edits)
    rows, tags_atuais = _locate(precisa_tags)

    changes, missing = [], []
    for edit in edits:
        base = dict(edit.get("fields") or {})
        adicionar = base.pop("tags_add", None)
        remover = base.pop("tags_remove", None)
        if "tags" in base:
            base["tags"] = normalize_tags(base["tags"])
        # uma edição manual passa a valer sobre regra e mapa, como no categorize
        if "category" in base:
            base.update(category_source="manual", rule_id=None,
                        needs_review=False, reviewed=True)
        for transaction_id in edit.get("ids") or []:
            row = rows.get(transaction_id)
            if row is None:
                missing.append(transaction_id)
                continue
            fields = dict(base)
            if adicionar or remover:
                fields["tags"] = update_tags(tags_atuais.get(transaction_id, []),
                                             adicionar, remover)
            if fields:
                changes.append((row, fields))

    ranges = sheets.update_fields("Ledger", changes)
    return {"rows": len(changes), "ranges": ranges, "missing": missing}


def main() -> None:
    ap = argparse.ArgumentParser(description="Edita linhas do Ledger sem reler a aba.")
    ap.add_argument("file", help='JSON: {"edits": [{"ids": [...], "fields": {...}}]}')
    args = ap.parse_args()
    payload = json.loads(Path(args.file).read_text())
    print(json.dumps(apply_edits(payload.get("edits") or []), ensure_ascii=False))


if __name__ == "__main__":
    main()
