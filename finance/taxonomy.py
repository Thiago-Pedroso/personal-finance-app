"""Carrega e valida a taxonomia do usuário (aba **Taxonomy** do Google Sheets).

Aba Taxonomy: 1 linha por categoria, colunas `Category | Subcategories` (subs separados por
vírgula). `load()` reconstrói o dict `{categoria: [subs]}` que o resto do pipeline espera.

Gestão segura (criar, renomear, remover): `preview()` calcula o impacto e um fingerprint do
estado; `apply()` só grava com o fingerprint ainda válido e confirmação explícita. O estado
final inteiro é montado antes de gravar, numa ordem que nunca deixa Ledger ou Rules
apontando para uma categoria/subcategoria que não existe.
CLI (ponte do dashboard): uv run python -m finance.taxonomy preview|apply <request.json>
"""

import argparse
import copy
import hashlib
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path

from . import ledger as L
from . import rules as R
from . import sheets

# Tratamento de cada categoria: como o dinheiro é tratado nos relatórios.
#   fluxo     → conta em Receitas/Gastos (padrão)
#   poupança  → não é gasto; alimenta "Poupado" e a taxa de poupança (Reserva, Investimentos)
#   movimento → fora do fluxo, só auditoria (transferências, rateios reembolsáveis)
TREATMENTS = ("fluxo", "poupança", "movimento")

# Fallback para planilha antiga, sem a coluna Treatment. Os nomes aqui são os das primeiras
# versões do projeto: ficam por compatibilidade, a fonte da verdade é a coluna.
_LEGACY_TREATMENT = {
    "Reserva": "poupança", "Investimentos": "poupança",
    "Transferências": "movimento", "Formatura": "movimento",
    "Compartilhado": "movimento",
}
_KINDS = {"create-category", "create-subcategory", "rename-category",
          "rename-subcategory", "delete-category", "delete-subcategory"}
_FIELDS = {
    "create-category": {"kind", "category", "treatment"},
    "create-subcategory": {"kind", "category", "subcategory"},
    "rename-category": {"kind", "category", "newCategory"},
    "rename-subcategory": {"kind", "category", "subcategory", "newSubcategory"},
    "delete-category": {"kind", "category"},
    "delete-subcategory": {"kind", "category", "subcategory"},
}


class TaxonomyError(ValueError):
    """A request or stored-state error that can be shown to the user."""

    def __init__(self, message, *, status=400, kind="validation"):
        super().__init__(message)
        self.status = status
        self.kind = kind


def _norm_treatment(raw: str | None, cat: str) -> str:
    t = (raw or "").strip().lower()
    if t in ("poupanca", "poupança"):
        t = "poupança"
    return t if t in TREATMENTS else _LEGACY_TREATMENT.get(cat, "fluxo")


def _split_subs(raw: str | None) -> list[str]:
    return [s.strip() for s in (raw or "").split(",") if s.strip()]


def load() -> dict:
    tax: dict = {}
    for rec in sheets.read_records("Taxonomy"):
        cat = (rec.get("Category") or "").strip()
        if cat:
            tax[cat] = _split_subs(rec.get("Subcategories"))
    return tax


def load_treatments() -> dict:
    """Mapa {categoria: tratamento} da coluna Treatment (com fallback legado)."""
    out: dict = {}
    for rec in sheets.read_records("Taxonomy"):
        cat = (rec.get("Category") or "").strip()
        if cat:
            out[cat] = _norm_treatment(rec.get("Treatment"), cat)
    return out


def load_all() -> tuple[dict, dict]:
    """Lê a aba Taxonomy UMA vez e devolve (taxonomia, tratamentos). Evita 2
    requests quando o chamador precisa dos dois (ex.: categorize.apply)."""
    tax, treats, _ = load_full()
    return tax, treats


def load_meta() -> dict:
    """Cor e ícone por categoria, para o dashboard. Colunas opcionais."""
    return load_full()[2]


def load_subcategory_meta(taxonomy: dict | None = None) -> dict:
    """Carrega cor e ícone opcionais por categoria e subcategoria."""
    meta: dict = {}
    try:
        records = sheets.read_records("SubcategoryMeta")
    except sheets.SheetsError:
        return meta
    for rec in records:
        category = (rec.get("Category") or "").strip()
        subcategory = (rec.get("Subcategory") or "").strip()
        if not category or not subcategory:
            continue
        if taxonomy is not None and subcategory not in (taxonomy.get(category) or []):
            continue
        color = (rec.get("Color") or "").strip()
        icon = (rec.get("Icon") or "").strip()
        if color or icon:
            meta.setdefault(category, {})[subcategory] = {
                "color": color or None,
                "icon": icon or None,
            }
    return meta


def save_subcategory_meta(meta: dict | None = None) -> None:
    """Grava metadados opcionais de subcategorias."""
    records = []
    for category, subcategories in (meta or {}).items():
        for subcategory, values in (subcategories or {}).items():
            records.append({
                "Category": category,
                "Subcategory": subcategory,
                "Color": (values or {}).get("color"),
                "Icon": (values or {}).get("icon"),
            })
    sheets.write_records("SubcategoryMeta", records)


def load_full() -> tuple[dict, dict, dict]:
    """(taxonomia, tratamentos, meta) numa leitura só."""
    tax: dict = {}
    treats: dict = {}
    meta: dict = {}
    for rec in sheets.read_records("Taxonomy"):
        cat = (rec.get("Category") or "").strip()
        if not cat:
            continue
        tax[cat] = _split_subs(rec.get("Subcategories"))
        treats[cat] = _norm_treatment(rec.get("Treatment"), cat)
        color = (rec.get("Color") or "").strip()
        icon = (rec.get("Icon") or "").strip()
        essential = bool(rec.get("Essential"))
        if color or icon or essential:
            meta[cat] = {"color": color or None, "icon": icon or None,
                         "essential": essential}
    return tax, treats, meta


def treatment_of(treatments: dict, cat: str | None) -> str:
    """Tratamento de uma categoria; cai no fallback legado se não estiver no mapa."""
    if cat and cat in treatments:
        return treatments[cat]
    return _LEGACY_TREATMENT.get(cat or "", "fluxo")


def save(tax: dict, treatments: dict | None = None, meta: dict | None = None) -> None:
    """Grava o dict {categoria: [subs]} na aba Taxonomy (usado pelo seed).
    `treatments` define o Tratamento; `meta` traz {cat: {color, icon}}. Ambos opcionais."""
    treatments = treatments or {}
    meta = meta or {}
    records = [{"Category": cat, "Subcategories": ", ".join(subs or []),
                "Treatment": _norm_treatment(treatments.get(cat), cat),
                "Color": (meta.get(cat) or {}).get("color"),
                "Icon": (meta.get(cat) or {}).get("icon"),
                "Essential": bool((meta.get(cat) or {}).get("essential"))}
               for cat, subs in tax.items()]
    sheets.write_records("Taxonomy", records)


def valid(tax: dict, category: str | None, subcategory: str | None) -> bool:
    if category is None:
        return False
    if category not in tax:
        return False
    if subcategory is None:
        return True
    return subcategory in (tax.get(category) or [])


def _name(value, label):
    if not isinstance(value, str):
        raise TaxonomyError(f"{label} deve ser texto")
    value = value.strip()
    if not value:
        raise TaxonomyError(f"{label} não pode ficar vazio")
    if "," in value:
        raise TaxonomyError(f"{label} não pode conter vírgula")
    return value


def validate_operation(operation, tax=None, treatments=None):
    """Validate the closed API request.  No fuzzy normalization is applied."""
    if not isinstance(operation, dict) or not isinstance(operation.get("kind"), str):
        raise TaxonomyError("operação inválida")
    kind = operation["kind"]
    if kind not in _KINDS or set(operation) != _FIELDS[kind]:
        raise TaxonomyError("operação inválida ou contém campos extras")
    op = {"kind": kind}
    for field in _FIELDS[kind] - {"kind", "treatment"}:
        if field not in operation:
            raise TaxonomyError("operação inválida")
        op[field] = _name(operation[field], field)
    if kind == "create-category":
        treatment = operation.get("treatment")
        if treatment not in TREATMENTS:
            raise TaxonomyError("tratamento deve ser fluxo, poupança ou movimento")
        op["treatment"] = treatment
    if tax is None:
        return op
    cat = op.get("category")
    if kind == "create-category":
        if cat in tax:
            raise TaxonomyError("categoria já existe")
    elif cat not in tax:
        raise TaxonomyError("categoria não existe")
    if kind == "create-subcategory" and op["subcategory"] in tax[cat]:
        raise TaxonomyError("subcategoria já existe nesta categoria")
    if kind == "rename-category":
        new = op["newCategory"]
        if new == cat:
            raise TaxonomyError("novo nome é igual ao atual")
        # A matching destination is not evidence of our compatibility phase:
        # accepting it would silently merge independently created categories.
        if new in tax:
            raise TaxonomyError("categoria de destino já existe")
    if kind == "rename-subcategory":
        old, new = op["subcategory"], op["newSubcategory"]
        if old not in tax[cat]:
            raise TaxonomyError("subcategoria não existe nesta categoria")
        if old == new:
            raise TaxonomyError("novo nome é igual ao atual")
        # Do not infer an interrupted migration from two ordinary names.  There
        # is no durable marker in this protocol, so a collision requires manual
        # recovery rather than a potentially destructive merge.
        if new in tax[cat]:
            raise TaxonomyError("subcategoria de destino já existe")
    if kind == "delete-subcategory" and op["subcategory"] not in tax[cat]:
        raise TaxonomyError("subcategoria não existe nesta categoria")
    if kind.startswith("delete") and not valid(tax, "Outros", "A revisar"):
        raise TaxonomyError("remoção requer Outros / A revisar na taxonomia")
    if kind == "delete-category" and cat == "Outros":
        raise TaxonomyError("Outros não pode ser removida: é o fallback seguro")
    if kind == "delete-subcategory" and cat == "Outros" and op["subcategory"] == "A revisar":
        raise TaxonomyError("A revisar não pode ser removida: é o fallback seguro")
    return op


def _read_state():
    tax, treatments = load_all()
    return tax, treatments, L.load_ledger(), R.load_rules()


def _matches(op, category, subcategory):
    """Whether a persisted reference is affected by this operation.

    Creation cannot affect existing references.  Explicit kinds avoid the
    misleading shared ``endswith('category')`` suffix of category and
    subcategory operations.
    """
    kind = op["kind"]
    if kind in ("rename-category", "delete-category"):
        return category == op["category"]
    if kind in ("rename-subcategory", "delete-subcategory"):
        return category == op["category"] and subcategory == op["subcategory"]
    return False


def _impact(op, ledger, rules):
    normal = rules_count = split_transactions = split_parts = 0
    for rec in ledger.values():
        splits = rec.get("splits") or []
        if splits:
            hit = 0
            for part in splits:
                if _matches(op, part.get("category"), part.get("subcategory")):
                    split_parts += 1; hit = 1
            split_transactions += hit
        elif _matches(op, rec.get("category"), rec.get("subcategory")):
            normal += 1
    for rule in rules.get("rules", []):
        if _matches(op, rule.get("category"), rule.get("subcategory")):
            rules_count += 1
    return {"normalTransactions": normal, "rules": rules_count,
            "splitTransactions": split_transactions, "splitParts": split_parts}


def _fingerprint(tax, treatments, ledger, rules):
    # Full records make manual changes to a relevant row detectably stale and keep
    # the protocol simple/auditable.  JSON's sorted keys gives deterministic hashes.
    snapshot = {"taxonomy": tax, "treatments": treatments,
                "ledger": ledger, "rules": rules.get("rules", [])}
    payload = json.dumps(snapshot, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


def _replace_top(rec, op, delete=False):
    if not _matches(op, rec.get("category"), rec.get("subcategory")):
        return
    if delete:
        if op["kind"] == "delete-category":
            rec["category"], rec["subcategory"] = None, None
        else:
            rec["subcategory"] = None
        rec["needs_review"], rec["reviewed"] = True, False
        rec["category_source"], rec["rule_id"] = None, None
    elif op["kind"] == "rename-category":
        rec["category"] = op["newCategory"]
    else:
        rec["subcategory"] = op["newSubcategory"]


def _future_state(op, tax, treatments, ledger, rules):
    """Return final state and compatibility taxonomy without mutating input."""
    tax, treatments, ledger, rules = (copy.deepcopy(tax), copy.deepcopy(treatments),
                                      copy.deepcopy(ledger), copy.deepcopy(rules))
    kind = op["kind"]
    compat_tax, compat_treatments = copy.deepcopy(tax), copy.deepcopy(treatments)
    if kind == "create-category":
        tax[op["category"]] = []; treatments[op["category"]] = op["treatment"]
        return tax, treatments, tax, treatments, ledger, rules
    if kind == "create-subcategory":
        tax[op["category"]].append(op["subcategory"])
        return tax, treatments, tax, treatments, ledger, rules
    if kind == "rename-category":
        old, new = op["category"], op["newCategory"]
        # The compatibility bridge keeps the destination valid while Ledger and
        # Rules migrate; ordinary destination collisions were rejected above.
        compat_tax[new] = copy.deepcopy(tax[old]); compat_treatments[new] = treatments[old]
        tax[new] = copy.deepcopy(tax[old]); treatments[new] = treatments[old]
        for rec in ledger.values():
            _replace_top(rec, op)
            for part in rec.get("splits") or []:
                if _matches(op, part.get("category"), part.get("subcategory")):
                    part["category"] = new
        for rule in rules["rules"]:
            if _matches(op, rule.get("category"), rule.get("subcategory")):
                rule["category"] = new
        tax.pop(old); treatments.pop(old, None)
        return tax, treatments, compat_tax, compat_treatments, ledger, rules
    if kind == "rename-subcategory":
        old, new, cat = op["subcategory"], op["newSubcategory"], op["category"]
        if new not in compat_tax[cat]: compat_tax[cat].append(new)
        for rec in ledger.values():
            _replace_top(rec, op)
            for part in rec.get("splits") or []:
                if _matches(op, part.get("category"), part.get("subcategory")):
                    part["subcategory"] = new
        for rule in rules["rules"]:
            if _matches(op, rule.get("category"), rule.get("subcategory")):
                rule["subcategory"] = new
        tax[cat] = list(dict.fromkeys(new if sub == old else sub for sub in tax[cat]))
        return tax, treatments, compat_tax, compat_treatments, ledger, rules
    # delete: write the references first, then the reduced taxonomy.
    for rec in ledger.values():
        if rec.get("splits"):
            _replace_top(rec, op, delete=True)
            # A split's top-level pair is not used for aggregation, but it must
            # remain a valid reference while its affected parts use the fallback.
            if kind == "delete-category" and rec.get("category") is None:
                rec["category"], rec["subcategory"] = "Outros", "A revisar"
            changed = False
            for part in rec["splits"]:
                if _matches(op, part.get("category"), part.get("subcategory")):
                    part["category"], part["subcategory"] = "Outros", "A revisar"
                    changed = True
            if changed:
                rec["needs_review"], rec["reviewed"] = True, False
        else:
            _replace_top(rec, op, delete=True)
    rules["rules"] = [r for r in rules["rules"]
                      if not _matches(op, r.get("category"), r.get("subcategory"))]
    if kind == "delete-category":
        tax.pop(op["category"]); treatments.pop(op["category"], None)
    else:
        tax[op["category"]].remove(op["subcategory"])
    return tax, treatments, compat_tax, compat_treatments, ledger, rules


def _validate_final(tax, ledger, rules):
    for rec in ledger.values():
        # A split may intentionally omit its top-level pair, but if either
        # value is populated it is still a stored Ledger reference and must be
        # coherent.  Validate it before split-specific parts.
        cat, sub = rec.get("category"), rec.get("subcategory")
        if sub and not cat:
            raise TaxonomyError(f"lançamento split {rec.get('id')} tem subcategoria sem categoria")
        if cat and not valid(tax, cat, sub):
            raise TaxonomyError(f"lançamento split {rec.get('id')} tem referência inválida")
        splits = rec.get("splits") or []
        if splits:
            cents = sum(round(float(p.get("amount", 0)) * 100) for p in splits)
            if cents != round(float(L.effective_amount(rec)) * 100):
                raise TaxonomyError(f"split de {rec.get('id')} não soma o valor efetivo")
            for part in splits:
                if not valid(tax, part.get("category"), part.get("subcategory")):
                    raise TaxonomyError(f"split de {rec.get('id')} tem referência inválida")
    for rule in rules.get("rules", []):
        if not valid(tax, rule.get("category"), rule.get("subcategory")):
            raise TaxonomyError(f"regra {rule.get('id')} tem referência inválida")


def preview(operation):
    tax, treatments, ledger, rules = _read_state()
    op = validate_operation(operation, tax, treatments)
    return {"ok": True, "operation": op, "impact": _impact(op, ledger, rules),
            "fingerprint": _fingerprint(tax, treatments, ledger, rules)}


def _write_tax(tax, treatments):
    sheets.write_taxonomy_records([
        {"Category": cat, "Subcategories": ", ".join(subs or []),
         "Treatment": _norm_treatment(treatments.get(cat), cat)}
        for cat, subs in tax.items()])


def apply(operation, fingerprint, confirmed):
    """Apply a previewed intent. Returns structured failures after durable writes."""
    if confirmed is not True:
        raise TaxonomyError("confirme explicitamente a alteração")
    tax, treatments, ledger, rules = _read_state()
    op = validate_operation(operation, tax, treatments)
    actual = _fingerprint(tax, treatments, ledger, rules)
    if not isinstance(fingerprint, str) or fingerprint != actual:
        raise TaxonomyError("a prévia venceu; atualize a prévia antes de confirmar",
                            status=409, kind="stale")
    final_tax, final_treatments, compat_tax, compat_treatments, final_ledger, final_rules = \
        _future_state(op, tax, treatments, ledger, rules)
    _validate_final(final_tax, final_ledger, final_rules)
    writes = []
    if op["kind"] in ("create-category", "create-subcategory"):
        writes = [("taxonomy", lambda: _write_tax(final_tax, final_treatments))]
    elif op["kind"].startswith("rename"):
        writes = [("taxonomy-compatibility", lambda: _write_tax(compat_tax, compat_treatments)),
                  ("ledger-migration", lambda: L.save_ledger(final_ledger)),
                  ("rules-migration", lambda: R.save_rules(final_rules)),
                  ("taxonomy-final", lambda: _write_tax(final_tax, final_treatments))]
    else:
        writes = [("ledger-migration", lambda: L.save_ledger(final_ledger)),
                  ("rules-migration", lambda: R.save_rules(final_rules)),
                  ("taxonomy-final", lambda: _write_tax(final_tax, final_treatments))]
    for phase, writer in writes:
        # A remote request can succeed after its client raises (or a taxonomy
        # resize can already have mutated the sheet).  Rename destinations are
        # deliberately rejected when already present, so this ambiguous state
        # cannot be safely resumed or merged by a second request.
        try:
            writer()
        except Exception as exc:
            return {"ok": False, "persisted": True, "status": 409, "errorKind": "partial",
                    "step": "taxonomy-migration", "phase": phase,
                    "error": (f"Falha ao gravar {phase}: {exc}. A alteração pode ter sido "
                              "parcialmente gravada. Não tente repetir ou renomear novamente; "
                              "recupere a planilha pelo Histórico de versões do Google Sheets.")}
    try:
        from . import report
        report.generate(recs=list(final_ledger.values()), taxonomy=final_tax,
                        treatments=final_treatments)
    except Exception as exc:
        return {"ok": False, "persisted": True, "status": 409, "errorKind": "partial",
                "step": "report-regeneration",
                "error": (f"Taxonomia gravada, mas os relatórios falharam: {exc}. "
                          "Rode 'uv run python -m finance.report'; não repita a mutação.")}
    return {"ok": True, "operation": op, "impact": _impact(op, ledger, rules)}


def _cli_request(path, command):
    raw = json.loads(Path(path).read_text())
    if not isinstance(raw, dict):
        raise TaxonomyError("request inválido")
    expected = {"operation"} if command == "preview" else {"operation", "fingerprint", "confirmed"}
    if set(raw) != expected:
        raise TaxonomyError("envelope inválido")
    return raw


def main():
    parser = argparse.ArgumentParser(description="Prévia e migração segura de taxonomia.")
    parser.add_argument("command", choices=("preview", "apply"))
    parser.add_argument("request")
    args = parser.parse_args()
    request_path = Path(args.request)
    try:
        raw = _cli_request(request_path, args.command)
        # This command is a machine-readable bridge.  Report generation can emit
        # normal operational logs, which belong on stderr rather than beside JSON.
        with redirect_stdout(sys.stderr):
            result = preview(raw["operation"]) if args.command == "preview" else apply(
                raw["operation"], raw["fingerprint"], raw["confirmed"])
        print(json.dumps(result, ensure_ascii=False))
        if not result.get("ok"):
            raise SystemExit(1)
    except TaxonomyError as exc:
        print(json.dumps({"ok": False, "error": str(exc), "status": exc.status,
                          "errorKind": exc.kind}, ensure_ascii=False))
        raise SystemExit(1)
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": False, "error": str(exc), "status": 400,
                          "errorKind": "validation"}, ensure_ascii=False))
        raise SystemExit(1)
    except Exception as exc:
        # Keep the HTTP bridge machine-readable even for an unavailable Sheet.
        print(json.dumps({"ok": False, "error": f"Falha ao acessar a taxonomia: {exc}",
                          "status": 500, "errorKind": "unexpected"}, ensure_ascii=False))
        raise SystemExit(1)
    finally:
        request_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
