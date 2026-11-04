"""Parcelas: o que está parcelado e quanto ainda falta pagar.

Tudo é derivado do Ledger, sem aba nova:

- **Compra parcelada no cartão**: a Pluggy grava cada parcela com `installment` = "n/N".
  Não existe id da compra, então as parcelas são agrupadas por conta + total de parcelas +
  lojista (sem o marcador "3/10" da descrição) e, dentro disso, em sequências crescentes
  de valor parecido. A identificação é uma estimativa e o resultado guarda os ids.
- **Parcelamento de fatura**: "Parcela da fatura" (também com "n/N"). O valor financiado
  vem do "Crédito por parcelamento da fatura" na mesma conta; a diferença é o juro.
- **Empréstimo**: "Pagamento de parcela Empréstimos …"/"Débito por dívida Empréstimos …".
  Não traz "n/N", então mostra o que já foi pago e a parcela típica, sem prazo.

Os parcelamentos de fatura e de empréstimo costumam ficar em Transferências/Pagamento de
cartão (as compras originais já contaram como gasto). Aqui eles aparecem à parte, com o
juro, sem mexer na categoria.

CLI: uv run python -m finance.installments      (resumo no terminal, só leitura)
"""
from __future__ import annotations

import hashlib
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import date

from . import ledger as L

INSTALLMENT_RE = re.compile(r"^\s*([1-9]\d*)\s*/\s*([1-9]\d*)\s*$")
# "PARCELA 3/10", "- 3 de 10" no fim da descrição
MARKER_RE = re.compile(r"(?:\s*[-–—]?\s*)(?:parc(?:ela)?\.?\s*)?\d+\s*(?:/|de)\s*\d+\s*$", re.I)
FATURA_PLAN_RE = re.compile(r"parcela da fatura|parcelamento (?:de|da) fatura", re.I)
FATURA_CREDIT_RE = re.compile(r"cr[eé]dito por parcelamento da fatura", re.I)
FATURA_ADJUST_RE = re.compile(
    r"antecipa[cç][aã]o de parcelamento|devolu[cç][aã]o de juros|juros? (?:do|de) parcelamento",
    re.I)
LOAN_RE = re.compile(r"empr[eé]stimo", re.I)
LOAN_PREFIX_RE = re.compile(
    r"^(?:d[eé]bito por d[ií]vida|pagamento de parcela|pagamento|parcela)\s+", re.I)

# valor de parcela "igual" na mesma sequência (arredondamento de centavos, IOF)
_AMOUNT_TOL = 0.02
# empréstimo sem pagamento há mais que isso é tratado como encerrado
_LOAN_ACTIVE_DAYS = 45


def parse(value) -> tuple[int, int] | None:
    """'3/10' → (3, 10). Inválido, 0 ou n > N → None."""
    m = INSTALLMENT_RE.match(str(value or ""))
    if not m:
        return None
    n, total = int(m.group(1)), int(m.group(2))
    return (n, total) if n <= total else None


def _norm(text: str | None) -> str:
    t = unicodedata.normalize("NFD", text or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").upper()
    return re.sub(r"[^A-Z0-9]+", " ", t).strip()


def strip_marker(description: str | None) -> str:
    return MARKER_RE.sub("", (description or "").strip()).strip()


def _identity(rec: dict) -> str:
    # Só a descrição: o merchant_name da Pluggy às vezes vem só em parte das parcelas
    # ("lojaexemplo" numas, vazio noutras). Sem espaços, "LOJA EXEMPLO" e "LOJAEXEMPLO"
    # casam.
    return _norm(strip_marker(rec.get("description"))).replace(" ", "")


def _month(d: str) -> str:
    return d[:7]


def add_months(month: str, k: int) -> str:
    y, m = int(month[:4]), int(month[5:7])
    idx = y * 12 + (m - 1) + k
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def _amount(rec: dict) -> float:
    return abs(float(L.effective_amount(rec)))


def _close(a: float, b: float) -> bool:
    return abs(a - b) <= max(0.05, _AMOUNT_TOL * max(a, b))


def _kind(rec: dict) -> str:
    return "fatura" if FATURA_PLAN_RE.search(rec.get("description") or "") else "compra"


def _sequences(entries: list[tuple[int, int, dict]], kind: str) -> list[list]:
    """Separa compras diferentes do mesmo lojista com o mesmo N.

    A Pluggy costuma trazer várias parcelas futuras de uma vez (2/10 a 7/10 no dia
    seguinte à compra) e depois uma por fatura, então a ordem das datas não separa compras.
    Uma parcela entra numa sequência de valor parecido que ainda não tem esse número
    (preferindo a que termina em n-1). Na compra, "1/N" sempre abre uma sequência nova:
    é assim que duas compras iguais no mesmo lojista ficam separadas.
    """
    seqs: list[list] = []
    for n, total, rec in sorted(entries, key=lambda e: (e[2]["date"], e[0], e[2]["id"])):
        amt = _amount(rec)
        best = None
        for seq in seqs:
            nums = {e[0] for e in seq}
            last_n, _, last = max(seq, key=lambda e: (e[0], e[2]["date"]))
            if not _close(amt, _amount(last)) or n in nums:
                continue
            if kind == "compra" and n == 1:
                continue
            score = (0 if last_n == n - 1 else 1, abs(n - last_n))
            if best is None or score < best[0]:
                best = (score, seq)
        if best:
            best[1].append((n, total, rec))
        else:
            seqs.append([(n, total, rec)])
    return seqs


def _months_between(a: str, b: str) -> int:
    """Quantos meses de a até b (b - a)."""
    return (int(b[:4]) * 12 + int(b[5:7])) - (int(a[:4]) * 12 + int(a[5:7]))


def _plan(kind: str, seq: list, ref_month: dict, credits: list[dict], today: date) -> dict:
    seq = sorted(seq, key=lambda e: (e[0], e[2]["date"]))
    recs = [e[2] for e in seq]
    first, last = min(recs, key=lambda r: r["date"]), max(recs, key=lambda r: r["date"])
    top_n, total = seq[-1][0], seq[-1][1]
    parcel = round(_amount(seq[-1][2]), 2)
    account = last.get("account_id") or ""
    # Calendário da compra: a parcela n cai na fatura start + n - 1. As parcelas que a
    # Pluggy adianta (2/10 a 7/10 no dia seguinte à compra) puxariam o início para trás,
    # então vale o MAIOR início estimado entre as linhas.
    start = max(add_months(_month(r["date"]), -(n - 1)) for n, _, r in seq)
    end = add_months(start, total - 1)
    # Referência: a última fatura da conta que já está no Ledger. Conta parada há meses
    # (cartão cancelado) usa o mês corrente.
    now = today.strftime("%Y-%m")
    ref = ref_month.get(account) or now
    if ref < add_months(now, -3):
        ref = now
    pending = [add_months(start, n - 1) for n in range(top_n + 1, total + 1)]
    future = [m for m in pending if m > ref]
    overdue = [m for m in pending if m <= ref]
    if not pending:
        status = "completed"
    elif not future and all(m <= add_months(ref, -2) for m in overdue):
        # parcelas que já deviam ter vindo há meses: antecipada, cancelada ou outro nome
        status = "stale"
    else:
        status = "active"
    remaining = len(pending) if status == "active" else 0
    key = "|".join([kind, account, _identity(first), str(total), first["id"]])
    plan = {
        "id": hashlib.sha1(key.encode()).hexdigest()[:12],
        "kind": kind,
        "description": strip_marker(first.get("description")) or first.get("description")
        or "Compra parcelada",
        "account_id": account,
        "account_name": last.get("account_name"),
        "category": last.get("category"),
        "subcategory": last.get("subcategory"),
        "parcel_amount": parcel,
        "total_installments": total,
        "paid_installments": top_n,
        "remaining_installments": remaining,
        "overdue_installments": len(overdue) if status == "active" else 0,
        "total_amount": round(parcel * total, 2),
        "paid_amount": round(sum(_amount(r) for r in recs), 2),
        "remaining_amount": round(parcel * remaining, 2),
        "first_date": first["date"],
        "last_date": last["date"],
        "start_month": start,
        "end_month": end,
        "next_month": future[0] if status == "active" and future else None,
        "ref_month": ref,
        "status": status,
        "schedule": future if status == "active" else [],
        "transactions": [{"id": r["id"], "date": r["date"], "installment": f"{n}/{t}",
                          "amount": round(float(L.effective_amount(r)), 2)}
                         for n, t, r in seq],
    }
    if kind == "fatura":
        # valor financiado: crédito "parcelamento da fatura" da mesma conta, perto da 1ª
        near = [c for c in credits if c.get("account_id") == account
                and abs((date.fromisoformat(c["date"])
                         - date.fromisoformat(first["date"])).days) <= 45]
        principal = round(sum(float(L.effective_amount(c)) for c in near), 2) if near else None
        plan["principal"] = principal
        plan["interest"] = (round(plan["total_amount"] - principal, 2)
                            if principal is not None else None)
        plan["related"] = [{"id": c["id"], "date": c["date"], "description": c["description"],
                            "amount": round(float(L.effective_amount(c)), 2)} for c in near]
    return plan


def _loans(recs: list[dict], today: date) -> list[dict]:
    groups: dict = defaultdict(list)
    for r in recs:
        desc = r.get("description") or ""
        if r.get("excluded") or parse(r.get("installment")) or not LOAN_RE.search(desc):
            continue
        if float(L.effective_amount(r)) >= 0:
            continue
        name = LOAN_PREFIX_RE.sub("", desc.strip()).strip() or desc
        groups[(r.get("account_id") or "", _norm(name))].append((name, r))
    out = []
    for (account, _), items in groups.items():
        items.sort(key=lambda it: it[1]["date"])
        rows = [r for _, r in items]
        last = rows[-1]
        days = (today - date.fromisoformat(last["date"])).days
        out.append({
            "id": hashlib.sha1(f"loan|{account}|{_norm(items[0][0])}".encode()).hexdigest()[:12],
            "kind": "emprestimo",
            "description": items[-1][0],
            "account_id": account,
            "account_name": last.get("account_name"),
            "parcel_amount": round(_amount(last), 2),
            "payments": len(rows),
            "paid_amount": round(sum(_amount(r) for r in rows), 2),
            "first_date": rows[0]["date"],
            "last_date": last["date"],
            "status": "active" if days <= _LOAN_ACTIVE_DAYS else "completed",
            # categorias divergentes ajudam a achar parcela de empréstimo mal classificada
            "categories": sorted({f"{r.get('category') or '—'}/{r.get('subcategory') or '—'}"
                                  for r in rows}),
            "transactions": [{"id": r["id"], "date": r["date"], "installment": None,
                              "amount": round(float(L.effective_amount(r)), 2)} for r in rows],
        })
    return sorted(out, key=lambda x: (x["status"] != "active", x["description"]))


def build(recs: list[dict], today: date | None = None, horizon: int = 12) -> dict:
    """Planos de parcelas, empréstimos e o comprometido por mês nos próximos meses."""
    today = today or date.today()
    buckets: dict = defaultdict(list)
    ref_month: dict = {}
    credits = []
    for r in recs:
        if r.get("excluded"):
            continue
        desc = r.get("description") or ""
        if FATURA_CREDIT_RE.search(desc) or (FATURA_ADJUST_RE.search(desc)
                                             and not parse(r.get("installment"))):
            if FATURA_CREDIT_RE.search(desc):
                credits.append(r)
            continue
        parsed = parse(r.get("installment"))
        if not parsed:
            continue
        acc = r.get("account_id") or ""
        ref_month[acc] = max(ref_month.get(acc, ""), _month(r["date"]))
        kind = _kind(r)
        ident = "FATURA" if kind == "fatura" else _identity(r)
        buckets[(kind, acc, parsed[1], ident)].append((parsed[0], parsed[1], r))

    plans = []
    for (kind, _, _, _), entries in buckets.items():
        seqs = _sequences(entries, kind)
        for seq in seqs:
            plan = _plan(kind, seq, ref_month, credits, today)
            # "1/N" sozinho, igual (data e valor) ao 1/N de outra sequência: quase sempre
            # a mesma compra importada duas vezes. Fica fora das contas, para conferir.
            if len(seq) == 1 and seq[0][0] == 1 and any(
                    other is not seq and any(n == 1 and r["date"] == seq[0][2]["date"]
                                             and _close(_amount(r), _amount(seq[0][2]))
                                             for n, _, r in other)
                    for other in seqs):
                plan.update(status="duplicate", remaining_installments=0,
                            remaining_amount=0.0, overdue_installments=0,
                            next_month=None, schedule=[])
            plans.append(plan)
    order = {"active": 0, "stale": 1, "duplicate": 2, "completed": 3}
    plans.sort(key=lambda p: (order[p["status"]], p["end_month"] if p["status"] == "active"
                              else "~" + p["end_month"][::-1], p["description"]))

    active = [p for p in plans if p["status"] == "active"]
    # A janela começa depois da fatura mais recente que já está no Ledger (entre as contas
    # com parcela ativa). Parcela de mês anterior a isso já devia ter chegado: vai para
    # "atrasadas", fora do gráfico.
    refs = [p["ref_month"] for p in active]
    start = add_months(max(refs), 1) if refs else add_months(today.strftime("%Y-%m"), 1)
    months = [add_months(start, k) for k in range(horizon)]
    schedule = []
    for m in months:
        row = {"month": m, "compra": 0.0, "fatura": 0.0}
        for p in active:
            if m in p["schedule"]:
                row[p["kind"]] += p["parcel_amount"]
        row = {k: (round(v, 2) if isinstance(v, float) else v) for k, v in row.items()}
        row["total"] = round(row["compra"] + row["fatura"], 2)
        schedule.append(row)
    late = 0.0
    for p in active:
        early = [m for m in p["schedule"] if m < start]
        p["overdue_installments"] += len(early)
        late += p["overdue_installments"] * p["parcel_amount"]

    loans = _loans(recs, today)
    return {
        "plans": plans,
        "loans": loans,
        "schedule": schedule,
        "totals": {
            "remaining_amount": round(sum(p["remaining_amount"] for p in active), 2),
            "active_plans": len(active),
            "next_month": schedule[0]["total"] if schedule else 0.0,
            "end_month": max((p["end_month"] for p in active), default=None),
            "overdue_amount": round(late, 2),
            "loans_monthly": round(sum(x["parcel_amount"] for x in loans
                                       if x["status"] == "active"), 2),
            "fatura_interest": round(sum(p.get("interest") or 0 for p in plans
                                         if p["kind"] == "fatura"), 2),
        },
    }


def _cli() -> None:
    data = build(list(L.load_ledger().values()))
    t = data["totals"]
    print(f"Parcelas ativas: {t['active_plans']} · falta pagar R$ {t['remaining_amount']:,.2f}"
          f" · termina {t['end_month'] or '—'}")
    for p in data["plans"]:
        if p["status"] == "completed":
            continue
        print(f"  [{p['status']:<6}] {p['kind']:<6} {p['description'][:34]:<34} "
              f"{p['paid_installments']:>2}/{p['total_installments']:<2} "
              f"R$ {p['parcel_amount']:>9,.2f}  falta R$ {p['remaining_amount']:>9,.2f}"
              f"  até {p['end_month']}")
    for x in data["loans"]:
        print(f"  [{x['status']:<6}] empréstimo {x['description'][:30]:<30} "
              f"{x['payments']} pagamentos · R$ {x['parcel_amount']:,.2f}/mês")
    print("Comprometido por mês:")
    for row in data["schedule"]:
        print(f"  {row['month']}  R$ {row['total']:>10,.2f}")


if __name__ == "__main__":
    _cli() if len(sys.argv) == 1 else sys.exit("uso: python -m finance.installments")
