"""Onde o dinheiro está custodiado (aba **InvestAccounts**).

Uma conta responde duas perguntas: onde cada ativo mora e qual o total que a instituição
informa. É o total que ancora as caixinhas, que a Pluggy vê como um bloco só.
"""

from . import sheets_io as io

TAB = "InvestAccounts"
KINDS = ("broker", "wallet", "bucket")


def normalize(rec: dict) -> dict:
    kind = (rec.get("kind") or "").strip().lower()
    return {
        "id": (rec.get("id") or "").strip(),
        "name": (rec.get("name") or rec.get("id") or "").strip(),
        "institution": (rec.get("institution") or None),
        "kind": kind if kind in KINDS else "broker",
        "pluggy_item_id": (rec.get("pluggy_item_id") or None),
        "currency": (rec.get("currency") or "BRL"),
    }


def load(records=None) -> dict:
    rows = records if records is not None else io.read(TAB)
    return {acc["id"]: acc for acc in map(normalize, rows) if acc["id"]}


def save(accounts: dict) -> None:
    io.write(TAB, [accounts[key] for key in sorted(accounts)])


def by_pluggy_item(accounts: dict, item_id: str) -> dict | None:
    for acc in accounts.values():
        if acc["pluggy_item_id"] and str(acc["pluggy_item_id"]) == str(item_id):
            return acc
    return None
