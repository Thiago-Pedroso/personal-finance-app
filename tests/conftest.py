import pytest

from finance import sheets

_PATCHABLE = ("read_records", "write_records", "read_config", "write_config",
              "update_changed_rows", "ensure_tabs", "ensure_current_schema",
              "check", "open_sheet", "reset_cache")
_REAL = {name: getattr(sheets, name) for name in _PATCHABLE}


@pytest.fixture(autouse=True)
def restore_sheets_backend():
    """Devolve o backend real do Sheets antes de cada teste. O pytest importa
    todos os arquivos antes de rodar, então um patch de módulo vaza nos outros."""
    for name, real in _REAL.items():
        setattr(sheets, name, real)
