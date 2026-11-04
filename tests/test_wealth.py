"""Patrimônio: bens/dívidas manuais (Config[wealth_manual]) e histórico por papel."""
import json

import pytest

from finance import sheets
from finance import wealth as W
from finance.invest import report as IR


def test_normalize_valida_e_gera_ids():
    out = W.normalize({"assets": [
        {"name": "  Carro  Exemplo ", "value": "35000.456", "kind": "veiculo",
         "as_of": "2026-11-01"},
        {"name": "Carro Exemplo", "value": 1, "kind": "xyz"},
    ], "debts": [{"name": "Empréstimo Ana", "value": 500}]})
    a, b = out["assets"]
    assert (a["id"], a["name"], a["value"], a["kind"]) == ("carro-exemplo", "Carro Exemplo",
                                                           35000.46, "veiculo")
    assert b["id"] == "carro-exemplo-2" and b["kind"] == "outro"
    assert out["debts"][0]["kind"] == "outro" and out["debts"][0]["as_of"]
    assert W.normalize(None) == {"assets": [], "debts": []}


@pytest.mark.parametrize("bad", [
    {"assets": [{"name": "", "value": 1}]},
    {"assets": [{"name": "X", "value": -1}]},
    {"assets": [{"name": "X", "value": "abc"}]},
    {"debts": [{"name": "X", "value": 1, "as_of": "31/12/2026"}]},
    {"assets": "nada"},
])
def test_normalize_recusa_lixo(bad):
    with pytest.raises(W.WealthError):
        W.normalize(bad)


def test_block_tolerante_e_totais():
    assert W.block({"assets": "x"})["error"]
    b = W.block({"assets": [{"name": "Casa", "value": 100}],
                 "debts": [{"name": "Fin", "value": 40}]})
    assert (b["assets_total"], b["debts_total"]) == (100.0, 40.0)


def test_save_grava_no_config_e_atualiza_so_o_pedaco_do_relatorio(tmp_path, monkeypatch):
    store = {}
    monkeypatch.setattr(sheets, "write_config", lambda k, v: store.__setitem__(k, v))
    manual = W.save({"assets": [{"name": "Moto", "value": 9000}], "debts": []})
    assert store[W.MANUAL_KEY]["assets"][0]["id"] == "moto"
    path = tmp_path / "invest.json"
    path.write_text(json.dumps({"wealth": {"total": 1}}))
    assert W.patch_report(manual, path)
    report = json.loads(path.read_text())
    assert report["wealth"] == {"total": 1} and report["manual_wealth"]["assets_total"] == 9000
    assert not W.patch_report(manual, tmp_path / "nao-existe.json")


def test_history_by_role():
    tree = {"acoes": {"role": "strategy"}, "reserva": {"role": "reserved"},
            "corretora": {"role": "to_invest"}, "contas": {"role": "free"}}
    snaps = [
        {"date": "2026-11-02", "node": "acoes", "value": 100, "cost": 90},
        {"date": "2026-11-02", "node": "contas", "value": 50, "cost": 50},
        {"date": "2026-11-03", "node": "acoes", "value": 110, "cost": 90},
        {"date": "2026-11-03", "node": "reserva", "value": 20, "cost": 20},
        {"date": "2026-11-03", "node": "corretora", "value": 5, "cost": 5},
        {"date": "2026-11-03", "node": "nó-antigo", "value": 1, "cost": 1},
    ]
    out = IR.history_by_role(snaps, tree)
    assert out[0] == {"date": "2026-11-02", "invested": 100.0, "reserved": 0.0,
                      "to_invest": 0.0, "free": 50.0, "total": 150.0}
    assert out[1]["invested"] == 111.0 and out[1]["total"] == 136.0
