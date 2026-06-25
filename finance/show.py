"""Inspeção SÓ-LEITURA do ledger / fila / regras (não escreve nada).

Substitui scripts python ad-hoc — é um comando fixo e seguro de allowlistar.

Uso:
  uv run python -m finance.show queue            # a Fila do Claude, formatada
  uv run python -m finance.show tx <id|prefixo>… # registro(s) completos (JSON)
  uv run python -m finance.show find <texto> [-n N]  # busca na descrição
  uv run python -m finance.show cat "Categoria[/Sub]" [-n N]  # por categoria
  uv run python -m finance.show stats            # contadores do ledger + fila
"""

import argparse
import json
import sys

from . import ledger as L
from . import rules as R
from .config import CLAUDE_QUEUE_FILE


def _eff(r: dict) -> float:
    return L.effective_amount(r)


def _line(r: dict) -> str:
    ov = "" if r.get("amount_override") is None else f" (ov {r['amount_override']})"
    sp = ""
    if r.get("splits"):
        sp = " SPLIT[" + " | ".join(
            f"{s['amount']} {s.get('category')}/{s.get('subcategory')}"
            for s in r["splits"]) + "]"
    cat = f"{r.get('category')}/{r.get('subcategory')}"
    return (f"{r['date']} {_eff(r):>10.2f}{ov}  {(r['description'] or '')[:46]:<46} "
            f"[{cat} {r.get('category_source')}]{sp}  {r['id']}")


def cmd_queue(_args) -> None:
    if not CLAUDE_QUEUE_FILE.exists() or not CLAUDE_QUEUE_FILE.read_text().strip():
        print("Fila do Claude vazia.")
        return
    n = 0
    for raw in CLAUDE_QUEUE_FILE.read_text().splitlines():
        raw = raw.strip()
        if not raw:
            continue
        n += 1
        o = json.loads(raw)
        sg = o.get("suggestion") or {}
        print(f"[{n}] ids={o.get('ids')}")
        print(f"    nota: {o.get('note')}")
        print(f"    sugestão: {sg.get('category')}/{sg.get('subcategory')}")
        for s in o.get("samples", []):
            print(f"    • {s.get('date')} {s.get('signed_amount'):>10} "
                  f"{s.get('description')}")
    print(f"\nTotal: {n} item(ns) na fila.")


def cmd_tx(args) -> None:
    led = L.load_ledger()
    hits = [r for r in led.values()
            if any(r["id"].startswith(p) for p in args.ids)]
    if not hits:
        sys.exit("Nenhum registro casou esses ids/prefixos.")
    for r in sorted(hits, key=lambda r: r["date"]):
        print(json.dumps(r, ensure_ascii=False, indent=2))


def cmd_find(args) -> None:
    led = L.load_ledger()
    q = R.norm(args.text)
    hits = [r for r in led.values()
            if q in R.norm(r.get("description"))
            or q in R.norm(r.get("merchant_name"))
            or q in R.norm(r.get("counterparty"))]
    hits.sort(key=lambda r: r["date"])
    for r in hits[:args.n]:
        print(_line(r))
    tot = round(sum(_eff(r) for r in hits), 2)
    print(f"\n{len(hits)} resultado(s) (mostrando {min(len(hits), args.n)}) "
          f"| soma efetiva: {tot}")


def cmd_cat(args) -> None:
    cat, _, sub = args.cat.partition("/")
    led = L.load_ledger()

    def match(r):
        if r.get("splits"):
            return any(s.get("category") == cat
                       and (not sub or s.get("subcategory") == sub)
                       for s in r["splits"])
        return r.get("category") == cat and (not sub
                                             or r.get("subcategory") == sub)
    hits = sorted([r for r in led.values() if match(r)],
                  key=lambda r: r["date"])
    for r in hits[:args.n]:
        print(_line(r))
    tot = round(sum(_eff(r) for r in hits), 2)
    print(f"\n{len(hits)} em {args.cat} (mostrando {min(len(hits), args.n)}) "
          f"| soma efetiva: {tot}")


def cmd_stats(_args) -> None:
    led = L.load_ledger()
    n = len(led)
    cat = sum(1 for r in led.values() if r.get("category") or r.get("splits"))
    rev = sum(1 for r in led.values() if r.get("reviewed"))
    flag = sum(1 for r in led.values() if r.get("needs_review"))
    ovr = sum(1 for r in led.values() if r.get("amount_override") is not None)
    spl = sum(1 for r in led.values() if r.get("splits"))
    qn = 0
    if CLAUDE_QUEUE_FILE.exists():
        qn = len([x for x in CLAUDE_QUEUE_FILE.read_text().splitlines()
                  if x.strip()])
    print(f"Ledger: {n} | categorizadas: {cat} | confirmadas: {rev} | "
          f"sem categoria: {n - cat} | a revisar: {flag}")
    print(f"splits: {spl} | amount_override: {ovr} | fila do Claude: {qn}")


def main() -> None:
    ap = argparse.ArgumentParser(prog="finance.show",
                                 description="Inspeção só-leitura.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("queue").set_defaults(fn=cmd_queue)
    p = sub.add_parser("tx")
    p.add_argument("ids", nargs="+")
    p.set_defaults(fn=cmd_tx)
    p = sub.add_parser("find")
    p.add_argument("text")
    p.add_argument("-n", type=int, default=40)
    p.set_defaults(fn=cmd_find)
    p = sub.add_parser("cat")
    p.add_argument("cat")
    p.add_argument("-n", type=int, default=60)
    p.set_defaults(fn=cmd_cat)
    sub.add_parser("stats").set_defaults(fn=cmd_stats)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
