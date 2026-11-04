"""Contraparte do PIX: sem nome, o documento identifica para quem foi (sem rede)."""
from types import SimpleNamespace

from finance import ledger

from tests.test_transaction_dates import LOCAL_TIMEZONE, account_stub, transaction_stub


def _pix(receiver):
    tx = transaction_stub()
    tx.payment_data = SimpleNamespace(payer=None, receiver=receiver, payment_method="PIX")
    return ledger.normalize(tx, account_stub(), "item-id", LOCAL_TIMEZONE)


def test_pix_sem_nome_usa_o_documento_da_contraparte():
    doc = SimpleNamespace(type="CPF", value="000.000.000-00")
    record = _pix(SimpleNamespace(name=None, document_number=doc))
    assert record["counterparty"] == "CPF 000.000.000-00"


def test_nome_da_contraparte_continua_tendo_prioridade():
    doc = SimpleNamespace(type="CNPJ", value="00.000.000/0001-00")
    record = _pix(SimpleNamespace(name="Loja Exemplo", document_number=doc))
    assert record["counterparty"] == "Loja Exemplo"


def test_sem_nome_e_sem_documento_fica_vazio():
    record = _pix(SimpleNamespace(name=None, document_number=None))
    assert record["counterparty"] is None
