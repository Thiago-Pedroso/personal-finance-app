"""Plano de aporte: onde colocar o próximo dinheiro.

A planilha respondia com um ativo só. Aqui o aporte é repartido, porque R$ 3.000
raramente cabem num papel, e o resultado é uma lista de ordens com o desvio antes e
depois. O motor **nunca sugere venda**: rebalanceia só com dinheiro novo, então sobra
acima do alvo é ignorada em vez de virar ordem de saída.

Dois modos, ambos legítimos: `spread` reparte proporcional ao déficit (padrão) e `focus`
concentra tudo no maior buraco, que é o que a planilha tentava fazer.
"""

import math

from . import policy as P
from . import portfolio as PF

MODES = ("spread", "focus")


def _share(amount: float, deficits: dict, mode: str) -> dict:
    """Divide `amount` entre as chaves conforme o déficit de cada uma."""
    total = sum(deficits.values())
    if amount <= 0 or total <= 0:
        return {key: 0.0 for key in deficits}
    if mode == "focus":
        biggest = max(deficits, key=lambda key: deficits[key])
        return {key: (amount if key == biggest else 0.0) for key in deficits}
    return {key: amount * value / total for key, value in deficits.items()}


def _round_to_lot(amount: float, price: float | None, lot: float) -> tuple[float, float]:
    """Quantidade comprável e quanto ela custa. Sem preço (renda fixa, saldo), o valor
    passa direto e a quantidade fica indefinida."""
    if not price or price <= 0:
        return 0.0, amount
    if not lot or lot <= 0:
        lot = 1.0
    lots = math.floor(amount / (price * lot) + 1e-9)
    quantity = max(lots, 0) * lot
    return quantity, quantity * price


def _reallocate(orders: list[dict], leftover: float) -> float:
    """Gasta a sobra do arredondamento onde ainda falta mais, um lote por vez.

    O alvo é o déficit real do ativo, não o pedaço que o rateio deu a ele: é isso que
    permite a sobra de um papel caro escorrer para outro que ainda está abaixo do alvo.
    Nunca compra acima do déficit, então sobra que não cabe em lote nenhum continua
    sobrando, à vista, em vez de piorar o desvio escondido."""
    if leftover <= 0:
        return leftover
    while True:
        candidates = [o for o in orders
                      if o["price"] and o["missing"] > 0
                      and o["price"] * (o["lot_size"] or 1.0) <= leftover + 1e-9]
        if not candidates:
            return leftover
        order = max(candidates, key=lambda o: o["missing"])
        lot = order["lot_size"] or 1.0
        step = order["price"] * lot
        order["quantity"] += lot
        order["amount"] += step
        order["missing"] -= step
        leftover -= step


def build(positions: dict, assets: dict, tree: dict, contribution: float,
          mode: str = "spread") -> dict:
    """Plano completo: quanto vai para cada classe, quais ordens e o desvio resultante."""
    mode = mode if mode in MODES else "spread"
    contribution = max(float(contribution or 0.0), 0.0)
    spread = PF.allocation(positions, tree)
    weights = P.leaf_weights(tree)
    eligible = sum(item["value"] for item in spread.values() if item["in_totals"])
    target_base = eligible + contribution

    deficits, targets = {}, {}
    for node, weight in weights.items():
        target = target_base * weight
        targets[node] = target
        deficits[node] = max(0.0, target - spread[node]["value"])
    if sum(deficits.values()) <= 0:      # carteira no alvo: segue a própria política
        deficits = dict(weights)
    per_node = _share(contribution, deficits, mode)

    orders = []
    for node, amount in per_node.items():
        node_assets = [a for a in assets.values()
                       if a["node"] == node and a["active"]]
        if not node_assets or amount <= 0:
            continue
        node_value = spread[node]["value"] + amount
        asset_deficits = {}
        for asset in node_assets:
            position = positions.get(asset["ticker"], {})
            wanted = node_value * asset["target_pct"]
            asset_deficits[asset["ticker"]] = max(
                0.0, wanted - position.get("value", 0.0))
        if sum(asset_deficits.values()) <= 0:
            asset_deficits = {a["ticker"]: a["target_pct"] for a in node_assets}
        for ticker, share in _share(amount, asset_deficits, mode).items():
            if share <= 0:
                continue
            asset = assets[ticker]
            position = positions.get(ticker, {})
            price = position.get("price") if asset["valuation"] == "quote" else None
            quantity, cost = _round_to_lot(share, price, asset["lot_size"])
            orders.append({
                "ticker": ticker, "name": asset["name"], "node": node,
                "account": asset["account"], "price": price,
                "lot_size": asset["lot_size"], "quantity": quantity,
                "amount": cost, "wanted": share,
                "missing": asset_deficits.get(ticker, share) - cost,
            })

    allocated = sum(order["amount"] for order in orders)
    leftover = _reallocate(orders, contribution - allocated)
    allocated = sum(order["amount"] for order in orders)

    after = {}
    for node, item in spread.items():
        added = sum(o["amount"] for o in orders if o["node"] == node)
        after[node] = item["value"] + added
    base_after = sum(value for node, value in after.items()
                     if spread[node]["in_totals"])
    nodes = []
    for node in sorted(spread, key=lambda n: -spread[n]["value"]):
        item = spread[node]
        added = sum(o["amount"] for o in orders if o["node"] == node)
        real_after = (after[node] / base_after) if base_after and item["in_totals"] else 0.0
        nodes.append({
            "node": node, "name": item["name"], "value": item["value"],
            "target_value": targets.get(node, 0.0),
            "deficit": deficits.get(node, 0.0) if item["in_totals"] else 0.0,
            "amount": added, "in_totals": item["in_totals"],
            "real_pct": item["real_pct"], "target_pct": item["target_pct"],
            "drift_before": item["drift"],
            "drift_after": real_after - item["target_pct"] if item["in_totals"] else 0.0,
        })

    # o que ficou de fora por não caber num lote: a tela explica a sobra com isso
    blocked = sorted({order["node"] for order in orders
                      if order["missing"] > 0 and order["price"]})
    for order in orders:
        order.pop("missing", None)
    return {
        "contribution": contribution, "mode": mode,
        "eligible_value": eligible, "allocated": allocated,
        "leftover": max(contribution - allocated, 0.0),
        "blocked_nodes": blocked,
        "nodes": nodes,
        "orders": sorted((o for o in orders if o["amount"] > 0),
                         key=lambda o: -o["amount"]),
    }
