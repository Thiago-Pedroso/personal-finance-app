"""Aplica `data/.invest_decisions.json`: o caminho por conversa, sem tela.

Espelha o `.decisions.json` da categorização. Serve para registrar movimentação, criar
ativo e conta, mexer na política e informar saldo pelo chat, e é também o que faz o app
funcionar para quem ainda não tem interface aberta.

    {
      "accounts": [{"id": "xp", "name": "XP", "kind": "broker"}],
      "policy":   [{"node": "fiis", "name": "FIIs", "parent": "br", "target_pct": 0.3}],
      "assets":   [{"ticker": "SAPR11", "node": "fiis", "sector": "Saneamento"}],
      "trades":   [{"date": "2026-09-07", "ticker": "SAPR11", "side": "BUY",
                    "quantity": 30, "price": 4.5, "account": "xp"}],
      "balances": [{"ticker": "INTER-GLOBAL", "date": "2026-09-07", "value": 13450}],
      "targets":  {"acoes": {"BBAS3": 0.07}},
      "locked":   {"acoes": ["ITUB3"]}
    }

Ticker que aparece numa movimentação e ainda não existe é cadastrado sozinho, com o tipo
deduzido do formato, e ganha linha na aba de cotações.
"""

import json
import math
from datetime import date

from . import accounts as ACC
from . import assets as A
from . import plan as PL
from . import policy as P
from . import quotes as Q
from . import trades as T


def _valid_date(value: str) -> bool:
    try:
        date.fromisoformat(str(value))
        return True
    except ValueError:
        return False


def contribution_settings(data: dict) -> tuple[dict | None, list[str]]:
    if "contribution" not in data and "contribution_mode" not in data:
        return None, []
    try:
        amount = float(data.get("contribution"))
    except (TypeError, ValueError):
        return None, ["O próximo aporte precisa ser um valor válido."]
    if not math.isfinite(amount) or amount < 0:
        return None, ["O próximo aporte não pode ser negativo."]
    mode = str(data.get("contribution_mode") or "spread")
    if mode not in PL.MODES:
        return None, ["O modo do próximo aporte é inválido."]
    return {"amount": amount, "mode": mode}, []


def plan_changes(data: dict, assets: dict, accounts: dict, tree: dict,
                 existing: list[dict]) -> dict:
    """Calcula o que muda, sem tocar em rede. Devolve o estado novo e os problemas."""
    assets = {ticker: dict(asset) for ticker, asset in assets.items()}
    accounts = {key: dict(value) for key, value in accounts.items()}
    tree = {node: dict(value) for node, value in tree.items()}
    problems: list[str] = []
    contribution, contribution_problems = contribution_settings(data)
    problems.extend(contribution_problems)

    for row in data.get("accounts") or []:
        account = ACC.normalize(row)
        if not account["id"]:
            problems.append("Conta sem id foi ignorada.")
            continue
        accounts[account["id"]] = {**accounts.get(account["id"], {}), **account}

    for row in data.get("policy") or []:
        node = (row.get("node") or "").strip()
        if not node:
            problems.append("Nó de política sem id foi ignorado.")
            continue
        current = tree.get(node, {"node": node, "name": node, "parent": None,
                                  "target_pct": 0.0, "in_totals": True,
                                  "role": P.STRATEGY, "color": None, "icon": None})
        tree[node] = {**current, **{k: v for k, v in row.items() if k in current}}
        tree[node]["parent"] = (tree[node]["parent"] or None) or None

    for row in data.get("assets") or []:
        asset = A.normalize(row)
        if not asset["ticker"]:
            problems.append("Ativo sem ticker foi ignorado.")
            continue
        merged = {**assets.get(asset["ticker"], {}), **{k: v for k, v in row.items()}}
        assets[asset["ticker"]] = A.normalize(merged)

    new_trades: list[dict] = []
    for row in list(data.get("trades") or []) + _balances_as_trades(data):
        trade = T.normalize(row)
        if not trade["ticker"]:
            problems.append("Movimentação sem ticker foi ignorada.")
            continue
        # sem moeda declarada, o lançamento é na moeda do ativo: saldo em dólar fica
        # gravado como dólar, e a conversão é sempre da tela para dentro
        if not (row.get("currency") or "").strip() and trade["ticker"] in assets:
            trade["currency"] = assets[trade["ticker"]]["currency"]
        if not _valid_date(trade["date"]):
            problems.append(f"Movimentação de {trade['ticker']} com data inválida "
                            f"({trade['date'] or 'vazia'}).")
            continue
        if trade["ticker"] not in assets:
            assets[trade["ticker"]] = _asset_from_trade(trade, tree, problems)
        new_trades.append(trade)

    for node, targets in (data.get("targets") or {}).items():
        current = {ticker: asset["target_pct"] for ticker, asset in assets.items()
                   if asset["node"] == node and asset["active"]}
        unknown = [ticker for ticker in targets if ticker not in current]
        for ticker in unknown:
            problems.append(f"{ticker} não está em '{node}': alvo ignorado.")
        wanted = {t: v for t, v in targets.items() if t in current}
        locked = (data.get("locked") or {}).get(node, [])
        for ticker, value in A.redistribute(current, wanted, locked).items():
            assets[ticker]["target_pct"] = value

    problems.extend(_sale_warnings(new_trades, existing))
    quotes = [{"ticker": t["ticker"]} for t in new_trades
              if assets[t["ticker"]]["valuation"] == "quote"]
    return {"assets": assets, "accounts": accounts, "policy": tree,
            "trades": new_trades, "quotes": quotes, "problems": problems,
            "contribution_settings": contribution}


def _balances_as_trades(data: dict) -> list[dict]:
    """Saldo informado é uma movimentação como qualquer outra, e fica no histórico."""
    return [{"date": row.get("date") or date.today().isoformat(),
             "ticker": row.get("ticker"), "side": "BALANCE",
             "price": row.get("value"), "note": row.get("note"),
             "currency": row.get("currency"), "fx_rate": row.get("fx_rate"),
             "account": row.get("account"), "source": row.get("source") or "manual"}
            for row in (data.get("balances") or [])]


def _asset_from_trade(trade: dict, tree: dict, problems: list) -> dict:
    """Cadastro automático do ticker que apareceu numa movimentação."""
    kind = Q.guess_kind(trade["ticker"])
    node = ""
    if not tree:
        problems.append("A política está vazia: cadastre os nós antes dos ativos.")
    else:
        problems.append(
            f"{trade['ticker']} foi cadastrado sem classe. Defina o nó e o alvo dele.")
    return A.normalize({
        "ticker": trade["ticker"], "node": node, "account": trade["account"],
        "currency": trade["currency"],
        "quote_symbol": Q.symbol_for(trade["ticker"], kind),
        "valuation": "quote" if kind != "manual" else "balance",
        "lot_size": 1.0 if kind in ("stock_br", "fii_br") else 0.0001,
        "target_pct": 0.0, "active": True,
    })


def _sale_warnings(new_trades: list[dict], existing: list[dict]) -> list[str]:
    """Venda maior que a posição não é bloqueada, só avisada: pode ser lançamento
    faltando, e o registro é do usuário."""
    held: dict = {}
    for trade in T.sort([T.normalize(t) for t in existing] + new_trades):
        ticker = trade["ticker"]
        if trade["side"] == "BUY":
            held[ticker] = held.get(ticker, 0.0) + trade["quantity"]
        elif trade["side"] == "SELL":
            held[ticker] = held.get(ticker, 0.0) - trade["quantity"]
    return [f"{ticker} ficou com quantidade negativa ({quantity:g}): "
            f"falta registrar alguma compra." for ticker, quantity in sorted(held.items())
            if quantity < -1e-9]


def load(path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
