"""Caminhos e constantes do projeto. Tudo relativo à raiz do repositório."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

TAXONOMY_FILE = DATA / "taxonomy.yaml"
RULES_FILE = DATA / "rules.json"
BUDGETS_FILE = DATA / "budgets.json"
LEDGER_FILE = DATA / "ledger.jsonl"
SYNC_STATE_FILE = DATA / ".sync_state.json"
REPORTS_DIR = DATA / "reports"

# Arquivos de trabalho efêmeros do loop de categorização (gitignored)
TO_CATEGORIZE_FILE = DATA / ".to_categorize.json"
DECISIONS_FILE = DATA / ".decisions.json"
CLAUDE_QUEUE_FILE = DATA / ".claude_queue.jsonl"

# Janela máxima de histórico que a Pluggy disponibiliza no backfill
BACKFILL_DAYS = 365


def ensure_dirs() -> None:
    DATA.mkdir(exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
