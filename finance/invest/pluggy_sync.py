"""Leitura dos investimentos na Pluggy e conciliação com a carteira registrada.

A Pluggy entrega **posição boa e transação fraca**: as quantidades batem com a carteira,
mas o histórico de operações vem incompleto e sem preço médio. Por isso ela nunca escreve
na carteira: compara e levanta pendência.

Duas regras separam os casos:

- **Ativo por cota**: quantidade diferente significa movimentação faltando, e o app pede o
  registro em vez de corrigir o saldo. Aceitar o número da corretora aqui apagaria a
  compra que ninguém lançou.
- **Ativo por saldo**: valor diferente vira lançamento de atualização, que é como o
  próprio usuário informa saldo.
"""

import pluggy_sdk

from .. import pluggy_client as pc
from . import trades as T

# Papel temporário e posição encerrada não são carteira: entram zerados e só fazem ruído.
NOISE_TOLERANCE = 1e-9


def normalize_investment(raw, item_id: str) -> dict:
    return {
        "item_id": str(item_id),
        "code": (getattr(raw, "code", None) or "").strip().upper() or None,
        "name": (getattr(raw, "name", None) or "").strip(),
        "type": getattr(raw, "type", None),
        "subtype": getattr(raw, "subtype", None),
        "quantity": float(getattr(raw, "quantity", None) or 0.0),
        "balance": float(getattr(raw, "balance", None) or 0.0),
        "original": float(getattr(raw, "amount_original", None) or 0.0),
        "institution": getattr(getattr(raw, "institution", None), "name", None),
        "updated_at": str(getattr(raw, "updated_at", "") or "") or None,
    }


def is_noise(investment: dict) -> bool:
    """Posição encerrada ou direito de subscrição: saldo zero e nada a acompanhar."""
    return (abs(investment["balance"]) <= NOISE_TOLERANCE
            and abs(investment["quantity"]) <= NOISE_TOLERANCE)


def fetch(item_ids=None) -> list[dict]:
    """Investimentos de cada item, já sem o ruído. Uma request por item."""
    client = pc.build_client(pc.get_api_key())
    api = pluggy_sdk.InvestmentApi(client)
    out = []
    for item_id in (item_ids or pc.item_ids()):
        try:
            results = api.investments_list(item_id=item_id).results or []
        except Exception as error:                       # conector sem o produto
            print(f"  ! item {str(item_id)[:8]}: {str(error)[:120]}")
            continue
        found = [normalize_investment(raw, item_id) for raw in results]
        kept = [inv for inv in found if not is_noise(inv)]
        print(f"  item {str(item_id)[:8]}: {len(kept)} posições "
              f"({len(found) - len(kept)} zeradas ignoradas)")
        out.extend(kept)
    return out


def _match(investment: dict, assets: dict) -> str | None:
    """Casa a posição da corretora com um ativo do catálogo."""
    code = investment["code"]
    for ticker, asset in assets.items():
        if asset["pluggy_code"] and asset["pluggy_code"].upper() == (code or ""):
            return ticker
    if code and code in assets:
        return code
    return None


def reconcile(investments: list[dict], positions: dict, assets: dict,
              today: str) -> list[dict]:
    """Pendências entre o que a corretora informa e o que a carteira calculou."""
    pending = []
    for investment in investments:
        ticker = _match(investment, assets)
        if not ticker:
            pending.append({
                "kind": "unknown_asset", "ticker": investment["code"],
                "name": investment["name"], "value": investment["balance"],
                "quantity": investment["quantity"],
                "message": f"{investment['code'] or investment['name']} aparece na "
                           "corretora e não está na carteira."})
            continue
        asset = assets[ticker]
        position = positions.get(ticker, {})
        if asset["valuation"] == "quote":
            difference = investment["quantity"] - position.get("quantity", 0.0)
            if abs(difference) > 1e-6:
                verb = "faltando" if difference > 0 else "a mais"
                pending.append({
                    "kind": "quantity_mismatch", "ticker": ticker,
                    "difference": difference,
                    "broker_quantity": investment["quantity"],
                    "our_quantity": position.get("quantity", 0.0),
                    "message": f"{ticker}: a corretora informa "
                               f"{investment['quantity']:g} cotas e a carteira tem "
                               f"{position.get('quantity', 0.0):g}. Tem movimentação "
                               f"{verb}."})
            continue
        difference = investment["balance"] - position.get("value", 0.0)
        if abs(difference) > 0.01:
            pending.append({
                "kind": "balance_update", "ticker": ticker,
                "difference": difference, "value": investment["balance"],
                "message": f"{ticker}: saldo na corretora é "
                           f"R$ {investment['balance']:,.2f}.",
                "trade": {"date": today, "ticker": ticker, "side": "BALANCE",
                          "price": investment["balance"], "source": "pluggy",
                          "note": "saldo informado pela corretora"}})
    return pending


def bucket_report(total: float, buckets: dict) -> dict:
    """Divisão de uma conta de caixinhas: a instituição dá o total, você dá as partes.

    O que sobra é dinheiro a alocar, e a distribuição do rendimento é proporcional ao
    saldo, que aqui é exata porque as caixinhas rendem a mesma taxa."""
    registered = sum(buckets.values())
    unallocated = total - registered
    base = registered or 1.0
    return {
        "total": total, "registered": registered, "unallocated": unallocated,
        "buckets": [{"ticker": ticker, "value": value,
                     "share": value / base if registered else 0.0,
                     "suggested": value + unallocated * (value / base)
                     if registered else 0.0}
                    for ticker, value in sorted(buckets.items(),
                                                key=lambda item: -item[1])],
    }


def bucket_updates(report: dict, today: str, tolerance: float = 0.01) -> list[dict]:
    """Lançamentos que encaixam as caixinhas no total informado pela instituição."""
    if abs(report["unallocated"]) <= tolerance or not report["registered"]:
        return []
    return [{"date": today, "ticker": bucket["ticker"], "side": "BALANCE",
             "price": round(bucket["suggested"], 2), "source": "pluggy",
             "note": "rendimento rateado pelo saldo"}
            for bucket in report["buckets"]]


def account_total(investments: list[dict], item_id: str) -> float:
    return sum(inv["balance"] for inv in investments
               if inv["item_id"] == str(item_id))


def suggested_trades(pending: list[dict]) -> list[dict]:
    return [T.normalize(item["trade"]) for item in pending if item.get("trade")]
