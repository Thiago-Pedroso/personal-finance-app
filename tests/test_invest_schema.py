"""Coerção tipada e migração das abas de investimento (sem rede)."""

from finance import sheets

INVEST_TABS = ["InvestTrades", "InvestAssets", "InvestAccounts", "InvestPolicy",
               "Quotes", "InvestSnapshots"]


def _roundtrip(schema, rec):
    cells = {name: sheets._val_to_cell(kind, rec.get(name)) for name, kind in schema}
    return {name: sheets._cell_to_val(kind, "" if cells[name] is None else str(cells[name]))
            for name, kind in schema}


def test_invest_tabs_are_registered():
    for tab in INVEST_TABS:
        assert tab in sheets.SCHEMAS


def test_trade_roundtrip_preserves_types():
    trade = {"id": "t1", "date": "2026-04-16", "ticker": "VOO", "side": "BUY",
             "quantity": 2.46963785, "price": 610.5, "fees": None, "currency": "USD",
             "fx_rate": 5.1233, "account": "inter", "note": "", "source": "manual",
             "ledger_id": None, "created_at": "2026-04-16T12:00:00Z"}
    first = _roundtrip(sheets.INVEST_TRADES_SCHEMA, trade)
    assert first == _roundtrip(sheets.INVEST_TRADES_SCHEMA, first)
    assert first["quantity"] == trade["quantity"]
    assert first["fx_rate"] == trade["fx_rate"]
    assert first["fees"] is None
    assert first["ledger_id"] is None


def test_asset_and_policy_roundtrip():
    asset = {"ticker": "BBAS3", "name": "Banco do Brasil", "node": "acoes",
             "account": "xp", "sector": "Banco", "currency": "BRL",
             "quote_symbol": "BVMF:BBAS3", "valuation": "quote", "pluggy_code": "BBAS3",
             "target_pct": 0.06, "lot_size": 1.0, "active": True, "note": None}
    first = _roundtrip(sheets.INVEST_ASSETS_SCHEMA, asset)
    assert first == asset

    node = {"node": "renda_variavel", "name": "Renda Variável", "parent": None,
            "target_pct": 0.8, "in_totals": True, "color": None, "icon": None}
    assert _roundtrip(sheets.INVEST_POLICY_SCHEMA, node) == node


def test_quote_price_tolerates_formula_errors():
    for broken in ("#N/A", "#ERROR!", "#VALUE!", "Loading...", ""):
        assert sheets._cell_to_val("qnum", broken) is None
    assert sheets._cell_to_val("qnum", "3627.35") == 3627.35
    # locale pt-BR não quebra a leitura da cotação
    assert sheets._cell_to_val("qnum", "3.627,35") == 3627.35


def test_migration_creates_missing_invest_tabs():
    from tests.test_schema_migration import FakeSheet, FakeWorksheet

    worksheets = [FakeWorksheet(tab, [name for name, _ in schema])
                  for tab, schema in sheets.SCHEMAS.items() if tab not in INVEST_TABS]
    worksheets.append(FakeWorksheet("Config", ["key", "value"]))
    config = {"schema_version": 4, "timezone": "America/Sao_Paulo"}
    sheets.open_sheet = lambda: FakeSheet(worksheets)
    sheets.read_config = lambda key, default=None: config.get(key, default)
    sheets.write_config = lambda key, value: config.__setitem__(key, value)
    sheets.reset_cache = lambda: None

    changes = sheets.ensure_current_schema()

    assert changes == [f"aba {tab}" for tab in INVEST_TABS]
    created = {w.title: w.header for w in worksheets}
    for tab in INVEST_TABS:
        assert created[tab] == [name for name, _ in sheets.SCHEMAS[tab]]
    assert config["schema_version"] == sheets.SCHEMA_VERSION
