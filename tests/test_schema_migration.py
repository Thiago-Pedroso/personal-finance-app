from finance import sheets


class FakeWorksheet:
    def __init__(self, title, header):
        self.title = title
        self.header = list(header)
        self.col_count = len(header)

    def row_values(self, row):
        return list(self.header) if row == 1 else []

    def resize(self, rows=None, cols=None):
        if cols is not None:
            self.col_count = cols

    def update(self, values, range_name, value_input_option):
        self.header.extend(values[0])


class FakeSheet:
    def __init__(self, worksheets):
        self._worksheets = worksheets

    def worksheets(self):
        return list(self._worksheets)

    def add_worksheet(self, title, rows, cols):
        worksheet = FakeWorksheet(title, [])
        worksheet.col_count = cols
        self._worksheets.append(worksheet)
        return worksheet


def test_schema_migration_adds_missing_fields():
    worksheets = [
        FakeWorksheet(tab, [name for name, _ in schema]
                      if tab != "Ledger"
                      else [name for name, _ in schema][:-1])
        for tab, schema in sheets.SCHEMAS.items()
    ]
    worksheets.append(FakeWorksheet("Config", ["key", "value"]))
    fake_sheet = FakeSheet(worksheets)
    config = {"schema_version": 1}
    sheets.open_sheet = lambda: fake_sheet
    sheets.read_config = lambda key, default=None: config.get(key, default)
    sheets.write_config = lambda key, value: config.__setitem__(key, value)
    sheets.reset_cache = lambda: None

    changes = sheets.ensure_current_schema()

    ledger = next(worksheet for worksheet in worksheets
                  if worksheet.title == "Ledger")
    assert ledger.header == [name for name, _ in sheets.LEDGER_SCHEMA]
    assert changes == ["coluna Ledger.tags", "Config.timezone"]
    assert config["timezone"] == "America/Sao_Paulo"
    assert config["schema_version"] == 3
    assert sheets.ensure_current_schema() == []


if __name__ == "__main__":
    test_schema_migration_adds_missing_fields()
    print("ok  test_schema_migration_adds_missing_fields")
