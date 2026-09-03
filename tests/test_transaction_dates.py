from datetime import datetime, timezone
from types import SimpleNamespace

from finance import ledger
from finance.transaction_dates import date_migration_preview, resolve_timezone


LOCAL_TIMEZONE = resolve_timezone("America/Sao_Paulo")


def transaction_stub(transaction_id="dc498e2a-476e-4a9a-8ab0-fe378585eab0"):
    return SimpleNamespace(
        id=transaction_id,
        var_date=datetime(2026, 8, 6, 0, 18, 12, tzinfo=timezone.utc),
        credit_card_metadata=None,
        merchant=None,
        payment_data=None,
        type="DEBIT",
        description="PIX ENVIADO PEDRO FERNANDES LTDA COM SALDO",
        amount=-600.0,
        currency_code="BRL",
        status="POSTED",
        category="Digital services",
        category_id="09000000",
    )


def account_stub():
    return SimpleNamespace(
        id="5604f558-bfae-4543-969c-ec5d5e1ea0f2",
        marketing_name="PicPay",
        name="PicPay",
        type="BANK",
    )


def test_normalize_uses_configured_timezone():
    record = ledger.normalize(transaction_stub(), account_stub(), "item-id", LOCAL_TIMEZONE)

    assert record["date"] == "2026-08-05"
    assert record["datetime"] == "2026-08-06T00:18:12+00:00"


def test_date_migration_changes_only_pluggy_records():
    pluggy_id = "dc498e2a-476e-4a9a-8ab0-fe378585eab0"
    records = {
        pluggy_id: {
            "id": pluggy_id,
            "item_id": "item-id",
            "account_id": "account-id",
            "date": "2026-08-06",
            "datetime": "2026-08-06T00:18:12.472000+00:00",
        },
        "manual-1": {
            "id": "manual-1",
            "item_id": "item-id",
            "account_id": "account-id",
            "date": "2026-08-06",
            "datetime": "2026-08-06T00:18:12.472000+00:00",
        },
    }

    changed_dates, transitions, skipped_count = date_migration_preview(
        records, LOCAL_TIMEZONE
    )

    assert changed_dates == {pluggy_id: "2026-08-05"}
    assert transitions == {("2026-08-06", "2026-08-05"): 1}
    assert skipped_count == 0


if __name__ == "__main__":
    test_normalize_uses_configured_timezone()
    test_date_migration_changes_only_pluggy_records()
    print("ok  test_normalize_uses_configured_timezone")
    print("ok  test_date_migration_changes_only_pluggy_records")
