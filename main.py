"""Verificação rápida de conectividade e estado do ledger.

Uso: uv run python main.py
Para o fluxo real use as skills / módulos: finance.sync, finance.categorize, finance.report
"""

from finance import ledger as L
from finance import pluggy_client as pc


def main() -> None:
    items = pc.item_ids()
    print(f"ITEM_IDS configurados: {len(items)}")
    print("Autenticando na Pluggy...")
    api_key = pc.get_api_key()
    print("OK.\n")

    with pc.build_client(api_key) as client:
        for item_id in items:
            print(f"=== Item {item_id} ===")
            for acc in pc.list_accounts(client, item_id):
                name = acc.marketing_name or acc.name
                print(f"  {name} [{acc.type}/{acc.subtype}] saldo R$ {acc.balance:.2f}")

    led = L.load_ledger()
    if led:
        uncat = sum(1 for r in led.values() if not r["category"])
        dates = sorted(r["date"] for r in led.values())
        print(f"\nLedger: {len(led)} transações ({dates[0]} → {dates[-1]}), "
              f"{uncat} sem categoria.")
    else:
        print("\nLedger vazio. Rode: uv run python -m finance.sync --backfill")


if __name__ == "__main__":
    main()
