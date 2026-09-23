"""Ligação entre o Ledger e a carteira: destino, contas e extrato."""

from finance import categorize as C
from finance import ledger as L
from finance.invest import assets as A
from finance.invest import decisions as D
from finance.invest import ledger_link as LL
from finance.invest import pluggy_sync as PS
from finance.invest import portfolio as PF

TREATMENTS = {"Reserva": "poupança", "Investimentos": "poupança",
              "Transferências": "movimento", "Alimentação": "fluxo"}

ASSETS = A.load([
    {"ticker": "VIAGEM", "node": "reservas", "account": "banco", "valuation": "balance"},
    {"ticker": "RESERVA", "node": "reservas", "account": "banco", "valuation": "balance"},
    {"ticker": "CONTA-CORRETORA", "node": "livre", "account": "corretora", "valuation": "account",
     "pluggy_code": "acc-corretora"},
    {"ticker": "CONTA-CORRETORA-2", "node": "livre", "account": "corretora",
     "valuation": "account"},
    {"ticker": "IPCA", "node": "renda_fixa", "account": "corretora", "valuation": "pluggy"},
    {"ticker": "PETR3", "node": "acoes", "isin": "BRPETRACNOR9"},
])


def _record(record_id, amount, category, subcategory, **extra):
    return {"id": record_id, "date": "2026-09-08", "description": f"lançamento {record_id}",
            "signed_amount": amount, "category": category, "subcategory": subcategory,
            "account_id": "acc-banco", "item_id": "item-banco", **extra}


def _link(ledger_id, ticker, amount, side="BUY"):
    return {"id": f"t-{ledger_id}-{ticker}", "date": "2026-09-08", "ticker": ticker,
            "side": side, "price": amount, "ledger_id": ledger_id}


def test_contribution_without_destination_is_pending():
    records = [_record("a", -1200, "Reserva", "Aporte")]
    status = LL.destination_status(records, [], TREATMENTS)
    assert status["a"]["status"] == "missing"
    pending = LL.destination_pending(records, [], TREATMENTS)
    assert pending[0]["kind"] == "destination_missing"
    assert "sem destino" in pending[0]["message"]


def test_destination_can_split_a_transfer_between_envelopes():
    records = [_record("pix", -5000, None, None, splits=[
        {"amount": -3000, "category": "Investimentos", "subcategory": "Aporte"},
        {"amount": -2000, "category": "Reserva", "subcategory": "Aporte"}])]
    trades = [_link("pix", "CONTA-CORRETORA", 3000, "TRANSFER"), _link("pix", "VIAGEM", 2000)]
    status = LL.destination_status(records, trades, TREATMENTS, ASSETS)["pix"]
    assert status["status"] == "linked"
    assert {link["ticker"] for link in status["links"]} == {"CONTA-CORRETORA", "VIAGEM"}


def test_partial_over_and_orphan_links_are_reported():
    records = [_record("a", -1200, "Reserva", "Aporte"),
               _record("b", -600, "Reserva", "Aporte")]
    trades = [_link("a", "VIAGEM", 600), _link("b", "VIAGEM", 900),
              _link("gone", "VIAGEM", 50)]
    kinds = {item["kind"] for item in LL.destination_pending(records, trades, TREATMENTS)}
    assert kinds == {"destination_partial", "destination_over", "orphan_link"}


def test_internal_transfer_and_yield_need_no_destination():
    records = [_record("t", -2000, "Transferências", "TED/DOC"),
               _record("y", 10.0, "Reserva", "Rendimento")]
    assert LL.destination_status(records, [], TREATMENTS) == {}


def test_purchase_linked_to_a_movement_is_informative():
    records = [_record("compra", -1500.0, "Transferências", "TED/DOC")]
    status = LL.destination_status(records, [_link("compra", "IPCA", 1500.0)], TREATMENTS)
    assert status["compra"]["status"] == "info"


def test_income_recognizes_interest_and_lent_share_reimbursement():
    records = [
        {"id": "jcp", "date": "2026-09-09", "signed_amount": 3.00,
         "description": "JUROS S/ CAPITAL DE CLIENTES PETR3 S/ 20"},
        {"id": "evt", "date": "2026-08-28", "signed_amount": 2.50,
         "description": "CREDITO DE REEMBOLSO DE EVENTO BRPETRACNOR9"},
    ]
    trades, pending = LL.income_from_ledger(records, ASSETS, {"PETR3": {"quantity": 20}}, [])
    assert pending == []
    assert [(t["ticker"], t["side"]) for t in trades] == [("PETR3", "JCP"),
                                                           ("PETR3", "DIVIDEND")]


def test_account_has_no_profit_and_transfers_do_not_move_it():
    trades = [
        {"date": "2026-09-07", "ticker": "CONTA-CORRETORA", "side": "BALANCE", "price": 4000},
        {"date": "2026-09-08", "ticker": "CONTA-CORRETORA", "side": "TRANSFER", "price": 3000,
         "ledger_id": "pix"},
        {"date": "2026-09-23", "ticker": "CONTA-CORRETORA", "side": "BALANCE", "price": 7000},
    ]
    account = PF.build(ASSETS, trades)["CONTA-CORRETORA"]
    assert account["value"] == 7000
    assert account["profit"] == 0.0


def test_statement_gap_points_to_missing_statement():
    records = [{"account_id": "acc", "date": "2026-09-09", "signed_amount": 1000.0}]
    assert PS.statement_gap(records, "acc", "2026-09-07", "2026-09-23", 1000.4) is None
    gap = PS.statement_gap(records, "acc", "2026-09-07", "2026-09-23", 250.0)
    assert round(gap, 2) == -750.0


def test_bucket_yield_split_waits_for_destinations():
    report = PS.bucket_report(7000.0, {"VIAGEM": 1000.0, "RESERVA": 5000.0})
    assert PS.bucket_updates(report, "2026-09-23")
    report["blocked"] = 1
    assert PS.bucket_updates(report, "2026-09-23") == []
    pending = [{"kind": "destination_missing", "item_id": "item-banco"}]
    assert PS.blocking_destinations(pending, "item-banco") == pending


def test_links_replace_previous_destinations():
    records = {"a": _record("a", -1200, "Reserva", "Aporte")}
    existing = [_link("a", "RESERVA", 1200)]
    data = {"links": [{"ledger_id": "a", "destinations": [
        {"ticker": "VIAGEM", "amount": 700}, {"ticker": "RESERVA", "amount": 500}]}]}
    result = D.plan_changes(data, ASSETS, {}, {}, existing, records, TREATMENTS)
    assert result["problems"] == []
    assert result["removed_trades"] == {"t-a-RESERVA"}
    assert sorted((t["ticker"], t["side"], t["price"]) for t in result["trades"]) == [
        ("RESERVA", "BUY", 500.0), ("VIAGEM", "BUY", 700.0)]


def test_links_are_validated():
    records = {"a": _record("a", -1200, "Reserva", "Aporte")}
    too_much = {"links": [{"ledger_id": "a", "destinations": [
        {"ticker": "VIAGEM", "amount": 1500}]}]}
    not_envelope = {"links": [{"ledger_id": "a", "destinations": [
        {"ticker": "ITUB3", "amount": 100}]}]}
    for data in (too_much, not_envelope):
        result = D.plan_changes(data, ASSETS, {}, {}, [], records, TREATMENTS)
        assert result["trades"] == [] and result["problems"]


def test_withdrawal_becomes_a_sale_from_the_envelope():
    records = {"r": _record("r", 300, "Reserva", "Resgate")}
    data = {"links": [{"ledger_id": "r", "destinations": [
        {"ticker": "VIAGEM", "amount": 300}]}]}
    result = D.plan_changes(data, ASSETS, {}, {}, [], records, TREATMENTS)
    assert result["trades"][0]["side"] == "SELL"


def test_money_sent_to_the_broker_is_linked_to_the_account():
    records = {"pix": _record("pix", -5000, "Investimentos", "Aporte")}
    data = {"links": [{"ledger_id": "pix", "destinations": [
        {"ticker": "CONTA-CORRETORA", "amount": 5000}]}]}
    result = D.plan_changes(data, ASSETS, {}, {}, [], records, TREATMENTS)
    assert result["problems"] == []
    assert result["trades"][0]["side"] == "TRANSFER"
    status = LL.destination_status(list(records.values()), result["trades"], TREATMENTS)
    assert status["pix"]["status"] == "linked"


def test_purchase_needs_existing_ledger_row():
    data = {"trades": [{"date": "2026-09-10", "ticker": "IPCA", "side": "BUY",
                        "price": 10, "ledger_id": "nope"}]}
    result = D.plan_changes(data, ASSETS, {}, {}, [], {}, TREATMENTS)
    assert result["trades"] == []
    assert len(result["problems"]) == 1


def test_destination_subcategories_follow_the_user_taxonomy():
    record = _record("a", -800, "Reserva", "Depósito")
    assert LL.needed_destination(record, TREATMENTS) == 0.0
    assert LL.needed_destination(record, TREATMENTS, ("Depósito", "Saque")) == 800.0


def test_statement_import_skips_duplicates_and_links_income():
    ledger = {"x": {"id": "x", "account_id": "acc", "item_id": "item",
                    "account_name": "Corretora", "account_type": "BANK", "date": "2026-09-15",
                    "description": "RENDIMENTOS DE CLIENTES ABCD11 S/ 20",
                    "signed_amount": 12.0}}
    rows = [
        {"account_id": "acc", "date": "2026-09-15", "amount": 12.0,
         "description": "RENDIMENTOS  DE CLIENTES ABCD11 S/ 20"},
        {"account_id": "acc", "date": "2026-09-14", "amount": 9.6,
         "description": "RENDIMENTOS DE CLIENTES EFGH11 S/ 8",
         "category": "Investimentos", "subcategory": "Rendimentos",
         "invest": {"ticker": "EFGH11", "side": "DIVIDEND", "quantity": 8}},
    ]
    added, trades = C._import_statement(ledger, rows)
    assert added == 1
    new = next(rec for rec in ledger.values() if rec["id"] != "x")
    assert new["item_id"] == "item" and new["account_name"] == "Corretora"
    assert new["category_source"] == "manual"
    assert trades[0]["ledger_id"] == new["id"]
    assert round(trades[0]["price"], 2) == 1.2
    assert L.duplicate_of(ledger, rows[1]) == new["id"]
