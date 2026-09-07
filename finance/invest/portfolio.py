"""Posições derivadas das movimentações.

Duas naturezas de ativo, um motor só:

**Por cota** (ações, FIIs, ETFs, cripto): quantidade vem das compras menos as vendas e o
preço médio é a média ponderada **só das compras**, que é a regra brasileira. Uma venda
reduz a quantidade, preserva o preço médio e produz resultado realizado.

**Por saldo** (renda fixa, conta no exterior, caixinha): o valor é o último saldo informado
somado ao que entrou e saiu depois. Informar um saldo novo não sobrescreve nada: gera um
ajuste, e esse ajuste é valorização, nunca aporte. É o que impede a rentabilidade de mentir.
"""

from . import assets as A
from . import policy as P
from . import trades as T


def _blank(asset: dict) -> dict:
    return {
        "ticker": asset["ticker"], "name": asset["name"], "node": asset["node"],
        "account": asset["account"], "sector": asset["sector"],
        "currency": asset["currency"], "valuation": asset["valuation"],
        "target_pct": asset["target_pct"], "lot_size": asset["lot_size"],
        "quantity": 0.0, "avg_price": 0.0, "avg_price_brl": 0.0, "cost": 0.0,
        "price": None, "value": 0.0, "profit": 0.0, "profit_pct": None,
        "realized": 0.0, "income": 0.0, "fees": 0.0,
        "price_source": None, "stale": False, "last_balance_date": None,
    }


def _by_quote(position: dict, trades: list[dict]) -> dict:
    quantity = 0.0
    bought_qty = 0.0          # só compras: base do preço médio
    bought_cost = 0.0         # em reais, já com câmbio da data
    bought_native = 0.0       # em moeda de origem, para separar ativo de câmbio
    for trade in trades:
        side = trade["side"]
        total = T.total_brl(trade)
        if side == "BUY":
            quantity += trade["quantity"]
            bought_qty += trade["quantity"]
            bought_cost += total + trade["fees"]
            bought_native += trade["quantity"] * trade["price"]
            position["fees"] += trade["fees"]
        elif side == "SELL":
            average = bought_cost / bought_qty if bought_qty else 0.0
            position["realized"] += (trade["price"] * trade["fx_rate"] - average) \
                * trade["quantity"] - trade["fees"]
            quantity -= trade["quantity"]
            position["fees"] += trade["fees"]
        elif side in T.INCOME_SIDES:
            position["income"] += total
        elif side == "SPLIT" and trade["quantity"] > 0:
            factor = trade["quantity"]
            quantity *= factor
            bought_qty *= factor
        elif side == "ADJUST":
            quantity += trade["quantity"]
    position["quantity"] = quantity
    if bought_qty:
        position["avg_price_brl"] = bought_cost / bought_qty
        position["avg_price"] = bought_native / bought_qty
    # custo da posição atual = quantidade viva ao preço médio (o que a planilha faz)
    position["cost"] = quantity * position["avg_price_brl"]
    return position


def _by_balance(position: dict, trades: list[dict]) -> dict:
    balance = 0.0
    contributed = 0.0
    opened = False
    for trade in trades:
        side = trade["side"]
        total = T.total_brl(trade)
        if side == "BALANCE":
            if not opened:
                # saldo antes de qualquer movimento é abertura: dinheiro que já era seu.
                # Depois de um aporte, a diferença passa a ser rendimento.
                contributed = total
                opened = True
            else:
                # daí em diante, a diferença entre o informado e o esperado é rendimento
                position["income"] += total - balance
            balance = total
            position["last_balance_date"] = trade["date"]
        elif side in ("BUY", "ADJUST"):
            balance += total
            contributed += total
            opened = True
        elif side == "SELL":
            balance -= total
            contributed -= total
            opened = True
        elif side in T.INCOME_SIDES:
            balance += total
            position["income"] += total
    position["quantity"] = 0.0
    position["cost"] = contributed
    position["value"] = balance
    position["price_source"] = "balance"
    return position


def _price_of(asset: dict, quotes: dict) -> tuple[float | None, bool]:
    quote = quotes.get(asset["ticker"]) or {}
    price = quote.get("price")
    if price is None:
        return None, True
    return float(price), bool(quote.get("stale"))


def build(assets: dict, trades: list[dict], quotes: dict | None = None,
          balances: dict | None = None) -> dict:
    """{ticker: posição}. `quotes` traz {ticker: {price, stale}} já em reais;
    `balances` traz o valor que a Pluggy informou para os ativos sincronizados."""
    quotes = quotes or {}
    balances = balances or {}
    grouped = T.by_ticker(T.sort([T.normalize(trade) for trade in trades]))
    out = {}
    for ticker, asset in A.active(assets).items():
        position = _blank(asset)
        rows = grouped.get(ticker, [])
        if asset["valuation"] == "quote":
            _by_quote(position, rows)
            price, stale = _price_of(asset, quotes)
            position["price"] = price
            position["stale"] = stale
            position["price_source"] = "quote"
            position["value"] = position["quantity"] * price if price is not None \
                else position["cost"]
        elif asset["valuation"] == "pluggy":
            # sincronizado é o mesmo ativo por saldo: o que muda é quem escreve o
            # lançamento. `balances` só entra quando o valor chega ao vivo, sem gravar.
            _by_balance(position, rows)
            informed = balances.get(ticker)
            if informed is not None:
                position["value"] = float(informed)
            position["stale"] = informed is None and not position["last_balance_date"]
            position["price_source"] = "pluggy"
        else:
            _by_balance(position, rows)
        position["profit"] = position["value"] - position["cost"]
        position["profit_pct"] = (position["profit"] / position["cost"]
                                  if position["cost"] else None)
        out[ticker] = position
    return out


def by_node(positions: dict) -> dict:
    """Agrega as posições por nó da política, somando reais e nunca percentuais."""
    out: dict = {}
    for position in positions.values():
        node = out.setdefault(position["node"], {
            "node": position["node"], "value": 0.0, "cost": 0.0, "profit": 0.0,
            "income": 0.0, "realized": 0.0, "tickers": []})
        node["value"] += position["value"]
        node["cost"] += position["cost"]
        node["profit"] += position["profit"]
        node["income"] += position["income"]
        node["realized"] += position["realized"]
        node["tickers"].append(position["ticker"])
    for node in out.values():
        node["profit_pct"] = node["profit"] / node["cost"] if node["cost"] else None
    return out


def totals(positions: dict, tree: dict) -> dict:
    """Patrimônio e rentabilidade. `eligible` é a base do rebalanceamento: só o que
    conta na política. O total sempre soma tudo, porque o dinheiro é seu."""
    total_value = sum(p["value"] for p in positions.values())
    total_cost = sum(p["cost"] for p in positions.values())
    eligible_value = sum(p["value"] for p in positions.values()
                         if p["node"] in tree and P.counts(tree, p["node"]))
    eligible_cost = sum(p["cost"] for p in positions.values()
                        if p["node"] in tree and P.counts(tree, p["node"]))
    return {
        "value": total_value, "cost": total_cost,
        "profit": total_value - total_cost,
        # lucro dividido por custo: somar as porcentagens das classes é o erro da planilha
        "profit_pct": ((total_value - total_cost) / total_cost) if total_cost else None,
        "eligible_value": eligible_value, "eligible_cost": eligible_cost,
        "income": sum(p["income"] for p in positions.values()),
        "realized": sum(p["realized"] for p in positions.values()),
    }


def allocation(positions: dict, tree: dict) -> dict:
    """{nó folha: {value, real_pct, target_pct, drift}} sobre o patrimônio elegível."""
    grouped = by_node(positions)
    base = sum(node["value"] for key, node in grouped.items()
               if key in tree and P.counts(tree, key))
    targets = P.leaf_weights(tree)
    out = {}
    for node in set(targets) | set(grouped):
        value = grouped.get(node, {}).get("value", 0.0)
        target = targets.get(node, 0.0)
        real = (value / base) if base else 0.0
        counted = node in targets
        out[node] = {
            "node": node, "name": tree[node]["name"] if node in tree else node,
            "value": value, "real_pct": real if counted else 0.0,
            "target_pct": target, "drift": (real - target) if counted else 0.0,
            "in_totals": counted,
        }
    return out
