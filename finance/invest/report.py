"""Gera `data/reports/invest.json`, que é o que o dashboard lê.

Mesmo desenho do relatório de gastos: o Sheets guarda fatos, o Python calcula e o
frontend só desenha. Grava também um snapshot diário por nó na aba InvestSnapshots,
que é o histórico de patrimônio que a planilha nunca teve.

Uso:
  uv run python -m finance.invest.report
"""

import json
from datetime import date, datetime, timezone

from .. import ledger as L
from .. import sheets
from .. import taxonomy as TX
from ..config import INVEST_PENDING_FILE, REPORTS_DIR, ensure_dirs
from . import accounts as ACC
from . import assets as A
from . import ledger_link as LL
from . import plan as PL
from . import policy as P
from . import portfolio as PF
from . import quotes as Q
from . import trades as T

SNAPSHOT_TAB = "InvestSnapshots"
CONTRIBUTION_KEY = "invest_monthly_contribution"
CONTRIBUTION_MODE_KEY = "invest_contribution_mode"
# Simulador livre de alocação (aba própria): rascunho puro, nunca vira trade nem
# InvestPolicy. {"base": float | None, "items": [{"label", "amount"}]}.
ALLOCATION_SIM_KEY = "invest_allocation_sim"


def problems(tree: dict, assets: dict, positions: dict, quote_map: dict) -> list[str]:
    """Tudo que a tela precisa avisar, em uma lista só."""
    out = list(P.validate(tree))
    for node, total in sorted(A.unbalanced_nodes(assets).items()):
        # nó fora dos alvos não precisa fechar 100%: caixinha é saldo, não estratégia
        if node in tree and not P.counts(tree, node):
            continue
        name = tree[node]["name"] if node in tree else node
        out.append(f"Os alvos dos ativos de '{name}' somam {total * 100:.1f}%.")
    for ticker in sorted(assets):
        if assets[ticker]["node"] not in tree:
            out.append(f"O ativo {ticker} aponta para um nó que não existe na política.")
    for ticker, currency in sorted(A.foreign_balances(assets).items()):
        quote = quote_map.get(f"{currency}BRL") or {}
        if quote.get("price") is None:
            out.append(f"Sem câmbio {currency}/BRL: o saldo de {ticker} está em "
                       f"{currency} e não foi convertido para reais.")
    stale = sorted(t for t, q in quote_map.items() if q["stale"])
    if stale:
        out.append("Cotação defasada ou indisponível: " + ", ".join(stale) + ".")
    return out


def ledger_links(records: list[dict], trades: list, treatments: dict,
                 assets: dict, subcategories=LL.DESTINATION_SUBCATEGORIES) -> list[dict]:
    """Cada lançamento ligado à carteira (ou que deveria estar), com o que a tela mostra."""
    by_id = {record["id"]: record for record in records}
    status = LL.destination_status(records, trades, treatments, assets, subcategories)
    return [{"ledger_id": ledger_id, "date": by_id[ledger_id].get("date"),
             "description": by_id[ledger_id].get("description"),
             "account_name": by_id[ledger_id].get("account_name"),
             "amount": by_id[ledger_id].get("signed_amount"),
             "category": by_id[ledger_id].get("category"),
             "subcategory": by_id[ledger_id].get("subcategory"), **info}
            for ledger_id, info in sorted(status.items(),
                                          key=lambda item: by_id[item[0]]["date"])]


def load_pending() -> dict:
    """Pendências da última conferência com as corretoras, se houver."""
    if not INVEST_PENDING_FILE.exists():
        return {}
    try:
        return json.loads(INVEST_PENDING_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def build(assets: dict, trades: list, quote_map: dict, tree: dict, accounts: dict,
          contribution: float, history: list | None = None,
          balances: dict | None = None, pending: dict | None = None,
          contribution_mode: str = "spread",
          allocation_sim: dict | None = None, records: list | None = None,
          treatments: dict | None = None,
          subcategories=LL.DESTINATION_SUBCATEGORIES) -> dict:
    contribution_mode = (contribution_mode if contribution_mode in PL.MODES
                         else "spread")
    positions = PF.build(assets, trades, quote_map, balances)
    totals = PF.totals(positions, tree)
    records = records or []
    treatments = treatments or {}
    spread = PF.allocation(positions, tree)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "contribution": contribution,
        "contribution_mode": contribution_mode,
        "totals": totals,
        "wealth": PF.wealth(positions, tree),
        "policy": [{**tree[node], "weight": P.weight(tree, node),
                    "is_leaf": P.is_leaf(tree, node),
                    "counts": P.counts(tree, node)} for node in P.order(tree)],
        "allocation": [spread[node] for node in
                       sorted(spread, key=lambda n: -spread[n]["value"])],
        "positions": [positions[t] for t in
                      sorted(positions, key=lambda t: -positions[t]["value"])],
        "trades": T.sort([T.normalize(trade) for trade in trades]),
        "nodes": PF.by_node(positions),
        "accounts": [accounts[key] for key in sorted(accounts)],
        "sectors": A.sectors(assets),
        "plan": PL.build(positions, assets, tree, contribution, contribution_mode),
        "quotes": {ticker: quote_map[ticker] for ticker in sorted(quote_map)},
        "history": history or [],
        "pending": pending or {},
        "problems": problems(tree, assets, positions, quote_map),
        "allocation_sim": allocation_sim or {"base": None, "items": []},
        "links": ledger_links(records, trades, treatments, assets, subcategories),
        "audit": LL.destination_pending(records, trades, treatments, assets,
                                        subcategories),
        "destination_subcategories": list(subcategories),
    }


def snapshot_rows(positions: dict, today: str) -> list[dict]:
    return [{"date": today, "node": node, "value": data["value"], "cost": data["cost"]}
            for node, data in sorted(PF.by_node(positions).items())]


def merge_snapshots(existing: list[dict], rows: list[dict], today: str) -> list[dict]:
    """Um registro por nó por dia: rodar o relatório duas vezes no mesmo dia atualiza
    em vez de duplicar."""
    kept = [row for row in existing if str(row.get("date")) != today]
    return sorted(kept + rows, key=lambda row: (str(row.get("date")), row.get("node")))


def history_from(snapshots: list[dict]) -> list[dict]:
    """Série diária de patrimônio e custo, pronta para o gráfico."""
    by_day: dict = {}
    for row in snapshots:
        day = str(row.get("date") or "")
        if not day:
            continue
        point = by_day.setdefault(day, {"date": day, "value": 0.0, "cost": 0.0})
        point["value"] += float(row.get("value") or 0.0)
        point["cost"] += float(row.get("cost") or 0.0)
    return [by_day[day] for day in sorted(by_day)]


def generate(write_snapshot: bool = True) -> dict:
    ensure_dirs()
    tree = P.load()
    assets = A.load()
    accounts = ACC.load()
    trades = T.load()

    quote_records = sheets.read_records(Q.TAB)
    quote_map = Q.load(quote_records)
    pending = Q.missing(quote_map, assets)
    if pending:
        Q.ensure(pending)
        quote_records = sheets.read_records(Q.TAB)
        quote_map = Q.load(quote_records)

    today = date.today().isoformat()
    snapshots = sheets.read_records(SNAPSHOT_TAB)
    contribution = float(sheets.read_config(CONTRIBUTION_KEY, 0) or 0)
    contribution_mode = str(sheets.read_config(CONTRIBUTION_MODE_KEY, "spread")
                            or "spread")
    allocation_sim = sheets.read_config(ALLOCATION_SIM_KEY, None)
    positions = PF.build(assets, trades, quote_map)

    if write_snapshot:
        merged = merge_snapshots(snapshots, snapshot_rows(positions, today), today)
        sheets.write_records(SNAPSHOT_TAB, merged)
        snapshots = merged
        changes = Q.keep_last_good(quote_records, quote_map, today)
        if changes:
            sheets.update_fields(Q.TAB, changes)

    report = build(assets, trades, quote_map, tree, accounts, contribution,
                   history_from(snapshots), pending=load_pending(),
                   contribution_mode=contribution_mode, allocation_sim=allocation_sim,
                   records=list(L.load_ledger().values()),
                   treatments=TX.load_treatments(),
                   subcategories=LL.load_destination_subcategories())
    path = REPORTS_DIR / "invest.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    total = report["totals"]
    print(f"Carteira R$ {total['value']:,.2f} | elegível R$ {total['eligible_value']:,.2f}"
          f" | {len(report['positions'])} ativos -> {path}")
    for problem in report["problems"]:
        print(f"  ! {problem}")
    return report


def main() -> None:
    generate()


if __name__ == "__main__":
    main()
