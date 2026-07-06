"""Carrega e valida a taxonomia do usuário (aba **Taxonomy** do Google Sheets).

Aba Taxonomy: 1 linha por categoria, colunas `Category | Subcategories` (subs separados por
vírgula). `load()` reconstrói o dict `{categoria: [subs]}` que o resto do pipeline espera.
"""

from . import sheets


def _split_subs(raw: str | None) -> list[str]:
    return [s.strip() for s in (raw or "").split(",") if s.strip()]


def load() -> dict:
    tax: dict = {}
    for rec in sheets.read_records("Taxonomy"):
        cat = (rec.get("Category") or "").strip()
        if cat:
            tax[cat] = _split_subs(rec.get("Subcategories"))
    return tax


def save(tax: dict) -> None:
    """Grava o dict {categoria: [subs]} na aba Taxonomy (usado pelo seed)."""
    records = [{"Category": cat, "Subcategories": ", ".join(subs or [])}
               for cat, subs in tax.items()]
    sheets.write_records("Taxonomy", records)


def valid(tax: dict, category: str | None, subcategory: str | None) -> bool:
    if category is None:
        return False
    if category not in tax:
        return False
    if subcategory is None:
        return True
    return subcategory in (tax.get(category) or [])
