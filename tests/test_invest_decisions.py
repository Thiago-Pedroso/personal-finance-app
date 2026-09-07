"""Arquivo de decisões: o caminho por conversa, sem tela e sem rede."""

from finance.invest import accounts as ACC
from finance.invest import assets as A
from finance.invest import decisions as D
from finance.invest import policy as P
from tests.test_invest_policy import TEMPLATE

ASSETS = A.load([
    {"ticker": "BBAS3", "node": "acoes", "target_pct": 0.5, "account": "xp"},
    {"ticker": "ITUB3", "node": "acoes", "target_pct": 0.5, "account": "xp"},
])
ACCOUNTS = ACC.load([{"id": "xp", "name": "XP", "kind": "broker"}])
TREE = P.load(TEMPLATE)


def _apply(data, trades=()):
    return D.plan_changes(data, ASSETS, ACCOUNTS, TREE, list(trades))


def test_trade_of_unknown_ticker_registers_the_asset():
    result = _apply({"trades": [{"date": "2026-09-07", "ticker": "SAPR11",
                                 "side": "BUY", "quantity": 30, "price": 4.5,
                                 "account": "xp"}]})
    asset = result["assets"]["SAPR11"]
    assert asset["quote_symbol"] == "BVMF:SAPR11"
    assert asset["valuation"] == "quote"
    assert result["quotes"] == [{"ticker": "SAPR11"}]
    # cadastrar sozinho não adivinha a classe: isso é decisão de política
    assert any("SAPR11" in problem for problem in result["problems"])


def test_fixed_income_ticker_becomes_a_balance_asset():
    result = _apply({"trades": [{"date": "2026-09-07", "ticker": "CDB-XP",
                                 "side": "BUY", "price": 1000.0}]})
    assert result["assets"]["CDB-XP"]["valuation"] == "balance"
    assert result["quotes"] == []


def test_balance_entry_becomes_a_trade_in_the_history():
    result = _apply({"balances": [{"ticker": "BBAS3", "date": "2026-09-07",
                                   "value": 13450.0}]})
    trade = result["trades"][0]
    assert trade["side"] == "BALANCE"
    assert trade["price"] == 13450.0
    assert trade["date"] == "2026-09-07"


def test_targets_reflow_the_unlocked_assets():
    result = _apply({"targets": {"acoes": {"BBAS3": 0.7}}})
    assert result["assets"]["BBAS3"]["target_pct"] == 0.7
    assert round(result["assets"]["ITUB3"]["target_pct"], 4) == 0.3


def test_locked_asset_keeps_its_target():
    assets = A.load([
        {"ticker": "A", "node": "acoes", "target_pct": 0.4},
        {"ticker": "B", "node": "acoes", "target_pct": 0.3},
        {"ticker": "C", "node": "acoes", "target_pct": 0.3},
    ])
    result = D.plan_changes({"targets": {"acoes": {"A": 0.5}},
                             "locked": {"acoes": ["B"]}},
                            assets, ACCOUNTS, TREE, [])
    assert result["assets"]["B"]["target_pct"] == 0.3
    assert round(result["assets"]["C"]["target_pct"], 4) == 0.2


def test_invalid_date_is_reported_and_dropped():
    result = _apply({"trades": [{"date": "07/09/2026", "ticker": "BBAS3",
                                 "side": "BUY", "quantity": 1, "price": 10.0}]})
    assert result["trades"] == []
    assert "data inválida" in result["problems"][0]


def test_selling_more_than_held_warns_without_blocking():
    existing = [{"date": "2026-01-01", "ticker": "BBAS3", "side": "BUY",
                 "quantity": 10, "price": 20.0}]
    result = _apply({"trades": [{"date": "2026-09-07", "ticker": "BBAS3",
                                 "side": "SELL", "quantity": 25, "price": 22.0}]},
                    trades=existing)
    assert len(result["trades"]) == 1
    assert any("quantidade negativa" in problem for problem in result["problems"])


def test_new_account_and_policy_node_are_created():
    result = _apply({
        "accounts": [{"id": "inter", "name": "Inter", "kind": "wallet"}],
        "policy": [{"node": "global", "name": "Global", "parent": "",
                    "target_pct": 0.0, "in_totals": True}],
    })
    assert result["accounts"]["inter"]["kind"] == "wallet"
    assert result["policy"]["global"]["name"] == "Global"
    assert result["policy"]["global"]["parent"] is None


def test_nothing_changes_when_the_file_is_empty():
    result = _apply({})
    assert result["trades"] == []
    assert result["assets"] == ASSETS
    assert result["problems"] == []


def test_new_node_keeps_the_role_it_was_given():
    result = _apply({"policy": [{"node": "a_aportar", "name": "Esperando aporte",
                                 "parent": "", "target_pct": 0.0, "in_totals": False,
                                 "role": "to_invest"}]})
    assert result["policy"]["a_aportar"]["role"] == "to_invest"
    assert result["policy"]["a_aportar"]["in_totals"] is False
