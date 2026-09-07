"""Ponte fina para o Sheets: mantém os módulos de investimento testáveis sem rede."""

from .. import sheets


def read(tab: str) -> list[dict]:
    return sheets.read_records(tab)


def write(tab: str, records: list[dict]) -> None:
    sheets.write_records(tab, records)


def append(tab: str, records: list[dict]) -> int:
    return sheets.append_rows(tab, records)
