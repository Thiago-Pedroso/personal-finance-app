import pytest

from finance import report


@pytest.fixture(autouse=True)
def treatments(monkeypatch):
    monkeypatch.setattr(report, "_TREAT", {"Casa": "fluxo", "Salário": "fluxo",
                                           "Reserva": "poupança"})
    monkeypatch.setattr(report, "_SAVING_SUBS", ("Aporte", "Resgate"))


def _month(entries):
    bucket = report._blank()
    for amount, category, subcategory in entries:
        report._post(bucket, amount, category, subcategory)
    return report._month_json("2030-01", bucket)


def test_balance_is_what_is_left_after_saving():
    month = _month([(1000, "Salário", None), (-300, "Casa", None),
                    (-500, "Reserva", "Aporte")])
    assert (month["income"], month["expense"], month["saved"]) == (1000, 300, 500)
    assert month["surplus"] == 700
    assert month["net"] == 200


def test_withdrawal_reduces_saved_and_returns_to_balance():
    month = _month([(-200, "Reserva", "Aporte"), (400, "Reserva", "Resgate"),
                    (-150, "Casa", None)])
    assert (month["income"], month["expense"]) == (0, 150)
    assert month["saved"] == -200
    assert month["net"] == 50


def test_yield_is_outside_every_total():
    month = _month([(30, "Reserva", "Rendimento")])
    assert (month["income"], month["expense"], month["saved"], month["net"]) == (0, 0, 0, 0)


def test_other_saving_subcategory_counts_as_flow():
    month = _month([(-5, "Reserva", "Custos")])
    assert (month["expense"], month["saved"], month["net"]) == (5, 0, -5)
    assert month["by_category"]["Reserva"]["expense"] == 5


def _linked(amount, links, needed):
    return {"id": "tx", "signed_amount": amount, "category": "Reserva",
            "subcategory": "Aporte" if amount < 0 else "Resgate", "splits": None,
            "invest": {"needed": needed, "links": [
                {"ticker": ticker, "amount": value} for ticker, value in links]}}


def test_saving_into_free_node_stays_in_balance(monkeypatch):
    monkeypatch.setattr(report, "_FREE_TICKERS", frozenset({"LIVRE"}))
    bucket = report._blank()
    report._post(bucket, 1000, "Salário", None)
    report._add_record(bucket, _linked(-800, [("OBJETIVO", 500), ("LIVRE", 300)], 800))
    month = report._month_json("2030-01", bucket)
    assert month["saved"] == 500
    assert month["moved_to_free"] == 300
    assert month["net"] == 500


def test_withdrawal_from_free_node_does_not_reduce_saved(monkeypatch):
    monkeypatch.setattr(report, "_FREE_TICKERS", frozenset({"LIVRE"}))
    bucket = report._blank()
    report._add_record(bucket, _linked(200, [("LIVRE", 200)], 200))
    month = report._month_json("2030-01", bucket)
    assert (month["saved"], month["moved_to_free"], month["net"]) == (0, -200, 0)


def test_without_free_nodes_everything_counts_as_saved():
    bucket = report._blank()
    report._add_record(bucket, _linked(-300, [("LIVRE", 300)], 300))
    assert report._month_json("2030-01", bucket)["saved"] == 300
