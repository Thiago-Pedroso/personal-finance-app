from collections import Counter
from datetime import datetime, timezone
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from . import sheets
from .config import DEFAULT_TIMEZONE


class TimezoneConfigError(ValueError):
    pass


def resolve_timezone(timezone_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as error:
        raise TimezoneConfigError(
            f"Fuso inválido em Config[timezone]: {timezone_name!r}. "
            "Use um identificador IANA, por exemplo America/Sao_Paulo."
        ) from error


def load_timezone() -> ZoneInfo:
    timezone_name = sheets.read_config("timezone", DEFAULT_TIMEZONE) or DEFAULT_TIMEZONE
    if not isinstance(timezone_name, str):
        raise TimezoneConfigError(
            "Config[timezone] deve ser um identificador IANA em texto."
        )
    return resolve_timezone(timezone_name)


def normalize_provider_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("O datetime da Pluggy precisa conter fuso horário.")
    return value.astimezone(timezone.utc)


def local_transaction_date(value: datetime, local_timezone: ZoneInfo) -> str:
    utc_value = normalize_provider_datetime(value)
    return utc_value.astimezone(local_timezone).date().isoformat()


def local_transaction_time(value: datetime, local_timezone: ZoneInfo) -> str:
    utc_value = normalize_provider_datetime(value)
    return utc_value.astimezone(local_timezone).strftime("%H:%M")


def parse_provider_datetime(value: str) -> datetime:
    parsed_value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return normalize_provider_datetime(parsed_value)


def is_pluggy_transaction(record: dict) -> bool:
    if not record.get("item_id") or not record.get("account_id"):
        return False
    try:
        UUID(str(record.get("id")))
    except (TypeError, ValueError, AttributeError):
        return False
    return True


def date_migration_preview(
    records: dict, local_timezone: ZoneInfo
) -> tuple[dict, Counter, int]:
    changed_dates = {}
    transitions = Counter()
    skipped_count = 0
    for transaction_id, record in records.items():
        if not is_pluggy_transaction(record):
            continue
        datetime_value = record.get("datetime")
        if not datetime_value:
            skipped_count += 1
            continue
        try:
            expected_date = local_transaction_date(
                parse_provider_datetime(datetime_value), local_timezone
            )
        except (TypeError, ValueError):
            skipped_count += 1
            continue
        current_date = record.get("date")
        if current_date != expected_date:
            changed_dates[transaction_id] = expected_date
            transitions[(current_date, expected_date)] += 1
    return changed_dates, transitions, skipped_count
