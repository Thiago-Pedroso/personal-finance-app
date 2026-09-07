"""Os fixtures sintéticos precisam formar uma carteira válida e navegável."""

import json

import yaml

from finance.config import SEED_DIR
from finance.invest import accounts as ACC
from finance.invest import assets as A
from finance.invest import plan as PL
from finance.invest import policy as P
from finance.invest import portfolio as PF
from finance.invest import quotes as Q
from finance.invest import trades as T


def _fixtures():
    policy = yaml.safe_load((SEED_DIR / "invest_policy.yaml").read_text())
    assets = yaml.safe_load((SEED_DIR / "invest_assets.yaml").read_text())
    accounts = yaml.safe_load((SEED_DIR / "invest_accounts.yaml").read_text())
    trades = [json.loads(line) for line in
              (SEED_DIR / "invest_trades.jsonl").read_text().splitlines() if line.strip()]
    return P.load(policy), A.load(assets), ACC.load(accounts), T.load(trades)


def test_seed_policy_is_valid_and_adds_up():
    tree, _, _, _ = _fixtures()
    assert P.validate(tree) == []
    assert round(sum(P.leaf_weights(tree).values()), 6) == 1.0


def test_every_seed_asset_points_to_a_real_leaf():
    tree, assets, accounts, _ = _fixtures()
    for asset in assets.values():
        assert asset["node"] in tree, asset["ticker"]
        assert P.is_leaf(tree, asset["node"]), asset["ticker"]
        assert asset["account"] in accounts, asset["ticker"]


def test_seed_targets_close_each_class():
    _, assets, _, _ = _fixtures()
    unbalanced = {node: total for node, total in A.target_sums(assets).items()
                  if node != "reservas"}
    for node, total in unbalanced.items():
        assert round(total, 4) == 1.0, node


def test_seed_portfolio_builds_and_can_be_planned():
    tree, assets, _, trades = _fixtures()
    quotes = {ticker: {"price": 30.0, "stale": False, "fell_back": False}
              for ticker in assets}
    positions = PF.build(assets, trades, quotes)
    assert positions["BBAS3"]["quantity"] == 180
    assert positions["TESOURO-IPCA-2045"]["value"] == 6480.0
    # a atualização de saldo virou rendimento, não aporte
    assert positions["TESOURO-IPCA-2045"]["cost"] == 6000.0
    assert round(positions["TESOURO-IPCA-2045"]["income"], 2) == 480.0
    plan = PL.build(positions, assets, tree, 1000)
    assert round(plan["allocated"] + plan["leftover"], 2) == 1000.0


def test_seed_quote_assets_get_a_formula():
    _, assets, _, _ = _fixtures()
    pending = Q.missing({}, assets)
    tickers = {entry["ticker"] for entry in pending}
    assert {"BBAS3", "HGLG11", "VOO", "BTC"} <= tickers
    # ativo por saldo não recebe fórmula
    assert "TESOURO-IPCA-2045" not in tickers
    assert "RESERVA-EMERGENCIA" not in tickers
    for row in Q.rows_for(pending):
        assert row["price"].startswith("=GOOGLEFINANCE(")


def test_foreign_seed_trade_keeps_native_price_and_rate():
    _, assets, _, trades = _fixtures()
    voo = [t for t in trades if t["ticker"] == "VOO"][0]
    assert voo["currency"] == "USD"
    assert voo["fx_rate"] == 5.02
