import argparse
from datetime import date

from . import sheets

ANCHOR_KEY = "free_balance_anchor"


def parse_anchor(raw) -> dict | None:
    """Valida o blob `{date, value}` da âncora; ausente ou vazio vira None."""
    if raw in (None, "", {}):
        return None
    if not isinstance(raw, dict) or "date" not in raw or "value" not in raw:
        raise SystemExit(f"Config[{ANCHOR_KEY}] inválido: {raw!r}. "
                         'Use {"date": "YYYY-MM-DD", "value": 1234.56}.')
    try:
        anchor_date = date.fromisoformat(str(raw["date"]).strip()).isoformat()
        value = round(float(raw["value"]), 2)
    except (TypeError, ValueError):
        raise SystemExit(f"Config[{ANCHOR_KEY}] inválido: {raw!r}.")
    return {"date": anchor_date, "value": value}


def load_anchor() -> dict | None:
    return parse_anchor(sheets.read_config(ANCHOR_KEY))


def save_anchor(anchor_date: str, value: float) -> dict:
    anchor = parse_anchor({"date": anchor_date, "value": value})
    sheets.write_config(ANCHOR_KEY, anchor)
    return anchor


def counts_after(record_date: str, anchor: dict | None) -> bool:
    """A âncora já é o fim do dia D, então só entra o que vem a partir de D+1."""
    return not anchor or record_date > anchor["date"]


def running_totals(month_nets: dict, anchor: dict | None) -> dict:
    """Saldo total no fim de cada mês: âncora somada aos saldos mensais posteriores.
    `month_nets` só deve contar lançamentos depois do dia da âncora."""
    start = anchor["value"] if anchor else 0.0
    first_month = anchor["date"][:7] if anchor else None
    totals, running = {}, start
    for month in sorted(month_nets):
        if first_month and month < first_month:
            totals[month] = None
            continue
        running += month_nets[month]
        totals[month] = round(running, 2)
    return totals


def main() -> None:
    parser = argparse.ArgumentParser(description="Âncora do Saldo total.")
    sub = parser.add_subparsers(dest="cmd")
    sub.add_parser("show", help="Mostra a âncora atual.")
    set_cmd = sub.add_parser("set", help="Grava a âncora e regera os relatórios.")
    set_cmd.add_argument("date", help="Fim do dia D (YYYY-MM-DD).")
    set_cmd.add_argument("value", type=float,
                         help="Dinheiro livre em D menos o que se devia nos cartões.")
    sub.add_parser("clear", help="Remove a âncora (volta ao acumulado desde o início).")
    args = parser.parse_args()

    if args.cmd == "set":
        anchor = save_anchor(args.date, args.value)
        print(f"Âncora gravada: R$ {anchor['value']:,.2f} no fim de {anchor['date']}.")
    elif args.cmd == "clear":
        sheets.write_config(ANCHOR_KEY, "")
        print("Âncora removida.")
    else:
        anchor = load_anchor()
        print(f"Âncora: R$ {anchor['value']:,.2f} no fim de {anchor['date']}."
              if anchor else "Sem âncora: o card mostra o acumulado desde o início.")
        return
    from . import report
    report.generate()


if __name__ == "__main__":
    main()
