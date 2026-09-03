"""Mapa curado: categoria da Pluggy -> (nossa categoria, subcategoria).

Vive na aba **PluggyMap** do Sheets; `data/seed/pluggy_map.yaml` é só a semente
para quem começa do zero. Usado como dica: o `categorize` descarta o que não
existir na taxonomia. Direção de transferência é resolvida pelo `type`.
"""

import yaml

from . import sheets
from .config import SEED_DIR

# Categorias da Pluggy que são transferências genéricas (direção por tipo).
# Ficam no código: são nomes da Pluggy, não da taxonomia do usuário.
_TRANSFER_GENERIC = {"Transfer - PIX", "Transfer - TED", "Transfers",
                     "Same person transfer", "Third party transfer - PIX"}

_MAP: dict | None = None


def _from_sheet() -> dict:
    try:
        recs = sheets.read_records("PluggyMap")
    except sheets.SheetsError:
        return {}
    out = {}
    for r in recs:
        key = (r.get("PluggyCategory") or "").strip()
        cat = (r.get("Category") or "").strip()
        if key and cat:
            out[key] = (cat, (r.get("Subcategory") or "").strip() or None)
    return out


def _from_fixture() -> dict:
    path = SEED_DIR / "pluggy_map.yaml"
    if not path.exists():
        return {}
    raw = yaml.safe_load(path.read_text()) or {}
    return {k: (v[0], (v[1] or None) if len(v) > 1 else None)
            for k, v in raw.items() if v}


def load(refresh: bool = False) -> dict:
    """Mapa completo, com cache de módulo: `suggest` roda por transação."""
    global _MAP
    if _MAP is None or refresh:
        _MAP = _from_sheet() or _from_fixture()
    return _MAP


def suggest(pluggy_category: str | None, tx_type: str | None) -> tuple[str, str | None] | None:
    """Retorna (categoria, subcategoria) sugerida, ou None se não houver dica."""
    if not pluggy_category:
        return None
    if pluggy_category in _TRANSFER_GENERIC:
        if "PIX" in pluggy_category:
            sub = "PIX recebido" if tx_type == "CREDIT" else "PIX enviado"
        elif "TED" in pluggy_category:
            sub = "TED/DOC"
        else:
            sub = "PIX recebido" if tx_type == "CREDIT" else "TED/DOC"
        return ("Transferências", sub)
    return load().get(pluggy_category)
