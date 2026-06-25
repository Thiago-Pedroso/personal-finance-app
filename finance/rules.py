"""Motor de regras determinísticas de categorização (data/rules.json).

Primeira regra que casa vence (ordem da lista = prioridade).
Match em descrição/lojista é case- e acento-insensível.
"""

import json
import re
import unicodedata
from datetime import datetime, timezone

from .config import RULES_FILE

_TEXT_FIELDS = ("description", "merchant_name", "counterparty")


def norm(s: str | None) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", str(s))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.upper().split())


def load_rules() -> dict:
    if RULES_FILE.exists():
        return json.loads(RULES_FILE.read_text())
    return {"version": 1, "rules": []}


def save_rules(data: dict) -> None:
    RULES_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def _key(field: str, value: str) -> str:
    return norm(value) if field in _TEXT_FIELDS else str(value).strip().upper()


def rule_matches(rule: dict, rec: dict) -> bool:
    rtype = rule.get("type")  # opcional: só casa nesse tipo (DEBIT/CREDIT)
    if rtype and rec.get("type") != rtype:
        return False
    # opcional: faixa de valor absoluto (|signed_amount|). min inclusivo, max exclusivo.
    amin, amax = rule.get("amount_abs_min"), rule.get("amount_abs_max")
    if amin is not None or amax is not None:
        amt = abs(rec.get("signed_amount") or 0)
        if amin is not None and amt < amin:
            return False
        if amax is not None and amt >= amax:
            return False
    val = rec.get(rule["field"])
    if val is None:
        return False
    field, m, target = rule["field"], rule.get("match", "contains"), rule["value"]
    if field in _TEXT_FIELDS:
        v, t = norm(val), norm(target)
    else:
        v, t = str(val).strip().upper(), str(target).strip().upper()
    if m == "contains":
        return t in v
    if m == "exact":
        return v == t
    if m == "startswith":
        return v.startswith(t)
    if m == "regex":
        try:
            return re.search(target, str(val), re.IGNORECASE) is not None
        except re.error:
            return False
    return False


def first_match(rec: dict, rules: list) -> dict | None:
    for r in rules:
        if rule_matches(r, rec):
            return r
    return None


def _next_id(rules: list) -> str:
    n = 0
    for r in rules:
        try:
            n = max(n, int(r["id"].split("_")[1]))
        except (KeyError, ValueError, IndexError):
            pass
    return f"r_{n + 1:04d}"


def add_rule(data: dict, field: str, match: str, value: str,
             category: str, subcategory: str | None, note: str = "",
             txn_type: str | None = None,
             amount_abs_min: float | None = None,
             amount_abs_max: float | None = None) -> dict:
    """Adiciona uma regra (idempotente por field+match+valor norm.+tipo+faixa)."""
    k = (field, match, _key(field, value), txn_type,
         amount_abs_min, amount_abs_max)
    for r in data["rules"]:
        if (r["field"], r.get("match", "contains"),
                _key(r["field"], r["value"]), r.get("type"),
                r.get("amount_abs_min"), r.get("amount_abs_max")) == k:
            return r  # já existe
    rule = {
        "id": _next_id(data["rules"]),
        "field": field,
        "match": match,
        "value": value,
        "category": category,
        "subcategory": subcategory,
        "note": note,
        "created_at": datetime.now(timezone.utc).date().isoformat(),
    }
    if txn_type:
        rule["type"] = txn_type
    if amount_abs_min is not None:
        rule["amount_abs_min"] = amount_abs_min
    if amount_abs_max is not None:
        rule["amount_abs_max"] = amount_abs_max
    data["rules"].append(rule)
    return rule
