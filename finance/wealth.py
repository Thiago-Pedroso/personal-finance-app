"""Patrimônio: bens e dívidas informados à mão, fora da carteira de investimentos.

Carro, imóvel, empréstimo de pessoa física, financiamento: coisas que não têm cotação
nem aparecem no Open Finance. Ficam num blob em `Config[wealth_manual]` (sem aba nova):

    {"assets": [{"id", "name", "kind", "value", "as_of", "note"}],
     "debts":  [{"id", "name", "kind", "value", "as_of", "note"}]}

O valor é sempre positivo; quem decide o sinal é a lista. A tela Patrimônio soma com o
`wealth` da carteira e com a fatura em aberto (`Config[invest_debts]`).

CLI:
  uv run python -m finance.wealth show
  uv run python -m finance.wealth set data/.wealth_input.json   # usado pelo dashboard
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

from . import sheets
from .config import REPORTS_DIR

MANUAL_KEY = "wealth_manual"
ASSET_KINDS = ("veiculo", "imovel", "outro")
DEBT_KINDS = ("emprestimo", "financiamento", "outro")
_MAX_ITEMS = 100


class WealthError(ValueError):
    pass


def _slug(text: str) -> str:
    t = unicodedata.normalize("NFKD", text)
    t = "".join(c for c in t if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:40] or "item"


def _item(raw, kinds: tuple, seen: set) -> dict:
    if not isinstance(raw, dict):
        raise WealthError("item inválido")
    name = " ".join(str(raw.get("name") or "").split())
    if not name:
        raise WealthError("item sem nome")
    try:
        value = round(float(raw.get("value")), 2)
    except (TypeError, ValueError):
        raise WealthError(f"{name}: valor inválido") from None
    if value < 0:
        raise WealthError(f"{name}: valor negativo (o sinal vem da lista)")
    kind = raw.get("kind") if raw.get("kind") in kinds else "outro"
    as_of = str(raw.get("as_of") or date.today().isoformat())[:10]
    try:
        date.fromisoformat(as_of)
    except ValueError:
        raise WealthError(f"{name}: data inválida {as_of!r}") from None
    base = str(raw.get("id") or "") or _slug(name)
    item_id, n = base, 2
    while item_id in seen:
        item_id, n = f"{base}-{n}", n + 1
    seen.add(item_id)
    return {"id": item_id, "name": name, "kind": kind, "value": value, "as_of": as_of,
            "note": " ".join(str(raw.get("note") or "").split()) or None}


def normalize(raw) -> dict:
    """Valida e normaliza o blob. Lixo vira erro; ausente vira vazio."""
    raw = raw if isinstance(raw, dict) else {}
    out = {}
    for key, kinds in (("assets", ASSET_KINDS), ("debts", DEBT_KINDS)):
        items = raw.get(key) or []
        if not isinstance(items, list) or len(items) > _MAX_ITEMS:
            raise WealthError(f"{key}: lista inválida")
        seen: set = set()
        out[key] = [_item(item, kinds, seen) for item in items]
    return out


def block(raw) -> dict:
    """Versão tolerante para o relatório: blob quebrado não derruba a tela."""
    try:
        data = normalize(raw)
    except WealthError as exc:
        return {"assets": [], "debts": [], "error": str(exc),
                "assets_total": 0.0, "debts_total": 0.0}
    return {**data,
            "assets_total": round(sum(i["value"] for i in data["assets"]), 2),
            "debts_total": round(sum(i["value"] for i in data["debts"]), 2)}


def load() -> dict:
    return block(sheets.read_config(MANUAL_KEY, None))


def save(raw) -> dict:
    data = normalize(raw)
    sheets.write_config(MANUAL_KEY, data)
    return block(data)


def patch_report(manual: dict, path: Path | None = None) -> bool:
    """Atualiza só `manual_wealth` no invest.json, sem refazer a carteira inteira."""
    path = path or REPORTS_DIR / "invest.json"
    if not path.exists():
        return False
    report = json.loads(path.read_text())
    report["manual_wealth"] = manual
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description="Bens e dívidas informados à mão.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show")
    s = sub.add_parser("set")
    s.add_argument("file")
    args = ap.parse_args()
    if args.cmd == "show":
        print(json.dumps(load(), ensure_ascii=False, indent=2))
        return
    try:
        manual = save(json.loads(Path(args.file).read_text()))
    except (WealthError, json.JSONDecodeError) as exc:
        sys.exit(f"erro: {exc}")
    patch_report(manual)
    print(f"Patrimônio manual: {len(manual['assets'])} bem(ns) R$ {manual['assets_total']:,.2f}"
          f" | {len(manual['debts'])} dívida(s) R$ {manual['debts_total']:,.2f}")


if __name__ == "__main__":
    main()
