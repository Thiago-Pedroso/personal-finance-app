from finance import iof, sheets

SETTINGS = {"rate": 0.035, "match": ["STREAMING INTL", "SOFTWARE CO"]}


def _rec(rec_id, description, amount, **extra):
    base = {"id": rec_id, "account_id": "card", "account_type": "CREDIT",
            "date": "2026-01-04", "description": description, "signed_amount": amount,
            "amount_override": None, "splits": None, "note": None}
    return {**base, **extra}


def _ledger(*recs):
    return {rec["id"]: rec for rec in recs}


def test_with_iof_rounds_to_cents():
    assert iof.with_iof(-110.0, 0.035) == -113.85
    assert iof.with_iof(-40.0, 0.035) == -41.40
    assert iof.with_iof(-99.9, 0.035) == -103.40


def test_apply_sets_override_and_note():
    ledger = _ledger(_rec("a", "STREAMING INTL SUB", -110.0))
    assert iof.apply(ledger, SETTINGS) == {"a"}
    assert ledger["a"]["amount_override"] == -113.85
    assert ledger["a"]["note"] == "IOF estimado (3,5%)"


def test_match_ignores_case_and_accents():
    ledger = _ledger(_rec("a", "Sóftware Co", -40.0))
    assert iof.apply(ledger, SETTINGS) == {"a"}


def test_skips_unmatched_bank_credit_and_split():
    ledger = _ledger(
        _rec("other", "LOCAL STORE", -50.0),
        _rec("bank", "STREAMING INTL", -50.0, account_type="BANK"),
        _rec("refund", "STREAMING INTL", 50.0),
        _rec("split", "STREAMING INTL", -50.0, splits=[{"amount": -50.0}]),
    )
    assert iof.apply(ledger, SETTINGS) == set()


def test_keeps_manual_override():
    ledger = _ledger(_rec("a", "STREAMING INTL", -110.0, amount_override=-120.0))
    assert iof.apply(ledger, SETTINGS) == set()
    assert ledger["a"]["amount_override"] == -120.0


def test_skips_day_with_provider_iof_line():
    ledger = _ledger(_rec("a", "STREAMING INTL", -110.0),
                     _rec("b", "STREAMING INTL (IOF)", -3.85))
    assert iof.apply(ledger, SETTINGS) == set()


def test_is_idempotent():
    ledger = _ledger(_rec("a", "STREAMING INTL", -110.0))
    iof.apply(ledger, SETTINGS)
    assert iof.apply(ledger, SETTINGS) == set()
    assert ledger["a"]["amount_override"] == -113.85


def test_apply_limited_to_ids():
    ledger = _ledger(_rec("old", "STREAMING INTL", -110.0),
                     _rec("new", "SOFTWARE CO", -40.0, date="2026-02-04"))
    assert iof.apply(ledger, SETTINGS, {"new"}) == {"new"}
    assert ledger["old"]["amount_override"] is None


def test_conflict_when_provider_line_arrives_later():
    ledger = _ledger(_rec("a", "STREAMING INTL", -110.0))
    iof.apply(ledger, SETTINGS)
    ledger["b"] = _rec("b", "STREAMING INTL (IOF)", -3.85)
    assert [(est["id"], line["id"]) for est, line in iof.conflicts(ledger)] == [("a", "b")]


def test_settings_disabled_without_match(monkeypatch):
    monkeypatch.setattr(sheets, "read_config", lambda key, default=None: None)
    assert iof.load_settings() is None
    monkeypatch.setattr(sheets, "read_config", lambda key, default=None: {"rate": 0.035})
    assert iof.load_settings() is None
