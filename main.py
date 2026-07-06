"""Verificação rápida de conectividade (Google Sheets + Pluggy) e estado do ledger.

Uso: uv run python main.py
Para o fluxo real use as skills / módulos: finance.sync, finance.categorize, finance.report
"""

from finance import ledger as L
from finance import pluggy_client as pc
from finance import sheets


def main() -> None:
    # ---- Google Sheets (banco de dados) ----
    print("Conectando ao Google Sheets...")
    try:
        info = sheets.check()
        print(f"OK — planilha '{info['title']}'")
        print(f"  abas: {', '.join(info['tabs'])}")
        print(f"  {info['url']}\n")
    except sheets.SheetsError as e:
        print(f"FALHA no Google Sheets:\n  {e}\n")
        return

    # ---- Pluggy (Open Finance) ----
    items = pc.item_ids()
    print(f"ITEM_IDS configurados: {len(items)}")
    if items:
        print("Autenticando na Pluggy...")
        api_key = pc.get_api_key()
        print("OK.\n")
        with pc.build_client(api_key) as client:
            for item_id in items:
                print(f"=== Item {item_id} ===")
                for acc in pc.list_accounts(client, item_id):
                    name = acc.marketing_name or acc.name
                    print(f"  {name} [{acc.type}/{acc.subtype}] saldo R$ {acc.balance:.2f}")
    else:
        print("(sem ITEM_IDS — conecte contas na Pluggy p/ sincronizar dados reais)\n")

    led = L.load_ledger()
    if led:
        uncat = sum(1 for r in led.values() if not r["category"])
        dates = sorted(r["date"] for r in led.values())
        print(f"\nLedger: {len(led)} transações ({dates[0]} → {dates[-1]}), "
              f"{uncat} sem categoria.")
    else:
        print("\nLedger vazio. Rode o seed (uv run python -m finance.seed) "
              "ou sincronize: uv run python -m finance.sync --backfill")


if __name__ == "__main__":
    main()
