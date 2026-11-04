import argparse

from . import ledger as L
from . import people as P
from . import sheets
from .transaction_dates import date_migration_preview, load_timezone


def main() -> None:
    parser = argparse.ArgumentParser(description="Atualiza schema e datas da Pluggy.")
    parser.add_argument("--dry-run", action="store_true",
                        help="mostra as mudanças de data sem gravar")
    parser.add_argument("--person-tags", default="",
                        help="tags que são nomes de pessoa, separadas por vírgula: viram o "
                             "campo person (beneficiário) e saem das tags. Ex.: "
                             "--person-tags \"Ana,Pedro\"")
    args = parser.parse_args()

    schema_changes = [] if args.dry_run else sheets.ensure_current_schema()
    if schema_changes:
        print("Schema atualizado: " + ", ".join(schema_changes))
    elif not args.dry_run:
        print("Schema já está atualizado.")

    local_timezone = load_timezone()
    ledger = L.load_ledger()
    changed_dates, transitions, skipped_count = date_migration_preview(
        ledger, local_timezone
    )
    action = "seriam atualizadas" if args.dry_run else "atualizadas"
    print(f"Datas da Pluggy {action}: {len(changed_dates)}")
    for (current_date, expected_date), count in sorted(transitions.items()):
        print(f"  {current_date} -> {expected_date}: {count}")
    if skipped_count:
        print(f"Registros da Pluggy sem datetime válido, preservados: {skipped_count}")

    names = [n for n in args.person_tags.split(",") if n.strip()]
    moved = P.move_tags_to_person(ledger, names) if names else []
    if names:
        action = "seriam movidas" if args.dry_run else "movidas"
        print(f"Tags de pessoa {action} para o campo person: {len(moved)} lançamento(s)")

    if args.dry_run or not (changed_dates or moved):
        return
    for transaction_id, expected_date in changed_dates.items():
        ledger[transaction_id]["date"] = expected_date
    L.save_ledger(ledger)


if __name__ == "__main__":
    main()
