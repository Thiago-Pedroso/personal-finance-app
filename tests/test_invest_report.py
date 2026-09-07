"""Montagem do invest.json e o histórico diário."""

from finance.invest import accounts as ACC
from finance.invest import assets as A
from finance.invest import policy as P
from finance.invest import portfolio as PF
from finance.invest import report as R
from tests.test_invest_plan import QUOTES, ROWS, TRADES
from tests.test_invest_policy import TEMPLATE


def _report(**kwargs):
    assets = A.load(ROWS)
    quotes = {t: {"price": q["price"], "stale": False, "fell_back": False}
              for t, q in QUOTES.items()}
    return R.build(assets, TRADES, quotes, P.load(TEMPLATE),
                   ACC.load([{"id": "xp", "name": "XP", "kind": "broker"}]),
                   kwargs.pop("contribution", 3000.0), **kwargs)


def test_report_carries_what_the_screen_needs():
    report = _report()
    assert round(report["totals"]["value"], 2) == 43546.98
    assert report["plan"]["orders"]
    assert report["accounts"][0]["name"] == "XP"
    assert [item["node"] for item in report["allocation"]][0] == "acoes"
    assert report["problems"] == []


def test_stale_quote_shows_up_as_a_problem():
    assets = A.load(ROWS)
    quotes = {t: {"price": q["price"], "stale": t == "VOO", "fell_back": False}
              for t, q in QUOTES.items()}
    report = R.build(assets, TRADES, quotes, P.load(TEMPLATE), {}, 0.0)
    assert "VOO" in report["problems"][0]


def test_asset_pointing_nowhere_is_reported():
    assets = A.load(ROWS + [{"ticker": "ZZZ", "node": "inexistente", "target_pct": 1.0}])
    quotes = {t: {"price": q["price"], "stale": False, "fell_back": False}
              for t, q in QUOTES.items()}
    report = R.build(assets, TRADES, quotes, P.load(TEMPLATE), {}, 0.0)
    assert any("ZZZ" in problem for problem in report["problems"])


def test_snapshot_replaces_the_same_day_instead_of_duplicating():
    assets = A.load(ROWS)
    quotes = {t: {"price": q["price"], "stale": False, "fell_back": False}
              for t, q in QUOTES.items()}
    positions = PF.build(assets, TRADES, quotes)
    first = R.snapshot_rows(positions, "2026-09-07")
    existing = [{"date": "2026-09-06", "node": "acoes", "value": 1.0, "cost": 1.0}]
    merged = R.merge_snapshots(existing, first, "2026-09-07")
    again = R.merge_snapshots(merged, first, "2026-09-07")
    assert len(merged) == len(again)
    assert len([r for r in again if r["date"] == "2026-09-07"]) == len(first)


def test_history_sums_the_nodes_of_each_day():
    snapshots = [
        {"date": "2026-09-06", "node": "acoes", "value": 100.0, "cost": 90.0},
        {"date": "2026-09-06", "node": "rf", "value": 50.0, "cost": 50.0},
        {"date": "2026-09-07", "node": "acoes", "value": 110.0, "cost": 90.0},
    ]
    history = R.history_from(snapshots)
    assert history[0] == {"date": "2026-09-06", "value": 150.0, "cost": 140.0}
    assert history[1]["value"] == 110.0


def test_report_exposes_the_trade_log():
    report = _report()
    assert len(report["trades"]) == len(TRADES)
    assert report["trades"][0]["date"] <= report["trades"][-1]["date"]
    assert all("id" in trade for trade in report["trades"])


def test_class_out_of_the_targets_does_not_need_to_add_up():
    """Caixinha é saldo com nome: cobrar 100% de alvo ali seria ruído."""
    assets = A.load(ROWS + [{"ticker": "RESERVA", "node": "cripto", "target_pct": 0.0,
                             "valuation": "balance"}])
    quotes = {t: {"price": q["price"], "stale": False, "fell_back": False}
              for t, q in QUOTES.items()}
    report = R.build(assets, TRADES, quotes, P.load(TEMPLATE), {}, 0.0)
    assert report["problems"] == []
