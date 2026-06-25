"""Sincroniza transações da Pluggy para o ledger.

Uso:
  uv run python -m finance.sync               # incremental (só o novo desde o último sync)
  uv run python -m finance.sync --backfill    # histórico completo (~12 meses) — 1ª vez
  uv run python -m finance.sync --days 90      # backfill de janela customizada
"""

import argparse
import json
from datetime import datetime, timedelta, timezone

from . import ledger as L
from . import pluggy_client as pc
from .config import BACKFILL_DAYS, SYNC_STATE_FILE, ensure_dirs


def _load_state() -> dict:
    if SYNC_STATE_FILE.exists():
        return json.loads(SYNC_STATE_FILE.read_text())
    return {}


def _save_state(state: dict) -> None:
    SYNC_STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser(description="Sincroniza transações da Pluggy.")
    ap.add_argument("--backfill", action="store_true", help="Puxa histórico completo (~12 meses).")
    ap.add_argument("--days", type=int, default=BACKFILL_DAYS, help="Janela de backfill (máx ~365).")
    args = ap.parse_args()

    ensure_dirs()
    items = pc.item_ids()
    if not items:
        raise SystemExit("ITEM_IDS vazio no .env. Adicione o(s) ID(s) do(s) item(ns).")

    print("Autenticando na Pluggy...")
    api_key = pc.get_api_key()
    state = _load_state()
    ledger = L.load_ledger()
    run_started = datetime.now(timezone.utc)

    total_added = total_updated = 0
    with pc.build_client(api_key) as client:
        for item_id in items:
            print(f"=== Item {item_id} ===")
            for acc in pc.list_accounts(client, item_id):
                acc_id = str(acc.id)
                name = acc.marketing_name or acc.name
                st = state.get(acc_id)
                if args.backfill or st is None:
                    var_from = datetime.now(timezone.utc) - timedelta(days=args.days)
                    created_at_from = None
                    mode = f"backfill {args.days}d"
                else:
                    last = datetime.fromisoformat(st["last_synced_at"])
                    created_at_from = last - timedelta(days=2)  # overlap; upsert deduplica
                    var_from = None
                    mode = f"incremental desde {created_at_from.date()}"

                txs = pc.fetch_transactions(
                    client, acc_id, var_from=var_from, created_at_from=created_at_from
                )
                recs = [L.normalize(t, acc, item_id) for t in txs]
                a, u = L.upsert(ledger, recs)
                total_added += a
                total_updated += u
                print(f"  {name} [{acc.type}] ({mode}): "
                      f"{len(txs)} recebidas, +{a} novas, ~{u} atualizadas")
                state[acc_id] = {
                    "account_name": name,
                    "item_id": str(item_id),
                    "last_synced_at": run_started.isoformat(),
                }

    L.save_ledger(ledger)
    _save_state(state)
    print(f"\nLedger: {len(ledger)} transações (+{total_added} novas, ~{total_updated} atualizadas).")
    uncat = sum(1 for r in ledger.values() if not r["category"])
    if uncat:
        print(f"{uncat} sem categoria → rode a skill finance-categorize.")


if __name__ == "__main__":
    main()
