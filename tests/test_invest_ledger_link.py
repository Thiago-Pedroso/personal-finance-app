"""Proventos e aportes a alocar, a partir do que já está no Ledger."""

from finance.invest import assets as A
from finance.invest import ledger_link as LL

ASSETS = A.load([
    {"ticker": "VISC11", "node": "fiis", "target_pct": 0.5},
    {"ticker": "HGLG11", "node": "fiis", "target_pct": 0.5},
    {"ticker": "BBAS3", "node": "acoes", "target_pct": 1.0},
])
POSITIONS = {"VISC11": {"quantity": 10.0}, "HGLG11": {"quantity": 12.0},
             "BBAS3": {"quantity": 25.0}}
TREATMENTS = {"Investimentos": "poupança", "Reserva": "poupança",
              "Alimentação": "fluxo"}


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


def test_savings_transfer_without_a_trade_shows_up_as_unallocated():
    records = [
        _record(id="tx-9", description="TED CORRETORA", signed_amount=-3000.0,
                category="Investimentos", subcategory="Aporte"),
        _record(id="tx-10", description="Mercado", signed_amount=-120.0,
                category="Alimentação"),
    ]
    pending = LL.unallocated(records, [], TREATMENTS)
    assert len(pending) == 1
    assert pending[0]["ledger_id"] == "tx-9"
    assert pending[0]["amount"] == 3000.0


def test_transfer_already_linked_disappears_from_the_list():
    records = [_record(id="tx-9", description="TED CORRETORA", signed_amount=-3000.0,
                       category="Investimentos")]
    assert LL.unallocated(records, [{"ledger_id": "tx-9"}], TREATMENTS) == []


def test_rules_fill_in_the_recurring_destination():
    items = [{"description": "PIX PICPAY CAIXINHA", "amount": 500.0},
             {"description": "TED DESCONHECIDA", "amount": 100.0}]
    out = LL.apply_rules(items, [{"match": "picpay", "ticker": "RESERVA-EMERGENCIA"}])
    assert out[0]["suggested_ticker"] == "RESERVA-EMERGENCIA"
    assert "suggested_ticker" not in out[1]


def test_savings_goal_reads_the_bucket_balance(tmp_path, monkeypatch):
    """A meta para de pedir saldo digitado e passa a ler a caixinha de mesmo nome."""
    import json

    from finance import report as R

    reports = tmp_path / "reports"
    reports.mkdir()
    (reports / "invest.json").write_text(json.dumps({"positions": [
        {"ticker": "RESERVA-EMERGENCIA", "name": "Reserva de emergência",
         "valuation": "balance", "value": 19240.0},
        {"ticker": "BBAS3", "name": "BBAS3", "valuation": "quote", "value": 563.0},
    ]}), encoding="utf-8")
    monkeypatch.setattr(R, "REPORTS_DIR", reports)

    budgets = {"savings_goals": [
        {"name": "Reserva de emergência", "target": 40000, "current": 12000},
        {"name": "Trocar o carro", "target": 30000, "current": 6420},
    ]}
    savings = R._savings(budgets, 0, 0, 0, 0)
    goals = {goal["name"]: goal for goal in savings["goals"]}
    assert goals["Reserva de emergência"]["current"] == 19240.0
    assert goals["Reserva de emergência"]["source"] == "carteira"
    # meta sem caixinha correspondente continua com o valor informado
    assert goals["Trocar o carro"]["current"] == 6420.0
    assert goals["Trocar o carro"]["source"] == "informado"
