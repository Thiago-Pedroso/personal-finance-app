"""Posições de cripto na Binance (Spot + Funding + Simple Earn), já convertidas para BRL.

Módulo-folha e SÓ-LEITURA: não escreve na planilha, não importa nada de `finance.*`.
Devolve `list[dict]` no mesmo schema de posição que o módulo de investimentos consome.

Uso:
  uv run python -m finance.binance_client [--json] [--data YYYY-MM-DD]
"""

import argparse
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from dotenv import load_dotenv

load_dotenv()

BASE = "https://api.binance.com"
LIMIAR_POEIRA_BRL = 5.00       # posições abaixo disso somem do painel
TOLERANCIA_CONFERENCIA = 0.02  # 2% de divergência vs wallet/balance antes de avisar
PISO_CONFERENCIA_BRL = 50.00   # abaixo disso, divergência percentual é ruído; não avisa
RECV_WINDOW = 60000            # máximo aceito pela Binance; mata quase todo -1021
_TIMEOUT = 20                  # segundos, por request

# Offset de relógio aprendido em /api/v3/time (só no tratamento de -1021).
_offset_ms: int = 0


# ---- Infra ----------------------------------------------------------------------------

def _avisar(msg: str) -> None:
    """Único canal de aviso do módulo. Nunca recebe chave, secret ou header."""
    print(f"[binance] {msg}")


class _BinanceErro(RuntimeError):
    """Falha de acesso à Binance. Nunca escapa de fetch_positions()."""

    def __init__(self, msg: str, code: int | None = None):
        super().__init__(msg)
        self.msg = msg
        self.code = code


def _credenciais() -> tuple[str, str] | None:
    """Credenciais do .env, ou None se qualquer uma faltar (não levanta KeyError)."""
    key = os.environ.get("BINANCE_API_KEY", "").strip()
    secret = os.environ.get("BINANCE_API_SECRET", "").strip()
    if not key or not secret:
        return None
    return key, secret


def _assinar(params: dict, secret: str) -> str:
    """Query string assinada, pronta pro wire. Nunca re-serializar o resultado (-1022)."""
    qs = urllib.parse.urlencode(params)
    assinatura = hmac.new(secret.encode(), qs.encode(), hashlib.sha256).hexdigest()
    return f"{qs}&signature={assinatura}"


def _codigo_do_erro(err) -> int | None:
    """Extrai o `code` da Binance do corpo do HTTPError, tolerando corpo não-JSON."""
    try:
        return json.loads(err.read().decode("utf-8", "replace")).get("code")
    except Exception:
        return None


def _request(method: str, path: str, params: dict | None = None,
             signed: bool = False, _retry: bool = True) -> dict | list:
    """Único ponto de saída HTTP do módulo. Só GET/POST de leitura nos paths permitidos."""
    params = dict(params or {})
    headers = {}
    if signed:
        cred = _credenciais()
        if cred is None:
            raise _BinanceErro("credenciais ausentes")
        key, secret = cred
        params["timestamp"] = int(time.time() * 1000) + _offset_ms
        params["recvWindow"] = RECV_WINDOW
        qs = _assinar(params, secret)
        headers["X-MBX-APIKEY"] = key
    else:
        qs = urllib.parse.urlencode(params)

    if method == "POST":
        req = urllib.request.Request(f"{BASE}{path}", data=qs.encode(), headers={
            **headers, "Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    else:
        url = f"{BASE}{path}?{qs}" if qs else f"{BASE}{path}"
        req = urllib.request.Request(url, headers=headers, method="GET")

    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as err:
        code = _codigo_do_erro(err)
        return _tratar_http(err, code, method, path, params, signed, _retry)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        if _retry:
            time.sleep(2)
            return _request(method, path, params, signed, _retry=False)
        raise _BinanceErro("rede indisponível")


def _tratar_http(err, code, method, path, params, signed, _retry) -> dict | list:
    """Tabela de erros da Binance: decide entre uma retentativa e _BinanceErro."""
    http = err.code
    if http == 418:
        raise _BinanceErro("IP temporariamente banido pela Binance; não insista",
                           code=code)
    if code == -2014:
        raise _BinanceErro(
            "chave de API em formato inválido (espaço ou quebra de linha no .env?)",
            code=code)
    if code == -2015:
        raise _BinanceErro(
            "chave inválida/revogada, IP não autorizado ou sem permissão de leitura — "
            "confira as três hipóteses no painel da Binance (API Management)",
            code=code)
    if code == -1022:
        raise _BinanceErro("assinatura rejeitada", code=code)
    if code == -1021:
        if _retry:
            _sincronizar_relogio()
            return _request(method, path, params, signed, _retry=False)
        raise _BinanceErro("relógio local dessincronizado", code=code)
    if http == 429 or code == -1003:
        if _retry:
            espera = err.headers.get("Retry-After") if err.headers else None
            try:
                espera = int(espera)
            except (TypeError, ValueError):
                espera = 5
            time.sleep(min(espera, 60))
            return _request(method, path, params, signed, _retry=False)
        raise _BinanceErro("limite de requisições da Binance atingido",
                           code=code)
    if http >= 500 or code == -1000:
        if _retry:
            time.sleep(2)
            return _request(method, path, params, signed, _retry=False)
        raise _BinanceErro("erro no servidor da Binance", code=code)
    raise _BinanceErro(f"HTTP {http} da Binance (code {code})", code=code)


def _sincronizar_relogio() -> None:
    """Aprende o offset do relógio local contra o servidor (só no caso -1021)."""
    global _offset_ms
    try:
        r = _request("GET", "/api/v3/time")
        _offset_ms = int(r["serverTime"]) - int(time.time() * 1000)
    except Exception:
        _offset_ms = 0


def _dec(v) -> Decimal:
    """Decimal tolerante: valor inválido/ausente vira 0."""
    try:
        return Decimal(str(v))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal(0)


# ---- Carteiras ------------------------------------------------------------------------

def _somar(linhas, *campos: str) -> dict[str, Decimal]:
    """Soma `campos` por ativo, descartando saldo zerado. Base dos quatro leitores."""
    out: dict[str, Decimal] = {}
    for b in linhas or []:
        qtd = sum((_dec(b.get(c)) for c in campos), Decimal(0))
        if qtd > 0:
            out[b["asset"]] = out.get(b["asset"], Decimal(0)) + qtd
    return out


def _saldos_spot() -> dict[str, Decimal]:
    """Spot: free + locked. Devolve LD* como veio (a neutralização é em fetch_positions)."""
    r = _request("GET", "/api/v3/account", {"omitZeroBalances": "true"}, signed=True)
    return _somar(r.get("balances"), "free", "locked")


def _saldos_funding() -> dict[str, Decimal]:
    """Funding/P2P: free + locked (ignora freeze/withdrawing/btcValuation)."""
    return _somar(_request("POST", "/sapi/v1/asset/get-funding-asset", signed=True),
                  "free", "locked")


def _paginar(path: str, params: dict) -> list[dict]:
    """Pagina os endpoints de Simple Earn (size=100), com teto rígido de 20 páginas."""
    linhas: list[dict] = []
    current = 1
    while current <= 20:
        r = _request("GET", path, {**params, "current": current, "size": 100}, signed=True)
        linhas.extend(r.get("rows") or [])
        total = int(r.get("total") or 0)
        if current * 100 >= total:
            return linhas
        current += 1
    _avisar(f"paginação de {path} passou de 20 páginas; usando o que foi lido")
    return linhas


def _saldos_earn_flexivel() -> dict[str, Decimal]:
    """Simple Earn flexível: soma `totalAmount` (ignora collateralAmount)."""
    return _somar(_paginar("/sapi/v1/simple-earn/flexible/position", {}), "totalAmount")


def _saldos_earn_travado() -> dict[str, Decimal]:
    """Simple Earn travado: soma `amount` (ignora recompensas e redeemingAmt)."""
    return _somar(_paginar("/sapi/v1/simple-earn/locked/position", {}), "amount")


# ---- Dupla contagem -------------------------------------------------------------------

def _eh_espelho_de_earn(asset: str, ativos_earn: set[str]) -> bool:
    """LDBTC é espelho de BTC no Earn; LDO (Lido DAO) é ativo real — nunca cortar cego."""
    if not asset.startswith("LD") or len(asset) <= 2:
        return False
    return asset[2:] in ativos_earn


# ---- Precificação ---------------------------------------------------------------------

def _tabela_precos() -> dict[str, Decimal]:
    """Todos os símbolos numa chamada só (peso 4)."""
    r = _request("GET", "/api/v3/ticker/price")
    return {i["symbol"]: _dec(i["price"]) for i in r}


def _status_simbolos(candidatos: list[str]) -> dict[str, str]:
    """Status de negociação dos candidatos (já filtrados pelo ticker), em lotes de 100."""
    if not candidatos:
        return {}
    out: dict[str, str] = {}
    for i in range(0, len(candidatos), 100):
        lote = candidatos[i:i + 100]
        try:
            r = _request("GET", "/api/v3/exchangeInfo",
                         {"symbols": json.dumps(lote, separators=(",", ":"))})
        except _BinanceErro as e:
            # Só -1121 (símbolo inexistente) degrada o lote; qualquer outra falha
            # (5xx, 429, rede) sobe e aborta a leitura — devolver a carteira inteira
            # sem valor seria indistinguível de "a Binance não cota esses ativos".
            if e.code != -1121:
                raise
            _avisar(f"exchangeInfo recusou um lote de símbolos ({e.msg}); "
                    "esses ativos ficam sem rota de preço")
            continue
        for s in r.get("symbols", []):
            out[s["symbol"]] = s.get("status", "")
    return out


def _rota_preco(asset: str, precos: dict[str, Decimal], status: dict[str, str],
                usdtbrl: Decimal | None) -> tuple[Decimal, str] | None:
    """Preço em BRL por unidade + texto da rota, ou None quando não há rota."""
    if asset == "BRL":
        return (Decimal(1), "BRL nativo")

    par = f"{asset}BRL"
    if par in precos and status.get(par) == "TRADING" and precos[par] > 0:
        return (precos[par], f"{par} @ {precos[par]:.2f}")

    par = f"{asset}USDT"
    if (usdtbrl is not None and par in precos
            and status.get(par) == "TRADING" and precos[par] > 0):
        return (precos[par] * usdtbrl,
                f"{par} @ {precos[par]} * USDTBRL @ {usdtbrl}")

    return None


# ---- Conferência ----------------------------------------------------------------------

def _cobre(nome: str) -> bool:
    """Carteira coberta por este módulo? Match por substring (nomes têm unicode)."""
    n = (nome or "").lower()
    return "spot" in n or "funding" in n or "earn" in n


def _conferir(total_brl: Decimal, usdtbrl: Decimal | None, precos: dict) -> None:
    """Compara o somatório com /asset/wallet/balance. Só avisa; nunca levanta."""
    if usdtbrl is None:
        _avisar("sem USDTBRL: conferência pulada")
        return
    try:
        try:
            carteiras = _request("GET", "/sapi/v1/asset/wallet/balance",
                                 {"quoteAsset": "USDT"}, signed=True)
            fator = usdtbrl
        except _BinanceErro as e:
            if e.code not in (-1100, -1102):
                raise
            # quoteAsset recusado: cai no default (BTC) e converte via BTCUSDT.
            carteiras = _request("GET", "/sapi/v1/asset/wallet/balance", signed=True)
            btcusdt = precos.get("BTCUSDT")
            if not btcusdt:
                _avisar("conferência de carteiras indisponível")
                return
            fator = btcusdt * usdtbrl

        cobertas = sum((_dec(w.get("balance")) for w in carteiras
                        if _cobre(w.get("walletName"))), Decimal(0))
        esperado_brl = cobertas * fator
        base = max(esperado_brl, total_brl)
        if base >= PISO_CONFERENCIA_BRL:
            dif = abs(total_brl - esperado_brl)
            if dif / base > Decimal(str(TOLERANCIA_CONFERENCIA)):
                _avisar(f"divergência: somatório R$ {total_brl:.2f} vs carteiras Binance "
                        f"R$ {esperado_brl:.2f} ({dif / base * 100:.1f}%)")

        nao_cobertas = [w.get("walletName") for w in carteiras
                        if _dec(w.get("balance")) > 0 and not _cobre(w.get("walletName"))]
        if nao_cobertas:
            _avisar("carteiras com saldo fora da cobertura deste módulo: "
                    + ", ".join(str(n) for n in nao_cobertas))
    except Exception:
        _avisar("conferência de carteiras indisponível")


# ---- Entrada pública ------------------------------------------------------------------

def _posicao(data: str, asset: str, qtd: Decimal, valor: Decimal | None, nota: str) -> dict:
    return {
        "snapshot_date": data,
        "source": "binance",
        "institution": "Binance",
        "asset": asset,
        "class": "CRYPTO",
        "quantity": float(qtd),
        "value": None if valor is None else round(float(valor), 2),
        "currency": "BRL",
        "note": nota,
    }


def fetch_positions(snapshot_date: str | None = None) -> list[dict]:
    """Posições de cripto na Binance convertidas para BRL, uma por ativo.

    Cada item tem as chaves: snapshot_date, source, institution, asset, class,
    quantity, value, currency, note. Cobre Spot + Funding + Simple Earn
    (flexível e travado), somando `free` e `locked` e descartando os saldos
    espelho `LD*` da Spot para não contar Earn duas vezes.

    Garantias:
      (a) sem BINANCE_API_KEY/BINANCE_API_SECRET, devolve [] silenciosamente;
      (b) nunca levanta exceção — falha vira aviso no stdout e lista vazia;
      (c) ativo sem rota de preço sai com `value: None` e nota de aviso, nunca 0.0.
    """
    data = snapshot_date or datetime.now(timezone.utc).date().isoformat()
    if _credenciais() is None:
        return []

    try:
        try:
            spot = _saldos_spot()
            funding = _saldos_funding()
            flex = _saldos_earn_flexivel()
            lock = _saldos_earn_travado()
        except _BinanceErro as e:
            _avisar(e.msg)
            return []

        ativos_earn = set(flex) | set(lock)

        # Neutralização da dupla contagem: LD* espelhando Earn é descartado da Spot.
        spot_limpa: dict[str, Decimal] = {}
        for asset, qtd in spot.items():
            if _eh_espelho_de_earn(asset, ativos_earn):
                _avisar(f"saldo espelho de Earn descartado da Spot: {asset} {qtd}")
                continue
            spot_limpa[asset] = qtd
        spot = spot_limpa

        fontes: dict[str, list[str]] = {}
        quantidades: dict[str, Decimal] = {}
        for mapa, rotulo in ((spot, "spot"), (funding, "funding"),
                             (flex, "earn_flex"), (lock, "earn_lock")):
            for asset, qtd in mapa.items():
                if qtd <= 0:
                    continue
                quantidades[asset] = quantidades.get(asset, Decimal(0)) + qtd
                fontes.setdefault(asset, []).append(rotulo)

        try:
            precos = _tabela_precos()
        except _BinanceErro:
            _avisar("preços indisponíveis")
            return []

        candidatos = ["USDTBRL"] if "USDTBRL" in precos else []
        for asset in quantidades:
            for s in (f"{asset}BRL", f"{asset}USDT"):
                if s in precos and s not in candidatos:
                    candidatos.append(s)
        try:
            status = _status_simbolos(candidatos)
        except _BinanceErro:
            _avisar("exchangeInfo indisponível")
            return []

        usdtbrl = None
        if status.get("USDTBRL") == "TRADING" and precos.get("USDTBRL", Decimal(0)) > 0:
            usdtbrl = precos["USDTBRL"]
        else:
            _avisar("USDTBRL indisponível: rotas via USDT ficam sem preço")

        posicoes: list[dict] = []
        total_brl = Decimal(0)
        for asset, qtd in quantidades.items():
            origem = "+".join(fontes[asset])
            rota = _rota_preco(asset, precos, status, usdtbrl)
            if rota is None:
                posicoes.append(_posicao(data, asset, qtd, None,
                                         f"{origem}; SEM ROTA DE PRECO"))
                _avisar(f"{asset}: sem rota de preço em BRL; posição emitida sem valor")
                continue
            preco, texto = rota
            valor = qtd * preco
            if valor < Decimal(str(LIMIAR_POEIRA_BRL)):
                continue  # poeira: só depois de precificar
            total_brl += valor
            posicoes.append(_posicao(data, asset, qtd, valor, f"{origem}; {texto}"))

        _conferir(total_brl, usdtbrl, precos)

        posicoes.sort(key=lambda p: (p["value"] is None,
                                     -(p["value"] or 0.0),
                                     p["asset"]))
        return posicoes
    except Exception as e:  # garantia (b): nada escapa daqui
        _avisar(f"falha inesperada ao ler a Binance: {type(e).__name__}")
        return []


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Mostra as posições de cripto na Binance (somente leitura).")
    ap.add_argument("--json", action="store_true", help="imprime as posições em json.")
    ap.add_argument("--data", help="data do snapshot (YYYY-MM-DD); default: hoje em utc.")
    args = ap.parse_args()

    if _credenciais() is None:
        print("sem BINANCE_API_KEY/BINANCE_API_SECRET no .env; nada a mostrar.")
        return

    posicoes = fetch_positions(args.data)
    if args.json:
        print(json.dumps(posicoes, ensure_ascii=False, indent=2))
        return
    if not posicoes:
        print("nenhuma posição encontrada.")
        return
    print(f"{'ASSET':<8} {'QUANTITY':>18} {'VALUE (BRL)':>14}  NOTE")
    for p in posicoes:
        valor = "-" if p["value"] is None else f"{p['value']:.2f}"
        print(f"{p['asset']:<8} {p['quantity']:>18.8f} {valor:>14}  {p['note']}")
    total = sum(p["value"] for p in posicoes if p["value"] is not None)
    print(f"{'TOTAL':<8} {'':>18} {total:>14.2f}")


if __name__ == "__main__":
    main()
