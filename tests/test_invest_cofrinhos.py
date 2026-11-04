"""Sugestão de destino para "Dinheiro reservado/retirado <cofrinho>" (cofrinhos de banco digital)."""
from finance.invest import ledger_link as LL

ITEM = "bank-item"
ACCOUNTS = {"banco": {"pluggy_item_id": ITEM}, "corretora": {"pluggy_item_id": "corretora-item"}}
ASSETS = {
    "COFRINHO-PRAIA": {"valuation": "balance", "account": "banco",
                    "name": "Cofrinho Praia (140% CDI)"},
    "VIAGEM": {"valuation": "balance", "account": "corretora", "name": "Viagem"},
    "CONTA-BANCO": {"valuation": "account", "account": "banco",
                 "name": "Conta Banco Exemplo"},
}


def rec(id, desc, amount, item=ITEM):
    return {"id": id, "date": "2026-08-09", "description": desc, "signed_amount": amount,
            "item_id": item}


def pend(id, needed, kind="destination_missing"):
    return {"kind": kind, "ledger_id": id, "needed": needed}


def test_sugere_a_caixinha_da_mesma_instituicao_pelo_nome():
    records = [rec("a", "Dinheiro reservado Cofrinho Praia", -2000),
               rec("b", "Dinheiro retirado Cofrinho Praia", 1960.29),
               rec("c", "Dinheiro reservado Carro", -6000),
               rec("d", "Dinheiro reservado Viagem", -100),          # Viagem é de outra instituição
               rec("e", "Pix enviado", -50)]
    pending = [pend("a", 2000), pend("b", 1960.29), pend("c", 6000), pend("d", 100),
               pend("e", 50), pend("a", 1, kind="destination_partial")]
    out = {s["ledger_id"]: s for s in LL.cofrinho_suggestions(records, pending, ASSETS,
                                                               ACCOUNTS)}
    assert set(out) == {"a", "b", "c", "d"}
    assert out["a"]["ticker"] == "COFRINHO-PRAIA" and out["a"]["side"] == "in"
    assert out["b"]["ticker"] == "COFRINHO-PRAIA" and out["b"]["side"] == "out"
    assert out["b"]["amount"] == 1960.29 and out["a"]["account"] == "banco"
    assert out["c"]["ticker"] is None and out["c"]["name"] == "Carro"
    assert out["d"]["ticker"] is None, "caixinha de outra instituição não serve"


def test_nome_ambiguo_lista_candidatas():
    assets = {**ASSETS, "COFRINHO-PRAIA2": {"valuation": "balance", "account": "banco",
                                         "name": "Cofrinho Praia 2"}}
    out = LL.cofrinho_suggestions([rec("a", "Dinheiro reservado Praia", -10)],
                                  [pend("a", 10)], assets, ACCOUNTS)
    assert out[0]["ticker"] is None
    assert sorted(out[0]["candidates"]) == ["COFRINHO-PRAIA", "COFRINHO-PRAIA2"]
