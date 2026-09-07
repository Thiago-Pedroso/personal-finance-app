"""Catálogo de ativos (aba **InvestAssets**).

`node` liga o ativo a uma folha da política e `valuation` diz de onde vem o valor:
`quote` (cotação), `balance` (saldo que você informa) ou `pluggy` (saldo sincronizado).
`target_pct` é o alvo do ativo **dentro** do nó, e a soma por nó deveria fechar 100%.
"""

from . import sheets_io as io

TAB = "InvestAssets"
VALUATIONS = ("quote", "balance", "pluggy")
TOLERANCE = 0.005


def normalize(rec: dict) -> dict:
    valuation = (rec.get("valuation") or "").strip().lower()
    ticker = (rec.get("ticker") or "").strip().upper()
    lot = rec.get("lot_size")
    return {
        "ticker": ticker,
        "name": (rec.get("name") or ticker),
        "node": (rec.get("node") or "").strip(),
        "account": (rec.get("account") or None),
        "sector": (rec.get("sector") or None),
        "currency": (rec.get("currency") or "BRL"),
        "quote_symbol": (rec.get("quote_symbol") or None),
        "valuation": valuation if valuation in VALUATIONS else "quote",
        "pluggy_code": (rec.get("pluggy_code") or None),
        "target_pct": float(rec.get("target_pct") or 0.0),
        "lot_size": float(lot) if lot not in (None, "") else 1.0,
        "active": True if rec.get("active") is None else bool(rec.get("active")),
        "note": (rec.get("note") or None),
    }


def load(records=None) -> dict:
    rows = records if records is not None else io.read(TAB)
    return {a["ticker"]: a for a in map(normalize, rows) if a["ticker"]}


def save(assets: dict) -> None:
    io.write(TAB, [assets[key] for key in sorted(assets)])


def active(assets: dict) -> dict:
    return {t: a for t, a in assets.items() if a["active"]}


def by_node(assets: dict) -> dict:
    """{node: [ativos]}, só os ativos ativos, na ordem do ticker."""
    out: dict = {}
    for ticker in sorted(assets):
        asset = assets[ticker]
        if asset["active"]:
            out.setdefault(asset["node"], []).append(asset)
    return out


def sectors(assets: dict) -> list[str]:
    """Setores já usados, dos mais frequentes para os menos. É a lista do autocomplete:
    a sugestão nasce do que existe na carteira, não de uma taxonomia no código."""
    counts: dict = {}
    for asset in assets.values():
        sector = (asset.get("sector") or "").strip()
        if sector:
            counts[sector] = counts.get(sector, 0) + 1
    return sorted(counts, key=lambda s: (-counts[s], s.lower()))


def target_sums(assets: dict) -> dict:
    """{node: soma dos alvos}. A tela usa para dizer se a classe fecha 100%."""
    out: dict = {}
    for asset in active(assets).values():
        out[asset["node"]] = out.get(asset["node"], 0.0) + asset["target_pct"]
    return out


def unbalanced_nodes(assets: dict) -> dict:
    """Nós cuja soma de alvos foge de 100%, para a tela avisar sem bloquear."""
    return {node: total for node, total in target_sums(assets).items()
            if abs(total - 1.0) > TOLERANCE}


def redistribute(targets: dict, changed: dict, locked=()) -> dict:
    """Aplica os alvos alterados e reparte o que sobra entre os não travados.

    É o comportamento do cadeado da tela: mexer num alvo não pode obrigar a recalcular
    os outros na mão. Sem ninguém livre para absorver, a soma fica fora de 100% e quem
    avisa é a tela."""
    frozen = set(locked) | set(changed)
    result = {**targets, **{t: float(v) for t, v in changed.items() if t in targets}}
    free = [t for t in result if t not in frozen]
    taken = sum(result[t] for t in result if t in frozen)
    left = 1.0 - taken
    if not free:
        return result
    base = sum(targets.get(t, 0.0) for t in free)
    for ticker in free:
        share = (targets.get(ticker, 0.0) / base) if base > 0 else 1.0 / len(free)
        result[ticker] = max(0.0, left * share)
    return result
