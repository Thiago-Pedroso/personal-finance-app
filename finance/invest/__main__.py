"""CLI do espaço Investimentos.

  uv run python -m finance.invest report            # gera data/reports/invest.json
  uv run python -m finance.invest apply [arquivo]   # aplica .invest_decisions.json
  uv run python -m finance.invest show              # resumo da carteira no terminal
  uv run python -m finance.invest plan 3000         # simula um aporte
  uv run python -m finance.invest sync              # confere com as corretoras (Pluggy)
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from .. import ledger as L
from .. import sheets
from .. import taxonomy as TX
from ..config import INVEST_DECISIONS_FILE, INVEST_PENDING_FILE
from . import accounts as ACC
from . import assets as A
from . import decisions as D
from . import ledger_link as LL
from . import plan as PL
from . import pluggy_sync as PS
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
    records = treatments = None
    subcategories = LL.DESTINATION_SUBCATEGORIES
    if D.needs_ledger(data):
        records = L.load_ledger()
        treatments = TX.load_treatments()
        subcategories = LL.load_destination_subcategories()
    result = D.plan_changes(data, assets, accounts, tree, trades, records, treatments,
                            subcategories)

    if result["accounts"] != accounts:
        ACC.save(result["accounts"])
        print(f"Contas: {len(result['accounts'])}")
    if result["policy"] != tree:
        P.save(result["policy"])
        print(f"Política: {len(result['policy'])} nós")
    if result["assets"] != assets:
        A.save(result["assets"])
        print(f"Ativos: {len(result['assets'])}")
    if result["removed_trades"]:
        kept = [trade for trade in trades if trade["id"] not in result["removed_trades"]]
        T.save(kept + result["trades"])
        print(f"Movimentações substituídas: -{len(result['removed_trades'])} "
              f"+{len(result['trades'])}")
    elif result["trades"]:
        T.append(result["trades"])
        print(f"Movimentações gravadas: {len(result['trades'])}")
    if result["contribution_settings"]:
        settings = result["contribution_settings"]
        sheets.write_config(R.CONTRIBUTION_KEY, settings["amount"])
        sheets.write_config(R.CONTRIBUTION_MODE_KEY, settings["mode"])
        print(f"Próximo aporte: {_money(settings['amount'])}")
    if result["allocation_sim"] is not None:
        sheets.write_config(R.ALLOCATION_SIM_KEY, result["allocation_sim"])
        print(f"Simulador de alocação: {len(result['allocation_sim']['items'])} linha(s)")
    pending = Q.missing(Q.load(), result["assets"])
    if pending:
        Q.ensure(pending)
        print(f"Cotações criadas: {', '.join(e['ticker'] for e in pending)}")

    for problem in result["problems"]:
        print(f"  ! {problem}")
    R.generate()
    if records is not None:
        from .. import report as flow_report
        flow_report.generate(recs=list(records.values()))
    return 1 if result["link_problems"] else 0


def cmd_sync(args) -> int:
    """Confere a carteira com o que as corretoras informam. Nunca escreve sozinho:
    divergência de quantidade pede movimentação, saldo pede confirmação."""
    assets, accounts, tree, trades = _load_state()
    positions = PF.build(assets, trades, Q.load())
    today = date.today().isoformat()

    records = list(L.load_ledger().values())
    destinations = LL.destination_pending(records, trades, TX.load_treatments(), assets,
                                          LL.load_destination_subcategories())

    print("Lendo investimentos na Pluggy...")
    investments = PS.fetch()
    bucket_items = {account["pluggy_item_id"] for account in accounts.values()
                    if account["kind"] == "bucket" and account["pluggy_item_id"]}
    pending = PS.reconcile(investments, positions, assets, today, bucket_items)
    pending.extend(PS.reconcile_accounts(PS.fetch_accounts(), positions, assets, today,
                                         records))
    pending.extend(destinations)

    buckets_report = {}
    for account in accounts.values():
        if account["kind"] != "bucket" or not account["pluggy_item_id"]:
            continue
        total = PS.account_total(investments, account["pluggy_item_id"])
        held = PS.bucket_balances(positions, assets, account["id"])
        report = PS.bucket_report(total, held)
        blocking = PS.blocking_destinations(destinations, account["pluggy_item_id"])
        report["blocked"] = len(blocking)
        buckets_report[account["id"]] = report
        print(f"\n{account['name']}: total {_money(report['total'])}, "
              f"registrado {_money(report['registered'])}, "
              f"a alocar {_money(report['unallocated'])}")
        if blocking:
            print(f"  rateio suspenso: {len(blocking)} aporte(s) sem destino nesta conta")

    print("\nLendo o extrato para proventos...")
    income, income_pending = LL.income_from_ledger(records, assets, positions, trades)
    pending.extend(income_pending)
    print(f"  {len(income)} provento(s) reconhecido(s)")

    updates = PS.suggested_trades(pending)
    for report in buckets_report.values():
        updates.extend(T.normalize(row) for row in PS.bucket_updates(report, today))

    INVEST_PENDING_FILE.write_text(json.dumps(
        {"generated_at": today, "pending": pending, "buckets": buckets_report,
         "suggested_trades": updates, "income": income},
        ensure_ascii=False, indent=2) + "\n")
    print(f"\n{len(pending)} pendência(s):")
    for item in pending:
        print(f"  ! {item['message']}")
    print(f"\nGravado em {INVEST_PENDING_FILE}")
    to_write = []
    if args.apply_balances:
        to_write += [t for t in updates if t["side"] == "BALANCE"]
    if args.apply_income:
        to_write += income
    if to_write:
        T.append(to_write)
        print(f"Gravado: {len(to_write)} lançamento(s)")
        R.generate()
    else:
        hints = []
        if updates:
            hints.append(f"{len(updates)} saldo(s) com --apply-balances")
        if income:
            hints.append(f"{len(income)} provento(s) com --apply-income")
        if hints:
            print("Sugestões prontas: " + ", ".join(hints) + ".")
    return 0


def cmd_report(args) -> int:
    R.generate(write_snapshot=not args.no_snapshot)
    return 0


def cmd_show(args) -> int:
    assets, accounts, tree, trades = _load_state()
    quotes = Q.load()
    positions = PF.build(assets, trades, quotes)
    totals = PF.totals(positions, tree)
    money = PF.wealth(positions, tree)
    print(f"Investido  {_money(money['invested']):>16}   "
          f"lucro {_money(totals['profit'])} "
          f"({(totals['profit_pct'] or 0) * 100:+.2f}%)")
    print(f"Reservado  {_money(money['reserved']):>16}")
    print(f"A aportar  {_money(money['to_invest']):>16}")
    print(f"Livre      {_money(money['free']):>16}")
    print(f"{'-' * 28}\nTotal      {_money(money['total']):>16}")
    print(f"\nElegível para rebalanceamento: {_money(totals['eligible_value'])}\n")
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

    sync_cmd = sub.add_parser("sync", help="confere com as corretoras via Pluggy")
    sync_cmd.add_argument("--apply-balances", action="store_true",
                          help="grava os saldos informados pelas corretoras")
    sync_cmd.add_argument("--apply-income", action="store_true",
                          help="grava os proventos reconhecidos no extrato")
    sync_cmd.set_defaults(func=cmd_sync)

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
