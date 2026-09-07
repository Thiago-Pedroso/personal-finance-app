"""Agrega o ledger em relatórios mensais + JSON do dashboard.

Uso:
  uv run python -m finance.report            # gera todos os meses + dashboard.json
  uv run python -m finance.report --month 2026-05

Fluxo de caixa = só consumo/receita real. Transferências e Investimentos NÃO entram
no fluxo (são movimentação, não gasto) — ficam num resumo à parte.
"""

import argparse
import json
import statistics
import unicodedata
from calendar import monthrange
from collections import Counter, defaultdict
from datetime import date, datetime, timezone

from . import budgets as B
from . import ledger as L
from . import taxonomy as T
from .config import REPORTS_DIR, ensure_dirs

# Tratamento por categoria (fluxo|poupança|movimento) — fonte da verdade é a taxonomia.
# Carregado uma vez em main(); as funções abaixo consultam via _tr().
_TREAT: dict = {}


def _tr(cat: str | None) -> str:
    return T.treatment_of(_TREAT, cat)


def _is_rendimento(sub: str | None) -> bool:
    """Rendimento de investimento: cresce o patrimônio, mas NÃO é 'poupado da renda'
    (não entra na taxa de poupança). Detectado pela subcategoria."""
    return "RENDIMENT" in _norm(sub)


# Campos de cada transação embutidos nos arquivos mensais (consumidos pelo front).
_TXN_FIELDS = ("id", "date", "description", "counterparty", "signed_amount",
               "type", "account_name", "category", "subcategory",
               "category_source", "reviewed", "needs_review", "note",
               "amount_override", "excluded", "tags")

# Subcategorias que são tipo de transação (palpite da Pluggy), não categoria real.
_TYPE_SUBS = {"PIX recebido", "PIX enviado", "TED/DOC"}


def _is_pending(r: dict) -> bool:
    """Precisa de ação do usuário: sem categoria, anomalia, ou palpite da
    Pluggy não confirmado (tipo de transação ≠ categoria de verdade)."""
    if r.get("excluded"):        # rasurado sai de tudo, inclusive das pendências
        return False
    if r.get("splits"):
        return False
    if not r["category"]:
        return True
    if r.get("needs_review"):
        return True
    if (r.get("category_source") == "pluggy-map" and not r.get("reviewed")
            and (r.get("subcategory") in _TYPE_SUBS)):
        return True
    return False


def _flowbucket():
    return defaultdict(lambda: {
        "in": 0.0, "out": 0.0, "count": 0,
        "subcategories": defaultdict(lambda: {"in": 0.0, "out": 0.0, "count": 0})})


def _blank() -> dict:
    return {"income": 0.0, "expense": 0.0, "saved": 0.0,
            "by_category": defaultdict(
                lambda: {"income": 0.0, "expense": 0.0, "count": 0,
                         "subcategories": defaultdict(
                             lambda: {"income": 0.0, "expense": 0.0, "count": 0})}),
            # movimento (auditoria) e poupança (Poupado) — cada um seu balde in/out
            "movements": _flowbucket(),
            "poupanca": _flowbucket()}


def _post(bucket: dict, amt: float, cat: str, sub: str) -> None:
    cat = cat or "Outros"
    sub = sub or "—"
    treat = _tr(cat)
    if treat != "fluxo":
        key = "poupanca" if treat == "poupança" else "movements"
        m = bucket[key][cat]
        side = "in" if amt > 0 else "out"
        m[side] += abs(amt)
        m["count"] += 1
        ms = m["subcategories"][sub]
        ms[side] += abs(amt)
        ms["count"] += 1
        # Poupado = só APORTES (o que saiu da conta pra poupança). Resgate (entrada,
        # amt>0) NÃO conta — tirar de um cofrinho não é poupar. Rendimento também não.
        if treat == "poupança" and not _is_rendimento(sub) and amt < 0:
            bucket["saved"] += -amt
        return
    c = bucket["by_category"][cat]
    s = c["subcategories"][sub]
    if amt >= 0:
        bucket["income"] += amt
        c["income"] += amt
        s["income"] += amt
    else:
        bucket["expense"] += -amt
        c["expense"] += -amt
        s["expense"] += -amt
    c["count"] += 1
    s["count"] += 1


def _add(bucket: dict, rec: dict) -> None:
    """Lança no agregado. Se o registro tem `splits`, cada parte é lançada
    na sua própria categoria (a sua parte conta no fluxo; a parte adiantada
    cai em Compartilhado e some do fluxo)."""
    splits = rec.get("splits")
    if splits:
        for sp in splits:
            _post(bucket, sp["amount"], sp.get("category"),
                  sp.get("subcategory"))
        return
    _post(bucket, rec["signed_amount"], rec["category"], rec["subcategory"])


def _undefault(o):
    if isinstance(o, defaultdict):
        o = {k: _undefault(v) for k, v in o.items()}
    elif isinstance(o, dict):
        o = {k: _undefault(v) for k, v in o.items()}
    return {k: round(v, 2) if isinstance(v, float) else v for k, v in o.items()} \
        if isinstance(o, dict) else o


def _month_json(month: str, b: dict) -> dict:
    return {
        "month": month,
        "income": round(b["income"], 2),
        "expense": round(b["expense"], 2),
        "net": round(b["income"] - b["expense"], 2),
        # Poupado no mês (aportes − resgates). Sobra líquida = net − saved (no front).
        "saved": round(b["saved"], 2),
        "by_category": _undefault(b["by_category"]),
        "movements": _undefault(b["movements"]),
        "poupanca": _undefault(b["poupanca"]),
    }


def _md(mj: dict, prev: dict | None) -> str:
    L_ = [f"# Relatório {mj['month']}", ""]
    L_.append(f"- **Receitas:** R$ {mj['income']:,.2f}")
    L_.append(f"- **Gastos:** R$ {mj['expense']:,.2f}")
    L_.append(f"- **Saldo:** R$ {mj['net']:,.2f}")
    if prev:
        d = mj["expense"] - prev["expense"]
        sign = "▲" if d > 0 else "▼"
        L_.append(f"- **Gastos vs mês anterior:** {sign} R$ {abs(d):,.2f} "
                  f"(antes R$ {prev['expense']:,.2f})")
    L_.append("\n## Gastos por categoria\n")
    cats = sorted(mj["by_category"].items(), key=lambda kv: -kv[1]["expense"])
    for cat, c in cats:
        if c["expense"] <= 0:
            continue
        L_.append(f"### {cat} — R$ {c['expense']:,.2f}")
        subs = sorted(c["subcategories"].items(), key=lambda kv: -kv[1]["expense"])
        for sub, s in subs:
            if s["expense"] > 0:
                L_.append(f"- {sub}: R$ {s['expense']:,.2f} ({s['count']}x)")
        L_.append("")
    if mj["movements"]:
        L_.append("## Movimentações (fora do fluxo de caixa)\n")
        for cat, m in sorted(mj["movements"].items()):
            net = m["in"] - m["out"]
            L_.append(f"- **{cat}**: entrou R$ {m['in']:,.2f} / "
                      f"saiu R$ {m['out']:,.2f} / líquido R$ {net:,.2f} ({m['count']}x)")
            subs = sorted(m.get("subcategories", {}).items(),
                          key=lambda kv: -(kv[1]["in"] + kv[1]["out"]))
            for sub, s in subs:
                L_.append(f"    - {sub}: entrou R$ {s['in']:,.2f} / "
                          f"saiu R$ {s['out']:,.2f} ({s['count']}x)")
    return "\n".join(L_) + "\n"


def _norm(s: str | None) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", str(s))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.upper().split())


def _plan_for_month(b: dict, mj: dict, month: str, today: date) -> dict:
    """Planejado vs realizado por categoria, com ritmo/projeção."""
    y, mm = int(month[:4]), int(month[5:7])
    dim = monthrange(y, mm)[1]
    is_cur = month == today.strftime("%Y-%m")
    delap = min(today.day, dim) if is_cur else dim
    frac = max(delap / dim, 1e-9)

    plan = B.planned_spending(b, month)
    inc_plan = B.planned_income(b, month)
    realized = {c: v["expense"] for c, v in mj["by_category"].items()
                if v["expense"] > 0}
    cats = sorted(set(plan) | set(realized),
                  key=lambda c: -(plan.get(c, 0) or realized.get(c, 0)))

    rows, tot_p, tot_r, tot_proj = [], 0.0, 0.0, 0.0
    for c in cats:
        p = float(plan.get(c, 0.0))
        rl = round(realized.get(c, 0.0), 2)
        proj = round(rl / frac, 2) if is_cur else rl
        tot_p += p
        tot_r += rl
        tot_proj += max(proj, rl)
        if not p:
            st = "sem_teto"
        elif rl > p:
            st = "estourou"
        elif is_cur and proj > p:
            st = "estourando"
        elif rl < 0.7 * p:
            st = "folgado"
        else:
            st = "no_caminho"
        rows.append({"category": c, "planned": round(p, 2), "realized": rl,
                     "remaining": round(p - rl, 2),
                     "projected": proj if is_cur else rl, "status": st})

    income = round(mj["income"], 2)
    days_left = max(dim - delap, 0)
    free = max(tot_p - tot_r, 0.0)
    return {
        "month": month, "is_current": is_cur,
        "days_in_month": dim, "days_elapsed": delap, "days_left": days_left,
        "income_planned": round(inc_plan, 2), "income_realized": income,
        "total_planned": round(tot_p, 2), "total_realized": round(tot_r, 2),
        "total_projected": round(tot_proj, 2),
        "planned_balance": round(inc_plan - tot_p, 2),
        "realized_balance": round(income - tot_r, 2),
        "projected_balance": round(
            (inc_plan if is_cur else income) - tot_proj, 2),
        "daily_allowed": round(free / days_left, 2) if days_left else 0.0,
        "categories": rows,
    }


def _bucket_balances() -> dict:
    """Saldo das caixinhas, quando o espaço Investimentos já existe.

    O estoque passa a vir de lá: a meta continua no planejamento com o seu alvo, e o
    quanto já se tem deixa de ser digitado à mão."""
    path = REPORTS_DIR / "invest.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        return {}
    out = {}
    for position in data.get("positions", []):
        if position.get("valuation") == "balance":
            for key in (position.get("name"), position.get("ticker")):
                if key:
                    out[_norm(key)] = float(position.get("value") or 0.0)
    return out


def _savings(b: dict, cum_in: float, cum_out: float, mon_in: float,
             mon_out: float) -> dict:
    goals = b.get("savings_goals", []) or []
    buckets = _bucket_balances()
    g_out = []
    for g in goals:
        name = g.get("name", "Meta")
        held = buckets.get(_norm(name))
        g_out.append({
            "name": name,
            "target": round(float(g.get("target", 0) or 0), 2),
            "current": round(held if held is not None
                             else float(g.get("current", 0) or 0), 2),
            "source": "carteira" if held is not None else "informado",
        })
    target = round(sum(g["target"] for g in g_out), 2)
    current = round(sum(g["current"] for g in g_out), 2)
    return {
        # saldo informado pelo usuário (ele sabe os cofrinhos); o líquido
        # de Reserva é só contexto de movimentação no período.
        "current_total": current,
        "target_total": target,
        "pct": round(current / target * 100, 1) if target > 0 else None,
        "reserva_net_period": round(cum_in - cum_out, 2),
        "reserva_month_net": round(mon_in - mon_out, 2),
        "goals": g_out,
    }


def _insights(plan: dict, mj: dict, prev_mj: dict | None,
               txns: list, savings: dict) -> list:
    out = []
    for r in plan["categories"]:
        if r["status"] == "estourou":
            d = r["realized"] - r["planned"]
            out.append({"sev": "alert", "text":
                f"{r['category']} estourou: R$ {r['realized']:,.0f} de "
                f"R$ {r['planned']:,.0f} (+R$ {d:,.0f})"})
        elif r["status"] == "estourando":
            out.append({"sev": "warn", "text":
                f"{r['category']} no ritmo de estourar: projeção "
                f"R$ {r['projected']:,.0f} vs teto R$ {r['planned']:,.0f}"})
    if prev_mj:
        moves = []
        cats = set(mj["by_category"]) | set(prev_mj["by_category"])
        for c in cats:
            a = mj["by_category"].get(c, {}).get("expense", 0)
            p = prev_mj["by_category"].get(c, {}).get("expense", 0)
            moves.append((a - p, c, a, p))
        moves.sort(key=lambda x: -abs(x[0]))
        if moves and abs(moves[0][0]) > 50:
            d, c, a, p = moves[0]
            arrow = "subiu" if d > 0 else "caiu"
            out.append({"sev": "info", "text":
                f"{c} {arrow} R$ {abs(d):,.0f} vs mês anterior "
                f"(R$ {p:,.0f} → R$ {a:,.0f})"})
    cash = [t for t in txns
            if t["signed_amount"] < 0 and not t.get("splits")
            and not t.get("excluded") and _tr(t["category"]) == "fluxo"]
    if cash:
        big = min(cash, key=lambda t: t["signed_amount"])
        out.append({"sev": "info", "text":
            f"Maior gasto: {big['description']} "
            f"R$ {abs(big['signed_amount']):,.0f} "
            f"({big['category'] or 'Outros'})"})
    if savings.get("pct") is not None:
        out.append({"sev": "info", "text":
            f"Metas de poupança: R$ {savings['current_total']:,.0f} de R$ "
            f"{savings['target_total']:,.0f} ({savings['pct']:.0f}%)"})
    ip, ir = plan["income_planned"], plan["income_realized"]
    if not plan["is_current"] and ip > 0 and ir < 0.9 * ip:
        out.append({"sev": "warn", "text":
            f"Renda abaixo do planejado: R$ {ir:,.0f} de R$ {ip:,.0f}"})
    return out[:7]


def _recurring(recs: list) -> list:
    """Assinaturas/recorrências: agrupa por lojista, cadência ~regular."""
    groups: dict = defaultdict(list)
    for r in recs:
        if r.get("excluded") or r["signed_amount"] >= 0 or r.get("splits"):
            continue
        cat = r["category"] or "Outros"
        if _tr(cat) != "fluxo" or cat == "Alimentação":
            continue
        if (r.get("subcategory") or "") == "Combustível":
            continue
        key = _norm(r.get("merchant_name") or r.get("counterparty")
                    or r["description"])
        if len(key) < 3:
            continue
        groups[key].append(r)

    out = []
    for key, g in groups.items():
        dates = sorted(x["date"] for x in g)
        months = {d[:7] for d in dates}
        if len(g) < 3 or len(months) < 3:
            continue
        amts = [abs(x["signed_amount"]) for x in g]
        med = statistics.median(amts)
        mean = statistics.fmean(amts)
        sd = statistics.pstdev(amts)
        if med <= 0 or (mean > 0 and sd / mean > 0.4):
            continue
        ds = [date.fromisoformat(d) for d in dates]
        gaps = [(b - a).days for a, b in zip(ds, ds[1:]) if (b - a).days > 0]
        if not gaps:
            continue
        g_med = statistics.median(gaps)
        cad = ("semanal" if 5 <= g_med <= 9 else "quinzenal" if 12 <= g_med <= 18
               else "mensal" if 24 <= g_med <= 38 else "bimestral"
               if 50 <= g_med <= 70 else "anual" if 330 <= g_med <= 400
               else None)
        if cad is None:
            continue
        label = Counter(x["description"] for x in g).most_common(1)[0][0]
        out.append({
            "label": label,
            "amount": round(med, 2),
            "count": len(g),
            "months": len(months),
            "cadence": cad,
            "category": Counter(x["category"] or "Outros"
                                for x in g).most_common(1)[0][0],
            "last_date": dates[-1],
        })
    out.sort(key=lambda x: -(x["amount"] * x["count"]))
    return out[:40]


def generate(recs=None, taxonomy=None, treatments=None, budgets=None,
             month=None, category_meta=None, subcategory_meta=None) -> None:
    """Gera os relatórios (arquivos em REPORTS_DIR).

    Aceita ledger/taxonomia/tratamentos/budgets já carregados para evitar reler
    do Google Sheets quando o chamador (ex.: categorize.apply) já os tem em
    memória — cada leitura do Sheets custa ~0,5–2s. O que vier None é lido sob
    demanda."""
    ensure_dirs()
    global _TREAT
    if treatments is None or taxonomy is None or category_meta is None:
        tax_l, treat_l, meta_l = T.load_full()   # 1 request serve aos três
        taxonomy = taxonomy if taxonomy is not None else tax_l
        treatments = treatments if treatments is not None else treat_l
        category_meta = category_meta if category_meta is not None else meta_l
    if subcategory_meta is None:
        subcategory_meta = T.load_subcategory_meta(taxonomy)
    _TREAT = treatments
    if recs is None:
        recs = list(L.load_ledger().values())
    if not recs:
        raise SystemExit("Ledger vazio. Rode antes: uv run python -m finance.sync --backfill")

    # Aplica o override manual de valor (cópia em memória; o ledger no disco
    # mantém signed_amount cru + amount_override). Tudo a jusante (agregados,
    # splits, insights, recorrências, dashboard) passa a ver o valor efetivo.
    for r in recs:
        ov = r.get("amount_override")
        if ov is not None:
            r["signed_amount"] = ov

    months: dict = {}
    month_txns: dict = {}
    for r in recs:
        m = r["date"][:7]
        months.setdefault(m, _blank())
        month_txns.setdefault(m, []).append(r)   # lista mostra tudo (rasurado incluso)
        if not r.get("excluded"):                 # mas rasurado não entra nos agregados
            _add(months[m], r)

    ordered = sorted(months)
    # Agregados enxutos (vão para o dashboard.json — carga rápida, sem transações).
    month_jsons = {m: _month_json(m, months[m]) for m in ordered}

    # ---- planejamento por mês (teto vs realizado, ritmo) + poupança acumulada
    bud = budgets if budgets is not None else B.load()
    today = date.today()
    cum_in = cum_out = 0.0
    savings_by_month: dict = {}
    for m in ordered:
        rsv = month_jsons[m]["poupanca"].get("Reserva", {"in": 0.0, "out": 0.0})
        cum_in += rsv["in"]
        cum_out += rsv["out"]
        savings_by_month[m] = _savings(bud, cum_in, cum_out,
                                       rsv["in"], rsv["out"])
        month_jsons[m]["plan"] = _plan_for_month(bud, month_jsons[m], m, today)

    targets = [month] if month else ordered
    for i, m in enumerate(ordered):
        if m not in targets:
            continue
        mj = month_jsons[m]
        prev = month_jsons[ordered[i - 1]] if i > 0 else None
        txns = [{**{k: r.get(k) for k in _TXN_FIELDS}, "splits": r.get("splits")}
                for r in sorted(month_txns[m], key=lambda r: (r["date"], r["id"]))]
        insights = _insights(mj["plan"], mj, prev, txns, savings_by_month[m])
        # O arquivo mensal carrega os agregados + transações + plano (consumidos no front).
        (REPORTS_DIR / f"{m}.json").write_text(
            json.dumps({**mj, "transactions": txns,
                        "savings": savings_by_month[m], "insights": insights},
                       ensure_ascii=False, indent=2) + "\n")
        (REPORTS_DIR / f"{m}.md").write_text(_md(mj, prev))

    # Numa varredura completa, apaga meses que saíram do ledger — senão o disco
    # guarda dados já removidos e o front pode servi-los num F5.
    if not month:
        vivos = {f"{m}.{ext}" for m in ordered for ext in ("json", "md")}
        for antigo in REPORTS_DIR.glob("[0-9][0-9][0-9][0-9]-[0-9][0-9].*"):
            if antigo.name not in vivos:
                antigo.unlink()

    # ---- dashboard.json (consumido pelo frontend)
    by_cat12: dict = defaultdict(lambda: {"expense": 0.0, "income": 0.0, "count": 0})
    for r in recs:
        if r.get("excluded"):
            continue
        parts = (r["splits"] if r.get("splits")
                 else [{"amount": r["signed_amount"], "category": r["category"]}])
        for pt in parts:
            cat = pt.get("category") or "Outros"
            if _tr(cat) != "fluxo":
                continue
            c = by_cat12[cat]
            a = pt["amount"]
            c["expense" if a < 0 else "income"] += abs(a)
            c["count"] += 1
    recent = sorted(recs, key=lambda r: r["date"], reverse=True)[:60]
    dash = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "currency": "BRL",
        "taxonomy": taxonomy,
        # cor/ícone por categoria: vêm da planilha, o front cai num neutro se faltar
        "category_meta": category_meta or {},
        "subcategory_meta": subcategory_meta or {},
        # categorias "de sobrevivência": base do cálculo de reserva de emergência
        "essential_cats": sorted(c for c, m in (category_meta or {}).items()
                                 if m.get("essential")),
        "budgets": bud,
        "recurring": _recurring(recs),
        # tratamento por categoria (fonte da verdade da taxonomia) + listas derivadas
        "treatments": _TREAT,
        "cashflow_excludes": sorted(c for c, t in _TREAT.items() if t != "fluxo"),
        "poupanca_cats": sorted(c for c, t in _TREAT.items() if t == "poupança"),
        "movimento_cats": sorted(c for c, t in _TREAT.items() if t == "movimento"),
        "months": [month_jsons[m] for m in ordered],
        "by_category_12m": sorted(
            ({"category": k, **{kk: round(vv, 2) for kk, vv in v.items()}}
             for k, v in by_cat12.items()), key=lambda x: -x["expense"]),
        "recent": [{k: r.get(k) for k in (
            "id", "date", "description", "signed_amount", "category",
            "subcategory", "account_name", "needs_review", "tags")}
            for r in recent],
        "tags": sorted({tag for r in recs for tag in (r.get("tags") or [])},
                       key=L.tag_key),
        "needs_review": sum(1 for r in recs
                            if r["needs_review"] and not r.get("excluded")),
        "uncategorized": sum(1 for r in recs
                             if not r["category"] and not r.get("splits")
                             and not r.get("excluded")),
        "excluded_count": sum(1 for r in recs if r.get("excluded")),
        # tudo que precisa de ação (histórico inteiro) — consumido pela aba Revisar
        "review": [{**{k: r.get(k) for k in _TXN_FIELDS},
                     "splits": r.get("splits"), "month": r["date"][:7]}
                   for r in sorted(recs, key=lambda r: r["date"], reverse=True)
                   if _is_pending(r)],
        "total_transactions": len(recs),
    }
    dash["pending"] = len(dash["review"])
    (REPORTS_DIR / "dashboard.json").write_text(
        json.dumps(dash, ensure_ascii=False, indent=2) + "\n")

    last = month_jsons[ordered[-1]]
    print(f"Relatórios gerados em {REPORTS_DIR} ({len(targets)} mês(es) + dashboard.json)")
    print(f"Último mês {last['month']}: receitas R$ {last['income']:,.2f} | "
          f"gastos R$ {last['expense']:,.2f} | saldo R$ {last['net']:,.2f}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Relatórios financeiros.")
    ap.add_argument("--month", help="Gera só esse mês (YYYY-MM).")
    args = ap.parse_args()
    generate(month=args.month)


if __name__ == "__main__":
    main()
