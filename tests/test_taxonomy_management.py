"""Testes de contrato (sem rede) das migrações confirmadas de taxonomia.

Rode: uv run --with pytest python -m pytest -q tests/test_taxonomy_management.py
"""
import copy
import io
import json
import sys
import tempfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import pytest

from finance import ledger as L
from finance import report
from finance import rules as R
from finance import sheets
from finance import taxonomy as T

STORE = {}
WRITES = []
# O backend em memória troca funções dos módulos; o fixture devolve as originais para
# não vazar para os outros arquivos de teste (ex.: report.generate do pipeline).
_PATCHED = [(sheets, "read_records"), (sheets, "write_records"),
            (sheets, "write_taxonomy_records"), (sheets, "read_config"),
            (report, "generate")]


@pytest.fixture(autouse=True)
def _restore_backend():
    saved = [(module, name, getattr(module, name)) for module, name in _PATCHED]
    yield
    for module, name, value in saved:
        setattr(module, name, value)


def _record(id, category, subcategory, *, splits=None, override=None):
    return {"id": id, "date": "2026-05-01", "signed_amount": -100.0,
            "amount_override": override, "category": category, "subcategory": subcategory,
            "category_source": "manual", "rule_id": "r_1", "needs_review": False,
            "reviewed": True, "splits": splits, "note": "preserve", "excluded": False}


def _install_memory_backend():
    sheets.read_records = _read
    sheets.write_records = _write
    sheets.write_taxonomy_records = lambda rows: _write("Taxonomy", rows)
    sheets.read_config = lambda key, default=None: copy.deepcopy(default)
    # Domain tests assert the call boundary through its durable-error case below;
    # report generation itself is covered by the pipeline test.
    report.generate = lambda **kwargs: None


def reset():
    global STORE, WRITES
    _install_memory_backend()
    STORE = {
        "Taxonomy": [
            {"Category": "Outros", "Subcategories": "A revisar", "Treatment": "fluxo"},
            {"Category": "Casa", "Subcategories": "Aluguel, Luz", "Treatment": "fluxo"},
            {"Category": "Reserva", "Subcategories": "Aporte", "Treatment": "poupança"},
        ],
        "Ledger": [
            _record("normal", "Casa", "Aluguel"),
            _record("untouched", "Casa", "Luz"),
            _record("split", "Casa", "Aluguel", splits=[
                {"amount": -40.0, "category": "Casa", "subcategory": "Aluguel", "note": "a"},
                {"amount": -60.0, "category": "Casa", "subcategory": "Aluguel", "note": "b"},
            ], override=-100.0),
        ],
        "Rules": [
            {"id": "r_1", "field": "description", "match": "contains", "value": "casa",
             "category": "Casa", "subcategory": "Aluguel"},
            {"id": "r_2", "field": "description", "match": "contains", "value": "luz",
             "category": "Casa", "subcategory": "Luz"},
        ],
    }
    WRITES = []


def _read(tab): return copy.deepcopy(STORE.get(tab, []))
def _write(tab, rows):
    WRITES.append((tab, copy.deepcopy(list(rows))))
    STORE[tab] = copy.deepcopy(list(rows))


def test_preview_is_stable_and_counts_each_split_part_without_writing():
    reset()
    one = T.preview({"kind": "rename-category", "category": "Casa", "newCategory": "Moradia"})
    two = T.preview({"kind": "rename-category", "category": "Casa", "newCategory": "Moradia"})
    assert one["impact"] == {"normalTransactions": 2, "rules": 2,
                             "splitTransactions": 1, "splitParts": 2}
    assert one["fingerprint"] == two["fingerprint"] and WRITES == []
    STORE["Ledger"][0]["category"] = "Outros"
    assert T.preview({"kind": "rename-category", "category": "Casa", "newCategory": "Moradia"})["fingerprint"] != one["fingerprint"]


def test_create_and_rename_preserve_treatment_and_references_in_safe_write_order():
    reset()
    p = T.preview({"kind": "create-category", "category": "Viagem", "treatment": "movimento"})
    assert p["impact"] == {"normalTransactions": 0, "rules": 0,
                           "splitTransactions": 0, "splitParts": 0}
    assert T.apply(p["operation"], p["fingerprint"], True)["ok"]
    assert STORE["Taxonomy"][-1] == {"Category": "Viagem", "Subcategories": "", "Treatment": "movimento"}
    p = T.preview({"kind": "rename-category", "category": "Casa", "newCategory": "Moradia"})
    result = T.apply(p["operation"], p["fingerprint"], True)
    assert result["ok"]
    assert [tab for tab, _ in WRITES[-4:]] == ["Taxonomy", "Ledger", "Rules", "Taxonomy"]
    tax, treatments = T.load_all()
    assert tax["Moradia"] == ["Aluguel", "Luz"] and treatments["Moradia"] == "fluxo" and "Casa" not in tax
    rows = {r["id"]: r for r in STORE["Ledger"]}
    assert rows["normal"]["category"] == "Moradia"
    assert rows["untouched"]["category"] == "Moradia"
    assert all(p["category"] == "Moradia" for p in rows["split"]["splits"])
    assert {r["category"] for r in STORE["Rules"]} == {"Moradia"}


def test_subcategory_operations_only_touch_the_selected_subcategory():
    reset()
    rename = T.preview({"kind": "rename-subcategory", "category": "Casa",
                        "subcategory": "Aluguel", "newSubcategory": "Moradia"})
    assert rename["impact"] == {"normalTransactions": 1, "rules": 1,
                                "splitTransactions": 1, "splitParts": 2}
    assert T.apply(rename["operation"], rename["fingerprint"], True)["ok"]
    rows = {r["id"]: r for r in STORE["Ledger"]}
    assert (rows["normal"]["category"], rows["normal"]["subcategory"]) == ("Casa", "Moradia")
    assert (rows["untouched"]["category"], rows["untouched"]["subcategory"]) == ("Casa", "Luz")
    assert all(p["subcategory"] == "Moradia" for p in rows["split"]["splits"])
    assert any(r["id"] == "r_2" and r["subcategory"] == "Luz" for r in STORE["Rules"])

    delete = T.preview({"kind": "delete-subcategory", "category": "Casa", "subcategory": "Moradia"})
    assert T.apply(delete["operation"], delete["fingerprint"], True)["ok"]
    rows = {r["id"]: r for r in STORE["Ledger"]}
    assert (rows["untouched"]["category"], rows["untouched"]["subcategory"]) == ("Casa", "Luz")
    assert any(r["id"] == "r_2" and r["subcategory"] == "Luz" for r in STORE["Rules"])


def test_delete_moves_split_parts_to_fallback_and_marks_review_without_changing_amounts():
    reset()
    p = T.preview({"kind": "delete-subcategory", "category": "Casa", "subcategory": "Aluguel"})
    result = T.apply(p["operation"], p["fingerprint"], True)
    assert result["ok"] and [tab for tab, _ in WRITES] == ["Ledger", "Rules", "Taxonomy"]
    rows = {r["id"]: r for r in STORE["Ledger"]}
    normal, split = rows["normal"], rows["split"]
    assert normal["category"] == "Casa" and normal["subcategory"] is None
    assert normal["needs_review"] and not normal["reviewed"] and normal["rule_id"] is None
    assert split["category"] == "Casa" and split["subcategory"] is None
    assert all((part["category"], part["subcategory"], part["amount"]) == ("Outros", "A revisar", amount)
               for part, amount in zip(split["splits"], [-40.0, -60.0]))
    assert split["needs_review"] and not split["reviewed"]
    assert all(r["subcategory"] != "Aluguel" for r in STORE["Rules"])
    assert any(r["id"] == "r_2" and r["subcategory"] == "Luz" for r in STORE["Rules"])
    assert (rows["untouched"]["category"], rows["untouched"]["subcategory"]) == ("Casa", "Luz")
    assert "Aluguel" not in T.load()["Casa"]


def test_apply_rejects_unconfirmed_stale_or_corrupt_state_before_write():
    reset()
    p = T.preview({"kind": "delete-category", "category": "Casa"})
    for fingerprint, confirmed in ((p["fingerprint"], False), ("old", True)):
        try: T.apply(p["operation"], fingerprint, confirmed)
        except T.TaxonomyError as exc:
            if fingerprint == "old":
                assert exc.status == 409 and exc.kind == "stale"
        else: raise AssertionError("confirmation/token must be required")
    assert not WRITES
    STORE["Ledger"][2]["splits"][0]["amount"] = -1
    p = T.preview({"kind": "delete-category", "category": "Casa"})
    try: T.apply(p["operation"], p["fingerprint"], True)
    except T.TaxonomyError as exc: assert "não soma" in str(exc)
    else: raise AssertionError("corrupt split must not be persisted")
    assert not WRITES


def test_every_attempted_rename_write_failure_is_a_refresh_required_partial_state():
    # The remote call can have committed even when it raises.  Check every
    # rename phase reports that ambiguity rather than inviting a blind retry.
    original_taxonomy_write, original_write = sheets.write_taxonomy_records, sheets.write_records
    try:
        for fail_at, expected_phase in enumerate(("taxonomy-compatibility", "ledger-migration",
                                                   "rules-migration", "taxonomy-final"), start=1):
            reset(); calls = []

            def fail_on_nth(tab, rows):
                calls.append(tab)
                if len(calls) == fail_at:
                    raise RuntimeError("network acknowledgement lost")
                _write(tab, rows)

            sheets.write_records = fail_on_nth
            sheets.write_taxonomy_records = lambda rows: fail_on_nth("Taxonomy", rows)
            p = T.preview({"kind": "rename-category", "category": "Casa", "newCategory": "Moradia"})
            result = T.apply(p["operation"], p["fingerprint"], True)
            assert result["ok"] is False and result["persisted"] is True
            assert result["status"] == 409 and result["errorKind"] == "partial"
            assert result["step"] == "taxonomy-migration" and result["phase"] == expected_phase
            assert "Não tente repetir" in result["error"]
            assert "Histórico de versões" in result["error"]
    finally:
        sheets.write_taxonomy_records, sheets.write_records = original_taxonomy_write, original_write


def test_rejects_destination_collisions_without_a_durable_migration_marker():
    reset()
    for operation in (
        {"kind": "rename-subcategory", "category": "Casa", "subcategory": "Aluguel", "newSubcategory": "Luz"},
        {"kind": "rename-category", "category": "Casa", "newCategory": "Moradia"},
    ):
        if operation["kind"] == "rename-category":
            STORE["Taxonomy"].append({"Category": "Moradia", "Subcategories": "Aluguel, Luz", "Treatment": "fluxo"})
        try:
            T.preview(operation)
        except T.TaxonomyError as exc:
            assert "destino já existe" in str(exc)
        else:
            raise AssertionError("existing destination must never be silently merged")
        reset()


def test_rejects_invalid_closed_operations_and_missing_fallback():
    reset()
    bad = [
        {"kind": "create-category", "category": " ", "treatment": "fluxo"},
        {"kind": "create-category", "category": "A,B", "treatment": "fluxo"},
        {"kind": "create-category", "category": "Nova", "treatment": "wrong"},
        {"kind": "create-subcategory", "category": "Casa", "subcategory": "Luz", "extra": 1},
        {"kind": "rename-subcategory", "category": "Casa", "subcategory": "Luz", "newSubcategory": "Luz"},
    ]
    for op in bad:
        try: T.preview(op)
        except T.TaxonomyError: pass
        else: raise AssertionError(f"should reject {op}")
    STORE["Taxonomy"] = [r for r in STORE["Taxonomy"] if r["Category"] != "Outros"]
    try: T.preview({"kind": "delete-category", "category": "Casa"})
    except T.TaxonomyError as exc: assert "Outros" in str(exc)
    else: raise AssertionError("fallback is mandatory")


def test_rejects_invalid_split_top_level_references_before_write():
    for category, subcategory in (("Inexistente", "Qualquer"), (None, "Luz")):
        reset()
        STORE["Ledger"][2]["category"] = category
        STORE["Ledger"][2]["subcategory"] = subcategory
        p = T.preview({"kind": "create-subcategory", "category": "Casa", "subcategory": "Gás"})
        try:
            T.apply(p["operation"], p["fingerprint"], True)
        except T.TaxonomyError as exc:
            assert "lançamento split" in str(exc)
        else:
            raise AssertionError("invalid split top-level reference must be rejected")
        assert not WRITES


def test_cli_emits_status_for_validation_errors():
    reset()
    with tempfile.TemporaryDirectory() as directory:
        invalid = Path(directory) / "invalid.json"
        invalid.write_text(json.dumps({"operation": {"kind": "bad"}}))
        old_argv, output = sys.argv, io.StringIO()
        try:
            sys.argv = ["taxonomy", "preview", str(invalid)]
            with redirect_stdout(output):
                try: T.main()
                except SystemExit: pass
            result = json.loads(output.getvalue())
            assert result["status"] == 400 and result["errorKind"] == "validation"
        finally:
            sys.argv = old_argv


def test_taxonomy_cli_stdout_stays_one_json_document_for_vite_bridge_when_report_logs():
    reset()
    preview = T.preview({"kind": "create-subcategory", "category": "Casa", "subcategory": "Gás"})
    with tempfile.TemporaryDirectory() as directory:
        request = Path(directory) / "apply.json"
        request.write_text(json.dumps({"operation": preview["operation"],
                                       "fingerprint": preview["fingerprint"], "confirmed": True}))
        old_argv, old_generate, output, logs = sys.argv, report.generate, io.StringIO(), io.StringIO()
        try:
            report.generate = lambda **kwargs: print("normal report log")
            sys.argv = ["taxonomy", "apply", str(request)]
            with redirect_stdout(output), redirect_stderr(logs):
                T.main()
            lines = output.getvalue().splitlines()
            assert len(lines) == 1, output.getvalue()
            assert json.loads(lines[0])["ok"] is True
            assert logs.getvalue().strip() == "normal report log"
        finally:
            sys.argv, report.generate = old_argv, old_generate


def test_report_failure_is_declared_after_persistence():
    reset(); p = T.preview({"kind": "create-subcategory", "category": "Casa", "subcategory": "Gás"})
    old = report.generate
    report.generate = lambda **kwargs: (_ for _ in ()).throw(RuntimeError("disk"))
    try:
        got = T.apply(p["operation"], p["fingerprint"], True)
        assert got["persisted"] and got["step"] == "report-regeneration"
        assert len(WRITES) == 1
    finally: report.generate = old


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print("ok ", name)
