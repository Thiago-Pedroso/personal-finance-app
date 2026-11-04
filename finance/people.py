"""Pessoas: para quem foi o dinheiro (campo `person` do Ledger e das partes de split).

`person` é o beneficiário (presente, ajuda, serviço pago para outra pessoa).
`settle_with` é outra coisa: com quem um valor ainda vai ser acertado (pendência).
Este módulo junta os dois por nome para a aba Pessoas: o que foi para cada pessoa, o que
veio dela, por categoria e por mês, os presentes e as pendências em aberto.
"""
from __future__ import annotations

import re
from collections import defaultdict

from . import ledger as L

GIFT_RE = re.compile(r"presente", re.I)
LOAN_RE = re.compile(r"empr[eé]st", re.I)


def _parts(rec: dict) -> list[tuple[float, str | None, str | None, str | None]]:
    """(valor, categoria, subcategoria, pessoa) de cada parte; a parte herda a pessoa
    do lançamento quando não tem a sua."""
    owner = rec.get("person")
    if rec.get("splits"):
        return [(float(p.get("amount") or 0), p.get("category"), p.get("subcategory"),
                 p.get("person") or owner) for p in rec["splits"]]
    return [(float(L.effective_amount(rec)), rec.get("category"), rec.get("subcategory"),
             owner)]


def move_tags_to_person(ledger: dict, names: list[str]) -> list[str]:
    """Migração: a tag com nome de pessoa vira `person` (se o campo estiver vazio) e sai
    das tags. Devolve os ids alterados. Lançamento com duas tags de pessoa fica com a
    primeira da lista `names` e mantém as outras como tag, para não perder informação."""
    wanted = [n for n in (L.clean_person(x) for x in names) if n]
    keys = {L.tag_key(n): n for n in wanted}
    changed = []
    for rec in ledger.values():
        tags = rec.get("tags") or []
        hits = [t for t in tags if L.tag_key(t) in keys]
        if not hits:
            continue
        hits.sort(key=lambda t: wanted.index(keys[L.tag_key(t)]))
        if rec.get("person") and L.tag_key(rec["person"]) != L.tag_key(hits[0]):
            continue          # já tem outra pessoa: decisão manual, não mexe
        rec["person"] = rec.get("person") or keys[L.tag_key(hits[0])]
        rec["tags"] = [t for t in tags if t != hits[0]]
        changed.append(rec["id"])
    return changed


def summary(recs: list[dict], open_settlements: list[dict] | None = None,
            treatments: dict | None = None) -> dict:
    """{"people": [...nomes], "by_person": {nome: {...}}} para o dashboard."""
    treatments = treatments or {}
    people: dict = {}

    def bucket(name: str) -> dict:
        if name not in people:
            people[name] = {"name": name, "sent": 0.0, "received": 0.0, "count": 0,
                            "gifts": 0.0, "by_category": defaultdict(float),
                            "by_month": defaultdict(lambda: {"sent": 0.0, "received": 0.0}),
                            "transactions": [], "receivable": 0.0, "payable": 0.0,
                            "loan_balance": 0.0, "loan_count": 0,
                            "open_items": []}
        return people[name]

    for rec in recs:
        if rec.get("excluded"):
            continue
        for index, (amount, cat, sub, person) in enumerate(_parts(rec)):
            name = L.clean_person(person)
            if not name or not amount:
                continue
            b = bucket(name)
            month = rec["date"][:7]
            if amount < 0:
                b["sent"] += -amount
                b["by_category"][cat or "Sem categoria"] += -amount
                b["by_month"][month]["sent"] += -amount
                if GIFT_RE.search(sub or "") or GIFT_RE.search(cat or ""):
                    b["gifts"] += -amount
            else:
                b["received"] += amount
                b["by_month"][month]["received"] += amount
            b["count"] += 1
            # empréstimo (categoria/subcategoria): saída = emprestei, entrada = devolveu
            # ou peguei. Saldo positivo = a pessoa ainda te deve.
            if LOAN_RE.search(cat or "") or LOAN_RE.search(sub or ""):
                b["loan_balance"] -= amount
                b["loan_count"] += 1
            b["transactions"].append({
                "id": rec["id"], "part": index if rec.get("splits") else None,
                "date": rec["date"], "description": rec.get("description"),
                "amount": round(amount, 2), "category": cat, "subcategory": sub,
                "treatment": treatments.get(cat or "", "fluxo"),
            })

    # pendências (settle_with) do mesmo nome: empréstimos/acertos em aberto
    for group in open_settlements or []:
        name = L.clean_person(group.get("name"))
        if not name:
            continue
        b = bucket(name)
        # receivable = a pessoa deve a você; payable = você deve a ela
        b["receivable"] = float(group.get("receivable") or 0)
        b["payable"] = float(group.get("payable") or 0)
        b["open_items"] = group.get("items") or []

    out = {}
    for name, b in people.items():
        out[name] = {
            "name": name,
            "sent": round(b["sent"], 2), "received": round(b["received"], 2),
            "net": round(b["received"] - b["sent"], 2), "count": b["count"],
            "gifts": round(b["gifts"], 2),
            "receivable": round(b["receivable"], 2), "payable": round(b["payable"], 2),
            "loan_balance": round(b["loan_balance"], 2), "loan_count": b["loan_count"],
            "open_items": b["open_items"],
            "by_category": sorted(({"category": c, "sent": round(v, 2)}
                                   for c, v in b["by_category"].items()),
                                  key=lambda x: -x["sent"]),
            "by_month": [{"month": m, "sent": round(v["sent"], 2),
                          "received": round(v["received"], 2)}
                         for m, v in sorted(b["by_month"].items())],
            "transactions": sorted(b["transactions"], key=lambda t: t["date"],
                                   reverse=True),
        }
    order = sorted(out, key=lambda n: (-(out[n]["sent"] + out[n]["received"]), n))
    return {"people": order, "by_person": out}
