"""Conciliação com a Pluggy e divisão das caixinhas.

Os casos vêm do que a API devolveu de verdade: posições confiáveis, transações
incompletas, duplicatas zeradas e um direito de subscrição sem valor.
"""

from finance.invest import assets as A
from finance.invest import pluggy_sync as PS

TODAY = "2026-09-07"

ASSETS = A.load([
    {"ticker": "PSSA3", "node": "acoes", "target_pct": 0.5, "pluggy_code": "PSSA3"},
    {"ticker": "VISC11", "node": "fiis", "target_pct": 0.5, "pluggy_code": "VISC11"},
    {"ticker": "TESOURO-IPCA", "node": "rf", "target_pct": 1.0, "valuation": "pluggy",
     "pluggy_code": "BRSTNCNTB476"},
])


def _investment(**kwargs):
    base = {"item_id": "item-1", "code": None, "name": "", "type": "EQUITY",
            "subtype": "STOCK", "quantity": 0.0, "balance": 0.0, "original": 0.0,
            "institution": None, "updated_at": None}
    return {**base, **kwargs}


def test_closed_position_is_noise_and_a_real_one_is_not():
    assert PS.is_noise(_investment(code="KNCR11")) is True
    assert PS.is_noise(_investment(code="PSSA3", quantity=27, balance=1383.48)) is False


def test_matching_quantity_raises_nothing():
    investments = [_investment(code="PSSA3", quantity=27, balance=1383.48)]
    positions = {"PSSA3": {"quantity": 27.0, "value": 1383.48}}
    assert PS.reconcile(investments, positions, ASSETS, TODAY) == []


def test_quantity_gap_asks_for_the_missing_trade():
    """O caso real: a corretora dizia 27 e a planilha 47, e a corretora estava certa."""
    investments = [_investment(code="PSSA3", quantity=27, balance=1383.48)]
    positions = {"PSSA3": {"quantity": 47.0, "value": 2428.02}}
    pending = PS.reconcile(investments, positions, ASSETS, TODAY)
    assert pending[0]["kind"] == "quantity_mismatch"
    assert pending[0]["difference"] == -20
    assert "a mais" in pending[0]["message"]
    # divergência de quantidade nunca vira ajuste de saldo
    assert "trade" not in pending[0]


def test_balance_asset_gap_becomes_an_update():
    investments = [_investment(code="BRSTNCNTB476", quantity=9.08, balance=7865.82,
                               type="FIXED_INCOME", subtype="TREASURY")]
    positions = {"TESOURO-IPCA": {"quantity": 0.0, "value": 8300.30}}
    pending = PS.reconcile(investments, positions, ASSETS, TODAY)
    assert pending[0]["kind"] == "balance_update"
    trade = PS.suggested_trades(pending)[0]
    assert trade["side"] == "BALANCE"
    assert trade["price"] == 7865.82
    assert trade["source"] == "pluggy"


def test_asset_only_at_the_broker_is_flagged():
    investments = [_investment(code="SAPR11", quantity=100, balance=500.0)]
    pending = PS.reconcile(investments, {}, ASSETS, TODAY)
    assert pending[0]["kind"] == "unknown_asset"
    assert "SAPR11" in pending[0]["message"]


def test_bucket_split_finds_the_unallocated_money():
    report = PS.bucket_report(70573.36, {"RESERVA": 42180.0, "VIAGEM": 4180.0})
    assert round(report["unallocated"], 2) == 24213.36
    assert round(sum(b["share"] for b in report["buckets"]), 6) == 1.0


def test_bucket_yield_is_shared_by_balance():
    """As caixinhas rendem a mesma taxa, então ratear por saldo é exato, não estimativa."""
    report = PS.bucket_report(10200.0, {"A": 6000.0, "B": 4000.0})
    updates = PS.bucket_updates(report, TODAY)
    values = {row["ticker"]: row["price"] for row in updates}
    assert values == {"A": 6120.0, "B": 4080.0}
    assert round(sum(values.values()), 2) == 10200.0


def test_bucket_updates_stay_quiet_when_the_total_matches():
    report = PS.bucket_report(10000.0, {"A": 6000.0, "B": 4000.0})
    assert PS.bucket_updates(report, TODAY) == []


def test_bucket_report_survives_an_empty_division():
    report = PS.bucket_report(500.0, {})
    assert report["unallocated"] == 500.0
    assert PS.bucket_updates(report, TODAY) == []


def test_account_total_sums_only_that_item():
    investments = [_investment(item_id="a", balance=100.0),
                   _investment(item_id="b", balance=50.0)]
    assert PS.account_total(investments, "a") == 100.0


def test_bucket_balances_exclude_the_synced_account_balance():
    assets = A.load([
        {"ticker": "RESERVA", "account": "picpay", "valuation": "balance"},
        {"ticker": "CONTA-PICPAY", "account": "picpay", "valuation": "pluggy"},
    ])
    positions = {
        "RESERVA": {"value": 70573.36},
        "CONTA-PICPAY": {"value": 30902.71},
    }

    balances = PS.bucket_balances(positions, assets, "picpay")

    assert balances == {"RESERVA": 70573.36}
    assert PS.bucket_report(70573.36, balances)["unallocated"] == 0.0


def test_position_without_value_is_noise():
    """HGRE12 é direito de subscrição: vem com cotas e saldo zero."""
    assert PS.is_noise(_investment(code="HGRE12", quantity=5.0, balance=0.0)) is True


def test_repeated_unknown_assets_become_one_line():
    """Uma caixinha vira dezenas de CDBs idênticos: a tela precisa de uma linha só."""
    investments = [_investment(name="CDB - BANCO X", balance=500.0) for _ in range(40)]
    pending = PS.reconcile(investments, {}, ASSETS, TODAY)
    assert len(pending) == 1
    assert pending[0]["count"] == 40
    assert pending[0]["value"] == 20000.0
    assert "40 aplicações" in pending[0]["message"]


def test_bucket_account_skips_the_asset_by_asset_check():
    """Numa conta de caixinhas quem confere é o total: a instituição não sabe a divisão."""
    investments = [_investment(item_id="bucket-1", name="CDB - BANCO X", balance=500.0),
                   _investment(item_id="outra", code="SAPR11", quantity=10, balance=50.0)]
    pending = PS.reconcile(investments, {}, ASSETS, TODAY, bucket_items={"bucket-1"})
    assert [item["ticker"] for item in pending] == ["SAPR11"]


def test_account_balance_becomes_a_balance_update():
    """Saldo de conta é ativo por saldo: o ativo aponta para a conta em pluggy_code."""
    assets = A.load([{"ticker": "CONTA-XP", "name": "Conta XP", "node": "a_aportar",
                      "valuation": "pluggy", "pluggy_code": "acc-1"}])
    accounts_data = [{"item_id": "i", "account_id": "acc-1", "name": "XP",
                      "type": "BANK", "balance": 8000.60, "currency": "BRL"}]
    pending = PS.reconcile_accounts(accounts_data, {"CONTA-XP": {"value": 6000.0}},
                                    assets, TODAY)
    assert pending[0]["kind"] == "balance_update"
    assert PS.suggested_trades(pending)[0]["price"] == 8000.60


def test_dollar_account_is_compared_in_dollars():
    """A conta informa 15,70 dólares e a posição vale R$ 80,48: o que se compara é o
    saldo em dólar, senão a conciliação pediria correção todo dia."""
    assets = A.load([{"ticker": "INTER-GLOBAL", "name": "Conta global", "node": "livre",
                      "valuation": "pluggy", "currency": "USD", "pluggy_code": "acc-2"}])
    accounts_data = [{"item_id": "i", "account_id": "acc-2", "name": "Inter",
                      "type": "BANK", "balance": 15.70, "currency": "USD"}]
    positions = {"INTER-GLOBAL": {"value": 80.48, "native_value": 15.70}}

    assert PS.reconcile_accounts(accounts_data, positions, assets, TODAY) == []

    positions["INTER-GLOBAL"]["native_value"] = 12.0
    pending = PS.reconcile_accounts(accounts_data, positions, assets, TODAY)
    assert "US$ 15.70" in pending[0]["message"]
    assert PS.suggested_trades(pending)[0]["currency"] == "USD"


def test_account_already_in_sync_says_nothing():
    assets = A.load([{"ticker": "CONTA-XP", "name": "Conta XP", "node": "a_aportar",
                      "valuation": "pluggy", "pluggy_code": "acc-1"}])
    accounts_data = [{"item_id": "i", "account_id": "acc-1", "name": "XP",
                      "type": "BANK", "balance": 8000.60, "currency": "BRL"}]
    assert PS.reconcile_accounts(accounts_data, {"CONTA-XP": {"value": 8000.60}},
                                 assets, TODAY) == []
