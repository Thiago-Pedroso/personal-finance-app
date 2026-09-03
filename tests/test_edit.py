"""Caminho fino de edição: localiza a linha e grava só as células que mudaram,
sem baixar a aba nem gerar relatório.

Rode: PYTHONPATH=. uv run python tests/test_edit.py
"""

from finance import edit, sheets

IDS = ["aaa", "bbb", "ccc"]
TAGS = [["Viagem"], [], ["Trabalho", "Viagem"]]
TAX = {"Alimentação": ["Rotina", "Lazer"], "Presente": []}


def _recusa(edits):
    """Espera que a validação barre. Evita depender do pytest, que não é
    dependência do projeto — estes arquivos também rodam como script."""
    try:
        edit.apply_edits(edits)
    except ValueError:
        return
    raise AssertionError(f"esperava ValueError para {edits}")


def _fake_backend():
    """Substitui o Sheets por listas em memória e devolve o que foi gravado."""
    enviados = []
    colunas = {"id": list(IDS), "tags": [list(t) for t in TAGS]}

    def update_fields(tab, changes):
        enviados.extend(changes)
        return len(changes)

    sheets.read_columns = lambda tab, fields: {n: colunas[n] for n in fields}
    sheets.update_fields = update_fields
    edit._taxonomy = lambda: TAX
    return enviados


def test_localiza_linha_e_grava_so_o_que_mudou():
    enviados = _fake_backend()
    res = edit.apply_edits([{"ids": ["bbb"], "fields": {"note": "oi"}}])

    assert res["rows"] == 1 and not res["missing"]
    row, fields = enviados[0]
    assert row == 3, "bbb é o 2º registro → linha 3 (cabeçalho ocupa a 1)"
    assert fields == {"note": "oi"}, "não pode arrastar campo que ninguém pediu"


def test_categoria_manual_vence_regra_e_mapa():
    enviados = _fake_backend()
    edit.apply_edits([{"ids": ["aaa"],
                       "fields": {"category": "Alimentação", "subcategory": "Lazer"}}])
    _, fields = enviados[0]
    assert fields["category_source"] == "manual"
    assert fields["reviewed"] is True and fields["rule_id"] is None


def test_varios_ids_viram_um_batch_so():
    enviados = _fake_backend()
    res = edit.apply_edits([{"ids": IDS, "fields": {"excluded": True}}])
    assert res["rows"] == 3
    assert [row for row, _ in enviados] == [2, 3, 4]


def test_tags_resolvidas_com_o_valor_atual_da_planilha():
    enviados = _fake_backend()
    edit.apply_edits([{"ids": ["ccc"],
                       "fields": {"tags_add": ["Férias"], "tags_remove": ["trabalho"]}}])
    _, fields = enviados[0]
    # remoção casa sem diferenciar caixa; o resto é preservado
    assert fields["tags"] == ["Férias", "Viagem"]


def test_id_inexistente_nao_grava_nada():
    enviados = _fake_backend()
    res = edit.apply_edits([{"ids": ["zzz"], "fields": {"note": "x"}}])
    assert res["missing"] == ["zzz"] and not enviados


def test_categoria_fora_da_taxonomia_e_recusada():
    _fake_backend()
    _recusa([{"ids": ["aaa"], "fields": {"category": "Inexistente"}}])
    _recusa([{"ids": ["aaa"],
              "fields": {"category": "Alimentação", "subcategory": "Nada"}}])


def test_campo_nao_editavel_e_recusado():
    _fake_backend()
    _recusa([{"ids": ["aaa"], "fields": {"signed_amount": -1}}])


def test_colunas_vizinhas_viram_uma_faixa_so():
    # category..reviewed são contíguas no esquema: 1 faixa, não 6
    faixas = sheets._cell_ranges("Ledger", 7, {
        "category": "Alimentação", "subcategory": "Lazer", "category_source": "manual",
        "rule_id": None, "needs_review": False, "reviewed": True})
    assert len(faixas) == 1
    # nota e tags são distantes: viram faixas separadas
    assert len(sheets._cell_ranges("Ledger", 7, {"note": "x", "tags": ["a"]})) == 2


if __name__ == "__main__":
    for nome, fn in sorted(globals().items()):
        if nome.startswith("test_") and callable(fn):
            fn()
            print("ok ", nome)
    print("\nCaminho fino de edição passou.")
