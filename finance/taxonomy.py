"""Carrega e valida a taxonomia do usuário (aba **Taxonomy** do Google Sheets).

Aba Taxonomy: 1 linha por categoria, colunas `Category | Subcategories` (subs separados por
vírgula). `load()` reconstrói o dict `{categoria: [subs]}` que o resto do pipeline espera.
"""

from . import sheets

# Tratamento de cada categoria: como o dinheiro é tratado nos relatórios.
#   fluxo     → conta em Receitas/Gastos (padrão)
#   poupança  → não é gasto; alimenta "Poupado" e a taxa de poupança (Reserva, Investimentos)
#   movimento → fora do fluxo, só auditoria (Transferências, Formatura, Compartilhado)
TREATMENTS = ("fluxo", "poupança", "movimento")

# Fallback legado — usado quando a coluna Treatment ainda não existe/está vazia na planilha.
# Mantém o comportamento do antigo `NON_CASHFLOW` até a taxonomia trazer o tratamento explícito.
_LEGACY_TREATMENT = {
    "Reserva": "poupança", "Investimentos": "poupança",
    "Transferências": "movimento", "Formatura": "movimento",
    "Compartilhado": "movimento",
}


def _norm_treatment(raw: str | None, cat: str) -> str:
    t = (raw or "").strip().lower()
    if t in ("poupanca", "poupança"):
        t = "poupança"
    return t if t in TREATMENTS else _LEGACY_TREATMENT.get(cat, "fluxo")


def _split_subs(raw: str | None) -> list[str]:
    return [s.strip() for s in (raw or "").split(",") if s.strip()]


def load() -> dict:
    tax: dict = {}
    for rec in sheets.read_records("Taxonomy"):
        cat = (rec.get("Category") or "").strip()
        if cat:
            tax[cat] = _split_subs(rec.get("Subcategories"))
    return tax


def load_treatments() -> dict:
    """Mapa {categoria: tratamento} da coluna Treatment (com fallback legado)."""
    out: dict = {}
    for rec in sheets.read_records("Taxonomy"):
        cat = (rec.get("Category") or "").strip()
        if cat:
            out[cat] = _norm_treatment(rec.get("Treatment"), cat)
    return out


def load_all() -> tuple[dict, dict]:
    """Lê a aba Taxonomy UMA vez e devolve (taxonomia, tratamentos). Evita 2
    requests quando o chamador precisa dos dois (ex.: categorize.apply)."""
    tax, treats, _ = load_full()
    return tax, treats


def load_meta() -> dict:
    """Cor e ícone por categoria, para o dashboard. Colunas opcionais."""
    return load_full()[2]


def load_full() -> tuple[dict, dict, dict]:
    """(taxonomia, tratamentos, meta) numa leitura só."""
    tax: dict = {}
    treats: dict = {}
    meta: dict = {}
    for rec in sheets.read_records("Taxonomy"):
        cat = (rec.get("Category") or "").strip()
        if not cat:
            continue
        tax[cat] = _split_subs(rec.get("Subcategories"))
        treats[cat] = _norm_treatment(rec.get("Treatment"), cat)
        color = (rec.get("Color") or "").strip()
        icon = (rec.get("Icon") or "").strip()
        essential = bool(rec.get("Essential"))
        if color or icon or essential:
            meta[cat] = {"color": color or None, "icon": icon or None,
                         "essential": essential}
    return tax, treats, meta


def treatment_of(treatments: dict, cat: str | None) -> str:
    """Tratamento de uma categoria; cai no fallback legado se não estiver no mapa."""
    if cat and cat in treatments:
        return treatments[cat]
    return _LEGACY_TREATMENT.get(cat or "", "fluxo")


def save(tax: dict, treatments: dict | None = None, meta: dict | None = None) -> None:
    """Grava o dict {categoria: [subs]} na aba Taxonomy (usado pelo seed).
    `treatments` define o Tratamento; `meta` traz {cat: {color, icon}}. Ambos opcionais."""
    treatments = treatments or {}
    meta = meta or {}
    records = [{"Category": cat, "Subcategories": ", ".join(subs or []),
                "Treatment": _norm_treatment(treatments.get(cat), cat),
                "Color": (meta.get(cat) or {}).get("color"),
                "Icon": (meta.get(cat) or {}).get("icon"),
                "Essential": bool((meta.get(cat) or {}).get("essential"))}
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
