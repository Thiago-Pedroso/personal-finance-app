"""Ledger canônico na aba **Ledger** do Google Sheets. Chave = id da Pluggy.

A interface é a mesma de sempre — `load_ledger()` devolve `{id: rec}` e `save_ledger()` grava
o dict inteiro. Só o backend mudou de arquivo JSONL para uma aba do Sheets (1 request por
operação). Todo o resto do pipeline continua igual.
"""

import json
import re
import unicodedata
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from . import sheets
from .config import DEFAULT_TIMEZONE
from .transaction_dates import (
    local_transaction_date,
    normalize_provider_datetime,
    resolve_timezone,
)

# Campos da NOSSA categorização — preservados ao re-sincronizar.
_OURS = ("category", "subcategory", "category_source", "rule_id", "needs_review",
         "reviewed", "splits", "note", "amount_override", "excluded", "tags",
         "settle_with")
MAX_TAG_LENGTH = 80
_TEMPLATE_FIELDS = tuple(name for name, _ in sheets.LEDGER_SCHEMA)


def tag_key(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", " ".join(str(value).split()))
    return "".join(char for char in normalized
                   if not unicodedata.combining(char)).casefold()


def normalize_tags(values) -> list[str]:
    if not isinstance(values, list):
        return []
    tags = []
    seen = set()
    for value in values:
        if not isinstance(value, str):
            continue
        tag = " ".join(value.split())
        key = tag_key(tag)
        if tag and len(tag) <= MAX_TAG_LENGTH and key not in seen:
            tags.append(tag)
            seen.add(key)
    return sorted(tags, key=tag_key)


def update_tags(existing, additions=None, removals=None) -> list[str]:
    normalized_removals = normalize_tags(removals)
    removal_keys = {tag_key(value) for value in normalized_removals}
    retained = [tag for tag in normalize_tags(existing)
                if tag_key(tag) not in removal_keys]
    return normalize_tags(retained + normalize_tags(additions))


def snapshot(rec: dict) -> str:
    """String estável dos campos que a categorização pode alterar. Serve pra
    detectar quais linhas de fato mudaram e gravar só elas (o reapply toca em
    muitos registros por igual sem alterar valor)."""
    return json.dumps({k: rec.get(k) for k in _OURS},
                      ensure_ascii=False, sort_keys=True)


def effective_amount(rec: dict) -> float:
    """Valor a usar nos relatórios/splits: o override manual (ex.: compra em
    dólar que a Pluggy registrou errado) quando definido; senão o signed_amount."""
    ov = rec.get("amount_override")
    return ov if ov is not None else rec["signed_amount"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def signed_amount(amount: float, tx_type: str | None) -> float:
    """Sinal normalizado: despesa < 0, receita > 0, igual p/ conta e cartão."""
    if tx_type == "DEBIT":
        return -abs(amount)
    if tx_type == "CREDIT":
        return abs(amount)
    return amount  # fallback: confia no sinal da Pluggy (convenção de conta)


def normalize(tx, account, item_id, local_timezone: ZoneInfo | None = None) -> dict:
    local_timezone = local_timezone or resolve_timezone(DEFAULT_TIMEZONE)
    dt = normalize_provider_datetime(tx.var_date)
    cc = tx.credit_card_metadata
    installment = None
    if cc and cc.installment_number and cc.total_installments:
        installment = f"{int(cc.installment_number)}/{int(cc.total_installments)}"
    m = tx.merchant
    pd = tx.payment_data
    counterparty = None
    if pd:
        part = pd.payer if tx.type == "CREDIT" else pd.receiver
        counterparty = getattr(part, "name", None) if part else None
    counterparty = counterparty or (m.name if m else None)
    return {
        "id": tx.id,
        "item_id": str(item_id),
        "account_id": str(account.id),
        "account_name": account.marketing_name or account.name,
        "account_type": account.type,
        "date": local_transaction_date(dt, local_timezone),
        "datetime": dt.isoformat(),
        "description": (tx.description or "").strip(),
        "amount": tx.amount,
        "signed_amount": round(signed_amount(tx.amount, tx.type), 2),
        "currency": tx.currency_code,
        "type": tx.type,
        "status": tx.status,
        "pluggy_category": tx.category,
        "pluggy_category_id": tx.category_id,
        "merchant_name": m.name if m else None,
        "counterparty": counterparty,
        "merchant_cnpj": m.cnpj if m else None,
        "mcc": cc.payee_mcc if cc else None,
        "payment_method": tx.payment_data.payment_method if tx.payment_data else None,
        "installment": installment,
        "category": None,
        "subcategory": None,
        "category_source": None,  # "rule" | "ai" | "manual" | "split"
        "rule_id": None,
        "needs_review": False,
        "reviewed": False,
        # divisão do lançamento em partes (ex.: parte sua + parte adiantada p/
        # outra pessoa → Compartilhado). None = lançamento simples.
        # [{amount, category, subcategory, note}], soma = signed_amount.
        "splits": None,
        # nota livre do usuário (contexto p/ o Claude; aparece no hover do front).
        "note": None,
        # valor efetivo manual (sobrepõe signed_amount em relatórios/splits;
        # ex.: compra em dólar que a Pluggy gravou no valor errado). None = usa
        # signed_amount. Preservado no re-sync (está em _OURS).
        "amount_override": None,
        # "rasurado": sai de TODOS os agregados/relatórios, mas continua no ledger
        # (visível riscado na lista). Reversível. Preservado no re-sync (_OURS).
        "excluded": False,
        "synced_at": _now_iso(),
        "tags": [],
        # com quem esse valor vai ser acertado (pessoa ou instituição). None = ninguém.
        "settle_with": None,
    }


def load_ledger() -> dict:
    records = sheets.read_records("Ledger")
    for record in records:
        record["tags"] = normalize_tags(record.get("tags"))
    return {record["id"]: record for record in records}


def save_ledger(records: dict, changed_ids: set | None = None) -> None:
    """Grava o ledger. Com `changed_ids` (conjunto de ids alterados) manda só
    essas linhas pro Sheets (batch enxuto); sem ele, reescreve a aba inteira."""
    rows = sorted(records.values(), key=lambda r: (r["date"], r["id"]))
    if changed_ids is None:
        sheets.write_records("Ledger", rows)
    else:
        sheets.update_changed_rows("Ledger", rows, changed_ids)


def _statement_key(account_id, date, amount, description) -> tuple:
    text = " ".join(str(description or "").upper().split())
    return (account_id, str(date), round(float(amount), 2), text)


def duplicate_of(existing: dict, row: dict) -> str | None:
    """Id do lançamento que já registra a mesma linha de extrato, se houver."""
    wanted = _statement_key(row["account_id"], row["date"], row["amount"],
                            row["description"])
    for rec in existing.values():
        if _statement_key(rec.get("account_id"), rec.get("date"),
                          rec.get("signed_amount") or 0.0,
                          rec.get("description")) == wanted:
            return rec["id"]
    return None


def manual_record(row: dict, existing: dict) -> dict:
    """Lançamento vindo de extrato, com os dados da conta copiados de outro já sincronizado."""
    account = next((rec for rec in existing.values()
                    if rec.get("account_id") == row["account_id"]), {})
    amount = float(row["amount"])
    slug = re.sub(r"[^a-z0-9]+", "-", str(row["description"]).lower()).strip("-")[:28]
    base = row.get("id") or f"manual-{str(row['date']).replace('-', '')}-{slug}"
    record_id, suffix = base, 2
    while record_id in existing:
        record_id, suffix = f"{base}-{suffix}", suffix + 1
    category = row.get("category") or None
    return {**{name: None for name in _TEMPLATE_FIELDS},
            "id": record_id, "item_id": row.get("item_id") or account.get("item_id"),
            "account_id": row["account_id"],
            "account_name": row.get("account_name") or account.get("account_name"),
            "account_type": account.get("account_type") or "BANK",
            "date": row["date"], "datetime": f"{row['date']}T03:00:00+00:00",
            "description": row["description"], "amount": abs(amount),
            "signed_amount": amount, "currency": row.get("currency") or "BRL",
            "type": "CREDIT" if amount > 0 else "DEBIT", "status": "POSTED",
            "category": category, "subcategory": row.get("subcategory") or None,
            "category_source": "manual" if category else None,
            "needs_review": not category, "reviewed": bool(category),
            "note": row.get("note") or None, "excluded": False,
            "synced_at": _now_iso(), "tags": []}


def upsert(existing: dict, incoming: list) -> tuple[int, int]:
    """Insere novas e atualiza campos da Pluggy, preservando nossa categorização."""
    added = updated = 0
    for rec in incoming:
        cur = existing.get(rec["id"])
        if cur is None:
            existing[rec["id"]] = rec
            added += 1
        else:
            merged = {**cur, **rec}
            for k in _OURS:
                merged[k] = cur.get(k, rec[k])
            merged["synced_at"] = rec["synced_at"]
            existing[rec["id"]] = merged
            updated += 1
    return added, updated
