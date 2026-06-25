"""Ledger canônico em JSONL (1 transação por linha). Chave = id da Pluggy."""

import json
from datetime import datetime, timezone

from .config import LEDGER_FILE

# Campos da NOSSA categorização — preservados ao re-sincronizar.
_OURS = ("category", "subcategory", "category_source", "rule_id", "needs_review",
         "reviewed", "splits", "note", "amount_override")


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


def normalize(tx, account, item_id) -> dict:
    dt = tx.var_date
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
        "date": dt.date().isoformat(),
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
        "synced_at": _now_iso(),
    }


def load_ledger() -> dict:
    records: dict = {}
    if LEDGER_FILE.exists():
        for line in LEDGER_FILE.read_text().splitlines():
            line = line.strip()
            if line:
                rec = json.loads(line)
                records[rec["id"]] = rec
    return records


def save_ledger(records: dict) -> None:
    rows = sorted(records.values(), key=lambda r: (r["date"], r["id"]))
    LEDGER_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LEDGER_FILE.open("w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


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
