"""Traz a carteira de uma planilha antiga para as abas de investimento.

Lê a planilha no formato "financas-2.0" (blocos por classe na aba Investimentos, uma
linha por operação em Movimentações, cascata de alvos em Aporte por Tipo de Ativo) e
escreve `data/.invest_decisions.json`. Nada é gravado direto: o arquivo é revisável e
entra pelo caminho normal.

    uv run python -m finance.invest.import_sheet <ID_DA_PLANILHA>
    uv run python -m finance.invest apply

Premissas, todas verificadas na leitura: a aba de movimentações tem cabeçalho na primeira
linha; cada bloco da aba Investimentos começa numa linha cujo primeiro campo é "Ativo" e
termina em "TOTAL"; o nome da classe é o texto isolado logo acima do bloco.
"""

import json
import sys
import unicodedata
from datetime import date, timedelta
from pathlib import Path

import gspread
from google.oauth2.service_account import Credentials

from ..config import GOOGLE_SA_CREDENTIALS, INVEST_DECISIONS_FILE, ROOT
from . import quotes as Q

SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly",
          "https://www.googleapis.com/auth/drive.readonly"]
EPOCH = date(1899, 12, 30)
BUY_WORDS = ("compra", "buy")
SELL_WORDS = ("venda", "sell")


def slug(text: str) -> str:
    stripped = unicodedata.normalize("NFKD", str(text or ""))
    stripped = "".join(c for c in stripped if not unicodedata.combining(c))
    return "".join(c if c.isalnum() else "_" for c in stripped.strip().lower()).strip("_")


def number(value) -> float | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    raw = str(value)
    percent = "%" in raw
    text = raw.replace("R$", "").replace("%", "").replace("\xa0", " ").strip()
    text = text.replace(".", "").replace(",", ".") if "," in text else text
    try:
        parsed = float(text)
    except ValueError:
        return None
    return parsed / 100.0 if percent else parsed


def as_date(value) -> str | None:
    serial = number(value)
    if serial and serial > 20000:
        return (EPOCH + timedelta(days=int(serial))).isoformat()
    text = str(value or "").strip()
    if "/" in text:
        day, month, year = (text.split("/") + ["", ""])[:3]
        if day.isdigit() and month.isdigit() and year.isdigit():
            return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"
    return text or None


def open_sheet(sheet_id: str):
    path = Path(GOOGLE_SA_CREDENTIALS)
    path = path if path.is_absolute() else ROOT / path
    creds = Credentials.from_service_account_file(str(path), scopes=SCOPES)
    return gspread.authorize(creds).open_by_key(sheet_id)


def read_trades(sheet) -> tuple[list[dict], set[str]]:
    """Movimentações viram trades. Linha sem data ou sem ticker é descartada com aviso."""
    rows = sheet.worksheet("Movimentações").get_all_values()
    header = [slug(cell) for cell in rows[0]]
    index = {name: position for position, name in enumerate(header)}
    ticker_column = index.get("ticker", index.get("ticket"))
    trades, brokers, dropped = [], set(), 0
    for line, row in enumerate(rows[1:], start=2):
        ticker = (row[ticker_column] if ticker_column is not None else "").strip().upper()
        when = as_date(row[index["data"]]) if "data" in index else None
        quantity = number(row[index["qtd"]]) if "qtd" in index else None
        price = number(row[index["preco_pago"]]) if "preco_pago" in index else None
        if not ticker or not when or not quantity:
            dropped += 1 if ticker else 0
            if ticker:
                print(f"  ! linha {line}: {ticker} sem data ou quantidade, ignorada")
            continue
        operation = str(row[index["operacao"]]).strip().lower() if "operacao" in index else ""
        side = "SELL" if any(word in operation for word in SELL_WORDS) else "BUY"
        broker = str(row[index["corretora"]]).strip() if "corretora" in index else ""
        if broker:
            brokers.add(broker)
        trades.append({"date": when, "ticker": ticker, "side": side,
                       "quantity": quantity, "price": price or 0.0,
                       "account": slug(broker) or None, "source": "import"})
    print(f"  {len(trades)} movimentações lidas, {dropped} ignoradas")
    return trades, brokers


def read_assets(sheet) -> list[dict]:
    """Cada bloco da aba Investimentos vira uma classe com seus ativos e alvos."""
    rows = sheet.worksheet("Investimentos").get_all_values()
    assets, current, header = [], None, {}
    for position, row in enumerate(rows):
        first = (row[0] if row else "").strip()
        if first.lower() == "ativo":
            header = {slug(cell): column for column, cell in enumerate(row) if cell}
            for previous in range(position - 1, -1, -1):
                label = (rows[previous][0] if rows[previous] else "").strip()
                if label:
                    current = label
                    break
            continue
        if not first or first.upper() == "TOTAL" or not current:
            continue
        if not any(str(cell).strip() for cell in row[1:]):
            continue   # linha com um rótulo só é o nome da classe, não um ativo
        target = number(row[header["obj"]]) if "obj" in header else None
        sector = (row[header["setor"]].strip()
                  if "setor" in header and header["setor"] < len(row) else None)
        assets.append({"ticker": first.upper(), "name": first, "node": slug(current),
                       "sector": sector or None, "target_pct": target or 0.0})
    print(f"  {len(assets)} ativos em {len({a['node'] for a in assets})} classes")
    return assets


def read_policy(sheet, nodes: set[str]) -> list[dict]:
    """Reconstrói a cascata lendo os pares rótulo/percentual da aba de aporte.

    A planilha guarda cada decisão num par de colunas (rótulo à esquerda, fatia à
    direita). Varremos a faixa inteira, então mudar a ordem das colunas não quebra.
    """
    rows = sheet.worksheet("Aporte por Tipo de Ativo").get_all_values()
    found: dict = {}
    for row in rows[:12]:
        for column, cell in enumerate(row[:-1]):
            label = str(cell).strip()
            share = number(row[column + 1])
            if label and share is not None and 0 < share <= 1 and not number(label):
                found.setdefault(slug(label), share)
    # "FII" na cascata e "FIIs" no bloco de ativos são o mesmo nó
    for label in list(found):
        for node in nodes:
            if label != node and label.rstrip("s") == node.rstrip("s"):
                found[node] = found.pop(label)
                break
    print(f"  fatias encontradas: {', '.join(sorted(found)) or 'nenhuma'}")
    policy = []
    for node in sorted(nodes | set(found)):
        policy.append({"node": node, "name": node.replace("_", " ").title(),
                       "parent": "", "target_pct": found.get(node, 0.0),
                       "in_totals": True})
    return policy


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    sheet = open_sheet(sys.argv[1])
    print(f"Lendo '{sheet.title}'...")
    trades, brokers = read_trades(sheet)
    assets = read_assets(sheet)
    nodes = {asset["node"] for asset in assets}
    policy = read_policy(sheet, nodes)

    known = {asset["ticker"] for asset in assets}
    for trade in trades:
        if trade["ticker"] not in known:
            print(f"  ! {trade['ticker']} tem movimentação e não está na carteira")
    for asset in assets:
        kind = Q.guess_kind(asset["ticker"])
        asset["valuation"] = "quote" if kind != "manual" else "balance"
        asset["quote_symbol"] = Q.symbol_for(asset["ticker"], kind)
        asset["lot_size"] = 1.0 if kind in ("stock_br", "fii_br") else 0.0001

    payload = {
        "accounts": [{"id": slug(name), "name": name, "kind": "broker"}
                     for name in sorted(brokers)],
        "policy": policy,
        "assets": assets,
        "trades": trades,
    }
    INVEST_DECISIONS_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nEscrito em {INVEST_DECISIONS_FILE}.")
    print("\nFalta uma coisa que a planilha não diz explicitamente: quem é pai de quem.")
    print("Os nós vieram todos na raiz; preencha `parent` em policy para reconstruir a")
    print("cascata (ex.: brasil e eua com parent renda_variavel, acoes e fiis com")
    print("parent brasil). Depois rode:")
    print("  uv run python -m finance.invest apply")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
