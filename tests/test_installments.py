"""Agrupamento de parcelas (finance.installments): compra, fatura e empréstimo."""
from datetime import date

from finance import installments as I

CARD = "card-1"


def tx(id, d, desc, amount, inst=None, account=CARD, **kw):
    return {"id": id, "date": d, "description": desc, "signed_amount": amount,
            "amount_override": kw.pop("override", None), "installment": inst,
            "account_id": account, "account_name": "Cartão", "category": "Compras",
            "subcategory": "Online", "excluded": kw.pop("excluded", False),
            "merchant_name": kw.pop("merchant", None), **kw}


def plans(recs, today=date(2026, 11, 3)):
    return I.build(recs, today=today)


def test_parse_e_marcador():
    assert I.parse("3/10") == (3, 10)
    assert I.parse(" 1 / 2 ") == (1, 2)
    assert I.parse("11/10") is None and I.parse("0/3") is None and I.parse(None) is None
    assert I.strip_marker("LOJA X PARCELA 3/10") == "LOJA X"
    assert I.strip_marker("Steam PARC 01/02") == "Steam"
    assert I.add_months("2026-11", 3) == "2027-02"
    assert I.add_months("2026-01", -1) == "2025-12"


def test_compra_ativa_com_calendario_e_projecao():
    recs = [tx("a1", "2026-08-31", "LOJA A", -100, "1/4"),
            tx("a2", "2026-09-30", "LOJA A", -100, "2/4"),
            tx("ref", "2026-10-31", "OUTRA", -50, "1/1")]
    data = plans(recs)
    p = next(p for p in data["plans"] if p["description"] == "LOJA A")
    assert p["status"] == "active"
    assert (p["paid_installments"], p["remaining_installments"]) == (2, 2)
    assert p["remaining_amount"] == 200
    assert p["start_month"] == "2026-08" and p["end_month"] == "2026-11"
    # a fatura de out/2026 já chegou (linha "OUTRA") sem a 3/4: atrasada, ainda ativa
    assert p["overdue_installments"] == 1 and p["schedule"] == ["2026-11"]
    assert data["schedule"][0] == {"month": "2026-11", "compra": 100.0, "fatura": 0.0,
                                   "total": 100.0}
    assert len(data["schedule"]) == 12
    assert data["totals"]["remaining_amount"] == 200


def test_parcelas_adiantadas_pela_pluggy_nao_puxam_o_inicio():
    # 2/5..4/5 vêm no dia seguinte à compra; a 5/5 chega na fatura certa
    recs = [tx("b1", "2026-06-20", "LOJA B", -50, "1/5")]
    recs += [tx(f"b{n}", "2026-06-21", "LOJA B", -50, f"{n}/5") for n in (2, 3, 4)]
    recs += [tx("b5", "2026-10-31", "LOJA B", -50, "5/5")]
    p = plans(recs)["plans"][0]
    assert p["start_month"] == "2026-06" and p["end_month"] == "2026-10"
    assert p["status"] == "completed" and len(p["transactions"]) == 5


def test_duas_compras_iguais_no_mesmo_lojista_ficam_separadas():
    recs = [tx("c1", "2026-08-10", "LOJA C PARCELA 1/3", -30, "1/3"),
            tx("c2", "2026-09-10", "LOJA C PARCELA 2/3", -30, "2/3"),
            tx("d1", "2026-09-12", "LOJA C PARCELA 1/3", -30, "1/3"),
            tx("d2", "2026-10-10", "LOJA C PARCELA 2/3", -30, "2/3"),
            tx("c3", "2026-10-10", "LOJA C PARCELA 3/3", -30, "3/3")]
    got = sorted((p["paid_installments"], p["status"]) for p in plans(recs)["plans"])
    assert got == [(2, "active"), (3, "completed")]


def test_valor_diferente_separa_e_merchant_parcial_nao():
    recs = [tx("e1", "2026-09-01", "LOJA EXEMPLO", -41.69, "1/2", merchant="lojaexemplo"),
            tx("e2", "2026-10-01", "LOJA EXEMPLO", -41.66, "2/2"),
            tx("f1", "2026-09-01", "LOJA EXEMPLO", -99.0, "1/2")]
    ps = plans(recs)["plans"]
    assert len(ps) == 2
    assert next(p for p in ps if p["parcel_amount"] == 41.66)["status"] == "completed"


def test_duplicata_de_1_de_n_fica_fora_das_contas():
    recs = [tx("g1", "2026-09-16", "LOJA G", -56.7, "1/10"),
            tx("g1b", "2026-09-16", "LOJA G", -56.7, "1/10"),
            tx("g2", "2026-10-16", "LOJA G", -56.7, "2/10")]
    data = plans(recs)
    assert sorted(p["status"] for p in data["plans"]) == ["active", "duplicate"]
    assert data["totals"]["remaining_amount"] == round(56.7 * 8, 2)


def test_parcela_antiga_que_nao_veio_vira_stale():
    recs = [tx("h1", "2026-03-10", "LOJA H", -10, "1/3"),
            tx("ref", "2026-10-31", "OUTRA", -5, "1/1")]
    p = next(p for p in plans(recs)["plans"] if p["description"] == "LOJA H")
    assert p["status"] == "stale" and p["remaining_amount"] == 0


def test_excluido_e_override():
    recs = [tx("i1", "2026-10-01", "LOJA I", -10, "1/2", override=-12),
            tx("i2", "2026-10-02", "LOJA I", -10, "1/2", excluded=True)]
    ps = plans(recs)["plans"]
    assert len(ps) == 1 and ps[0]["parcel_amount"] == 12


def test_parcelamento_de_fatura_com_juros():
    mp = "mp-credit"
    recs = [tx("cred", "2026-05-13", "Crédito por parcelamento da fatura", 320.46,
               account=mp)]
    recs += [tx(f"pf{n}", "2026-05-13", "Parcela da fatura", -76.17, f"{n}/8", account=mp)
             for n in (1, 4, 5, 6, 7, 8)]
    recs += [tx("pf2", "2026-07-02", "Parcela da fatura", -76.17, "2/8", account=mp),
             tx("pf3", "2026-08-02", "Parcela da fatura", -76.17, "3/8", account=mp),
             tx("adj", "2026-08-09", "Antecipação de parcelamento de fatura", 205.73,
                account=mp)]
    data = plans(recs)
    fatura = [p for p in data["plans"] if p["kind"] == "fatura"]
    assert len(fatura) == 1, "as 8 parcelas são um plano só, mesmo fora de ordem"
    f = fatura[0]
    assert f["status"] == "completed" and f["principal"] == 320.46
    assert f["interest"] == round(8 * 76.17 - 320.46, 2)
    assert data["totals"]["fatura_interest"] == f["interest"]
    # crédito e antecipação não viram "compra"
    assert all(p["kind"] == "fatura" for p in data["plans"])


def test_emprestimo_sem_n_de_parcelas():
    bank = "bank-1"
    recs = [tx("l1", "2026-08-12", "Pagamento de parcela Empréstimos Banco Exemplo", -16.63,
               account=bank),
            tx("l2", "2026-09-11", "Débito por dívida Empréstimos Banco Exemplo", -16.64,
               account=bank, category="Alimentação", subcategory="Supermercado"),
            tx("l3", "2026-10-13", "Débito por dívida Empréstimos Banco Exemplo", -16.64,
               account=bank),
            tx("in", "2026-07-01", "Empréstimo recebido", 500, account=bank)]
    data = plans(recs)
    assert len(data["loans"]) == 1
    loan = data["loans"][0]
    assert loan["description"] == "Empréstimos Banco Exemplo"
    assert loan["payments"] == 3 and loan["paid_amount"] == 49.91
    assert loan["status"] == "active" and data["totals"]["loans_monthly"] == 16.64
    assert "Alimentação/Supermercado" in loan["categories"]
    assert data["plans"] == []
