"""Conferência da cripto com a Binance (finance.invest.binance_sync)."""
from finance.invest import binance_sync as BS

ASSETS = {
    "BTC": {"valuation": "quote", "account": "binance", "quote_symbol": "CURRENCY:BTCUSD"},
    "ETH": {"valuation": "quote", "account": "binance", "quote_symbol": "CURRENCY:ETHUSD"},
    "BNB": {"valuation": "quote", "account": "binance", "quote_symbol": "CURRENCY:BNBUSD"},
    "PETR4": {"valuation": "quote", "account": "xp", "quote_symbol": "BVMF:PETR4"},
    "CAIXA": {"valuation": "balance", "account": "binance"},
}
TODAY = "2026-11-03"


def row(asset, qty, value):
    return {"asset": asset, "quantity": qty, "value": value, "source": "binance"}


def test_casa_simbolo_pelo_ticker_e_pelo_quote_symbol():
    assets = {"BITCOIN": {"valuation": "quote", "account": "binance",
                          "quote_symbol": "CURRENCY:BTCUSD"},
              "SOL": {"valuation": "quote", "account": "binance", "pluggy_code": "SOL"}}
    assert BS.match_assets(assets) == {"BITCOIN": "BITCOIN", "BTC": "BITCOIN", "SOL": "SOL"}
    assert "PETR4" not in BS.match_assets(ASSETS), "só ativos da conta binance"


def test_quantidade_igual_nao_gera_pendencia():
    positions = {"BTC": {"quantity": 0.01}, "ETH": {"quantity": 0.5}}
    out = BS.reconcile([row("BTC", 0.01, 3500.0), row("ETH", 0.5, 7000.0)], positions,
                       ASSETS, TODAY)
    assert out == []


def test_divergencia_sugere_compra_e_venda_ao_preco_da_binance():
    positions = {"BTC": {"quantity": 0.01}, "ETH": {"quantity": 0.6}}
    out = BS.reconcile([row("BTC", 0.012, 4200.0), row("ETH", 0.5, 7000.0)], positions,
                       ASSETS, TODAY)
    btc, eth = sorted(out, key=lambda p: p["ticker"])
    assert btc["kind"] == "quantity_mismatch" and btc["source"] == "binance"
    assert btc["suggestion"] == {"date": TODAY, "ticker": "BTC", "side": "BUY",
                                 "quantity": 0.002, "price": 350000.0,
                                 "account": "binance", "source": "binance",
                                 "note": "diferença com a Binance"}
    assert eth["suggestion"]["side"] == "SELL" and eth["suggestion"]["quantity"] == 0.1
    assert "trade" not in btc, "compra/venda nunca vai para o --apply-balances"
    assert "BUY 0.002 BTC" in btc["message"]
    assert len(BS.suggested(out)) == 2


def test_moeda_fora_da_carteira_e_ativo_que_sumiu():
    positions = {"BNB": {"quantity": 1.0}}
    out = BS.reconcile([row("USDT", 50, 270.0), row("SHIB", 1000, 0.5)], positions,
                       ASSETS, TODAY)
    kinds = {(p["kind"], p["ticker"]) for p in out}
    assert ("unknown_asset", "USDT") in kinds
    assert ("unknown_asset", "SHIB") not in kinds, "poeira abaixo do mínimo"
    bnb = next(p for p in out if p["ticker"] == "BNB")
    assert bnb["suggestion"]["side"] == "SELL" and bnb["suggestion"]["quantity"] == 1.0
    assert "price" not in bnb["suggestion"]


def test_moeda_sem_preco_nao_inventa_preco():
    out = BS.reconcile([row("BTC", 0.02, None)], {"BTC": {"quantity": 0.01}}, ASSETS, TODAY)
    assert "price" not in out[0]["suggestion"]


def test_rendimento_do_earn_pingando_nao_vira_pendencia():
    # caso real: 0,00000003 ETH de diferença (~R$ 0,0004)
    out = BS.reconcile([row("ETH", 0.00997512, 123.99)], {"ETH": {"quantity": 0.00997509}},
                       ASSETS, TODAY)
    assert out == []
