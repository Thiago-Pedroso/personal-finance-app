"""Motor de aporte: divisão do dinheiro, lote, sobra e desvio depois."""

from finance.invest import assets as A
from finance.invest import plan as PL
from finance.invest import policy as P
from finance.invest import portfolio as PF
from tests.test_invest_policy import TEMPLATE

# Carteira com os valores da planilha: Ações 14.891,51 divididas em dez papéis,
# FIIs 6.858,22, renda fixa 8.300,30, VOO 8.967,68 e VNQ 4.529,27.
ROWS = ([{"ticker": f"AC{i}", "node": "acoes", "target_pct": 0.1} for i in range(10)]
        + [{"ticker": "FII1", "node": "fiis", "target_pct": 1.0},
           {"ticker": "RF1", "node": "rf", "target_pct": 1.0, "valuation": "balance"},
           {"ticker": "VOO", "node": "stocks", "target_pct": 1.0, "lot_size": 0.0001},
           {"ticker": "VNQ", "node": "reits", "target_pct": 1.0, "lot_size": 0.0001}])

TRADES = ([{"date": "2026-04-16", "ticker": f"AC{i}", "side": "BUY", "quantity": 50,
            "price": 29.783} for i in range(10)]
          + [{"date": "2026-04-16", "ticker": "FII1", "side": "BUY", "quantity": 1,
              "price": 6858.22},
             {"date": "2026-04-16", "ticker": "RF1", "side": "BALANCE", "price": 8300.30},
             {"date": "2026-04-16", "ticker": "VOO", "side": "BUY",
              "quantity": 2.46963785, "price": 3128.69},
             {"date": "2026-04-16", "ticker": "VNQ", "side": "BUY",
              "quantity": 9.19727258, "price": 466.64}])

QUOTES = {f"AC{i}": {"price": 29.783} for i in range(10)}
QUOTES.update({"FII1": {"price": 6858.22}, "VOO": {"price": 3631.17},
               "VNQ": {"price": 492.46}})


def _plan(contribution=3000.0, mode="spread"):
    assets = A.load(ROWS)
    tree = P.load(TEMPLATE)
    positions = PF.build(assets, TRADES, QUOTES)
    return PL.build(positions, assets, tree, contribution, mode), positions, tree


def test_targets_and_deficits_match_the_spreadsheet():
    plan, _, _ = _plan()
    nodes = {node["node"]: node for node in plan["nodes"]}
    assert round(plan["eligible_value"], 2) == 43546.98
    assert round(nodes["stocks"]["target_value"], 2) == 10426.52
    assert round(nodes["stocks"]["deficit"], 2) == 1458.85
    assert round(nodes["rf"]["deficit"], 2) == 1009.10
    assert round(nodes["acoes"]["deficit"], 2) == 748.29


def test_money_goes_where_the_gap_is():
    plan, _, _ = _plan()
    nodes = {node["node"]: node for node in plan["nodes"]}
    assert nodes["stocks"]["amount"] > nodes["rf"]["amount"] > nodes["acoes"]["amount"]
    # classes acima do alvo não recebem nada e nunca viram ordem de venda
    assert nodes["fiis"]["amount"] == 0
    assert nodes["reits"]["amount"] == 0
    assert all(order["amount"] > 0 for order in plan["orders"])


def test_allocated_plus_leftover_equals_the_contribution():
    plan, _, _ = _plan()
    assert round(plan["allocated"] + plan["leftover"], 2) == 3000.00


def test_leftover_is_smaller_than_the_cheapest_lot_available():
    plan, _, _ = _plan()
    assert plan["leftover"] < 29.783
    assert plan["blocked_nodes"] == ["acoes"]


def test_drift_shrinks_after_the_plan():
    plan, _, _ = _plan()
    for node in plan["nodes"]:
        if node["in_totals"] and node["deficit"] > 0:
            assert abs(node["drift_after"]) < abs(node["drift_before"])


def test_focus_mode_puts_everything_in_the_biggest_gap():
    plan, _, _ = _plan(mode="focus")
    assert len(plan["orders"]) == 1
    assert plan["orders"][0]["ticker"] == "VOO"
    assert round(plan["allocated"], 0) == 3000


def test_asset_without_quote_takes_the_amount_with_no_quantity():
    plan, _, _ = _plan()
    fixed = next(order for order in plan["orders"] if order["ticker"] == "RF1")
    assert fixed["price"] is None
    assert fixed["quantity"] == 0.0
    assert fixed["amount"] > 0


def test_zero_contribution_produces_no_orders():
    plan, _, _ = _plan(contribution=0)
    assert plan["orders"] == []
    assert plan["allocated"] == 0.0


def test_balanced_portfolio_follows_the_policy():
    """Sem desvio nenhum, o aporte segue a própria política em vez de travar."""
    assets = A.load([{"ticker": "A", "node": "rf", "target_pct": 1.0},
                     {"ticker": "B", "node": "acoes", "target_pct": 1.0}])
    tree = P.load([
        {"node": "rf", "name": "RF", "parent": "", "target_pct": 0.5, "in_totals": True},
        {"node": "acoes", "name": "Ações", "parent": "", "target_pct": 0.5,
         "in_totals": True}])
    trades = [{"date": "2026-01-01", "ticker": "A", "side": "BUY", "quantity": 100,
               "price": 1.0},
              {"date": "2026-01-01", "ticker": "B", "side": "BUY", "quantity": 100,
               "price": 1.0}]
    positions = PF.build(assets, trades, {"A": {"price": 1.0}, "B": {"price": 1.0}})
    plan = PL.build(positions, assets, tree, 100)
    amounts = {order["ticker"]: order["amount"] for order in plan["orders"]}
    assert amounts == {"A": 50.0, "B": 50.0}


def test_excluded_class_never_receives_a_contribution():
    assets = A.load(ROWS + [{"ticker": "BTC", "node": "cripto", "target_pct": 1.0}])
    trades = TRADES + [{"date": "2026-04-16", "ticker": "BTC", "side": "BUY",
                        "quantity": 1, "price": 3954.80}]
    positions = PF.build(assets, trades, {**QUOTES, "BTC": {"price": 3954.80}})
    plan = PL.build(positions, assets, P.load(TEMPLATE), 3000)
    assert all(order["node"] != "cripto" for order in plan["orders"])
