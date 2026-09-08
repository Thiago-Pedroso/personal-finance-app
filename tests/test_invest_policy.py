"""Árvore de alocação: pesos em cascata, exclusão do total e validação."""

from finance.invest import policy as P

TEMPLATE = [
    {"node": "rf", "name": "Renda Fixa", "parent": "", "target_pct": 0.2,
     "in_totals": True},
    {"node": "rv", "name": "Renda Variável", "parent": "", "target_pct": 0.8,
     "in_totals": True},
    {"node": "br", "name": "Brasil", "parent": "rv", "target_pct": 0.6,
     "in_totals": True},
    {"node": "us", "name": "EUA", "parent": "rv", "target_pct": 0.4,
     "in_totals": True},
    {"node": "acoes", "name": "Ações", "parent": "br", "target_pct": 0.7,
     "in_totals": True},
    {"node": "fiis", "name": "FIIs", "parent": "br", "target_pct": 0.3,
     "in_totals": True},
    {"node": "stocks", "name": "Stocks", "parent": "us", "target_pct": 0.7,
     "in_totals": True},
    {"node": "reits", "name": "REITs", "parent": "us", "target_pct": 0.3,
     "in_totals": True},
    {"node": "cripto", "name": "Cripto", "parent": "", "target_pct": 0.0,
     "in_totals": False},
]


def test_cascade_matches_the_spreadsheet():
    weights = P.leaf_weights(P.load(TEMPLATE))
    assert round(weights["rf"], 4) == 0.2
    assert round(weights["acoes"], 4) == 0.336
    assert round(weights["fiis"], 4) == 0.144
    assert round(weights["stocks"], 4) == 0.224
    assert round(weights["reits"], 4) == 0.096
    assert round(sum(weights.values()), 6) == 1.0


def test_node_out_of_totals_gets_no_weight():
    tree = P.load(TEMPLATE)
    assert "cripto" not in P.leaf_weights(tree)
    assert P.weight(tree, "cripto") == 0.0
    assert P.counts(tree, "cripto") is False


def test_children_inherit_exclusion_from_the_parent():
    rows = TEMPLATE + [{"node": "btc", "name": "Bitcoin", "parent": "cripto",
                        "target_pct": 1.0, "in_totals": True}]
    tree = P.load(rows)
    assert P.counts(tree, "btc") is False
    assert "btc" not in P.leaf_weights(tree)


def test_template_has_no_problems():
    assert P.validate(P.load(TEMPLATE)) == []


def test_validate_reports_orphan_cycle_and_bad_sum():
    orphan = P.load([{"node": "a", "name": "A", "parent": "sumiu",
                      "target_pct": 1.0, "in_totals": True}])
    assert "não existe" in P.validate(orphan)[0]

    cycle = P.load([
        {"node": "a", "name": "A", "parent": "b", "target_pct": 1.0, "in_totals": True},
        {"node": "b", "name": "B", "parent": "a", "target_pct": 1.0, "in_totals": True},
    ])
    assert any("ciclo" in problem for problem in P.validate(cycle))

    wrong = P.load([
        {"node": "a", "name": "A", "parent": "", "target_pct": 0.5, "in_totals": True},
        {"node": "b", "name": "B", "parent": "", "target_pct": 0.3, "in_totals": True},
    ])
    assert "80.0%" in P.validate(wrong)[0]


def test_any_shape_of_policy_works():
    """Sem país, e com três países: a árvore aceita as duas sem caso especial."""
    global_only = P.load([
        {"node": "rf", "name": "Renda Fixa", "parent": "", "target_pct": 0.3,
         "in_totals": True},
        {"node": "global", "name": "Global", "parent": "", "target_pct": 0.7,
         "in_totals": True},
    ])
    assert P.leaf_weights(global_only) == {"rf": 0.3, "global": 0.7}
    assert P.validate(global_only) == []

    three = P.load([
        {"node": "rv", "name": "Renda Variável", "parent": "", "target_pct": 1.0,
         "in_totals": True},
        {"node": "br", "name": "Brasil", "parent": "rv", "target_pct": 0.5,
         "in_totals": True},
        {"node": "us", "name": "EUA", "parent": "rv", "target_pct": 0.3,
         "in_totals": True},
        {"node": "nl", "name": "Holanda", "parent": "rv", "target_pct": 0.2,
         "in_totals": True},
    ])
    assert P.validate(three) == []
    assert round(P.leaf_weights(three)["nl"], 4) == 0.2


def test_order_puts_children_under_the_parent():
    ordered = P.order(P.load(TEMPLATE))
    assert ordered.index("br") > ordered.index("rv")
    assert ordered.index("acoes") > ordered.index("br")
    assert set(ordered) == {row["node"] for row in TEMPLATE}


def test_role_defaults_to_strategy_and_groups_the_tree():
    tree = P.load(TEMPLATE + [
        {"node": "reservas", "name": "Reservas", "parent": "", "target_pct": 0.0,
         "in_totals": False, "role": "reserved"},
        {"node": "livre", "name": "Livre", "parent": "", "target_pct": 0.0,
         "in_totals": False, "role": "free"},
        {"node": "a_aportar", "name": "Esperando aporte", "parent": "",
         "target_pct": 0.0, "in_totals": False, "role": "to_invest"},
    ])
    assert tree["acoes"]["role"] == "strategy"      # sem coluna preenchida
    grouped = P.by_role(tree)
    assert grouped["reserved"] == ["reservas"]
    assert grouped["free"] == ["livre"]
    assert grouped["to_invest"] == ["a_aportar"]
    assert "acoes" in grouped["strategy"]


def test_unknown_role_falls_back_to_strategy():
    tree = P.load([{"node": "x", "name": "X", "parent": "", "target_pct": 1.0,
                    "in_totals": True, "role": "sei la"}])
    assert tree["x"]["role"] == "strategy"


def test_nodes_outside_the_strategy_do_not_have_to_add_up():
    """Reserva e saldo livre não são alvo: cobrar 100% deles seria ruído."""
    tree = P.load(TEMPLATE + [
        {"node": "reservas", "name": "Reservas", "parent": "", "target_pct": 0.0,
         "in_totals": False, "role": "reserved"},
        {"node": "livre", "name": "Livre", "parent": "", "target_pct": 0.0,
         "in_totals": False, "role": "free"},
    ])
    assert P.validate(tree) == []
