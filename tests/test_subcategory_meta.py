from finance import sheets, taxonomy


def test_load_subcategory_meta_filters_invalid_records():
    records = [
        {"Category": "Alimentação", "Subcategory": "Supermercado",
         "Color": "#d7a21e", "Icon": ""},
        {"Category": "Alimentação", "Subcategory": "Restaurante",
         "Color": "", "Icon": "Utensils"},
        {"Category": "Alimentação", "Subcategory": "Inexistente",
         "Color": "#ffffff", "Icon": ""},
        {"Category": "", "Subcategory": "Supermercado",
         "Color": "#ffffff", "Icon": ""},
    ]
    original_read_records = sheets.read_records
    try:
        sheets.read_records = lambda tab: records
        meta = taxonomy.load_subcategory_meta({
            "Alimentação": ["Supermercado", "Restaurante"],
        })
    finally:
        sheets.read_records = original_read_records

    assert meta == {
        "Alimentação": {
            "Supermercado": {"color": "#d7a21e", "icon": None},
            "Restaurante": {"color": None, "icon": "Utensils"},
        },
    }


def test_load_subcategory_meta_accepts_missing_optional_sheet():
    def missing_sheet(tab):
        raise sheets.SheetsError("missing")

    original_read_records = sheets.read_records
    try:
        sheets.read_records = missing_sheet
        assert taxonomy.load_subcategory_meta({}) == {}
    finally:
        sheets.read_records = original_read_records


def test_save_subcategory_meta_flattens_records():
    saved = {}
    original_write_records = sheets.write_records
    try:
        sheets.write_records = lambda tab, records: saved.update(
            {"tab": tab, "records": records})
        taxonomy.save_subcategory_meta({
            "Renda": {
                "Salário": {"color": "#22a447", "icon": None},
            },
        })
    finally:
        sheets.write_records = original_write_records

    assert saved == {
        "tab": "SubcategoryMeta",
        "records": [{
            "Category": "Renda", "Subcategory": "Salário",
            "Color": "#22a447", "Icon": None,
        }],
    }


if __name__ == "__main__":
    for name, function in sorted(globals().items()):
        if name.startswith("test_") and callable(function):
            function()
            print(f"ok  {name}")
