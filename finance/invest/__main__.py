"""CLI do espaço Investimentos.

  uv run python -m finance.invest report            # gera data/reports/invest.json
  uv run python -m finance.invest apply [arquivo]   # aplica .invest_decisions.json
  uv run python -m finance.invest show              # resumo da carteira no terminal
  uv run python -m finance.invest plan 3000         # simula um aporte
"""

import argparse
import sys
from pathlib import Path

from .. import sheets
from ..config import INVEST_DECISIONS_FILE
from . import accounts as ACC
from . import assets as A
from . import decisions as D
from . import plan as PL
from . import policy as P
from . import portfolio as PF
from . import quotes as Q
from . import report as R
from . import trades as T


def _money(value: float) -> str:
    return f"R$ {value:,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")


def _load_state():
    return A.load(), ACC.load(), P.load(), T.load()


def cmd_apply(args) -> int:
    path = Path(args.file) if args.file else INVEST_DECISIONS_FILE
    data = D.load(path)
    if not data:
        print(f"Nada para aplicar: {path} vazio ou inexistente.")
        return 0
    assets, accounts, tree, trades = _load_state()
    result = D.plan_changes(data, assets, accounts, tree, trades)

    if result["accounts"] != accounts:
        ACC.save(result["accounts"])
        print(f"Contas: {len(result['accounts'])}")
    if result["policy"] != tree:
        P.save(result["policy"])
        print(f"Política: {len(result['policy'])} nós")
    if result["assets"] != assets:
        A.save(result["assets"])
        print(f"Ativos: {len(result['assets'])}")
    if result["trades"]:
        T.append(result["trades"])
        print(f"Movimentações gravadas: {len(result['trades'])}")
    pending = Q.missing(Q.load(), result["assets"])
    if pending:
        Q.ensure(pending)
        print(f"Cotações criadas: {', '.join(e['ticker'] for e in pending)}")

    for problem in result["problems"]:
        print(f"  ! {problem}")
    R.generate()
    return 0


def cmd_report(args) -> int:
    R.generate(write_snapshot=not args.no_snapshot)
    return 0


def cmd_show(args) -> int:
    assets, accounts, tree, trades = _load_state()
    quotes = Q.load()
    positions = PF.build(assets, trades, quotes)
    totals = PF.totals(positions, tree)
    print(f"Carteira {_money(totals['value'])} | custo {_money(totals['cost'])} | "
          f"lucro {_money(totals['profit'])} "
          f"({(totals['profit_pct'] or 0) * 100:+.2f}%)")
    print(f"Elegível para rebalanceamento: {_money(totals['eligible_value'])}\n")
    spread = PF.allocation(positions, tree)
    for node in sorted(spread, key=lambda n: -spread[n]["value"]):
        item = spread[node]
        marker = "" if item["in_totals"] else "  (fora dos alvos)"
        print(f"{item['name']:<16} {_money(item['value']):>16}  "
              f"{item['real_pct'] * 100:6.2f}% / {item['target_pct'] * 100:5.2f}%  "
              f"{item['drift'] * 100:+6.2f}%{marker}")
    stale = [t for t, q in quotes.items() if q["stale"]]
    if stale:
        print(f"\nCotação defasada: {', '.join(sorted(stale))}")
    return 0


def cmd_plan(args) -> int:
    assets, _, tree, trades = _load_state()
    positions = PF.build(assets, trades, Q.load())
    result = PL.build(positions, assets, tree, args.amount, args.mode)
    print(f"Aporte {_money(result['contribution'])} · modo {result['mode']}\n")
    for order in result["orders"]:
        quantity = f"{order['quantity']:g}" if order["quantity"] else "-"
        print(f"  {order['ticker']:<12} {quantity:>12}  {_money(order['amount']):>14}")
    print(f"\nAlocado {_money(result['allocated'])} · "
          f"sobra {_money(result['leftover'])}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="finance.invest",
                                     description="Carteira de investimentos.")
    sub = parser.add_subparsers(dest="command")

    apply_cmd = sub.add_parser("apply", help="aplica o arquivo de decisões")
    apply_cmd.add_argument("file", nargs="?")
    apply_cmd.set_defaults(func=cmd_apply)

    report_cmd = sub.add_parser("report", help="gera data/reports/invest.json")
    report_cmd.add_argument("--no-snapshot", action="store_true")
    report_cmd.set_defaults(func=cmd_report)

    show_cmd = sub.add_parser("show", help="resumo da carteira")
    show_cmd.set_defaults(func=cmd_show)

    plan_cmd = sub.add_parser("plan", help="simula um aporte")
    plan_cmd.add_argument("amount", type=float)
    plan_cmd.add_argument("--mode", choices=PL.MODES, default="spread")
    plan_cmd.set_defaults(func=cmd_plan)

    args = parser.parse_args()
    if not getattr(args, "func", None):
        parser.print_help()
        return 0
    try:
        return args.func(args)
    except sheets.SheetsError as error:
        print(f"Erro de acesso ao Sheets: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
