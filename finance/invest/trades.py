"""Movimentações (aba **InvestTrades**): os fatos de onde tudo é derivado.

`side` diz o que aconteceu:
  BUY/SELL      compra e venda de cotas
  DIVIDEND/JCP  provento recebido (quantity = cotas, price = valor por cota)
  SPLIT         desdobramento ou grupamento (quantity = fator)
  ADJUST        acerto de quantidade sem preço
  BALANCE       saldo informado de ativo sem cotação (price = valor total)
"""

import uuid
from datetime import datetime, timezone

from . import sheets_io as io

TAB = "InvestTrades"
SIDES = ("BUY", "SELL", "DIVIDEND", "JCP", "SPLIT", "ADJUST", "BALANCE")
INCOME_SIDES = ("DIVIDEND", "JCP")


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalize(rec: dict) -> dict:
    side = (rec.get("side") or "BUY").strip().upper()
    return {
        "id": (rec.get("id") or new_id()),
        "date": (rec.get("date") or "").strip(),
        "ticker": (rec.get("ticker") or "").strip().upper(),
        "side": side if side in SIDES else "BUY",
        "quantity": float(rec.get("quantity") or 0.0),
        "price": float(rec.get("price") or 0.0),
        "fees": float(rec.get("fees") or 0.0),
        "currency": (rec.get("currency") or "BRL"),
        "fx_rate": float(rec["fx_rate"]) if rec.get("fx_rate") else 1.0,
        "account": (rec.get("account") or None),
        "note": (rec.get("note") or None),
        "source": (rec.get("source") or "manual"),
        "ledger_id": (rec.get("ledger_id") or None),
        "created_at": (rec.get("created_at") or _now()),
    }


def load(records=None) -> list[dict]:
    rows = records if records is not None else io.read(TAB)
    trades = [normalize(row) for row in rows if (row.get("ticker") or "").strip()]
    return sort(trades)


def sort(trades: list[dict]) -> list[dict]:
    """Ordem cronológica. O sort é estável, então empate no mesmo dia preserva a ordem
    de entrada, que é o que o preço médio corrente precisa."""
    return sorted(trades, key=lambda t: (t.get("date") or "", t.get("created_at") or ""))


def save(trades: list[dict]) -> None:
    io.write(TAB, sort(trades))


def append(trades: list[dict]) -> int:
    return io.append(TAB, [normalize(t) for t in trades])


def by_ticker(trades: list[dict]) -> dict:
    out: dict = {}
    for trade in trades:
        out.setdefault(trade["ticker"], []).append(trade)
    return out


def total_brl(trade: dict) -> float:
    """Valor da operação em reais. Provento com cotas usa valor por cota; sem cotas,
    `price` já é o total."""
    if trade["side"] in INCOME_SIDES and trade["quantity"] <= 0:
        return trade["price"] * trade["fx_rate"]
    if trade["side"] == "BALANCE":
        return trade["price"] * trade["fx_rate"]
    quantity = trade["quantity"] or 1.0
    return quantity * trade["price"] * trade["fx_rate"]
