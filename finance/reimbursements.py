"""Abatimentos: vínculos em que uma entrada abate uma saída (aba Reimbursements).

Uso:
  uv run python -m finance.reimbursements apply <arquivo.json>
    arquivo = {"add": [{credit_id, credit_part?, debit_id, debit_part?, amount, note?}],
               "remove": ["ab_0001", ...]}
"""

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone

from . import ledger as L
from . import sheets

TAB = "Reimbursements"
_TOLERANCE = 0.005


def load() -> list[dict]:
    try:
        return sheets.read_records(TAB)
    except sheets.SheetsError:
        return []


def _part(value) -> int | None:
    return None if value is None or value == "" else int(value)


def _side_amount(rec: dict, part: int | None) -> float | None:
    """Valor efetivo de um lado: o lançamento inteiro ou uma parte do split."""
    splits = rec.get("splits") or []
    if part is None:
        return None if splits else L.effective_amount(rec)
    return splits[part]["amount"] if 0 <= part < len(splits) else None


def _problem(credit, credit_part, debit, debit_part, amount, used) -> str | None:
    if not credit or not debit:
        return "lançamento inexistente"
    if amount <= 0:
        return "valor zerado"
    credit_amount = _side_amount(credit, credit_part)
    debit_amount = _side_amount(debit, debit_part)
    if credit_amount is None or debit_amount is None:
        return "parte de split inválida"
    if credit_amount <= 0:
        return "o lado que abate precisa ser uma entrada"
    if debit_amount >= 0:
        return "o lado abatido precisa ser uma saída"
    if used[(credit["id"], credit_part)] + amount > credit_amount + _TOLERANCE:
        return "abate mais do que a entrada tem"
    if used[(debit["id"], debit_part)] + amount > -debit_amount + _TOLERANCE:
        return "abate mais do que a saída tem"
    return None


def index(links: list[dict], ledger: dict) -> tuple[dict, list[tuple[str, str]]]:
    """Agrupa os vínculos válidos por lançamento; devolve também os descartados."""
    by_tx: dict = {}
    used: dict = defaultdict(float)
    discarded = []
    for link in links:
        credit, debit = ledger.get(link["credit_id"]), ledger.get(link["debit_id"])
        credit_part, debit_part = _part(link.get("credit_part")), _part(link.get("debit_part"))
        amount = round(abs(link.get("amount") or 0), 2)
        problem = _problem(credit, credit_part, debit, debit_part, amount, used)
        if problem:
            discarded.append((link["id"], problem))
            continue
        used[(credit["id"], credit_part)] += amount
        used[(debit["id"], debit_part)] += amount
        sides = ((credit, credit_part, debit, debit_part, "credit"),
                 (debit, debit_part, credit, credit_part, "debit"))
        for rec, part, other, other_part, side in sides:
            entry = by_tx.setdefault(rec["id"], {"amount": 0.0, "parts": {}, "links": []})
            entry["amount"] = round(entry["amount"] + amount, 2)
            if part is not None:
                entry["parts"][part] = round(entry["parts"].get(part, 0.0) + amount, 2)
            entry["links"].append({
                "id": link["id"], "side": side, "part": part, "amount": amount,
                "other_id": other["id"], "other_part": other_part,
                "other_description": other.get("description"),
                "other_date": other.get("date"), "note": link.get("note"),
            })
    return by_tx, discarded


def _pieces(rec: dict) -> list[tuple]:
    splits = rec.get("splits") or []
    if splits:
        return [(index, part["amount"], part.get("settle_with"))
                for index, part in enumerate(splits)]
    return [(None, L.effective_amount(rec), rec.get("settle_with"))]


def open_items(recs: list[dict], by_tx: dict) -> list[dict]:
    """Pendências por pessoa: partes com `settle_with` ainda não totalmente abatidas."""
    groups: dict = {}
    for rec in recs:
        if rec.get("excluded"):
            continue
        info = by_tx.get(rec["id"]) or {}
        for part, amount, name in _pieces(rec):
            if not name or not amount:
                continue
            abated = (info.get("parts", {}).get(part, 0.0) if part is not None
                      else info.get("amount", 0.0))
            left = round(abs(amount) - abated, 2)
            if left <= _TOLERANCE:
                continue
            group = groups.setdefault(name, {"name": name, "receivable": 0.0,
                                             "payable": 0.0, "items": []})
            side = "receivable" if amount < 0 else "payable"
            group[side] = round(group[side] + left, 2)
            group["items"].append({"id": rec["id"], "part": part, "date": rec["date"],
                                   "description": rec.get("description"),
                                   "amount": amount, "open": left})
    for group in groups.values():
        group["items"].sort(key=lambda item: item["date"])
    return sorted(groups.values(), key=lambda g: -(g["receivable"] + g["payable"]))


def suggestions(recs: list[dict], by_tx: dict, window_days: int = 90) -> list[dict]:
    """Entradas cujo valor livre bate exato com algo a receber de até `window_days` antes."""
    pending = [{**item, "settle_with": group["name"]}
               for group in open_items(recs, by_tx) for item in group["items"]
               if item["amount"] < 0]
    taken = set()
    out = []
    for rec in sorted(recs, key=lambda r: r["date"]):
        if rec.get("excluded") or rec.get("splits") or rec.get("settle_with"):
            continue
        free = round(L.effective_amount(rec) - (by_tx.get(rec["id"]) or {}).get("amount", 0.0), 2)
        if free <= _TOLERANCE:
            continue
        credit_date = datetime.fromisoformat(rec["date"]).date()
        candidates = [
            item for item in pending
            if (item["id"], item["part"]) not in taken
            and round(item["open"] * 100) == round(free * 100)
            and 0 <= (credit_date - datetime.fromisoformat(item["date"]).date()).days
            <= window_days]
        if not candidates:
            continue
        debit = max(candidates, key=lambda item: item["date"])
        taken.add((debit["id"], debit["part"]))
        out.append({
            "credit": {"id": rec["id"], "date": rec["date"],
                       "description": rec.get("description"), "amount": free},
            "debit": {key: debit[key] for key in
                      ("id", "part", "date", "description", "open", "settle_with")},
        })
    return out


def _next_id(links: list[dict]) -> str:
    highest = 0
    for link in links:
        try:
            highest = max(highest, int(str(link["id"]).split("_")[1]))
        except (KeyError, ValueError, IndexError):
            pass
    return f"ab_{highest + 1:04d}"


def apply_changes(ledger: dict, add: list[dict], remove: list[str]) -> tuple[int, int, list[str]]:
    """Cria e remove vínculos de uma vez; se algum for inválido, não grava nada."""
    links = load()
    remove_ids = set(remove or [])
    kept = [link for link in links if link["id"] not in remove_ids]
    created = []
    now = datetime.now(timezone.utc).date().isoformat()
    for item in add or []:
        created.append({
            "id": _next_id(kept + created),
            "credit_id": item["credit_id"], "credit_part": _part(item.get("credit_part")),
            "debit_id": item["debit_id"], "debit_part": _part(item.get("debit_part")),
            "amount": round(abs(float(item["amount"])), 2),
            "note": item.get("note") or None, "created_at": now,
        })
    new_ids = {link["id"] for link in created}
    _, discarded = index(kept + created, ledger)
    problems = [f"{link_id}: {problem}" for link_id, problem in discarded
                if link_id in new_ids]
    if problems:
        return 0, 0, problems
    removed = len(links) - len(kept)
    if removed:
        sheets.write_records(TAB, kept + created)
    elif created:
        sheets.append_rows(TAB, created)
    return len(created), removed, []


def main() -> None:
    parser = argparse.ArgumentParser(prog="finance.reimbursements")
    sub = parser.add_subparsers(dest="cmd", required=True)
    apply_parser = sub.add_parser("apply")
    apply_parser.add_argument("file")
    args = parser.parse_args()
    payload = json.loads(open(args.file).read())
    sheets.ensure_current_schema()
    created, removed, problems = apply_changes(
        L.load_ledger(), payload.get("add"), payload.get("remove"))
    if problems:
        sys.exit("Nenhum abatimento gravado:\n" + "\n".join(problems))
    print(f"Abatimentos: +{created} criados, -{removed} removidos.")


if __name__ == "__main__":
    main()
