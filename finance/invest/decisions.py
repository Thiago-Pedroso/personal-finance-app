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
      "locked":   {"acoes": ["ITUB3"]},
      "links":    [{"ledger_id": "uuid", "destinations": [{"ticker": "VIAGEM",
                                                           "amount": 1200}]}]
    }

`links` define o destino de um lançamento do Ledger e substitui o que havia antes;
destinos vazios desfazem a ligação. Caixinha recebe `BUY` (ou `SELL` no resgate) e conta
recebe `TRANSFER`, que só documenta a chegada: o saldo da conta vem da Pluggy.

Ticker que aparece numa movimentação e ainda não existe é cadastrado sozinho, com o tipo
deduzido do formato, e ganha linha na aba de cotações.
"""

import json
import math
from datetime import date

from .. import ledger as L
from . import accounts as ACC
from . import assets as A
from . import ledger_link as LL
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


def allocation_sim_settings(data: dict) -> tuple[dict | None, list[str]]:
    """Simulador livre de alocação (aba própria): rascunho puro, nunca vira trade.

    `base` é opcional — quando ausente, a tela usa o `to_invest` ao vivo. `items` é
    uma lista de rótulo livre + valor, sem relação com `InvestPolicy`/`InvestAssets`."""
    if "allocation_sim" not in data:
        return None, []
    raw = data.get("allocation_sim")
    if not isinstance(raw, dict):
        return None, ["A simulação de alocação precisa ser um objeto."]
    problems: list[str] = []
    base = None
    if raw.get("base") not in (None, ""):
        try:
            base = float(raw["base"])
        except (TypeError, ValueError):
            problems.append("A base do simulador de alocação precisa ser um número.")
    items = []
    for row in raw.get("items") or []:
        label = str((row or {}).get("label") or "").strip()
        if not label:
            continue
        try:
            amount = float(row.get("amount") or 0)
        except (TypeError, ValueError):
            amount = 0.0
        items.append({"label": label, "amount": amount})
    return {"base": base, "items": items}, problems


def needs_ledger(data: dict) -> bool:
    return bool(data.get("links")) or any(
        (row or {}).get("ledger_id") for row in data.get("trades") or [])


def _link_trades(data: dict, assets: dict, existing: list[dict], records: dict,
                 treatments: dict, problems: list,
                 subcategories=LL.DESTINATION_SUBCATEGORIES) -> tuple[list[dict], set]:
    """Movimentações novas e ids removidos para cada destino informado em `links`."""
    new_trades, removed = [], set()
    for link in data.get("links") or []:
        ledger_id = (link or {}).get("ledger_id")
        record = records.get(ledger_id)
        if not record:
            problems.append(f"Lançamento {ledger_id} não existe no Ledger: destino ignorado.")
            continue
        amount = L.effective_amount(record)
        limit = LL.needed_destination(record, treatments, subcategories) or abs(amount)
        rows = [row for row in link.get("destinations") or []
                if float(row.get("amount") or 0) > 0]
        invalid = [row.get("ticker") for row in rows
                   if row.get("ticker", "").upper() not in assets
                   or not A.accepts_destination(assets[row["ticker"].upper()])]
        if invalid:
            problems.append(f"Destino inválido para {record['description']}: "
                            f"{', '.join(map(str, invalid))} não é caixinha, saldo nem conta.")
            continue
        total = round(sum(float(row["amount"]) for row in rows), 2)
        if total - limit > LL.TOLERANCE:
            problems.append(f"Destinos de {record['description']} somam {total:.2f}, "
                            f"mais que os {limit:.2f} do lançamento.")
            continue
        removed |= {trade["id"] for trade in map(T.normalize, existing)
                    if trade["ledger_id"] == ledger_id and trade["side"] in LL.LINK_SIDES
                    and trade["ticker"] in assets
                    and A.accepts_destination(assets[trade["ticker"]])}
        for row in rows:
            ticker = row["ticker"].upper()
            side = ("TRANSFER" if assets[ticker]["valuation"] == "account"
                    else "BUY" if amount < 0 else "SELL")
            new_trades.append(T.normalize({
                "date": record["date"], "ticker": ticker, "side": side,
                "price": round(float(row["amount"]), 2),
                "account": assets[ticker]["account"], "source": "ledger",
                "ledger_id": ledger_id, "note": row.get("note") or "destino do lançamento"}))
    return new_trades, removed


def plan_changes(data: dict, assets: dict, accounts: dict, tree: dict,
                 existing: list[dict], records: dict | None = None,
                 treatments: dict | None = None,
                 subcategories=LL.DESTINATION_SUBCATEGORIES) -> dict:
    """Calcula o que muda, sem tocar em rede. Devolve o estado novo e os problemas."""
    assets = {ticker: dict(asset) for ticker, asset in assets.items()}
    accounts = {key: dict(value) for key, value in accounts.items()}
    tree = {node: dict(value) for node, value in tree.items()}
    problems: list[str] = []
    contribution, contribution_problems = contribution_settings(data)
    problems.extend(contribution_problems)
    allocation_sim, allocation_sim_problems = allocation_sim_settings(data)
    problems.extend(allocation_sim_problems)

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
        if trade["ledger_id"] and records is not None and trade["ledger_id"] not in records:
            problems.append(f"Movimentação de {trade['ticker']} aponta para o lançamento "
                            f"{trade['ledger_id']}, que não existe no Ledger.")
            continue
        if trade["ticker"] not in assets:
            assets[trade["ticker"]] = _asset_from_trade(trade, tree, problems)
        new_trades.append(trade)

    link_problems: list[str] = []
    linked, removed = _link_trades(data, assets, existing, records or {},
                                   treatments or {}, link_problems, subcategories)
    problems.extend(link_problems)
    new_trades.extend(linked)

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
            "trades": new_trades, "removed_trades": removed,
            "link_problems": link_problems,
            "quotes": quotes, "problems": problems,
            "contribution_settings": contribution, "allocation_sim": allocation_sim}


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
