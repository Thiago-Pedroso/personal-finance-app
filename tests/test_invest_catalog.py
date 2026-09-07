"""Catálogo: normalização, setores vindos do uso e redistribuição de alvos."""

from finance.invest import accounts as ACC
from finance.invest import assets as A

ROWS = [
    {"ticker": "bbas3", "node": "acoes", "sector": "Banco", "target_pct": 0.06,
     "account": "xp"},
    {"ticker": "ITUB3", "node": "acoes", "sector": "Banco", "target_pct": 0.06,
     "account": "xp"},
    {"ticker": "WEGE3", "node": "acoes", "sector": "Máquinas", "target_pct": 0.88,
     "account": "xp"},
    {"ticker": "IPCA2050", "node": "rf", "valuation": "pluggy", "target_pct": 1.0,
     "account": "xp", "sector": "Tesouro IPCA+"},
    {"ticker": "ANTIGO", "node": "acoes", "target_pct": 0.5, "active": False},
]


def test_normalize_fills_the_defaults():
    asset = A.load(ROWS)["BBAS3"]
    assert asset["ticker"] == "BBAS3"
    assert asset["valuation"] == "quote"
    assert asset["lot_size"] == 1.0
    assert asset["active"] is True
    assert asset["name"] == "BBAS3"


def test_inactive_asset_stays_out_of_the_groups():
    assets = A.load(ROWS)
    assert "ANTIGO" not in A.active(assets)
    assert [a["ticker"] for a in A.by_node(assets)["acoes"]] == ["BBAS3", "ITUB3", "WEGE3"]


def test_sectors_come_from_what_is_in_use():
    assert A.sectors(A.load(ROWS))[0] == "Banco"
    assert "Tesouro IPCA+" in A.sectors(A.load(ROWS))


def test_target_sums_and_warning():
    assets = A.load(ROWS)
    assert round(A.target_sums(assets)["acoes"], 4) == 1.0
    assert A.unbalanced_nodes(assets) == {}

    off = A.load(ROWS[:2])
    assert round(A.unbalanced_nodes(off)["acoes"], 4) == 0.12


def test_redistribute_keeps_the_total_at_one():
    targets = {"A": 0.25, "B": 0.25, "C": 0.25, "D": 0.25}
    out = A.redistribute(targets, {"A": 0.4})
    assert round(sum(out.values()), 6) == 1.0
    assert out["A"] == 0.4
    assert round(out["B"], 4) == 0.2


def test_locked_targets_do_not_move():
    targets = {"A": 0.25, "B": 0.25, "C": 0.25, "D": 0.25}
    out = A.redistribute(targets, {"A": 0.4}, locked={"B"})
    assert out["B"] == 0.25
    assert round(out["C"], 4) == round(out["D"], 4) == 0.175
    assert round(sum(out.values()), 6) == 1.0


def test_redistribute_with_nobody_free_leaves_the_sum_off():
    targets = {"A": 0.5, "B": 0.5}
    out = A.redistribute(targets, {"A": 0.8}, locked={"B"})
    assert round(sum(out.values()), 6) == 1.3


def test_account_kind_falls_back_to_broker():
    accounts = ACC.load([
        {"id": "xp", "name": "XP", "kind": "broker", "pluggy_item_id": "item-1"},
        {"id": "picpay", "name": "PicPay", "kind": "bucket"},
        {"id": "bin", "name": "Binance", "kind": "sei la"},
    ])
    assert accounts["bin"]["kind"] == "broker"
    assert accounts["picpay"]["kind"] == "bucket"
    assert ACC.by_pluggy_item(accounts, "item-1")["id"] == "xp"
    assert ACC.by_pluggy_item(accounts, "item-9") is None
