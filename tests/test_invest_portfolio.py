"""Motor de posições: preço médio, venda, provento, saldo informado e rentabilidade.

Os números de referência vêm da planilha financas-2.0, para o motor reproduzir o que já
funcionava e corrigir só o que estava errado nela.
"""

from finance.invest import assets as A
from finance.invest import policy as P
from finance.invest import portfolio as PF
from tests.test_invest_policy import TEMPLATE


def _assets(*rows):
    return A.load(list(rows))


def test_average_price_uses_only_purchases():
    """SNAG11: 62 cotas a 9,79 e 94 a 10,74, como está na planilha."""
    assets = _assets({"ticker": "SNAG11", "node": "fiis", "target_pct": 0.2})
    trades = [
        {"date": "2026-04-16", "ticker": "SNAG11", "side": "BUY", "quantity": 62,
         "price": 9.79},
        {"date": "2026-04-16", "ticker": "SNAG11", "side": "BUY", "quantity": 94,
         "price": 10.74},
    ]
    position = PF.build(assets, trades, {"SNAG11": {"price": 9.91}})["SNAG11"]
    assert position["quantity"] == 156
    assert round(position["avg_price_brl"], 2) == 10.36
    assert round(position["cost"], 2) == 1616.54
    assert round(position["value"], 2) == 1545.96


def test_position_and_profit_match_the_spreadsheet():
    """BBAS3: 25 cotas a 27,96, cotação 22,52, prejuízo de 19,46%."""
    assets = _assets({"ticker": "BBAS3", "node": "acoes", "target_pct": 0.06})
    trades = [{"date": "2026-04-16", "ticker": "BBAS3", "side": "BUY",
               "quantity": 25, "price": 27.96}]
    position = PF.build(assets, trades, {"BBAS3": {"price": 22.52}})["BBAS3"]
    assert round(position["cost"], 2) == 699.00
    assert round(position["value"], 2) == 563.00
    assert round(position["profit"], 2) == -136.00
    assert round(position["profit_pct"] * 100, 2) == -19.46


def test_sale_keeps_the_average_price_and_books_the_result():
    assets = _assets({"ticker": "XPTO3", "node": "acoes", "target_pct": 1.0})
    trades = [
        {"date": "2026-01-10", "ticker": "XPTO3", "side": "BUY", "quantity": 100,
         "price": 10.0},
        {"date": "2026-02-10", "ticker": "XPTO3", "side": "SELL", "quantity": 40,
         "price": 15.0},
    ]
    position = PF.build(assets, trades, {"XPTO3": {"price": 15.0}})["XPTO3"]
    assert position["quantity"] == 60
    assert round(position["avg_price_brl"], 2) == 10.0
    assert round(position["cost"], 2) == 600.0
    assert round(position["realized"], 2) == 200.0


def test_income_never_touches_the_cost():
    """VISC11 pagou 0,84 por cota sobre 10 cotas, como veio no extrato."""
    assets = _assets({"ticker": "VISC11", "node": "fiis", "target_pct": 1.0})
    trades = [
        {"date": "2026-04-16", "ticker": "VISC11", "side": "BUY", "quantity": 10,
         "price": 99.98},
        {"date": "2026-08-14", "ticker": "VISC11", "side": "DIVIDEND", "quantity": 10,
         "price": 0.84},
    ]
    position = PF.build(assets, trades, {"VISC11": {"price": 103.80}})["VISC11"]
    assert round(position["cost"], 2) == 999.80
    assert round(position["income"], 2) == 8.40
    assert round(position["profit"], 2) == 38.20


def test_split_multiplies_quantity_and_keeps_the_cost():
    assets = _assets({"ticker": "SPLT3", "node": "acoes", "target_pct": 1.0})
    trades = [
        {"date": "2026-01-10", "ticker": "SPLT3", "side": "BUY", "quantity": 50,
         "price": 20.0},
        {"date": "2026-03-01", "ticker": "SPLT3", "side": "SPLIT", "quantity": 2},
    ]
    position = PF.build(assets, trades, {"SPLT3": {"price": 10.0}})["SPLT3"]
    assert position["quantity"] == 100
    assert round(position["cost"], 2) == 1000.0
    assert round(position["avg_price_brl"], 2) == 10.0


def test_foreign_purchase_keeps_native_price_and_rate():
    """VOO comprado em dólar: o custo em reais usa o câmbio do dia da compra."""
    assets = _assets({"ticker": "VOO", "node": "stocks", "currency": "USD",
                      "target_pct": 1.0, "lot_size": 0.0001})
    trades = [{"date": "2026-04-16", "ticker": "VOO", "side": "BUY",
               "quantity": 2.46963785, "price": 610.5, "currency": "USD",
               "fx_rate": 5.1233}]
    position = PF.build(assets, trades, {"VOO": {"price": 3627.35}})["VOO"]
    assert round(position["avg_price"], 2) == 610.5          # continua em dólar
    assert round(position["avg_price_brl"], 2) == 3127.77    # e em reais
    assert round(position["value"], 2) == 8958.24


def test_balance_asset_follows_deposits_and_updates():
    """O exemplo do Inter: base de 10.000, aporte de 3.000, saldo informado 13.450."""
    assets = _assets({"ticker": "INTER-GLOBAL", "node": "stocks",
                      "valuation": "balance", "target_pct": 1.0})
    trades = [
        {"date": "2026-07-15", "ticker": "INTER-GLOBAL", "side": "BALANCE",
         "price": 10000.0},
        {"date": "2026-08-20", "ticker": "INTER-GLOBAL", "side": "BUY", "price": 3000.0},
        {"date": "2026-09-07", "ticker": "INTER-GLOBAL", "side": "BALANCE",
         "price": 13450.0},
    ]
    position = PF.build(assets, trades)["INTER-GLOBAL"]
    assert round(position["value"], 2) == 13450.0
    assert round(position["cost"], 2) == 13000.0
    assert round(position["income"], 2) == 450.0
    assert position["last_balance_date"] == "2026-09-07"


def test_balance_before_any_update_is_just_the_deposits():
    assets = _assets({"ticker": "CAIXINHA", "node": "rf", "valuation": "balance",
                      "target_pct": 1.0})
    trades = [
        {"date": "2026-07-15", "ticker": "CAIXINHA", "side": "BALANCE", "price": 10000.0},
        {"date": "2026-08-20", "ticker": "CAIXINHA", "side": "BUY", "price": 3000.0},
    ]
    position = PF.build(assets, trades)["CAIXINHA"]
    assert round(position["value"], 2) == 13000.0
    assert round(position["income"], 2) == 0.0


def test_missing_quote_marks_stale_without_zeroing_the_position():
    assets = _assets({"ticker": "SEMCOTA", "node": "acoes", "target_pct": 1.0})
    trades = [{"date": "2026-01-10", "ticker": "SEMCOTA", "side": "BUY",
               "quantity": 10, "price": 50.0}]
    position = PF.build(assets, trades, {"SEMCOTA": {"price": None}})["SEMCOTA"]
    assert position["stale"] is True
    assert round(position["value"], 2) == 500.0


def test_total_return_divides_profit_by_cost():
    """O erro da planilha era somar percentuais: 100% e 0% não dão 100% no total."""
    assets = _assets(
        {"ticker": "AAA", "node": "acoes", "target_pct": 1.0},
        {"ticker": "BBB", "node": "fiis", "target_pct": 1.0},
    )
    trades = [
        {"date": "2026-01-01", "ticker": "AAA", "side": "BUY", "quantity": 10,
         "price": 10.0},
        {"date": "2026-01-01", "ticker": "BBB", "side": "BUY", "quantity": 90,
         "price": 10.0},
    ]
    positions = PF.build(assets, trades, {"AAA": {"price": 20.0}, "BBB": {"price": 10.0}})
    tree = P.load(TEMPLATE)
    total = PF.totals(positions, tree)
    assert round(total["cost"], 2) == 1000.0
    assert round(total["value"], 2) == 1100.0
    assert round(total["profit_pct"] * 100, 2) == 10.0


def test_allocation_reports_drift_against_the_target():
    assets = _assets(
        {"ticker": "AAA", "node": "acoes", "target_pct": 1.0},
        {"ticker": "BBB", "node": "rf", "target_pct": 1.0},
    )
    trades = [
        {"date": "2026-01-01", "ticker": "AAA", "side": "BUY", "quantity": 40,
         "price": 10.0},
        {"date": "2026-01-01", "ticker": "BBB", "side": "BUY", "quantity": 60,
         "price": 10.0},
    ]
    positions = PF.build(assets, trades, {"AAA": {"price": 10.0}, "BBB": {"price": 10.0}})
    tree = P.load(TEMPLATE)
    spread = PF.allocation(positions, tree)
    assert round(spread["acoes"]["real_pct"], 4) == 0.4
    assert round(spread["acoes"]["target_pct"], 4) == 0.336
    assert round(spread["acoes"]["drift"], 4) == 0.064
    assert round(spread["rf"]["drift"], 4) == 0.4


def test_excluded_class_stays_out_of_the_eligible_base():
    assets = _assets(
        {"ticker": "AAA", "node": "acoes", "target_pct": 1.0},
        {"ticker": "BTC", "node": "cripto", "target_pct": 1.0},
    )
    trades = [
        {"date": "2026-01-01", "ticker": "AAA", "side": "BUY", "quantity": 10,
         "price": 10.0},
        {"date": "2026-01-01", "ticker": "BTC", "side": "BUY", "quantity": 1,
         "price": 500.0},
    ]
    positions = PF.build(assets, trades, {"AAA": {"price": 10.0}, "BTC": {"price": 500.0}})
    total = PF.totals(positions, P.load(TEMPLATE))
    assert round(total["value"], 2) == 600.0
    assert round(total["eligible_value"], 2) == 100.0


def test_synced_asset_uses_the_balance_entries_the_sync_wrote():
    """Ativo da Pluggy é ativo por saldo: quem escreve o lançamento é o sync."""
    assets = _assets({"ticker": "TESOURO", "node": "rf", "valuation": "pluggy",
                      "target_pct": 1.0})
    trades = [
        {"date": "2026-04-16", "ticker": "TESOURO", "side": "BUY", "price": 7564.95},
        {"date": "2026-09-07", "ticker": "TESOURO", "side": "BALANCE", "price": 7865.82},
    ]
    position = PF.build(assets, trades)["TESOURO"]
    assert round(position["value"], 2) == 7865.82
    assert round(position["cost"], 2) == 7564.95
    assert position["stale"] is False


def test_synced_asset_without_any_balance_is_stale():
    assets = _assets({"ticker": "TESOURO", "node": "rf", "valuation": "pluggy",
                      "target_pct": 1.0})
    trades = [{"date": "2026-04-16", "ticker": "TESOURO", "side": "BUY",
               "price": 7564.95}]
    position = PF.build(assets, trades)["TESOURO"]
    assert position["stale"] is True
    assert round(position["value"], 2) == 7564.95
