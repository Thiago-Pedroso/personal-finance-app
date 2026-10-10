import pytest

from finance import balance


def test_without_anchor_accumulates_from_first_month():
    totals = balance.running_totals({"2030-01": 100.0, "2030-02": -40.0}, None)
    assert totals == {"2030-01": 100.0, "2030-02": 60.0}


def test_anchor_starts_the_running_total():
    anchor = {"date": "2030-02-10", "value": 5000.0}
    totals = balance.running_totals(
        {"2030-01": 999.0, "2030-02": -200.0, "2030-03": 300.0}, anchor)
    assert totals == {"2030-01": None, "2030-02": 4800.0, "2030-03": 5100.0}


def test_anchor_day_itself_is_already_in_the_value():
    anchor = {"date": "2030-02-10", "value": 0.0}
    assert not balance.counts_after("2030-02-10", anchor)
    assert balance.counts_after("2030-02-11", anchor)
    assert balance.counts_after("2030-01-01", None)


def test_parse_anchor_normalizes_and_accepts_empty():
    assert balance.parse_anchor(None) is None
    assert balance.parse_anchor("") is None
    assert balance.parse_anchor({"date": "2030-02-10", "value": "7200.004"}) == {
        "date": "2030-02-10", "value": 7200.0}


@pytest.mark.parametrize("raw", [
    {"date": "10/02/2030", "value": 1},
    {"date": "2030-02-10"},
    {"date": "2030-02-10", "value": "muito"},
    "2030-02-10",
])
def test_parse_anchor_rejects_malformed_values(raw):
    with pytest.raises(SystemExit):
        balance.parse_anchor(raw)
