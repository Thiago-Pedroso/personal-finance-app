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
# rendimento diário que a instituição credita sem lançamento cabe nessa folga
STATEMENT_TOLERANCE = 1.0
SYMBOLS = {"BRL": "R$", "USD": "US$", "EUR": "€", "GBP": "£"}


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
    """Sem valor não é carteira. Cobre a posição encerrada que a corretora continua
    listando e o direito de subscrição, que aparece com cotas e saldo zero."""
    return abs(investment["balance"]) <= NOISE_TOLERANCE


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


def normalize_account(raw, item_id: str) -> dict:
    return {
        "item_id": str(item_id),
        "account_id": str(getattr(raw, "id", "") or ""),
        "name": (getattr(raw, "name", None) or "").strip(),
        "type": getattr(raw, "type", None),
        "balance": float(getattr(raw, "balance", None) or 0.0),
        "currency": getattr(raw, "currency_code", None) or "BRL",
    }


def fetch_accounts(item_ids=None) -> list[dict]:
    """Saldo das contas. Cartão fica de fora: fatura é dívida, não saldo."""
    client = pc.build_client(pc.get_api_key())
    out = []
    for item_id in (item_ids or pc.item_ids()):
        try:
            accounts = pc.list_accounts(client, item_id)
        except Exception as error:
            print(f"  ! item {str(item_id)[:8]}: {str(error)[:120]}")
            continue
        out.extend(normalize_account(raw, item_id) for raw in accounts
                   if getattr(raw, "type", None) != "CREDIT")
    return out


def money(value: float, currency: str = "BRL") -> str:
    return f"{SYMBOLS.get(currency, currency)} {value:,.2f}"


def statement_gap(records: list[dict], account_id: str, since: str | None, today: str,
                  informed_change: float) -> float | None:
    """Quanto da variação informada pela instituição não tem lançamento no Ledger."""
    if not since:
        return None
    recorded = sum(float(record.get("signed_amount") or 0.0) for record in records
                   if record.get("account_id") == account_id
                   and since < str(record.get("date") or "") <= today)
    gap = informed_change - recorded
    return gap if abs(gap) > STATEMENT_TOLERANCE else None


def reconcile_accounts(accounts_data: list[dict], positions: dict, assets: dict,
                       today: str, records: list[dict] | None = None) -> list[dict]:
    """Saldo de conta aponta para a conta em `pluggy_code`, e a comparação é na moeda
    dela. Com o Ledger, também diz quando falta extrato."""
    by_id = {account["account_id"]: account for account in accounts_data}
    pending = []
    for ticker, asset in assets.items():
        code = (asset.get("pluggy_code") or "").strip()
        account = by_id.get(code)
        if not account:
            continue
        currency = (account["currency"] or asset["currency"] or "BRL").upper()
        position = positions.get(ticker) or {}
        current = position.get("native_value", position.get("value", 0.0))
        if abs(account["balance"] - current) <= 0.01:
            continue
        gap = statement_gap(records or [], code, position.get("last_balance_date"),
                            today, account["balance"] - current)
        if gap is not None:
            pending.append({
                "kind": "statement_missing", "ticker": ticker, "account_id": code,
                "since": position.get("last_balance_date"), "difference": gap,
                "message": f"{asset['name']}: {money(gap, currency)} de variação desde "
                           f"{position.get('last_balance_date')} sem lançamento no "
                           "Ledger. Traga o extrato dessa conta."})
        pending.append({
            "kind": "balance_update", "ticker": ticker, "currency": currency,
            "difference": account["balance"] - current, "value": account["balance"],
            "message": f"{asset['name']}: saldo em conta é "
                       f"{money(account['balance'], currency)}.",
            "trade": {"date": today, "ticker": ticker, "side": "BALANCE",
                      "price": account["balance"], "currency": currency,
                      "source": "pluggy",
                      "note": "saldo informado pela instituição"}})
    return pending


def _match(investment: dict, assets: dict) -> str | None:
    """Casa a posição da corretora com um ativo do catálogo."""
    code = investment["code"]
    for ticker, asset in assets.items():
        if asset["pluggy_code"] and asset["pluggy_code"].upper() == (code or ""):
            return ticker
    if code and code in assets:
        return code
    return None


def _unknown_message(name: str, count: int, total: float) -> str:
    if count > 1:
        return (f"{name}: {count} aplicações somando R$ {total:,.2f} aparecem na "
                "corretora e não estão na carteira.")
    return f"{name} aparece na corretora e não está na carteira, com R$ {total:,.2f}."


def reconcile(investments: list[dict], positions: dict, assets: dict,
              today: str, bucket_items=()) -> list[dict]:
    """Pendências entre o que a corretora informa e o que a carteira calculou.

    Itens de conta de caixinhas ficam de fora da conferência ativo a ativo: lá a
    instituição não sabe a divisão, e quem confere é o total (`bucket_report`)."""
    pending = []
    unknown: dict = {}
    buckets = {str(item) for item in bucket_items}
    for investment in investments:
        if investment["item_id"] in buckets:
            continue
        ticker = _match(investment, assets)
        if not ticker:
            # uma caixinha vira dezenas de papéis idênticos na corretora; agrupamos por
            # nome para a tela mostrar uma linha, não cinquenta
            key = investment["code"] or investment["name"]
            group = unknown.setdefault(key, {
                "kind": "unknown_asset", "ticker": investment["code"],
                "name": investment["name"], "value": 0.0, "quantity": 0.0, "count": 0})
            group["value"] += investment["balance"]
            group["quantity"] += investment["quantity"]
            group["count"] += 1
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
    for group in unknown.values():
        group["message"] = _unknown_message(
            group["ticker"] or group["name"], group["count"], group["value"])
        pending.append(group)
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
    if report.get("blocked") or abs(report["unallocated"]) <= tolerance \
            or not report["registered"]:
        return []
    return [{"date": today, "ticker": bucket["ticker"], "side": "BALANCE",
             "price": round(bucket["suggested"], 2), "source": "pluggy",
             "note": "rendimento rateado pelo saldo"}
            for bucket in report["buckets"]]


def account_total(investments: list[dict], item_id: str) -> float:
    return sum(inv["balance"] for inv in investments
               if inv["item_id"] == str(item_id))


def bucket_balances(positions: dict, assets: dict, account_id: str) -> dict:
    return {
        ticker: positions[ticker]["value"]
        for ticker, asset in assets.items()
        if asset["account"] == account_id
        and asset["valuation"] == "balance"
        and ticker in positions
    }


def blocking_destinations(pending: list[dict], item_id: str) -> list[dict]:
    """Aportes sem destino na conta de caixinhas: com eles, a sobra não é rendimento."""
    return [item for item in pending
            if item["kind"] in ("destination_missing", "destination_partial")
            and str(item.get("item_id")) == str(item_id)]


def suggested_trades(pending: list[dict]) -> list[dict]:
    return [T.normalize(item["trade"]) for item in pending if item.get("trade")]
