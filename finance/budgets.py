"""Planejamento financeiro: tetos por categoria, renda esperada, metas.

Fonte da verdade: `data/budgets.json` (versionado, editável por você, pelo
dashboard ou por mim na conversa). Estrutura:

  {
    "income_plan": { "recurring": 14000, "months": { "2026-05": 16000 } },
    "spending": {
      "recurring": { "Alimentação": 1800, ... },   # teto que vale todo mês
      "months":    { "2026-05": { "Lazer": 800 } }  # override do mês
    },
    "savings_goals": [ { "name": "Reserva de emergência", "target": 20000 } ]
  }

Teto efetivo do mês m p/ a categoria c =
    spending.months[m].get(c, spending.recurring.get(c))

CLI:
  uv run python -m finance.budgets            # mês mais recente do ledger
  uv run python -m finance.budgets 2026-05    # mês específico
"""

import json
import sys
from collections import defaultdict

from .config import BUDGETS_FILE

# Categorias que não são "gasto" de fluxo de caixa (não têm teto de orçamento).
NON_CASHFLOW = {"Transferências", "Investimentos", "Reserva", "Formatura",
                "Compartilhado"}


def default() -> dict:
    return {
        "income_plan": {"recurring": 0, "months": {}},
        "spending": {"recurring": {}, "months": {}},
        "savings_goals": [],
    }


def load() -> dict:
    if not BUDGETS_FILE.exists():
        return default()
    try:
        data = json.loads(BUDGETS_FILE.read_text())
    except json.JSONDecodeError:
        return default()
    d = default()
    d.update(data or {})
    d["income_plan"] = {**default()["income_plan"], **d.get("income_plan", {})}
    d["spending"] = {**default()["spending"], **d.get("spending", {})}
    d.setdefault("savings_goals", [])
    return d


def save(data: dict) -> None:
    BUDGETS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def planned_spending(b: dict, month: str) -> dict:
    """Teto efetivo por categoria no mês (recorrente + override do mês)."""
    rec = dict(b.get("spending", {}).get("recurring", {}) or {})
    rec.update(b.get("spending", {}).get("months", {}).get(month, {}) or {})
    return {k: float(v) for k, v in rec.items() if v not in (None, "")}


def planned_income(b: dict, month: str) -> float:
    ip = b.get("income_plan", {})
    m = ip.get("months", {}).get(month)
    return float(m if m not in (None, "") else ip.get("recurring", 0) or 0)


# ----------------------------------------------------------------------- CLI
def _cli(month: str | None) -> None:
    from . import ledger as L

    ledger = L.load_ledger()
    if not ledger:
        sys.exit("Ledger vazio. Rode antes: uv run python -m finance.sync")
    months = sorted({r["date"][:7] for r in ledger.values()})
    m = month or months[-1]
    if m not in months:
        sys.exit(f"Sem dados para {m}. Disponíveis: {months[0]}..{months[-1]}")

    b = load()
    realized: dict = defaultdict(float)
    income = 0.0
    for r in ledger.values():
        if r["date"][:7] != m:
            continue
        parts = (r["splits"] if r.get("splits")
                 else [{"amount": r["signed_amount"], "category": r["category"]}])
        for pt in parts:
            cat = pt.get("category") or "Outros"
            amt = pt["amount"]
            if cat in NON_CASHFLOW:
                continue
            if amt < 0:
                realized[cat] += -amt
            else:
                income += amt

    plan = planned_spending(b, m)
    inc_plan = planned_income(b, m)
    cats = sorted(set(plan) | set(realized),
                  key=lambda c: -(plan.get(c, 0) or realized.get(c, 0)))

    print(f"\nPlanejamento {m}")
    print(f"  Renda: planejada R$ {inc_plan:,.2f} | realizada R$ {income:,.2f}")
    print(f"  {'Categoria':<18}{'Teto':>12}{'Realizado':>13}{'Falta':>12}  Status")
    tot_p = tot_r = 0.0
    for c in cats:
        p = plan.get(c, 0.0)
        rl = realized.get(c, 0.0)
        tot_p += p
        tot_r += rl
        if not p:
            st = "sem teto"
        elif rl > p:
            st = "ESTOUROU"
        elif rl > 0.85 * p:
            st = "no limite"
        else:
            st = "ok"
        falta = p - rl
        print(f"  {c:<18}{p:>12,.0f}{rl:>13,.2f}{falta:>12,.2f}  {st}")
    print(f"  {'TOTAL':<18}{tot_p:>12,.0f}{tot_r:>13,.2f}"
          f"{tot_p - tot_r:>12,.2f}")
    print(f"  Saldo planejado R$ {inc_plan - tot_p:,.2f} | "
          f"realizado R$ {income - tot_r:,.2f}")


def main() -> None:
    _cli(sys.argv[1] if len(sys.argv) > 1 else None)


if __name__ == "__main__":
    main()
