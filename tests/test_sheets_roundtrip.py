"""Testes puros (sem rede) da coerção tipada célula↔Python em finance/sheets.py.

Garantem que gravar e reler pelo Sheets preserva o formato dos registros — o principal risco
de correção da migração. Rode: uv run python -m pytest tests/ -q  (ou uv run python tests/...).
"""

import json
from pathlib import Path

from finance import sheets
from finance.config import SEED_DIR


def _roundtrip(schema, rec):
    """Serializa cada campo p/ célula e coage de volta, como um write+read faria."""
    cells = {name: sheets._val_to_cell(kind, rec.get(name)) for name, kind in schema}
    return {name: sheets._cell_to_val(kind, "" if cells[name] is None else str(cells[name]))
            for name, kind in schema}


def test_ledger_fixture_roundtrip_is_stable():
    lines = (SEED_DIR / "ledger.jsonl").read_text().splitlines()
    recs = [json.loads(x) for x in lines if x.strip()]
    assert recs, "fixture de ledger vazio"
    for rec in recs:
        r1 = _roundtrip(sheets.LEDGER_SCHEMA, rec)
        r2 = _roundtrip(sheets.LEDGER_SCHEMA, r1)
        assert r1 == r2, f"round-trip instável em {rec['id']}"
        # tipos-chave preservados
        assert isinstance(r1["signed_amount"], float)
        assert isinstance(r1["needs_review"], bool)
        assert isinstance(r1["reviewed"], bool)
        # None ↔ célula vazia
        if rec.get("amount_override") is None:
            assert r1["amount_override"] is None
        else:
            assert abs(r1["amount_override"] - rec["amount_override"]) < 1e-9


def test_splits_survive_json_roundtrip():
    rec = {"id": "x", "date": "2026-05-01", "account_name": "Conta", "description": "d",
           "amount": 300.0, "signed_amount": -300.0, "needs_review": False,
           "reviewed": True, "amount_override": -290.0,
           "tags": ["Viagem Teste", "Evento"],
           "splits": [{"amount": -150.0, "category": "Lazer", "subcategory": "Viagem",
                       "note": "Minha parte"},
                      {"amount": -140.0, "category": "Compartilhado", "subcategory": "Outro",
                       "note": "Parte de terceiro"}]}
    r1 = _roundtrip(sheets.LEDGER_SCHEMA, rec)
    assert r1["splits"] == rec["splits"]
    assert r1["amount_override"] == -290.0
    assert r1["tags"] == rec["tags"]
    assert r1["reviewed"] is True and r1["needs_review"] is False


def test_tag_normalization_and_updates():
    from finance import ledger
    tags = ledger.normalize_tags([
        " Viagem   Teste ", "viágem teste", "Evento", "", None, {"tag": "inválida"},
        "x" * 81,
    ])
    assert tags == ["Evento", "Viagem Teste"]
    updated = ledger.update_tags(tags, ["Trabalho"], ["VIAGEM TESTE"])
    assert updated == ["Evento", "Trabalho"]


def test_rule_optional_numeric_fields():
    # regra simples (sem type/faixa) e regra com faixa de valor
    simple = {"id": "r_0001", "field": "description", "match": "contains",
              "value": "IFOOD", "category": "Alimentação", "subcategory": "Delivery",
              "note": "", "created_at": "2026-05-01"}
    ranged = {**simple, "id": "r_0002", "type": "DEBIT",
              "amount_abs_min": 10.0, "amount_abs_max": 500.0}
    for rec in (simple, ranged):
        r1 = _roundtrip(sheets.RULES_SCHEMA, rec)
        r2 = _roundtrip(sheets.RULES_SCHEMA, r1)
        assert r1 == r2
    rs = _roundtrip(sheets.RULES_SCHEMA, simple)
    assert rs["amount_abs_min"] is None and rs["type"] is None
    rr = _roundtrip(sheets.RULES_SCHEMA, ranged)
    assert rr["amount_abs_min"] == 10.0 and rr["amount_abs_max"] == 500.0


def test_unformatted_numeric_cells_and_locale():
    # UNFORMATTED_VALUE devolve números crus (int/float), não strings — devem coagir.
    assert sheets._cell_to_val("float", 13.43318987) == 13.43318987
    assert sheets._cell_to_val("float", 0) == 0.0
    assert sheets._cell_to_val("fnum", -290.0) == -290.0
    assert sheets._cell_to_val("fnum", "") is None
    # defesa contra formatação por locale (pt-BR usa vírgula decimal)
    assert sheets._cell_to_val("float", "13,43318987") == 13.43318987
    assert sheets._cell_to_val("fnum", "1.234,56") == 1234.56


def test_taxonomy_subcategory_split():
    rec = {"Category": "Alimentação",
           "Subcategories": "Supermercado, Restaurante, Delivery"}
    r1 = _roundtrip(sheets.TAXONOMY_SCHEMA, rec)
    assert r1["Category"] == "Alimentação"
    from finance import taxonomy
    subs = taxonomy._split_subs(r1["Subcategories"])
    assert subs == ["Supermercado", "Restaurante", "Delivery"]


class _NonAtomicWorksheet:
    """Small Sheets double: resize and update are separately durable calls."""
    def __init__(self, values, fail=None):
        self.values = [list(row) for row in values]
        self.row_count = len(values)
        self.col_count = len(values[0])
        self.fail = fail
        self.calls = []

    def resize(self, rows, cols):
        self.calls.append(("resize", rows, cols))
        if rows < len(self.values): self.values = self.values[:rows]
        else: self.values.extend([[""] * cols for _ in range(rows - len(self.values))])
        self.row_count, self.col_count = rows, cols
        if self.fail == "resize": raise RuntimeError("resize failed after persistence")

    def update(self, *, values, range_name, value_input_option):
        self.calls.append(("update", len(values)))
        # Updating A1 does not resize the remote worksheet; rows below the
        # replacement remain until a later explicit resize.
        self.values[:len(values)] = [list(row) for row in values]
        if self.fail == "update": raise RuntimeError("update failed before acknowledgement")


def test_taxonomy_write_expands_before_update_and_updates_before_shrinking():
    old = [["Category", "Subcategories", "Treatment"], ["Casa", "Aluguel", "fluxo"]]
    destination = [{"Category": "Casa", "Subcategories": "Aluguel", "Treatment": "fluxo"},
                   {"Category": "Moradia", "Subcategories": "Aluguel", "Treatment": "fluxo"}]
    final = [{"Category": "Moradia", "Subcategories": "Aluguel", "Treatment": "fluxo"}]
    original_ws = sheets._ws
    try:
        growing = _NonAtomicWorksheet(old, fail="update")
        sheets._ws = lambda tab: growing
        try: sheets.write_taxonomy_records(destination)
        except RuntimeError: pass
        else: raise AssertionError("injected update failure must propagate")
        # A failed bridge update cannot shrink away the old taxonomy.  The
        # update may be ambiguously acknowledged, so either old or bridge data
        # is safe; the key invariant is that all prior rows remain addressable.
        cols = len(sheets.TAXONOMY_SCHEMA)
        assert growing.calls[:2] == [("resize", 3, cols), ("update", 3)]
        assert growing.row_count == 3

        shrinking = _NonAtomicWorksheet([sheets._taxonomy_matrix(destination)[0],
                                         *sheets._taxonomy_matrix(destination)[1:]], fail="resize")
        sheets._ws = lambda tab: shrinking
        try: sheets.write_taxonomy_records(final)
        except RuntimeError: pass
        else: raise AssertionError("injected shrink failure must propagate")
        # The complete replacement was installed before a failed cleanup shrink.
        assert shrinking.calls[:2] == [("update", 2), ("resize", 2, cols)]
        assert shrinking.values == sheets._taxonomy_matrix(final)
    finally:
        sheets._ws = original_ws


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("\nTodos os testes passaram.")
