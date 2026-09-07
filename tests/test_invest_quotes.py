"""Cotações: símbolo do Google Finance, tolerância a erro e último preço bom."""

from datetime import datetime, timedelta

from finance.invest import assets as A
from finance.invest import quotes as Q

NOW = datetime(2026, 9, 7, 15, 0, 0)
SERIAL_NOW = (NOW - datetime(1899, 12, 30)).total_seconds() / 86400


def test_kind_guess_covers_the_real_portfolio():
    assert Q.guess_kind("BBAS3") == "stock_br"
    assert Q.guess_kind("B3SA3") == "stock_br"   # radical com dígito no meio
    assert Q.guess_kind("snag11") == "fii_br"
    assert Q.guess_kind("VOO") == "stock_us"
    assert Q.guess_kind("BTC") == "crypto"
    assert Q.guess_kind("USDBRL") == "fx"
    # renda fixa não tem símbolo, e o palpite não inventa um
    assert Q.guess_kind("IPCA2050") == "manual"
    assert Q.guess_kind("CDB-XP") == "manual"


def test_formulas_avoid_the_locale_argument_separator():
    """Fórmula com dois argumentos quebraria em planilha com locale diferente."""
    for ticker in ("BBAS3", "SNAG11", "VOO", "BTC", "USDBRL"):
        kind = Q.guess_kind(ticker)
        formula = Q.formula_for(Q.symbol_for(ticker, kind), kind)
        assert formula.startswith("=GOOGLEFINANCE(")
        assert ";" not in formula and '",' not in formula


def test_foreign_and_crypto_convert_to_reais():
    assert Q.formula_for(Q.symbol_for("VOO", "stock_us"), "stock_us") == \
        '=GOOGLEFINANCE("VOO")*GOOGLEFINANCE("CURRENCY:USDBRL")'
    assert Q.formula_for(Q.symbol_for("BTC", "crypto"), "crypto") == \
        '=GOOGLEFINANCE("CURRENCY:BTCUSD")*GOOGLEFINANCE("CURRENCY:USDBRL")'


def test_manual_asset_gets_no_formula():
    assert Q.formula_for(Q.symbol_for("IPCA2050", "manual"), "manual") is None


def test_broken_formula_falls_back_to_the_last_good_price():
    quotes = Q.load([{"ticker": "WEGE3", "price": None, "last_price": 51.74,
                      "updated_at": SERIAL_NOW}], now=NOW)
    quote = quotes["WEGE3"]
    assert quote["price"] == 51.74
    assert quote["stale"] is True
    assert quote["fell_back"] is True


def test_fresh_quote_is_not_stale():
    quotes = Q.load([{"ticker": "WEGE3", "price": 51.74, "updated_at": SERIAL_NOW}],
                    now=NOW)
    assert quotes["WEGE3"]["stale"] is False
    assert quotes["WEGE3"]["updated_at"] == "2026-09-07T15:00:00"


def test_sheet_that_stopped_recalculating_is_stale():
    old = (NOW - timedelta(days=3) - datetime(1899, 12, 30)).total_seconds() / 86400
    quotes = Q.load([{"ticker": "WEGE3", "price": 51.74, "updated_at": old}], now=NOW)
    assert quotes["WEGE3"]["stale"] is True


def test_missing_lists_only_quote_priced_assets():
    assets = A.load([
        {"ticker": "BBAS3", "node": "acoes", "target_pct": 1.0},
        {"ticker": "VOO", "node": "stocks", "target_pct": 1.0},
        {"ticker": "IPCA2050", "node": "rf", "valuation": "pluggy", "target_pct": 1.0},
        {"ticker": "INTER", "node": "stocks", "valuation": "balance", "target_pct": 1.0},
    ])
    quotes = Q.load([{"ticker": "BBAS3", "price": 22.52, "updated_at": SERIAL_NOW}],
                    now=NOW)
    pending = Q.missing(quotes, assets)
    assert [entry["ticker"] for entry in pending] == ["VOO"]


def test_rows_for_carry_the_formula_and_the_timestamp():
    row = Q.rows_for([{"ticker": "WEGE3", "kind": "stock_br"}])[0]
    assert row["price"] == '=GOOGLEFINANCE("BVMF:WEGE3")'
    assert row["updated_at"] == "=NOW()"
    assert row["quote_symbol"] == "BVMF:WEGE3"


def test_keep_last_good_only_writes_what_changed():
    records = [{"ticker": "AAA", "last_price": 10.0}, {"ticker": "BBB",
                                                       "last_price": None}]
    quotes = {"AAA": {"price": 10.0, "fell_back": False},
              "BBB": {"price": 20.0, "fell_back": False}}
    changes = Q.keep_last_good(records, quotes, "2026-09-07")
    assert changes == [(3, {"last_price": 20.0, "last_price_at": "2026-09-07"})]


def test_fx_rate_reads_the_dollar_line():
    quotes = Q.load([{"ticker": "USDBRL", "price": 5.1233, "updated_at": SERIAL_NOW}],
                    now=NOW)
    assert Q.fx_rate(quotes) == 5.1233
    assert Q.fx_rate({}) is None
