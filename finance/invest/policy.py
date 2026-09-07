"""Política de alocação como árvore (aba **InvestPolicy** do Google Sheets).

Cada linha é um nó: `node` é o id estável, `name` o rótulo editável e `target_pct` a fatia
que o nó ocupa **dentro do pai**. O alvo de uma folha é o produto do caminho até a raiz,
que é a cascata da planilha antiga sem nomes de classe presos em fórmula.
"""

from . import sheets_io as io

TAB = "InvestPolicy"
TOLERANCE = 0.005


def load(records=None) -> dict:
    """Devolve {node: {name, parent, target_pct, in_totals, color, icon}}."""
    rows = records if records is not None else io.read(TAB)
    tree = {}
    for row in rows:
        node = (row.get("node") or "").strip()
        if not node:
            continue
        parent = (row.get("parent") or "").strip() or None
        tree[node] = {
            "node": node,
            "name": (row.get("name") or node).strip(),
            "parent": parent,
            "target_pct": float(row.get("target_pct") or 0.0),
            "in_totals": bool(row.get("in_totals")),
            "color": row.get("color"),
            "icon": row.get("icon"),
        }
    return tree


def save(tree: dict) -> None:
    io.write(TAB, [tree[node] for node in order(tree)])


def order(tree: dict) -> list[str]:
    """Nós em ordem de leitura: raízes primeiro, filhos logo abaixo do pai."""
    out = []

    def walk(parent):
        for node in sorted(children(tree, parent), key=lambda n: tree[n]["name"]):
            out.append(node)
            walk(node)

    walk(None)
    out.extend(node for node in tree if node not in out)  # órfãos não somem
    return out


def children(tree: dict, node: str | None) -> list[str]:
    return [key for key, value in tree.items() if value["parent"] == node]


def is_leaf(tree: dict, node: str) -> bool:
    return not children(tree, node)


def leaves(tree: dict) -> list[str]:
    return [node for node in tree if is_leaf(tree, node)]


def path(tree: dict, node: str) -> list[str]:
    """Caminho da raiz até o nó. Interrompe em ciclo ou pai inexistente."""
    chain, seen = [], set()
    while node and node in tree and node not in seen:
        seen.add(node)
        chain.append(node)
        node = tree[node]["parent"]
    chain.reverse()
    return chain


def counts(tree: dict, node: str) -> bool:
    """Um nó entra na conta se ele e todos os ancestrais entram."""
    return all(tree[step]["in_totals"] for step in path(tree, node))


def weight(tree: dict, node: str) -> float:
    """Fatia do nó no patrimônio elegível: produto do caminho até a raiz."""
    if not counts(tree, node):
        return 0.0
    total = 1.0
    for step in path(tree, node):
        total *= tree[step]["target_pct"]
    return total


def leaf_weights(tree: dict) -> dict:
    """{folha: peso} para as folhas que contam. É o alvo de cada classe."""
    return {node: weight(tree, node) for node in leaves(tree) if counts(tree, node)}


def validate(tree: dict) -> list[str]:
    """Problemas encontrados, em português, prontos para a tela. Lista vazia = ok."""
    problems = []
    for node, data in sorted(tree.items()):
        parent = data["parent"]
        if parent and parent not in tree:
            problems.append(f"'{node}' aponta para o nó '{parent}', que não existe.")
            continue
        # caminho que não termina numa raiz só acontece quando os pais se mordem
        chain = path(tree, node)
        if chain and tree[chain[0]]["parent"]:
            problems.append(f"'{node}' está num ciclo de pais.")
    groups = {None: children(tree, None)}
    for node in tree:
        if children(tree, node):
            groups[node] = children(tree, node)
    for parent, group in groups.items():
        counted = [node for node in group if tree[node]["in_totals"]]
        if not counted:
            continue
        total = sum(tree[node]["target_pct"] for node in counted)
        if abs(total - 1.0) > TOLERANCE:
            where = f"de '{tree[parent]['name']}'" if parent else "da raiz"
            problems.append(
                f"Os alvos {where} somam {total * 100:.1f}% em vez de 100%.")
    return problems
