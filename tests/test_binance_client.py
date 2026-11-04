"""Testes offline de finance/binance_client.py — sem rede, sem credencial, sem planilha.

Provam o contrato do módulo: assinatura HMAC, ausência de credencial, agregação
Spot(free+locked)+Funding+Earn, neutralização da dupla contagem (LD*), precificação em BRL
(par direto, rota via USDT, BRL nativo, sem-rota nunca vira zero), filtro de poeira,
conferência que só avisa e o schema exato das posições devolvidas.

Rode: PYTHONPATH=. uv run python tests/test_binance_client.py
"""

import hashlib
import hmac
import json
import os
import re

# o módulo chama load_dotenv() no import e existe um .env real na raiz: limpar ANTES do import
os.environ.pop("BINANCE_API_KEY", None)
os.environ.pop("BINANCE_API_SECRET", None)

from finance import binance_client as bc  # noqa: E402

os.environ.pop("BINANCE_API_KEY", None)
os.environ.pop("BINANCE_API_SECRET", None)

P_SPOT = "/api/v3/account"
P_FUNDING = "/sapi/v1/asset/get-funding-asset"
P_FLEX = "/sapi/v1/simple-earn/flexible/position"
P_LOCK = "/sapi/v1/simple-earn/locked/position"
P_TICKER = "/api/v3/ticker/price"
P_INFO = "/api/v3/exchangeInfo"
P_WALLET = "/sapi/v1/asset/wallet/balance"


# ---- montagem de cenário (fixtures) ----------------------------------------------------

def _cenario(spot=(), funding=(), flex=(), lock=(), precos=None, status=None,
             carteiras=(), flex_paginas=None):
    """Monta o dict {path: resposta} que substitui o transporte HTTP.

    spot/funding: (asset, free, locked). flex: (asset, totalAmount). lock: (asset, amount).
    precos: {symbol: preço-string}. status: {symbol: status} (default TRADING).
    carteiras: (walletName, balance-em-USDT). flex_paginas: lista de respostas cruas.
    """
    precos = dict(precos or {})
    status = dict(status or {})

    def _info(params):
        pedidos = json.loads(params["symbols"])
        for s in pedidos:
            # a Binance devolve -1121 e derruba o lote inteiro se um símbolo não existir;
            # o contrato (C4) exige filtrar os candidatos pelo ticker antes de chamar aqui.
            assert s in precos, f"exchangeInfo chamado com símbolo inexistente: {s}"
        return {"symbols": [{"symbol": s, "status": status.get(s, "TRADING")}
                            for s in pedidos]}

    fake = {
        P_SPOT: {"balances": [{"asset": a, "free": f, "locked": l} for a, f, l in spot]},
        P_FUNDING: [{"asset": a, "free": f, "locked": l, "freeze": "0", "withdrawing": "0"}
                    for a, f, l in funding],
        P_FLEX: {"rows": [{"asset": a, "totalAmount": q, "collateralAmount": q}
                          for a, q in flex], "total": len(flex)},
        P_LOCK: {"rows": [{"asset": a, "amount": q, "rewardAmt": "9999"}
                          for a, q in lock], "total": len(lock)},
        P_TICKER: [{"symbol": s, "price": p} for s, p in precos.items()],
        P_INFO: _info,
        P_WALLET: [{"walletName": n, "balance": b} for n, b in carteiras],
    }
    if flex_paginas is not None:
        fake[P_FLEX] = lambda params: flex_paginas[int(params.get("current", 1)) - 1]
    return fake


def _instalar(fake, log):
    def _req(method, path, params=None, signed=False, _retry=True):
        log.append((method, path, dict(params or {})))
        assert path in fake, f"caminho não previsto no cenário: {path}"
        resp = fake[path]
        return resp(dict(params or {})) if callable(resp) else resp
    bc._request = _req


def _rodar(fake, snapshot_date=None):
    """Roda fetch_positions com credencial falsa, transporte mockado e avisos capturados."""
    orig_req, orig_avisar = bc._request, bc._avisar
    log, avisos = [], []
    os.environ["BINANCE_API_KEY"] = "chave-de-teste"
    os.environ["BINANCE_API_SECRET"] = "segredo-de-teste"
    try:
        _instalar(fake, log)
        bc._avisar = lambda msg: avisos.append(msg)
        posicoes = bc.fetch_positions(snapshot_date)
    finally:
        bc._request, bc._avisar = orig_req, orig_avisar
        os.environ.pop("BINANCE_API_KEY", None)
        os.environ.pop("BINANCE_API_SECRET", None)
    return posicoes, log, avisos


def _por_ativo(posicoes):
    return {p["asset"]: p for p in posicoes}


def _erro(code):
    try:
        return bc._BinanceErro(code=code)
    except TypeError:  # construtor posicional
        e = bc._BinanceErro("falha")
        e.code = code
        return e


PRECOS_BASE = {"BTCBRL": "543939.39", "USDTBRL": "5.40"}


# ---- testes -----------------------------------------------------------------------------

def test_assinatura_hmac_vetor_canonico():
    """Vetor oficial da doc da Binance (chave de exemplo pública, nunca do .env)."""
    secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j"
    params = {"symbol": "LTCBTC", "side": "BUY", "type": "LIMIT", "timeInForce": "GTC",
              "quantity": "1", "price": "0.1", "recvWindow": "5000",
              "timestamp": "1499827319559"}
    qs = ("symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1"
          "&recvWindow=5000&timestamp=1499827319559")
    esperada = hmac.new(secret.encode(), qs.encode(), hashlib.sha256).hexdigest()
    assert esperada == "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71", \
        "o vetor de referência da doc mudou"
    assinada = bc._assinar(params, secret)
    assert assinada == f"{qs}&signature={esperada}", f"query assinada divergente: {assinada}"


def test_sem_credencial_devolve_lista_vazia():
    # The file is intentionally executable without pytest; save/restore the
    # environment directly instead of depending on pytest's monkeypatch fixture.
    missing = object()
    old_key = os.environ.pop("BINANCE_API_KEY", missing)
    old_secret = os.environ.pop("BINANCE_API_SECRET", missing)
    orig = bc._request
    chamado = []
    try:
        bc._request = lambda *a, **k: chamado.append(a) or {}
        assert bc.fetch_positions() == [], "sem credencial deve devolver lista vazia"
    finally:
        bc._request = orig
        if old_key is not missing:
            os.environ["BINANCE_API_KEY"] = old_key
        if old_secret is not missing:
            os.environ["BINANCE_API_SECRET"] = old_secret
    assert not chamado, "não pode tocar a rede sem credencial"


def test_eh_espelho_de_earn():
    earn = {"BTC"}
    assert bc._eh_espelho_de_earn("LDBTC", earn) is True, "LDBTC é espelho de BTC no Earn"
    assert bc._eh_espelho_de_earn("LDO", earn) is False, "LDO é ativo real (Lido DAO)"
    assert bc._eh_espelho_de_earn("LD", earn) is False
    assert bc._eh_espelho_de_earn("BTC", earn) is False
    assert bc._eh_espelho_de_earn("LDBAKE", earn) is False, "BAKE não está no Earn"


def test_dupla_contagem_ldbtc_nao_soma_duas_vezes():
    """O teste mais importante: LDBTC na Spot + BTC no Earn não podem virar 0.020."""
    fake = _cenario(spot=[("BTC", "0.010", "0"), ("LDBTC", "0.005", "0")],
                    flex=[("BTC", "0.005")], precos=PRECOS_BASE)
    posicoes, _, _ = _rodar(fake)
    btc = [p for p in posicoes if p["asset"] == "BTC"]
    assert len(btc) == 1, f"esperava uma única posição de BTC, veio {len(btc)}"
    assert not any(p["asset"] == "LDBTC" for p in posicoes), "LDBTC não pode virar posição"
    q = btc[0]["quantity"]
    assert abs(q - 0.015) < 1e-12, f"dupla contagem: veio {q}, esperado 0.015"
    assert btc[0]["note"].startswith("spot+earn_flex;"), f"note inesperada: {btc[0]['note']}"


def test_spot_soma_free_e_locked():
    fake = _cenario(spot=[("BTC", "0.5", "0.3")], precos=PRECOS_BASE)
    posicoes, _, _ = _rodar(fake)
    q = _por_ativo(posicoes)["BTC"]["quantity"]
    assert abs(q - 0.8) < 1e-12, f"free+locked: veio {q}, esperado 0.8"


def test_agregacao_entre_carteiras():
    fake = _cenario(spot=[("BTC", "0.01", "0.005")],
                    funding=[("BTC", "0.002", "0.001")],
                    flex=[("BTC", "0.004")], lock=[("BTC", "0.003")],
                    precos=PRECOS_BASE)
    posicoes, _, _ = _rodar(fake)
    btc = _por_ativo(posicoes)["BTC"]
    assert abs(btc["quantity"] - 0.025) < 1e-12, f"agregação: veio {btc['quantity']}"
    assert btc["note"].startswith("spot+funding+earn_flex+earn_lock;"), btc["note"]


def test_rotas_de_preco():
    precos = {**PRECOS_BASE, "SOLUSDT": "150.00"}
    fake = _cenario(spot=[("BTC", "0.01", "0"), ("SOL", "2", "0"), ("XYZ", "1000", "0")],
                    precos=precos)
    posicoes, _, avisos = _rodar(fake)
    d = _por_ativo(posicoes)
    assert abs(d["BTC"]["value"] - 5439.39) < 0.01, f"BTC via par BRL: {d['BTC']['value']}"
    assert "BTCBRL" in d["BTC"]["note"], d["BTC"]["note"]
    assert abs(d["SOL"]["value"] - 1620.00) < 0.01, f"SOL via USDT: {d['SOL']['value']}"
    assert d["XYZ"]["value"] is None, "ativo sem rota não pode virar 0.0"
    assert d["XYZ"]["note"].endswith("SEM ROTA DE PRECO"), d["XYZ"]["note"]
    assert any("XYZ" in a for a in avisos), "sem-rota tem de gerar aviso"


def test_preco_zero_nao_vira_valor_zero():
    precos = {**PRECOS_BASE, "LUNABRL": "0.00000000"}
    fake = _cenario(spot=[("LUNA", "1000", "0")], precos=precos)
    posicoes, _, _ = _rodar(fake)
    luna = _por_ativo(posicoes)["LUNA"]
    assert luna["value"] is None, f"preço zero tem de virar sem-rota, veio {luna['value']}"


def test_simbolo_break_nao_precifica_com_preco_fossil():
    precos = {**PRECOS_BASE, "MATICBRL": "2.125", "MATICUSDT": "0.20"}
    fake = _cenario(spot=[("MATIC", "1000", "0")], precos=precos,
                    status={"MATICBRL": "BREAK"})
    posicoes, _, _ = _rodar(fake)
    matic = _por_ativo(posicoes)["MATIC"]
    assert abs(matic["value"] - 1080.00) < 0.01, \
        f"MATIC devia vir por USDT (1000*0.20*5.40), veio {matic['value']}"
    assert "2.125" not in matic["note"], f"usou o preço fóssil do par BREAK: {matic['note']}"


def test_brl_nativo():
    fake = _cenario(funding=[("BRL", "100", "0")], precos=PRECOS_BASE)
    posicoes, log, _ = _rodar(fake)
    brl = _por_ativo(posicoes)["BRL"]
    assert abs(brl["value"] - 100.00) < 0.001, f"BRL nativo: veio {brl['value']}"
    assert "BRL nativo" in brl["note"], brl["note"]
    pedidos = [s for _, p, prm in log if p == P_INFO for s in json.loads(prm["symbols"])]
    assert not any(s.startswith("BRL") for s in pedidos), \
        f"BRL nativo não consulta par nenhum, mas pediu {pedidos}"


def test_filtro_de_poeira():
    precos = {**PRECOS_BASE, "AAABRL": "0.80", "BBBBRL": "5.00"}
    fake = _cenario(spot=[("AAA", "1", "0"), ("BBB", "1", "0")], precos=precos)
    posicoes, _, _ = _rodar(fake)
    d = _por_ativo(posicoes)
    assert "AAA" not in d, "R$ 0,80 é poeira e devia sumir"
    assert "BBB" in d and abs(d["BBB"]["value"] - 5.00) < 0.001, \
        "R$ 5,00 exatos ficam (comparação estritamente menor)"
    assert bc.LIMIAR_POEIRA_BRL == 5.00, "o limiar do contrato mudou"


def test_sem_rota_escapa_do_filtro_de_poeira():
    fake = _cenario(spot=[("XYZ", "0.00000001", "0")], precos=PRECOS_BASE)
    posicoes, _, _ = _rodar(fake)
    assert _por_ativo(posicoes).get("XYZ", {}).get("value", 0) is None, \
        "posição sem rota é imune à poeira e sai com value None"


def test_paginacao_do_earn():
    paginas = [
        {"rows": [{"asset": "BTC", "totalAmount": "0.0001"} for _ in range(100)],
         "total": 150},
        {"rows": [{"asset": "ETH", "totalAmount": "0.001"} for _ in range(50)],
         "total": 150},
    ]
    precos = {**PRECOS_BASE, "ETHBRL": "15000.00"}
    fake = _cenario(precos=precos, flex_paginas=paginas)
    posicoes, log, _ = _rodar(fake)
    chamadas = [c for c in log if c[1] == P_FLEX]
    assert len(chamadas) == 2, f"esperava 2 páginas, houve {len(chamadas)} chamadas"
    d = _por_ativo(posicoes)
    assert abs(d["BTC"]["quantity"] - 0.01) < 1e-12, f"BTC: {d['BTC']['quantity']}"
    assert abs(d["ETH"]["quantity"] - 0.05) < 1e-12, f"ETH: {d['ETH']['quantity']}"


def test_schema_da_posicao():
    fake = _cenario(spot=[("BTC", "0.01", "0")], precos=PRECOS_BASE)
    posicoes, _, _ = _rodar(fake)
    assert posicoes, "esperava ao menos uma posição"
    for p in posicoes:
        assert list(p.keys()) == ["snapshot_date", "source", "institution", "asset",
                                  "class", "quantity", "value", "currency", "note"], \
            f"chaves fora do contrato: {list(p.keys())}"
        assert p["source"] == "binance" and p["institution"] == "Binance"
        assert p["class"] == "CRYPTO" and p["currency"] == "BRL"
        assert re.match(r"^\d{4}-\d{2}-\d{2}$", p["snapshot_date"]), p["snapshot_date"]
        assert isinstance(p["quantity"], float)
        assert p["value"] is None or isinstance(p["value"], float)
    fixas, _, _ = _rodar(fake, snapshot_date="2026-08-10")
    assert fixas[0]["snapshot_date"] == "2026-08-10"


def test_ordenacao_valor_desc_com_sem_rota_no_fim():
    precos = {**PRECOS_BASE, "ETHBRL": "15000.00"}
    fake = _cenario(spot=[("ETH", "0.1", "0"), ("BTC", "0.01", "0"), ("XYZ", "1", "0")],
                    precos=precos)
    posicoes, _, _ = _rodar(fake)
    assert [p["asset"] for p in posicoes] == ["BTC", "ETH", "XYZ"], \
        f"ordem inesperada: {[p['asset'] for p in posicoes]}"


def test_erro_de_api_2015_nao_propaga():
    orig_req, orig_avisar = bc._request, bc._avisar
    avisos = []
    os.environ["BINANCE_API_KEY"] = "chave-de-teste"
    os.environ["BINANCE_API_SECRET"] = "segredo-de-teste"
    try:
        def _boom(*a, **k):
            raise _erro(-2015)
        bc._request = _boom
        bc._avisar = lambda msg: avisos.append(msg)
        assert bc.fetch_positions() == [], "-2015 devia devolver lista vazia"
    finally:
        bc._request, bc._avisar = orig_req, orig_avisar
        os.environ.pop("BINANCE_API_KEY", None)
        os.environ.pop("BINANCE_API_SECRET", None)
    assert avisos, "-2015 tem de avisar o usuário"


def test_falha_do_exchangeinfo_aborta_em_vez_de_zerar_a_carteira():
    """5xx/rede no exchangeInfo não pode devolver a carteira inteira sem valor."""
    fake = _cenario(spot=[("BTC", "1", "0"), ("ETH", "10", "0")],
                    precos={**PRECOS_BASE, "ETHBRL": "15000.00"})

    def _cai(params):
        raise bc._BinanceErro("erro no servidor da Binance")
    fake[P_INFO] = _cai
    posicoes, _, avisos = _rodar(fake)
    assert posicoes == [], \
        f"metadados indisponíveis têm de abortar com [], veio {posicoes}"
    assert any("exchangeInfo" in a for a in avisos), f"avisos: {avisos}"


def test_1121_no_exchangeinfo_degrada_o_lote_sem_abortar():
    """Único caso que degrada: símbolo inexistente derruba o lote, não a execução."""
    fake = _cenario(spot=[("BTC", "1", "0")], precos=PRECOS_BASE)

    def _cai(params):
        raise bc._BinanceErro("Invalid symbol.", code=-1121)
    fake[P_INFO] = _cai
    posicoes, _, _ = _rodar(fake)
    assert len(posicoes) == 1 and posicoes[0]["value"] is None, \
        f"-1121 devia virar posição sem rota, veio {posicoes}"


def test_divergencia_na_conferencia_apenas_avisa():
    fake = _cenario(spot=[("BTC", "0.01", "0")], precos=PRECOS_BASE,
                    carteiras=[("Spot", "2014.59")])  # ~2x o somatório (5439.39/5.40≈1007.3)
    posicoes, _, avisos = _rodar(fake)
    assert len(posicoes) == 1 and abs(posicoes[0]["value"] - 5439.39) < 0.01, \
        "a conferência não pode alterar nem derrubar as posições"
    assert any("diverg" in a.lower() for a in avisos), \
        f"esperava aviso de divergência, avisos: {avisos}"


def test_carteira_fora_de_cobertura_com_unicode():
    fake = _cenario(spot=[("BTC", "0.01", "0")], precos=PRECOS_BASE,
                    carteiras=[("Spot", "1007.30"), ("USDⓈ-M Futures", "500")])
    posicoes, _, avisos = _rodar(fake)
    assert len(posicoes) == 1, "a conferência não altera as posições"
    assert any("Futures" in a for a in avisos), \
        f"carteira não coberta com saldo tem de ser avisada, avisos: {avisos}"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("\nTodos os testes passaram.")
