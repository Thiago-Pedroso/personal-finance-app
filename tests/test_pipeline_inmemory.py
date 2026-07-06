"""End-to-end offline: substitui o backend do Google Sheets por um store em memória e roda o
pipeline real (seed → load → categorize apply → report). Prova que os módulos migrados
(ledger/rules/taxonomy/budgets/sync) funcionam juntos sem precisar de credenciais/rede.

Rode: PYTHONPATH=. uv run python tests/test_pipeline_inmemory.py
"""

import copy
import json

from finance import sheets
from finance.config import REPORTS_DIR, DECISIONS_FILE, ensure_dirs
from finance.seed import _read_fixtures
from finance.config import SEED_DIR

# ---- store em memória que imita as abas do Sheets --------------------------------------
STORE = {"Ledger": [], "Rules": [], "Taxonomy": [], "Config": {}}

sheets.read_records = lambda tab: copy.deepcopy(STORE.get(tab, []))
sheets.write_records = lambda tab, recs: STORE.__setitem__(tab, copy.deepcopy(list(recs)))
sheets.read_config = lambda key, default=None: copy.deepcopy(STORE["Config"].get(key, default))
sheets.write_config = lambda key, val: STORE["Config"].__setitem__(key, copy.deepcopy(val))
sheets.ensure_tabs = lambda: None
sheets.check = lambda: {"title": "TEST", "url": "mem://", "tabs": list(STORE)}


def _seed():
    fx = _read_fixtures(SEED_DIR)
    STORE["Ledger"] = copy.deepcopy(fx["ledger"])
    STORE["Rules"] = copy.deepcopy(fx["rules"])
    STORE["Taxonomy"] = [{"Category": c, "Subcategories": ", ".join(s or [])}
                         for c, s in fx["taxonomy"].items()]
    STORE["Config"] = {"budgets": copy.deepcopy(fx["budgets"]), "sync_state": {}}


def test_end_to_end():
    from finance import ledger as L, rules as R, taxonomy as T, budgets as B

    _seed()
    # leitura pelas abas via os módulos migrados
    led = L.load_ledger()
    assert len(led) == 94, f"esperado 94 tx, veio {len(led)}"
    assert R.load_rules()["rules"], "regras não carregaram"
    tax = T.load()
    assert "Alimentação" in tax and "Restaurante" in tax["Alimentação"]
    assert isinstance(B.load()["spending"], dict)

    # categorização: pega uma transação sem categoria e atribui uma
    uncat = [r for r in led.values() if not r["category"] and not r.get("splits")]
    assert uncat, "esperava ao menos 1 transação sem categoria no fixture"
    target = uncat[0]["id"]
    ensure_dirs()
    DECISIONS_FILE.write_text(json.dumps({"assignments": [
        {"ids": [target], "category": "Alimentação", "subcategory": "Restaurante",
         "note": "teste"}]}))
    from finance import categorize
    categorize.apply(learn=False)

    # a decisão deve ter sido gravada de volta no "Sheets" (store)
    saved = {r["id"]: r for r in STORE["Ledger"]}[target]
    assert saved["category"] == "Alimentação" and saved["subcategory"] == "Restaurante"
    assert saved["category_source"] == "manual" and saved["note"] == "teste"

    # relatórios: gera a partir do store e confere o dashboard
    from finance import report
    import sys
    argv = sys.argv
    sys.argv = ["finance.report"]
    try:
        report.main()
    finally:
        sys.argv = argv
    dash = json.loads((REPORTS_DIR / "dashboard.json").read_text())
    assert dash["total_transactions"] == 94
    assert dash["months"], "dashboard sem meses"
    print(f"  ledger={len(led)}  meses={len(dash['months'])}  "
          f"pendências={dash['pending']}  categorias12m={len(dash['by_category_12m'])}")


if __name__ == "__main__":
    test_end_to_end()
    print("ok  test_end_to_end")
    print("\nPipeline end-to-end (em memória) passou.")
