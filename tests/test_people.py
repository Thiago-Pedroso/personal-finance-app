"""Pessoas: migração das tags de pessoa e resumo por beneficiário."""
from finance import people as P


def rec(id, amount, person=None, tags=None, splits=None, cat="Compras", sub="Presentes",
        d="2026-05-10", excluded=False):
    return {"id": id, "date": d, "description": id, "signed_amount": amount,
            "amount_override": None, "category": cat, "subcategory": sub,
            "person": person, "tags": tags or [], "splits": splits, "excluded": excluded}


def test_move_tags_to_person():
    led = {r["id"]: r for r in [
        rec("a", -10, tags=["Avó Exemplo", "Viagem"]),
        rec("b", -20, tags=["avo exemplo"]),               # acento/caixa diferentes
        rec("c", -30, tags=["Ana", "Pedro"]),            # duas pessoas: fica a 1ª da lista
        rec("d", -40, person="Pedro", tags=["Ana"]),     # já tem outra pessoa: não mexe
        rec("e", -50, tags=["Viagem"]),
    ]}
    changed = P.move_tags_to_person(led, ["Avó Exemplo", "Ana", "Pedro", " "])
    assert sorted(changed) == ["a", "b", "c"]
    assert led["a"]["person"] == "Avó Exemplo" and led["a"]["tags"] == ["Viagem"]
    assert led["b"]["person"] == "Avó Exemplo" and led["b"]["tags"] == []
    assert led["c"]["person"] == "Ana" and led["c"]["tags"] == ["Pedro"]
    assert led["d"]["person"] == "Pedro" and led["d"]["tags"] == ["Ana"]
    assert led["e"].get("person") is None
    assert P.move_tags_to_person(led, ["Avó Exemplo"]) == [], "idempotente"


def test_summary_por_pessoa_com_split_presente_e_pendencia():
    recs = [
        rec("p1", -100, person="Julia"),                                  # presente
        rec("p2", -50, person="Julia", cat="Saúde", sub="Veterinário", d="2026-06-01"),
        rec("p3", 30, person="Julia", cat="Renda", sub="Outros", d="2026-06-02"),
        rec("s1", -80, splits=[
            {"amount": -60, "category": "Alimentação", "subcategory": "Restaurante"},
            {"amount": -20, "category": "Alimentação", "subcategory": "Restaurante",
             "person": "Artur"}]),
        rec("x", -999, person="Julia", excluded=True),
    ]
    open_groups = [{"name": "Julia", "receivable": 40.0, "payable": 0.0,
                    "items": [{"id": "p2", "open": 40.0}]}]
    out = P.summary(recs, open_groups, {"Renda": "fluxo"})
    assert out["people"] == ["Julia", "Artur"]
    j = out["by_person"]["Julia"]
    assert (j["sent"], j["received"], j["net"], j["count"]) == (150.0, 30.0, -120.0, 3)
    assert j["gifts"] == 100.0
    assert j["by_category"][0] == {"category": "Compras", "sent": 100.0}
    assert [m["month"] for m in j["by_month"]] == ["2026-05", "2026-06"]
    assert j["receivable"] == 40.0 and j["open_items"][0]["id"] == "p2"
    assert j["transactions"][0]["date"] == "2026-06-02"
    assert j["loan_balance"] == 0 and j["loan_count"] == 0
    a = out["by_person"]["Artur"]
    assert a["sent"] == 20.0 and a["transactions"][0]["part"] == 1


def test_saldo_de_emprestimo_por_pessoa():
    recs = [rec("e1", -500, person="Ana", cat="Empréstimos", sub="Emprestei"),
            rec("e2", 200, person="Ana", cat="Empréstimos", sub="Devolvido"),
            rec("e3", 1000, person="Bia", cat="Empréstimos", sub="Peguei emprestado")]
    out = P.summary(recs)["by_person"]
    assert (out["Ana"]["loan_balance"], out["Ana"]["loan_count"]) == (300.0, 2)
    assert out["Bia"]["loan_balance"] == -1000.0
