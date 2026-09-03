"""Valida o mapa da Pluggy contra a taxonomia, sem rede: o store em memória
serve a aba PluggyMap e o fixture de seed.

Rode: PYTHONPATH=. uv run python tests/test_pluggy_map.py
"""

import copy

from finance import sheets

STORE = {"Taxonomy": [], "PluggyMap": []}
sheets.read_records = lambda tab: copy.deepcopy(STORE.get(tab, []))

from finance import pluggy_map as P  # noqa: E402
from finance import taxonomy as T  # noqa: E402
from finance.seed import _read_fixtures  # noqa: E402
from finance.config import SEED_DIR  # noqa: E402

fx = _read_fixtures(SEED_DIR)
STORE["Taxonomy"] = [{"Category": c, "Subcategories": ", ".join(subs or []),
                      "Treatment": ""} for c, subs in fx["taxonomy"].items()]
STORE["PluggyMap"] = [{"PluggyCategory": k, "Category": v[0],
                       "Subcategory": (v[1] or None) if len(v) > 1 else None}
                      for k, v in fx["pluggy_map"].items() if v]

tax = T.load()
mapa = P.load(refresh=True)
assert mapa, "mapa vazio"

ruins = [(k, c, s) for k, (c, s) in mapa.items() if not T.valid(tax, c, s)]
assert not ruins, f"apontam para categoria/subcategoria inexistente: {ruins}"

# transferências genéricas resolvem a direção pelo tipo, sem passar pelo mapa
assert P.suggest("Transfer - PIX", "CREDIT") == ("Transferências", "PIX recebido")
assert P.suggest("Transfer - PIX", "DEBIT") == ("Transferências", "PIX enviado")
assert P.suggest(None, "DEBIT") is None
assert P.suggest("categoria que não existe", "DEBIT") is None

# sem a aba, cai no fixture em vez de ficar sem mapa
STORE["PluggyMap"] = []
assert P.load(refresh=True), "fallback para o fixture falhou"

print(f"OK — {len(mapa)} entradas, todas válidas na taxonomia do seed.")
