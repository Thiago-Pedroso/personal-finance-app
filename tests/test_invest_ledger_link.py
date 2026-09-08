"""Proventos reconhecidos a partir do que já está no Ledger."""

from finance.invest import assets as A
from finance.invest import ledger_link as LL

ASSETS = A.load([
    {"ticker": "VISC11", "node": "fiis", "target_pct": 0.5},
    {"ticker": "HGLG11", "node": "fiis", "target_pct": 0.5},
    {"ticker": "BBAS3", "node": "acoes", "target_pct": 1.0},
])
POSITIONS = {"VISC11": {"quantity": 10.0}, "HGLG11": {"quantity": 12.0},
             "BBAS3": {"quantity": 25.0}}


def _record(**kwargs):
    base = {"id": "tx-1", "date": "2026-08-14", "description": "", "signed_amount": 0.0,
            "category": None, "subcategory": None}
    return {**base, **kwargs}


def test_dividend_description_gives_ticker_and_per_share_value():
    """O formato real do extrato: RENDIMENTOS DE CLIENTES VISC11 S/ 10."""
    records = [_record(description="RENDIMENTOS DE CLIENTES VISC11 S/             10",
                       signed_amount=8.40)]
    trades, pending = LL.income_from_ledger(records, ASSETS, POSITIONS, [])
    assert pending == []
    assert trades[0]["ticker"] == "VISC11"
    assert trades[0]["side"] == "DIVIDEND"
    assert trades[0]["quantity"] == 10.0
    assert round(trades[0]["price"], 2) == 0.84
    assert trades[0]["ledger_id"] == "tx-1"


def test_interest_on_capital_is_told_apart():
    records = [_record(description="JUROS SOBRE CAPITAL PROPRIO BBAS3 S/ 25",
                       signed_amount=12.5)]
    trades, _ = LL.income_from_ledger(records, ASSETS, POSITIONS, [])
    assert trades[0]["side"] == "JCP"


def test_quantity_that_does_not_match_becomes_a_missing_purchase():
    records = [_record(description="RENDIMENTOS DE CLIENTES HGLG11 S/ 20",
                       signed_amount=23.60)]
    trades, pending = LL.income_from_ledger(records, ASSETS, POSITIONS, [])
    assert trades == []
    assert pending[0]["kind"] == "income_quantity_mismatch"
    assert "falta registrar uma compra" in pending[0]["message"]


def test_account_yield_without_a_ticker_is_left_alone():
    records = [_record(description="Rendimento automático", signed_amount=0.16)]
    trades, pending = LL.income_from_ledger(records, ASSETS, POSITIONS, [])
    assert (trades, pending) == ([], [])


def test_already_imported_income_is_not_repeated():
    records = [_record(description="RENDIMENTOS DE CLIENTES VISC11 S/ 10",
                       signed_amount=8.40)]
    existing = [{"ledger_id": "tx-1"}]
    trades, _ = LL.income_from_ledger(records, ASSETS, POSITIONS, existing)
    assert trades == []


def test_outgoing_transaction_is_never_read_as_income():
    records = [_record(description="RENDIMENTOS DE CLIENTES VISC11 S/ 10",
                       signed_amount=-8.40)]
    trades, _ = LL.income_from_ledger(records, ASSETS, POSITIONS, [])
    assert trades == []
