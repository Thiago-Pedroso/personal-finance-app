"""Proventos reconhecidos no extrato.

A descrição bancária de um rendimento traz o ticker e a quantidade de cotas
(`RENDIMENTOS DE CLIENTES VISC11 S/ 10`). Daí saem o ativo e o valor por cota sem ninguém
digitar. Quando a quantidade da descrição bate com a que a carteira tem, o lançamento é
confiável; quando não bate, além de virar revisão ele também denuncia uma compra que
ficou sem registro.

Todo lançamento de poupança com subcategoria de aporte ou resgate tem um destino na
carteira: uma ou mais movimentações com o `ledger_id` dele, somando o valor do lançamento.
É essa ligação que mostra para onde foi cada real e impede o mesmo aporte de entrar duas
vezes.
"""

import re
import unicodedata

from . import trades as T

INCOME_WORDS = ("RENDIMENTO", "DIVIDEND", "JCP", "JUROS SOBRE", "JUROS S/ CAPITAL",
                "PROVENT", "AMORTIZ", "REEMBOLSO DE EVENTO")
JCP_WORDS = ("JCP", "JUROS SOBRE", "JUROS S/ CAPITAL")
# subcategorias de poupança que movem dinheiro; a taxonomia é do usuário, então é config
DESTINATION_KEY = "invest_destination_subcategories"
DESTINATION_SUBCATEGORIES = ("Aporte", "Resgate")
LINK_SIDES = ("BUY", "SELL", "TRANSFER")
TOLERANCE = 0.01
# "S/ 10", "SOBRE 10 COTAS": a quantidade que a corretora usou para calcular
_QUANTITY = re.compile(r"(?:S/|SOBRE)\s*([\d.,]+)")


def norm(text: str | None) -> str:
    stripped = unicodedata.normalize("NFKD", str(text or ""))
    stripped = "".join(c for c in stripped if not unicodedata.combining(c))
    return " ".join(stripped.upper().split())


def _text_of(record: dict) -> str:
    return norm(" ".join(str(record.get(field) or "") for field in
                         ("description", "merchant_name", "counterparty")))


def looks_like_income(record: dict) -> bool:
    text = _text_of(record)
    return (record.get("signed_amount", 0) or 0) > 0 and \
        any(word in text for word in INCOME_WORDS)


def find_ticker(text: str, assets: dict) -> str | None:
    """Só reconhece ativo que já existe na carteira, pelo ticker ou pelo ISIN (o provento
    de ação alugada vem como "REEMBOLSO DE EVENTO BRPETRACNOR9")."""
    tokens = set(re.split(r"[^A-Z0-9]+", text))
    for ticker, asset in assets.items():
        if ticker in tokens or (asset.get("isin") and asset["isin"] in tokens):
            return ticker
    return None


def find_quantity(text: str) -> float | None:
    match = _QUANTITY.search(text)
    if not match:
        return None
    raw = match.group(1).replace(".", "").replace(",", ".")
    try:
        return float(raw)
    except ValueError:
        return None


def income_from_ledger(records: list[dict], assets: dict, positions: dict,
                       existing: list[dict]) -> tuple[list[dict], list[dict]]:
    """Devolve (lançamentos de provento, pendências)."""
    already = {trade.get("ledger_id") for trade in existing if trade.get("ledger_id")}
    suggested, pending = [], []
    for record in records:
        if not looks_like_income(record) or record["id"] in already:
            continue
        text = _text_of(record)
        ticker = find_ticker(text, assets)
        if not ticker:
            continue
        total = float(record.get("signed_amount") or 0.0)
        quantity = find_quantity(text)
        held = positions.get(ticker, {}).get("quantity")
        side = "JCP" if any(word in text for word in JCP_WORDS) else "DIVIDEND"
        trade = {"date": record.get("date"), "ticker": ticker, "side": side,
                 "quantity": quantity or 0.0,
                 "price": (total / quantity) if quantity else total,
                 "ledger_id": record["id"], "source": "ledger",
                 "note": record.get("description")}
        if quantity and held is not None and abs(quantity - held) > 1e-6:
            pending.append({
                "kind": "income_quantity_mismatch", "ticker": ticker,
                "ledger_id": record["id"], "trade": trade,
                "message": f"{ticker}: o provento de {record.get('date')} foi pago sobre "
                           f"{quantity:g} cotas e a carteira tem {held:g}. "
                           "Provavelmente falta registrar uma compra."})
            continue
        suggested.append(T.normalize(trade))
    return suggested, pending


def _parts(record: dict) -> list[dict]:
    if record.get("splits"):
        return record["splits"]
    return [{"amount": record.get("amount_override") if record.get("amount_override")
             is not None else record.get("signed_amount") or 0.0,
             "category": record.get("category"), "subcategory": record.get("subcategory")}]


def load_destination_subcategories() -> tuple:
    from .. import sheets
    return tuple(sheets.read_config(DESTINATION_KEY, None) or DESTINATION_SUBCATEGORIES)


def needed_destination(record: dict, treatments: dict,
                       subcategories=DESTINATION_SUBCATEGORIES) -> float:
    """Quanto do lançamento é aporte ou resgate de poupança e precisa de destino."""
    if record.get("excluded"):
        return 0.0
    return round(sum(abs(float(part.get("amount") or 0.0)) for part in _parts(record)
                     if treatments.get(part.get("category")) == "poupança"
                     and part.get("subcategory") in subcategories), 2)


def links_by_ledger(trades: list[dict]) -> dict:
    """{ledger_id: [movimentações]} só com as que movem dinheiro."""
    out: dict = {}
    for trade in map(T.normalize, trades):
        if trade["ledger_id"] and trade["side"] in LINK_SIDES:
            out.setdefault(trade["ledger_id"], []).append(trade)
    return out


def destination_status(records: list[dict], trades: list[dict], treatments: dict,
                       assets: dict | None = None,
                       subcategories=DESTINATION_SUBCATEGORIES) -> dict:
    """{ledger_id: {needed, linked, status, links}}. `status` é linked, missing, partial,
    over, ou info quando o lançamento ligado não é aporte (ex.: compra de título)."""
    assets = assets or {}
    grouped = links_by_ledger(trades)
    out = {}
    for record in records:
        needed = needed_destination(record, treatments, subcategories)
        links = grouped.get(record["id"], [])
        if not needed and not links:
            continue
        linked = round(sum(T.total_brl(trade) for trade in links), 2)
        if not needed:
            status = "info"
        elif not links:
            status = "missing"
        elif abs(linked - needed) <= TOLERANCE:
            status = "linked"
        else:
            status = "partial" if linked < needed else "over"
        out[record["id"]] = {
            "needed": needed, "linked": linked, "status": status,
            "links": [{"trade_id": trade["id"], "ticker": trade["ticker"],
                       "name": (assets.get(trade["ticker"]) or {}).get("name")
                       or trade["ticker"],
                       "side": trade["side"], "amount": round(T.total_brl(trade), 2),
                       "date": trade["date"]} for trade in links],
        }
    return out


def _brl(value: float) -> str:
    return f"R$ {value:,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")


def destination_pending(records: list[dict], trades: list[dict], treatments: dict,
                        assets: dict | None = None,
                        subcategories=DESTINATION_SUBCATEGORIES) -> list[dict]:
    """Pendências de auditoria entre o Ledger e a carteira."""
    by_id = {record["id"]: record for record in records}
    status = destination_status(records, trades, treatments, assets, subcategories)
    pending = []
    for ledger_id, info in status.items():
        if info["status"] in ("linked", "info"):
            continue
        record = by_id[ledger_id]
        label = f"{record.get('description')} de {record.get('date')}"
        if info["status"] == "missing":
            message = f"{label} ({_brl(info['needed'])}) está sem destino na carteira."
        elif info["status"] == "partial":
            message = (f"{label}: {_brl(info['linked'])} de {_brl(info['needed'])} "
                       "têm destino.")
        else:
            message = (f"{label}: o destino soma {_brl(info['linked'])}, mais que os "
                       f"{_brl(info['needed'])} do lançamento.")
        pending.append({"kind": f"destination_{info['status']}", "ledger_id": ledger_id,
                        "item_id": record.get("item_id"), "date": record.get("date"),
                        "needed": info["needed"], "linked": info["linked"],
                        "message": message})
    for ledger_id, links in links_by_ledger(trades).items():
        if ledger_id not in by_id:
            tickers = ", ".join(sorted({trade["ticker"] for trade in links}))
            pending.append({"kind": "orphan_link", "ledger_id": ledger_id,
                            "message": f"Movimentação de {tickers} aponta para um "
                                       "lançamento que não existe mais no Ledger."})
    return pending


# "Dinheiro reservado Cofrinho Viagem" / "Dinheiro retirado Carro": alguns bancos digitais
# descrevem aporte e resgate de cofrinho assim, com o nome do cofrinho no fim.
_COFRINHO = re.compile(r"^DINHEIRO (RESERVADO|RETIRADO) (.+)$")
_STOP = {"DE", "DA", "DO", "E", "COFRINHO", "CAIXINHA"}


def _words(text: str) -> set:
    return {w for w in re.split(r"[^A-Z0-9]+", norm(text)) if w and w not in _STOP}


def cofrinho_suggestions(records: list[dict], pending: list[dict], assets: dict,
                         accounts: dict) -> list[dict]:
    """Sugere o destino dos aportes/resgates de cofrinho que estão sem destino.

    Para cada pendência `destination_missing` cuja descrição é "Dinheiro reservado/retirado
    <nome>", procura uma caixinha (`valuation: balance`) da mesma instituição (o
    `item_id` do lançamento é o `pluggy_item_id` da conta) cujo nome ou ticker tenha as
    palavras do <nome>. Achou uma só: sugere ligar ao ticker dela. Não achou: sugere criar
    a caixinha com esse nome. Nunca grava: quem confirma é o usuário (`links` no
    `.invest_decisions.json` ou o botão na tela de Reservas)."""
    by_id = {record["id"]: record for record in records}
    account_of_item = {str(acc.get("pluggy_item_id")): key for key, acc in accounts.items()
                       if acc.get("pluggy_item_id")}
    out: list[dict] = []
    for item in pending:
        if item.get("kind") != "destination_missing":
            continue
        record = by_id.get(item.get("ledger_id"))
        match = _COFRINHO.match(norm(record.get("description"))) if record else None
        if not match:
            continue
        name = match.group(2).strip()
        account = account_of_item.get(str(record.get("item_id")))
        wanted = _words(name)
        candidates = [ticker for ticker, asset in assets.items()
                      if asset.get("valuation") == "balance"
                      and (account is None or asset.get("account") == account)
                      and wanted and wanted <= (_words(asset.get("name") or "")
                                                | _words(ticker.replace("-", " ")))]
        amount = round(float(item.get("needed") or 0.0), 2)
        out.append({
            "ledger_id": record["id"], "date": record.get("date"),
            "description": record.get("description"),
            "side": "in" if match.group(1) == "RESERVADO" else "out",
            "amount": amount, "account": account,
            "name": name.title() if name.isupper() else name,
            "ticker": candidates[0] if len(candidates) == 1 else None,
            "candidates": candidates if len(candidates) > 1 else [],
        })
    return sorted(out, key=lambda s: (s["ticker"] is None, s["name"], s["date"] or ""))
