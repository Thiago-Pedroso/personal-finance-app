"""Categorização: regras determinísticas + dica da Pluggy + loop com a IA.

Fluxo (orquestrado pela skill finance-categorize):

  uv run python -m finance.categorize            # prepare: aplica regras + mapa Pluggy,
                                                 # escreve data/.to_categorize.json
  -> o agente lê o arquivo, propõe/clusteriza, o usuário confirma, gravamos decisões
  uv run python -m finance.categorize apply --learn   # aplica decisões + aprende regras
  uv run python -m finance.categorize stats      # situação atual

Precedência: manual > regra > mapa-pluggy. `reviewed` indica confirmação humana.
"""

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from statistics import median

from . import ledger as L
from . import pluggy_map
from . import rules as R
from . import taxonomy as T
from .config import DECISIONS_FILE, TO_CATEGORIZE_FILE, ensure_dirs

_COMPACT = ("id", "date", "description", "signed_amount", "type", "account_name",
            "pluggy_category", "merchant_name", "counterparty", "mcc",
            "payment_method", "installment")


def _compact(rec: dict) -> dict:
    return {k: rec[k] for k in _COMPACT}


def _anomaly(rec: dict, rule_id: str, ledger: dict) -> bool:
    """Sinaliza se o valor foge muito do histórico daquela regra."""
    hist = [abs(x["signed_amount"]) for x in ledger.values()
            if x.get("rule_id") == rule_id and x["category"] and x["id"] != rec["id"]]
    if len(hist) < 4:
        return False
    med = median(hist)
    return med > 0 and abs(rec["signed_amount"]) > 4 * med


# --------------------------------------------------------------------------- prepare
def prepare() -> None:
    ensure_dirs()
    tax = T.load()
    rules_data = R.load_rules()
    rules = rules_data["rules"]
    ledger = L.load_ledger()
    if not ledger:
        sys.exit("Ledger vazio. Rode antes: uv run python -m finance.sync --backfill")

    by_rule = by_map = still = 0
    for rec in ledger.values():
        if rec["category"] or rec.get("splits"):
            continue
        m = R.first_match(rec, rules)
        if m:
            rec.update(category=m["category"], subcategory=m["subcategory"],
                       category_source="rule", rule_id=m["id"],
                       needs_review=_anomaly(rec, m["id"], ledger),
                       reviewed=not _anomaly(rec, m["id"], ledger))
            by_rule += 1
            continue
        s = pluggy_map.suggest(rec["pluggy_category"], rec["type"])
        if s and s[0] in tax:
            cat, sub = s
            if sub is not None and not T.valid(tax, cat, sub):
                sub = None
            rec.update(category=cat, subcategory=sub, category_source="pluggy-map",
                       rule_id=None, needs_review=False, reviewed=False)
            by_map += 1
            continue
        still += 1

    L.save_ledger(ledger)

    # ---- monta o arquivo de trabalho para o agente
    prov = [r for r in ledger.values()
            if r["category_source"] == "pluggy-map" and not r["reviewed"]]
    clusters: dict = {}
    for r in prov:
        key = (r["category"], r["subcategory"])
        c = clusters.setdefault(key, {"category": r["category"],
                                      "subcategory": r["subcategory"],
                                      "count": 0, "merchants": Counter(), "sum": 0.0})
        c["count"] += 1
        c["sum"] = round(c["sum"] + r["signed_amount"], 2)
        c["merchants"][r["description"][:40]] += 1
    provisional_clusters = sorted(
        ({"category": c["category"], "subcategory": c["subcategory"],
          "count": c["count"], "sum": c["sum"],
          "top_merchants": c["merchants"].most_common(8)}
         for c in clusters.values()),
        key=lambda x: -x["count"])

    need_sub: dict = {}
    for r in (x for x in ledger.values()
              if x["category"] and x["subcategory"] is None and not x["reviewed"]):
        b = need_sub.setdefault(r["category"], {"category": r["category"], "count": 0,
                                                "merchants": Counter(), "ids": []})
        b["count"] += 1
        b["merchants"][r["description"][:40]] += 1
        if len(b["ids"]) < 60:
            b["ids"].append(r["id"])
    needs_subcategory = sorted(
        ({"category": b["category"], "count": b["count"],
          "top_merchants": b["merchants"].most_common(12), "ids_sample": b["ids"]}
         for b in need_sub.values()), key=lambda x: -x["count"])

    uncategorized = [_compact(r) for r in ledger.values()
                     if not r["category"] and not r.get("splits")]
    freq = Counter(R.norm(r["description"]) for r in ledger.values()
                   if not r["category"] and not r.get("splits"))
    needs_review = [{**_compact(r), "category": r["category"],
                     "subcategory": r["subcategory"], "rule_id": r["rule_id"]}
                    for r in ledger.values() if r["needs_review"]]

    src = Counter(r["category_source"] or "uncategorized" for r in ledger.values())
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "taxonomy": tax,
        "summary": {"total": len(ledger), "by_source": dict(src),
                    "provisional_unconfirmed": len(prov),
                    "applied_this_run": {"by_rule": by_rule, "by_pluggy_map": by_map,
                                         "still_uncategorized": still}},
        "provisional_clusters": provisional_clusters,
        "needs_subcategory": needs_subcategory,
        "uncategorized": uncategorized,
        "uncategorized_merchant_freq": freq.most_common(40),
        "needs_review": needs_review,
    }
    TO_CATEGORIZE_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n")

    print(f"Aplicado agora: {by_rule} por regra, {by_map} por mapa-Pluggy, "
          f"{still} ainda sem categoria.")
    print(f"Provisórias a confirmar (mapa-Pluggy): {len(prov)} | "
          f"sem subcategoria: {sum(b['count'] for b in need_sub.values())} | "
          f"anomalias: {len(needs_review)}")
    print(f"\nDetalhes em: {TO_CATEGORIZE_FILE}")
    print("Agente: leia esse arquivo, agrupe e proponha ao usuário; depois grave "
          f"as decisões em {DECISIONS_FILE} e rode `apply --learn`.")


# ----------------------------------------------------------------------------- apply
def apply(learn: bool) -> None:
    tax = T.load()
    rules_data = R.load_rules()
    ledger = L.load_ledger()
    if not DECISIONS_FILE.exists():
        sys.exit(f"Não encontrei {DECISIONS_FILE}. O agente deve gravá-lo antes.")
    dec = json.loads(DECISIONS_FILE.read_text())

    # 1) aprende regras novas
    new_rules = []
    for rd in dec.get("rules", []):
        r = R.add_rule(rules_data, rd["field"], rd.get("match", "contains"),
                       rd["value"], rd["category"], rd.get("subcategory"),
                       rd.get("note", ""), rd.get("type"),
                       rd.get("amount_abs_min"), rd.get("amount_abs_max"))
        new_rules.append(r)
    if learn or new_rules:
        R.save_rules(rules_data)

    # 2) reaplica todas as regras (regra vence mapa-pluggy; manual é intocável)
    rules = rules_data["rules"]
    reapplied = 0
    for rec in ledger.values():
        if rec["category_source"] == "manual" or rec.get("splits"):
            continue
        m = R.first_match(rec, rules)
        if m:
            rec.update(category=m["category"], subcategory=m["subcategory"],
                       category_source="rule", rule_id=m["id"],
                       needs_review=_anomaly(rec, m["id"], ledger),
                       reviewed=not _anomaly(rec, m["id"], ledger))
            reapplied += 1

    # 3) atribuições explícitas (id a id)
    assigned = 0
    for a in dec.get("assignments", []):
        cat, sub = a.get("category"), a.get("subcategory")
        splits = a.get("splits")
        for tid in a["ids"]:
            rec = ledger.get(tid)
            if not rec:
                continue
            # override manual de valor (ex.: compra em dólar gravada errada).
            # Aplica antes do split p/ a soma bater com o valor efetivo.
            if "amount_override" in a:
                rec["amount_override"] = a["amount_override"]
            if splits:
                # divide o lançamento; a soma deve bater com o valor efetivo
                eff = L.effective_amount(rec)
                tot = round(sum(s["amount"] for s in splits), 2)
                if abs(tot - eff) > 0.01:
                    print(f"  ⚠ split de {tid}: soma {tot} ≠ "
                          f"{eff} — ignorado")
                    continue
                rec.update(splits=splits, category_source="split",
                           rule_id=None, needs_review=False, reviewed=True)
                if cat:
                    rec.update(category=cat, subcategory=sub)
            else:
                rec.update(category=cat, subcategory=sub, splits=None,
                           category_source=a.get("source", "manual"),
                           rule_id=None, needs_review=False, reviewed=True)
            if "note" in a:
                rec["note"] = (a["note"] or None)
            assigned += 1

    # 4) confirma as provisórias do mapa-Pluggy
    confirmed = 0
    if dec.get("confirm_provisional"):
        for rec in ledger.values():
            if rec["category_source"] == "pluggy-map" and rec["category"] \
                    and not rec["reviewed"]:
                rec["reviewed"] = True
                confirmed += 1

    # 5) valida contra a taxonomia (não quebra; só reporta)
    invalid = [(r["id"], r["category"], r["subcategory"]) for r in ledger.values()
               if r["category"] and not T.valid(tax, r["category"], r["subcategory"])]

    L.save_ledger(ledger)
    TO_CATEGORIZE_FILE.unlink(missing_ok=True)
    DECISIONS_FILE.unlink(missing_ok=True)

    print(f"Regras novas: {len(new_rules)} | reaplicadas por regra: {reapplied} | "
          f"atribuições: {assigned} | provisórias confirmadas: {confirmed}")
    if invalid:
        print(f"\n⚠ {len(invalid)} fora da taxonomia (corrija taxonomy.yaml ou as decisões):")
        for tid, c, s in invalid[:15]:
            print(f"  {tid}: {c} / {s}")
    _print_stats(ledger)


# ----------------------------------------------------------------------------- stats
def _print_stats(ledger: dict) -> None:
    total = len(ledger)
    cat = sum(1 for r in ledger.values() if r["category"] or r.get("splits"))
    rev = sum(1 for r in ledger.values() if r["reviewed"])
    flag = sum(1 for r in ledger.values() if r["needs_review"])
    print(f"\nLedger: {total} | categorizadas: {cat} | confirmadas: {rev} | "
          f"sem categoria: {total - cat} | a revisar: {flag}")


def stats() -> None:
    ledger = L.load_ledger()
    if not ledger:
        sys.exit("Ledger vazio.")
    src = Counter(r["category_source"] or "uncategorized" for r in ledger.values())
    print("Por origem:", dict(src))
    by_cat = Counter(r["category"] or "(sem)" for r in ledger.values())
    for c, n in by_cat.most_common():
        print(f"  {n:5d}  {c}")
    _print_stats(ledger)


def main() -> None:
    ap = argparse.ArgumentParser(description="Categorização (regras + IA).")
    ap.add_argument("command", nargs="?", default="prepare",
                    choices=["prepare", "apply", "stats"])
    ap.add_argument("--learn", action="store_true",
                    help="(apply) persiste as regras novas em rules.json")
    args = ap.parse_args()
    if args.command == "prepare":
        prepare()
    elif args.command == "apply":
        apply(args.learn)
    else:
        stats()


if __name__ == "__main__":
    main()
