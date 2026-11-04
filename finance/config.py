"""Caminhos, credenciais e constantes do projeto. Tudo relativo à raiz do repositório.

A **fonte da verdade** dos dados do usuário (ledger, regras, taxonomia, orçamento, estado de
sync) vive no **Google Sheets** — ver `finance/sheets.py`. Os arquivos em `data/seed/` são
*fixtures sintéticos* usados só pelo script de seed. Os relatórios (`data/reports/`) são
gerados localmente a partir do Sheets e ficam fora do git.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# override=True: o .env do projeto vence uma variável exportada no shell. Sem isso,
# um SHEET_ID esquecido no ambiente aponta o pipeline para outra planilha em
# silêncio — foi assim que relatórios do banco de demonstração sobrescreveram os
# reais duas vezes, sem nenhum aviso na saída.
load_dotenv(override=True)

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

# Fixtures sintéticos do banco mocado (versionados; fonte do script de seed).
SEED_DIR = DATA / "seed"
SEED_LEDGER_FILE = SEED_DIR / "ledger.jsonl"
SEED_RULES_FILE = SEED_DIR / "rules.json"
SEED_TAXONOMY_FILE = SEED_DIR / "taxonomy.yaml"
SEED_BUDGETS_FILE = SEED_DIR / "budgets.json"

# Relatórios gerados localmente a partir do Sheets (gitignored; consumidos pelo frontend).
REPORTS_DIR = DATA / "reports"

# Arquivos de trabalho efêmeros do loop de categorização (gitignored, locais).
TO_CATEGORIZE_FILE = DATA / ".to_categorize.json"
DECISIONS_FILE = DATA / ".decisions.json"
CLAUDE_QUEUE_FILE = DATA / ".claude_queue.jsonl"
INVEST_DECISIONS_FILE = DATA / ".invest_decisions.json"
INVEST_PENDING_FILE = DATA / ".invest_pending.json"

# ---- Google Sheets (banco de dados na nuvem) ------------------------------------------
# ID da planilha (da URL: .../spreadsheets/d/<SHEET_ID>/edit). Cada usuário tem a sua.
SHEET_ID = os.environ.get("SHEET_ID", "").strip()
# Caminho do JSON da Service Account (gitignored). Default: ./credentials.json na raiz.
GOOGLE_SA_CREDENTIALS = os.environ.get("GOOGLE_SA_CREDENTIALS", "credentials.json").strip()

# Acima disso a conexão é considerada velha e o painel avisa. Os itens MeuPluggy
# não aceitam atualização por API (HTTP 400), então saber a idade do dado é a
# única defesa contra decidir em cima de extrato desatualizado.
CONEXAO_VELHA_HORAS = 48

# Janela máxima de histórico que a Pluggy disponibiliza no backfill.
BACKFILL_DAYS = 365
DEFAULT_TIMEZONE = "America/Sao_Paulo"


def ensure_dirs() -> None:
    DATA.mkdir(exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
