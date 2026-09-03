"""Camada de acesso ao Google Sheets — o *banco de dados na nuvem* do Finance Control.

Cada usuário tem a sua própria planilha (privada, na conta Google dele), compartilhada com o
e-mail de uma **Service Account**. Assim o código é público e colaborável, mas os dados
financeiros nunca entram no git nem ficam presos numa máquina.

Design (ver docs/SHEETS_INTEGRATION.md):
- **1 request por operação.** Cada aba é lida/gravada inteira de uma vez (get_all_values /
  resize+update em batch). Isso casa com o pipeline, que já carrega/salva cada "arquivo" inteiro,
  e fica folgado na quota (60 leituras + 60 escritas por minuto por usuário).
- **Coerção tipada** célula(str) ↔ Python via `SCHEMAS`, para o dict após round-trip ser idêntico
  ao que `ledger.normalize()` produz (bools, floats, None e `splits` JSON preservados).
- **Backoff exponencial** em 429/5xx (`@_retry`).

Abas: `Ledger`, `Rules`, `Taxonomy` (tabulares) e `Config` (blobs JSON: budgets, sync_state,
schema_version).
"""

import functools
import json
import random
import time
from pathlib import Path

import gspread
from gspread.utils import ValueRenderOption, rowcol_to_a1

from .config import GOOGLE_SA_CREDENTIALS, ROOT, SHEET_ID

SCHEMA_VERSION = 1

# Escopos: Sheets (ler/gravar) + Drive (abrir a planilha por ID / criar abas).
_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# ---- Esquema das abas tabulares: lista ordenada de (coluna, tipo) ----------------------
# tipos: "str"  (texto obrigatório; None→"" na escrita)
#        "opt"  (texto opcional; ""→None na leitura)
#        "float"(número obrigatório)
#        "fnum" (número opcional; ""→None)
#        "bool" (TRUE/FALSE)
#        "json" (serializado como JSON; ""→None)
LEDGER_SCHEMA = [
    ("id", "str"), ("item_id", "str"), ("account_id", "str"),
    ("account_name", "str"), ("account_type", "opt"), ("date", "str"),
    ("datetime", "opt"), ("description", "str"), ("amount", "float"),
    ("signed_amount", "float"), ("currency", "opt"), ("type", "opt"),
    ("status", "opt"), ("pluggy_category", "opt"), ("pluggy_category_id", "opt"),
    ("merchant_name", "opt"), ("counterparty", "opt"), ("merchant_cnpj", "opt"),
    ("mcc", "opt"), ("payment_method", "opt"), ("installment", "opt"),
    ("category", "opt"), ("subcategory", "opt"), ("category_source", "opt"),
    ("rule_id", "opt"), ("needs_review", "bool"), ("reviewed", "bool"),
    ("splits", "json"), ("note", "opt"), ("amount_override", "fnum"),
    ("excluded", "bool"), ("synced_at", "opt"),
]

RULES_SCHEMA = [
    ("id", "str"), ("field", "str"), ("match", "str"), ("value", "str"),
    ("category", "str"), ("subcategory", "opt"), ("note", "opt"),
    ("type", "opt"), ("amount_abs_min", "fnum"), ("amount_abs_max", "fnum"),
    ("excluded", "bool"), ("created_at", "opt"),
]

TAXONOMY_SCHEMA = [("Category", "str"), ("Subcategories", "str"), ("Treatment", "str"),
                   ("Color", "opt"), ("Icon", "opt")]

SCHEMAS = {
    "Ledger": LEDGER_SCHEMA,
    "Rules": RULES_SCHEMA,
    "Taxonomy": TAXONOMY_SCHEMA,
}
CONFIG_TAB = "Config"

# Abas padrão que o Google cria numa planilha em branco (várias localidades).
_DEFAULT_TITLES = {"Sheet1", "Sheet", "Página1", "Planilha1", "Hoja 1", "Feuille 1"}


class SheetsError(RuntimeError):
    """Erro de configuração/acesso ao Google Sheets, com mensagem acionável."""


# --------------------------------------------------------------------- coerção de tipos
def _parse_float(s: str):
    """float tolerante a formatação por locale (ex.: pt-BR '13,43' ou '1.234,56')."""
    s = s.strip()
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        cleaned = s.replace(".", "").replace(",", ".") if "," in s else s
        return float(cleaned)


def _cell_to_val(kind: str, cell):
    # Lemos com UNFORMATTED_VALUE, então números chegam como int/float (não string
    # locale-formatada) e texto como str. str(cell) normaliza os dois casos.
    s = "" if cell is None else str(cell)
    if kind == "str":
        return s
    if kind == "opt":
        return s if s != "" else None
    if kind == "bool":
        return s.strip().upper() in ("TRUE", "1", "YES", "SIM")
    if kind == "float":
        v = _parse_float(s)
        return v if v is not None else 0.0
    if kind == "fnum":
        return _parse_float(s)
    if kind == "json":
        if s.strip() == "":
            return None
        try:
            return json.loads(s)
        except (json.JSONDecodeError, TypeError):
            return None
    return s


def _val_to_cell(kind: str, val):
    if val is None:
        return ""
    if kind == "bool":
        return "TRUE" if val else "FALSE"
    if kind in ("float", "fnum"):
        return val  # número puro (value_input_option=RAW mantém como número)
    if kind == "json":
        return json.dumps(val, ensure_ascii=False)
    return str(val)


# ------------------------------------------------------------------------ retry/backoff
def _retry(fn):
    """Backoff exponencial em 429/5xx: min((2^n)+random_ms, 64s), até 6 tentativas."""
    @functools.wraps(fn)
    def wrap(*args, **kwargs):
        delay = 1.0
        for attempt in range(6):
            try:
                return fn(*args, **kwargs)
            except gspread.exceptions.APIError as e:
                code = getattr(getattr(e, "response", None), "status_code", None)
                if code in (429, 500, 502, 503) and attempt < 5:
                    time.sleep(min(delay + random.random(), 64.0))
                    delay *= 2
                    continue
                raise
    return wrap


# ---------------------------------------------------------------------------- conexão
_client = None
_sheet = None
_ws_cache: dict = {}


def _creds_path() -> Path:
    p = Path(GOOGLE_SA_CREDENTIALS).expanduser()
    return p if p.is_absolute() else (ROOT / p)


def client():
    """Cliente gspread autenticado via Service Account (cacheado no módulo)."""
    global _client
    if _client is None:
        path = _creds_path()
        if not path.exists():
            raise SheetsError(
                f"Credenciais da Service Account não encontradas em '{path}'.\n"
                "Baixe o JSON da SA no Google Cloud e salve como ./credentials.json "
                "(ou aponte GOOGLE_SA_CREDENTIALS no .env). Veja docs/SHEETS_INTEGRATION.md.")
        _client = gspread.service_account(filename=str(path), scopes=_SCOPES)
    return _client


def open_sheet():
    """Abre a planilha do SHEET_ID (cacheada). Erros mais comuns viram mensagem clara."""
    global _sheet
    if _sheet is None:
        if not SHEET_ID:
            raise SheetsError(
                "SHEET_ID vazio no .env. Cole o ID da sua planilha "
                "(URL: .../spreadsheets/d/<SHEET_ID>/edit).")
        try:
            _sheet = client().open_by_key(SHEET_ID)
        except gspread.exceptions.SpreadsheetNotFound:
            raise SheetsError(
                f"Planilha '{SHEET_ID}' não encontrada. Confira o SHEET_ID e se você "
                "compartilhou a planilha com o e-mail da Service Account (Editor).")
        except gspread.exceptions.APIError as e:
            raise SheetsError(
                f"Erro ao abrir a planilha ({e}). Você compartilhou a planilha com o "
                "e-mail da Service Account como Editor?")
    return _sheet


def _ws(tab: str):
    if tab not in _ws_cache:
        try:
            _ws_cache[tab] = open_sheet().worksheet(tab)
        except gspread.exceptions.WorksheetNotFound:
            raise SheetsError(
                f"Aba '{tab}' não existe na planilha. Rode o seed para criar/popular: "
                "uv run python -m finance.seed")
    return _ws_cache[tab]


def reset_cache() -> None:
    """Descarta handles cacheados (útil após criar abas no seed ou em testes)."""
    global _client, _sheet
    _client = None
    _sheet = None
    _ws_cache.clear()


# ------------------------------------------------------------------- leitura / escrita
@_retry
def read_records(tab: str) -> list[dict]:
    """Lê a aba tabular inteira → lista de dicts tipados (1 request)."""
    schema = dict(SCHEMAS[tab])
    # UNFORMATTED_VALUE: devolve números crus (evita o separador decimal do locale,
    # ex.: pt-BR devolver "13,43" e quebrar o float()).
    values = _ws(tab).get_all_values(value_render_option=ValueRenderOption.unformatted)
    if not values:
        return []
    header = values[0]
    out = []
    for row in values[1:]:
        if not (row and str(row[0]).strip()):  # ignora linhas sem chave na 1ª coluna
            continue
        row = list(row) + [""] * (len(header) - len(row))
        out.append({name: _cell_to_val(schema.get(name, "opt"), row[i])
                    for i, name in enumerate(header)})
    return out


@_retry
def write_records(tab: str, records: list[dict]) -> None:
    """Grava a aba tabular inteira a partir de uma lista de dicts (resize + update)."""
    schema = SCHEMAS[tab]
    header = [name for name, _ in schema]
    matrix = [header]
    for rec in records:
        matrix.append([_val_to_cell(kind, rec.get(name)) for name, kind in schema])
    ws = _ws(tab)
    ws.resize(rows=max(len(matrix), 1), cols=len(header))
    ws.update(values=matrix, range_name="A1", value_input_option="RAW")


@_retry
def update_changed_rows(tab: str, records: list[dict], changed_ids: set,
                        id_field: str = "id") -> int:
    """Atualiza SÓ as linhas cujo id está em `changed_ids`, casando pela posição
    na lista `records` (que deve estar na MESMA ordem já gravada na planilha).

    Reescrever a aba inteira custa caro no Sheets (ex.: ~2,8s p/ 1853 linhas do
    Ledger); quando só algumas linhas mudaram, mandamos um `batch_update` enxuto.
    Segurança: se a contagem de linhas da planilha divergir do esperado
    (alguém inseriu/removeu linhas fora daqui), cai para a reescrita total.
    Retorna quantas linhas foram enviadas (-1 se caiu no full rewrite)."""
    schema = SCHEMAS[tab]
    header = [name for name, _ in schema]
    ws = _ws(tab)
    # invariante mantido por write_records: planilha tem len(records)+1 linhas.
    # Se divergir, alguém mexeu na estrutura -> reescreve tudo (seguro).
    if ws.row_count != len(records) + 1:
        write_records(tab, records)
        return -1
    reqs = []
    for i, rec in enumerate(records):
        if rec.get(id_field) in changed_ids:
            line = [_val_to_cell(kind, rec.get(name)) for name, kind in schema]
            rn = i + 2  # 1-based + cabeçalho
            rng = f"{rowcol_to_a1(rn, 1)}:{rowcol_to_a1(rn, len(header))}"
            reqs.append({"range": rng, "values": [line]})
    if not reqs:
        return 0
    ws.batch_update(reqs, value_input_option="RAW")
    return len(reqs)


# ---------------------------------------------------------------------------- Config
@_retry
def _read_config_values() -> list[list[str]]:
    return _ws(CONFIG_TAB).get_all_values()


def read_config(key: str, default=None):
    """Lê um blob JSON (ou string) da aba Config pela chave."""
    for row in _read_config_values()[1:]:
        if row and row[0] == key:
            raw = row[1] if len(row) > 1 else ""
            if raw == "":
                return default
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return raw
    return default


@_retry
def write_config(key: str, value) -> None:
    """Grava/atualiza uma chave na aba Config (value serializado como JSON)."""
    ws = _ws(CONFIG_TAB)
    values = ws.get_all_values()
    header = values[0] if values else ["key", "value"]
    rows = [list(r) for r in values[1:]]
    payload = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    for r in rows:
        while len(r) < 2:
            r.append("")
        if r[0] == key:
            r[1] = payload
            break
    else:
        rows.append([key, payload])
    matrix = [header] + rows
    ws.resize(rows=max(len(matrix), 1), cols=2)
    ws.update(values=matrix, range_name="A1", value_input_option="RAW")


# ------------------------------------------------------------------- setup / diagnóstico
def ensure_tabs() -> None:
    """Cria as abas que faltam (com cabeçalho). Idempotente. Usado pelo seed."""
    sh = open_sheet()
    existing = {w.title: w for w in sh.worksheets()}
    for tab, schema in SCHEMAS.items():
        if tab not in existing:
            header = [name for name, _ in schema]
            ws = sh.add_worksheet(title=tab, rows=100, cols=max(len(header), 1))
            ws.update(values=[header], range_name="A1", value_input_option="RAW")
    if CONFIG_TAB not in existing:
        ws = sh.add_worksheet(title=CONFIG_TAB, rows=20, cols=2)
        ws.update(values=[["key", "value"]], range_name="A1", value_input_option="RAW")
    # remove a aba padrão vazia ("Sheet1"/"Página1"/...) para deixar a planilha limpa
    for title, ws in existing.items():
        if title in _DEFAULT_TITLES and not any(
                c for row in ws.get_all_values() for c in row):
            try:
                sh.del_worksheet(ws)
            except gspread.exceptions.APIError:
                pass
    reset_cache()


def check() -> dict:
    """Valida auth + acesso e devolve título/URL/abas (diagnóstico p/ main.py)."""
    sh = open_sheet()
    return {"title": sh.title, "url": sh.url,
            "tabs": [w.title for w in sh.worksheets()]}
