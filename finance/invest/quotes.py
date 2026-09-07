"""Cotações (aba **Quotes**), o encapsulamento do GOOGLEFINANCE.

A aba é a única com fórmula: `price` guarda a chamada e o Sheets devolve o resultado já
calculado quando a API lê com UNFORMATTED_VALUE. Isso dá cotação de ação, FII, ativo
americano, cripto e câmbio sem nenhuma chave de API.

As fórmulas são escritas **sem separador de argumentos** (`=GOOGLEFINANCE("BVMF:WEGE3")`,
sem o segundo parâmetro) porque esse separador muda com o locale da planilha, e o app é
público. `last_price` guarda o último valor bom, para uma falha momentânea da fórmula não
zerar a carteira.
"""

from datetime import datetime, timedelta

from .. import sheets
from . import sheets_io as io

TAB = "Quotes"
FX_TICKER = "USDBRL"
STALE_AFTER = timedelta(hours=24)

# Como cada tipo vira símbolo do Google Finance. `manual` é o ativo sem cotação.
KINDS = ("stock_br", "fii_br", "stock_us", "crypto", "fx", "manual")
_SHEETS_EPOCH = datetime(1899, 12, 30)
# Palpites para o autocomplete da tela, não uma lista fechada: cripto e ação americana
# de três letras são indistinguíveis pelo formato.
_CRYPTO_HINTS = ("BTC", "ETH", "SOL", "ADA", "XRP", "DOGE", "BNB", "LTC", "USDT", "USDC")


def guess_kind(ticker: str) -> str:
    """Palpite pelo formato do ticker. É sugestão de tela: quem decide é o catálogo,
    porque BTC e uma ação americana de três letras são indistinguíveis daqui."""
    code = (ticker or "").strip().upper()
    if not code:
        return "manual"
    if code in ("USDBRL", "USD/BRL", "USD"):
        return "fx"
    if code in _CRYPTO_HINTS:
        return "crypto"
    if code.endswith("11") and code[:-2].isalpha():
        return "fii_br"
    if len(code) == 5 and code[:4].isalpha() and code[4] in "34568":
        return "stock_br"
    if code.isalpha() and len(code) <= 5:
        return "stock_us"
    return "manual"


def symbol_for(ticker: str, kind: str) -> str | None:
    code = (ticker or "").strip().upper()
    if kind in ("stock_br", "fii_br"):
        return f"BVMF:{code}"
    if kind == "stock_us":
        return code
    if kind == "crypto":
        return f"CURRENCY:{code}USD"
    if kind == "fx":
        return "CURRENCY:USDBRL"
    return None


def formula_for(symbol: str | None, kind: str) -> str | None:
    """Fórmula em reais. Ativo em dólar já sai convertido pelo câmbio do momento,
    como a planilha fazia."""
    if not symbol:
        return None
    if kind in ("stock_br", "fii_br"):
        return f'=GOOGLEFINANCE("{symbol}")'
    if kind == "fx":
        return '=GOOGLEFINANCE("CURRENCY:USDBRL")'
    if kind in ("stock_us", "crypto"):
        return f'=GOOGLEFINANCE("{symbol}")*GOOGLEFINANCE("CURRENCY:USDBRL")'
    return None


def _serial_to_datetime(serial):
    if serial in (None, ""):
        return None
    try:
        return _SHEETS_EPOCH + timedelta(days=float(serial))
    except (TypeError, ValueError):
        return None


def normalize(rec: dict, now: datetime | None = None) -> dict:
    """Converte a linha crua em cotação utilizável, decidindo se está defasada."""
    now = now or datetime.now()
    price = rec.get("price")
    last = rec.get("last_price")
    calculated_at = _serial_to_datetime(rec.get("updated_at"))
    stale = price is None
    if not stale and calculated_at and (now - calculated_at) > STALE_AFTER:
        # a planilha não recalculou: o número existe mas não é de agora
        stale = True
    value = price if price is not None else last
    return {
        "ticker": (rec.get("ticker") or "").strip().upper(),
        "quote_symbol": rec.get("quote_symbol"),
        "kind": rec.get("kind") or "manual",
        "currency": rec.get("currency") or "BRL",
        "price": float(value) if value is not None else None,
        "stale": stale,
        "fell_back": price is None and last is not None,
        "updated_at": calculated_at.isoformat(timespec="seconds")
        if calculated_at else rec.get("last_price_at"),
    }


def load(records=None, now: datetime | None = None) -> dict:
    rows = records if records is not None else io.read(TAB)
    quotes = {}
    for row in rows:
        quote = normalize(row, now)
        if quote["ticker"]:
            quotes[quote["ticker"]] = quote
    return quotes


def fx_rate(quotes: dict) -> float | None:
    quote = quotes.get(FX_TICKER)
    return quote["price"] if quote and quote["price"] else None


def missing(quotes: dict, assets: dict) -> list[dict]:
    """Ativos cotados que ainda não têm linha na aba. É o que `ensure` vai criar."""
    out = []
    for ticker, asset in assets.items():
        if asset["valuation"] != "quote" or ticker in quotes:
            continue
        kind = asset.get("quote_kind") or guess_kind(ticker)
        out.append({"ticker": ticker, "kind": kind,
                    "quote_symbol": asset.get("quote_symbol") or symbol_for(ticker, kind)})
    return out


def rows_for(entries: list[dict]) -> list[dict]:
    """Linhas prontas para o append: a fórmula vai no lugar do preço."""
    rows = []
    for entry in entries:
        kind = entry.get("kind") or guess_kind(entry["ticker"])
        symbol = entry.get("quote_symbol") or symbol_for(entry["ticker"], kind)
        rows.append({
            "ticker": entry["ticker"], "quote_symbol": symbol,
            "price": formula_for(symbol, kind) or "", "currency": "BRL",
            "kind": kind, "updated_at": "=NOW()",
        })
    return rows


def ensure(entries: list[dict]) -> int:
    """Cria as linhas que faltam. Escrita com USER_ENTERED, então a fórmula vira fórmula."""
    rows = rows_for(entries)
    return sheets.append_rows(TAB, rows) if rows else 0


def keep_last_good(records: list[dict], quotes: dict, today: str) -> list[tuple]:
    """Mudanças para gravar o último preço bom, para a próxima falha ter em que cair."""
    changes = []
    for index, row in enumerate(records):
        ticker = (row.get("ticker") or "").strip().upper()
        quote = quotes.get(ticker)
        if not quote or quote["fell_back"] or quote["price"] is None:
            continue
        if row.get("last_price") == quote["price"]:
            continue
        changes.append((index + 2,
                        {"last_price": quote["price"], "last_price_at": today}))
    return changes
