"""Proventos reconhecidos no extrato.

A descrição bancária de um rendimento traz o ticker e a quantidade de cotas
(`RENDIMENTOS DE CLIENTES VISC11 S/ 10`). Daí saem o ativo e o valor por cota sem ninguém
digitar. Quando a quantidade da descrição bate com a que a carteira tem, o lançamento é
confiável; quando não bate, além de virar revisão ele também denuncia uma compra que
ficou sem registro.

Quanto ainda há para aportar não sai do extrato: é o saldo das contas cujo nó tem papel
`to_invest`, que a conferência com a Pluggy mantém sozinha.
"""

import re
import unicodedata

from . import trades as T

INCOME_WORDS = ("RENDIMENTO", "DIVIDEND", "JCP", "JUROS SOBRE", "PROVENT", "AMORTIZ")
JCP_WORDS = ("JCP", "JUROS SOBRE")
# "S/ 10", "SOBRE 10 COTAS": a quantidade que a corretora usou para calcular
_QUANTITY = re.compile(r"(?:S/|SOBRE)\s*([\d.,]+)")


def norm(text: str | None) -> str:
    stripped = unicodedata.normalize("NFKD", str(text or ""))
    stripped = "".join(c for c in stripped if not unicodedata.combining(c))
    return " ".join(stripped.upper().split())


def _text_of(record: dict) -> str:
    return norm(" ".join(str(record.get(field) or "") for field in
                         ("description", "merchant_name", "counterparty")))


def looks_like_income(record: dict) -> bool:
    text = _text_of(record)
    return (record.get("signed_amount", 0) or 0) > 0 and \
        any(word in text for word in INCOME_WORDS)


def find_ticker(text: str, assets: dict) -> str | None:
    """Só reconhece ticker que já existe na carteira. Um crédito de rendimento de conta,
    sem ativo nenhum na descrição, passa direto e não é tocado."""
    tokens = set(re.split(r"[^A-Z0-9]+", text))
    for ticker in assets:
        if ticker in tokens:
            return ticker
    return None


def find_quantity(text: str) -> float | None:
    match = _QUANTITY.search(text)
    if not match:
        return None
    raw = match.group(1).replace(".", "").replace(",", ".")
    try:
        return float(raw)
    except ValueError:
        return None


def income_from_ledger(records: list[dict], assets: dict, positions: dict,
                       existing: list[dict]) -> tuple[list[dict], list[dict]]:
    """Devolve (lançamentos de provento, pendências)."""
    already = {trade.get("ledger_id") for trade in existing if trade.get("ledger_id")}
    suggested, pending = [], []
    for record in records:
        if not looks_like_income(record) or record["id"] in already:
            continue
        text = _text_of(record)
        ticker = find_ticker(text, assets)
        if not ticker:
            continue
        total = float(record.get("signed_amount") or 0.0)
        quantity = find_quantity(text)
        held = positions.get(ticker, {}).get("quantity")
        side = "JCP" if any(word in text for word in JCP_WORDS) else "DIVIDEND"
        trade = {"date": record.get("date"), "ticker": ticker, "side": side,
                 "quantity": quantity or 0.0,
                 "price": (total / quantity) if quantity else total,
                 "ledger_id": record["id"], "source": "ledger",
                 "note": record.get("description")}
        if quantity and held is not None and abs(quantity - held) > 1e-6:
            pending.append({
                "kind": "income_quantity_mismatch", "ticker": ticker,
                "ledger_id": record["id"], "trade": trade,
                "message": f"{ticker}: o provento de {record.get('date')} foi pago sobre "
                           f"{quantity:g} cotas e a carteira tem {held:g}. "
                           "Provavelmente falta registrar uma compra."})
            continue
        suggested.append(T.normalize(trade))
    return suggested, pending
