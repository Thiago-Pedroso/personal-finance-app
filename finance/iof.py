import argparse
import re
from decimal import ROUND_HALF_UP, Decimal

from . import ledger as L
from . import sheets
from .rules import norm

CONFIG_KEY = "iof"
NOTE_PREFIX = "IOF estimado"


def load_settings() -> dict | None:
    """Lê `Config[iof]`; sem a chave ou sem `match`, o recurso fica desligado."""
    settings = sheets.read_config(CONFIG_KEY, None)
    if not isinstance(settings, dict) or not settings.get("match"):
        return None
    return {"rate": float(settings.get("rate", 0.035)),
            "match": [norm(text) for text in settings["match"] if str(text).strip()]}


def with_iof(amount: float, rate: float) -> float:
    total = Decimal(str(amount)) * (1 + Decimal(str(rate)))
    return float(total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _is_iof_line(rec: dict) -> bool:
    return re.search(r"\bIOF\b", norm(rec.get("description"))) is not None


def _iof_days(ledger: dict) -> set:
    return {(rec.get("account_id"), rec.get("date"))
            for rec in ledger.values() if _is_iof_line(rec)}


def _eligible(rec: dict, settings: dict, iof_days: set) -> bool:
    description = norm(rec.get("description"))
    return (rec.get("account_type") == "CREDIT"
            and (rec.get("signed_amount") or 0) < 0
            and rec.get("amount_override") is None
            and not rec.get("splits")
            and not _is_iof_line(rec)
            and (rec.get("account_id"), rec.get("date")) not in iof_days
            and any(text in description for text in settings["match"]))


def apply(ledger: dict, settings: dict, ids=None) -> set:
    """Grava o valor com IOF em `amount_override`; devolve os ids alterados."""
    iof_days = _iof_days(ledger)
    pct = f"{settings['rate'] * 100:g}".replace(".", ",")
    changed = set()
    for rec_id in (ids if ids is not None else list(ledger)):
        rec = ledger[rec_id]
        if not _eligible(rec, settings, iof_days):
            continue
        rec["amount_override"] = with_iof(rec["signed_amount"], settings["rate"])
        estimate = f"{NOTE_PREFIX} ({pct}%)"
        rec["note"] = f"{rec['note']} | {estimate}" if rec.get("note") else estimate
        changed.add(rec_id)
    return changed


def conflicts(ledger: dict) -> list[tuple[dict, dict]]:
    """Pares (estimativa, linha de IOF) na mesma conta e dia: o IOF contado duas vezes."""
    iof_lines = {}
    for rec in ledger.values():
        if _is_iof_line(rec):
            iof_lines.setdefault((rec.get("account_id"), rec.get("date")), rec)
    return [(rec, iof_lines[key]) for rec in ledger.values()
            if NOTE_PREFIX in (rec.get("note") or "")
            and (key := (rec.get("account_id"), rec.get("date"))) in iof_lines]


def report_conflicts(ledger: dict) -> None:
    for rec, line in conflicts(ledger):
        print(f"  IOF duplicado? {rec['date']} {rec['description']} ({rec['id']}) tem estimativa "
              f"e a Pluggy trouxe {line['description']} ({line['id']}). Remova um dos dois.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Soma o IOF estimado no ledger.")
    parser.add_argument("--dry-run", action="store_true", help="Só mostra o que mudaria.")
    args = parser.parse_args()

    settings = load_settings()
    if settings is None:
        raise SystemExit(f"Config[{CONFIG_KEY}] ausente ou sem 'match': nada a fazer.")
    ledger = L.load_ledger()
    changed = apply(ledger, settings)
    for rec_id in sorted(changed, key=lambda i: ledger[i]["date"]):
        rec = ledger[rec_id]
        print(f"  {rec['date']} {rec['description']}: "
              f"{rec['signed_amount']:.2f} -> {rec['amount_override']:.2f}")
    report_conflicts(ledger)
    if not changed:
        print("Nenhum lançamento novo para somar IOF.")
        return
    if args.dry_run:
        print(f"{len(changed)} lançamento(s) mudariam (dry-run, nada gravado).")
        return
    L.save_ledger(ledger, changed)
    print(f"{len(changed)} lançamento(s) com IOF somado.")


if __name__ == "__main__":
    main()
