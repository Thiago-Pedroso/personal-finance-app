"""Idade das conexões no sync e tolerância a enums novos da Pluggy (sem rede)."""
from datetime import datetime, timedelta, timezone

from finance import pluggy_client as pc
from finance import sync


AGORA = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)


def test_idade_em_horas_e_sem_data():
    assert sync._idade_horas(None, AGORA) is None
    assert sync._idade_horas((AGORA - timedelta(hours=50)).isoformat(), AGORA) == 50


def test_aviso_marca_conexao_velha(capsys):
    sync._avisar_conexoes([
        {"item_id": "item-novo", "accounts": ["Conta A"], "status": "UPDATED",
         "last_updated_at": (AGORA - timedelta(hours=3)).isoformat()},
        {"item_id": "item-velho", "accounts": ["Conta B"], "status": "UPDATED",
         "last_updated_at": (AGORA - timedelta(hours=72)).isoformat()},
        {"item_id": "item-sem-data", "accounts": [], "status": "ERRO (X)",
         "last_updated_at": None},
    ], AGORA)
    out = capsys.readouterr().out
    assert "Conta A: atualizada há 3h (status UPDATED)\n" in out
    assert "Conta B: atualizada há 72h (status UPDATED)  <-- VELHA" in out
    assert "item-sem: sem data de atualização" in out
    assert "1 conexão(ões) com mais de 48h" in out


def test_investimento_com_tipo_desconhecido_nao_quebra_a_validacao():
    inv = pc.Investment.from_dict({
        "id": "inv-1", "name": "Produto novo", "type": "TIPO_QUE_NAO_EXISTE",
        "subtype": "SUBTIPO_NOVO", "status": "STATUS_NOVO", "balance": None,
        "currencyCode": "BRL", "itemId": "6f1c3e2a-0000-4000-8000-000000000001",
        "date": "2026-11-03T00:00:00Z",
    })
    assert inv.type == "OTHER"
    assert inv.subtype is None and inv.status is None
    assert inv.balance == 0
