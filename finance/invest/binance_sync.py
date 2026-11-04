"""Conferência da cripto da carteira com a Binance (spot + funding + earn).

Mesmo papel da Pluggy no `invest sync`: compara, não escreve. A quantidade que a Binance
informa é a verdade sobre o que está lá; a carteira é a soma das movimentações. Quando
as duas não batem, vira pendência `quantity_mismatch` com a movimentação sugerida
(`BUY`/`SELL` da diferença, ao preço em BRL que a Binance usou), para o usuário
confirmar em `.invest_decisions.json` (`trades`). Moeda com saldo na Binance que não está
na carteira vira `unknown_asset`.

O ativo da carteira casa com a moeda da Binance por, nesta ordem: `pluggy_code` igual ao
símbolo (ex.: "BTC"), ticker igual ao símbolo, ou `quote_symbol` `CURRENCY:<SÍMBOLO>USD`.
Só entram ativos da conta `binance` (ou de qualquer conta, se a carteira não tiver
nenhum ativo nela).
"""
from __future__ import annotations

import re

ACCOUNT = "binance"
# diferença menor que isso é arredondamento da corretora (satoshis, dust de earn)
QUANTITY_TOLERANCE = 1e-8
# moeda fora da carteira com valor menor que isso não vira pendência
UNKNOWN_MIN_BRL = 10.0
# diferença que vale menos que isso é rendimento do Earn pingando, não movimentação
MIN_DIFF_BRL = 1.0
_QUOTE = re.compile(r"^CURRENCY:([A-Z0-9]+?)USD$")


def _symbol_of(ticker: str, asset: dict) -> set:
    out = {ticker.upper()}
    if asset.get("pluggy_code"):
        out.add(str(asset["pluggy_code"]).upper())
    match = _QUOTE.match(str(asset.get("quote_symbol") or "").upper())
    if match:
        out.add(match.group(1))
    return out


def match_assets(assets: dict) -> dict:
    """{símbolo da Binance: ticker da carteira} para os ativos de cotação."""
    pool = {t: a for t, a in assets.items()
            if a.get("valuation") == "quote" and a.get("account") == ACCOUNT}
    if not pool:
        pool = {t: a for t, a in assets.items() if a.get("valuation") == "quote"
                and _QUOTE.match(str(a.get("quote_symbol") or "").upper())}
    out: dict = {}
    for ticker, asset in sorted(pool.items()):
        for symbol in _symbol_of(ticker, asset):
            out.setdefault(symbol, ticker)
    return out


def _fmt(qty: float) -> str:
    return f"{qty:.8f}".rstrip("0").rstrip(".") or "0"


def reconcile(binance: list[dict], positions: dict, assets: dict, today: str) -> list[dict]:
    """Pendências entre a Binance (`binance_client.fetch_positions`) e a carteira."""
    by_symbol = match_assets(assets)
    seen = set()
    pending = []
    for row in binance:
        symbol = str(row.get("asset") or "").upper()
        qty = float(row.get("quantity") or 0.0)
        value = row.get("value")
        ticker = by_symbol.get(symbol)
        if not ticker:
            if value is not None and float(value) >= UNKNOWN_MIN_BRL:
                pending.append({
                    "kind": "unknown_asset", "ticker": symbol, "name": symbol,
                    "quantity": qty, "value": float(value), "count": 1,
                    "source": "binance",
                    "message": f"{symbol}: {_fmt(qty)} na Binance (R$ {float(value):,.2f}) "
                               "não está na carteira. Cadastre o ativo ou ignore."})
            continue
        seen.add(ticker)
        ours = float(positions.get(ticker, {}).get("quantity", 0.0))
        pending.extend(_mismatch(ticker, symbol, qty, ours, value, today))
    # ativo da carteira na Binance que sumiu de lá: venda/saque não registrado
    for symbol, ticker in by_symbol.items():
        if ticker in seen or assets[ticker].get("account") != ACCOUNT:
            continue
        ours = float(positions.get(ticker, {}).get("quantity", 0.0))
        if ours > QUANTITY_TOLERANCE:
            seen.add(ticker)
            pending.extend(_mismatch(ticker, symbol, 0.0, ours, None, today))
    return pending


def _mismatch(ticker, symbol, broker, ours, value, today) -> list[dict]:
    difference = broker - ours
    if abs(difference) <= max(QUANTITY_TOLERANCE, 1e-9 * max(broker, ours)):
        return []
    price = (float(value) / broker) if value is not None and broker > 0 else None
    if price and abs(difference) * price < MIN_DIFF_BRL:
        return []
    side = "BUY" if difference > 0 else "SELL"
    suggestion = {"date": today, "ticker": ticker, "side": side,
                  "quantity": round(abs(difference), 8), "account": ACCOUNT,
                  "source": "binance", "note": "diferença com a Binance"}
    if price:
        suggestion["price"] = round(price, 2)
    verb = "faltando" if difference > 0 else "a mais"
    hint = (f" Sugestão: {side} {_fmt(abs(difference))} {ticker}"
            + (f" a R$ {price:,.2f}" if price else "") + ".")
    return [{
        "kind": "quantity_mismatch", "ticker": ticker, "source": "binance",
        "difference": difference, "broker_quantity": broker, "our_quantity": ours,
        # não é `trade`: o `--apply-balances` não pode gravar compra/venda sozinho
        "suggestion": suggestion,
        "message": f"{ticker}: a Binance informa {_fmt(broker)} ({symbol}) e a carteira "
                   f"tem {_fmt(ours)}. Tem movimentação {verb}.{hint}",
    }]


def suggested(pending: list[dict]) -> list[dict]:
    """Movimentações sugeridas, prontas para `trades` do `.invest_decisions.json`."""
    return [item["suggestion"] for item in pending if item.get("suggestion")]
