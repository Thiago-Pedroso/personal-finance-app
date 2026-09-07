"""Gera `data/reports/invest.json`, que é o que o dashboard lê.

Mesmo desenho do relatório de gastos: o Sheets guarda fatos, o Python calcula e o
frontend só desenha. Grava também um snapshot diário por nó na aba InvestSnapshots,
que é o histórico de patrimônio que a planilha nunca teve.

Uso:
  uv run python -m finance.invest.report
"""

import json
from datetime import date, datetime, timezone

from .. import sheets
from ..config import INVEST_PENDING_FILE, REPORTS_DIR, ensure_dirs
from . import accounts as ACC
from . import assets as A
from . import plan as PL
from . import policy as P
from . import portfolio as PF
from . import quotes as Q
from . import trades as T

SNAPSHOT_TAB = "InvestSnapshots"
CONTRIBUTION_KEY = "invest_monthly_contribution"


def problems(tree: dict, assets: dict, positions: dict, quote_map: dict) -> list[str]:
    """Tudo que a tela precisa avisar, em uma lista só."""
    out = list(P.validate(tree))
    for node, total in sorted(A.unbalanced_nodes(assets).items()):
        name = tree[node]["name"] if node in tree else node
        out.append(f"Os alvos dos ativos de '{name}' somam {total * 100:.1f}%.")
    for ticker in sorted(assets):
        if assets[ticker]["node"] not in tree:
            out.append(f"O ativo {ticker} aponta para um nó que não existe na política.")
    stale = sorted(t for t, q in quote_map.items() if q["stale"])
    if stale:
        out.append("Cotação defasada ou indisponível: " + ", ".join(stale) + ".")
    return out


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
          balances: dict | None = None, pending: dict | None = None) -> dict:
    positions = PF.build(assets, trades, quote_map, balances)
    totals = PF.totals(positions, tree)
    spread = PF.allocation(positions, tree)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "contribution": contribution,
        "totals": totals,
        "policy": [{**tree[node], "weight": P.weight(tree, node),
                    "is_leaf": P.is_leaf(tree, node),
                    "counts": P.counts(tree, node)} for node in P.order(tree)],
        "allocation": [spread[node] for node in
                       sorted(spread, key=lambda n: -spread[n]["value"])],
        "positions": [positions[t] for t in
                      sorted(positions, key=lambda t: -positions[t]["value"])],
        "nodes": PF.by_node(positions),
        "accounts": [accounts[key] for key in sorted(accounts)],
        "sectors": A.sectors(assets),
        "plan": PL.build(positions, assets, tree, contribution),
        "quotes": {ticker: quote_map[ticker] for ticker in sorted(quote_map)},
        "history": history or [],
        "pending": pending or {},
        "problems": problems(tree, assets, positions, quote_map),
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
    positions = PF.build(assets, trades, quote_map)

    if write_snapshot:
        merged = merge_snapshots(snapshots, snapshot_rows(positions, today), today)
        sheets.write_records(SNAPSHOT_TAB, merged)
        snapshots = merged
        changes = Q.keep_last_good(quote_records, quote_map, today)
        if changes:
            sheets.update_fields(Q.TAB, changes)

    report = build(assets, trades, quote_map, tree, accounts, contribution,
                   history_from(snapshots), pending=load_pending())
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
