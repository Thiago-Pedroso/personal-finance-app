# Finance Control

Assistente de controle financeiro pessoal operado **via [Claude Code](https://claude.com/claude-code)**,
com dados do **Open Finance** (via [Pluggy](https://pluggy.ai)). Um pipeline Python enxuto
busca as transações, aplica regras determinísticas de categorização e gera relatórios; o
Claude Code categoriza o que sobra na conversa e aprende novas regras. Um dashboard React
(somente leitura + edição leve) visualiza tudo.

> **Princípio central:** a categorização assistida por IA é feita pelo próprio agente do
> Claude Code na conversa — **sem chave de API de modelo, sem custo extra**. O Python só faz
> o trabalho mecânico (buscar, aplicar regras, agregar). Veja [`PLAN.md`](PLAN.md) para a
> arquitetura completa e [`CLAUDE.md`](CLAUDE.md) para o contrato de operação.

> ⚠️ **Os dados em `data/` são sintéticos/fictícios**, apenas para demonstração. Conecte suas
> próprias contas via Pluggy para usar de verdade.

## Funcionalidades

- **Sync incremental** das transações da Pluggy (`finance.sync`).
- **Categorização** por regras determinísticas + loop assistido pelo Claude, com
  **aprendizado de regras** retroativo (`finance.categorize`).
- **Relatórios** mensais (JSON + Markdown) e um `dashboard.json` agregado (`finance.report`).
- **Dashboard React/Vite**: visão geral, transações com filtros, análise por categoria,
  planejamento/orçamento, fila de revisão, edição via o mesmo pipeline de regras, splits e
  drill-down global.
- **Taxonomia editável** (`data/taxonomy.yaml`) e **orçamento** (`data/budgets.json`).

## Stack

- **Backend:** Python 3.13 + [uv](https://docs.astral.sh/uv/), `pluggy-sdk`, `pyyaml`,
  `python-dotenv`. Sem banco de dados — estado em arquivos de texto (`data/`).
- **Frontend:** Vite + React 18 + Tailwind v4 + Recharts + TanStack Table.

## Setup

```bash
# 1. Credenciais da Pluggy
cp .env.example .env        # preencha CLIENT_ID, CLIENT_SECRET, ITEM_IDS

# 2. Backend (uv instala as dependências automaticamente)
uv run python main.py       # checa conectividade e estado do ledger

# 3. Frontend
cd frontend && npm install
```

## Operação (fluxo recorrente)

Em linguagem natural com o Claude Code, ou direto pelo CLI:

```bash
uv run python -m finance.sync --days 30     # puxa transações novas
uv run python -m finance.categorize         # categoriza (+ apply --learn)
uv run python -m finance.report             # gera relatórios
cd frontend && npm run dev                   # dashboard em http://localhost:5273
```

Comandos de inspeção (somente leitura):

```bash
uv run python -m finance.show stats
uv run python -m finance.show queue
uv run python -m finance.show find "texto"
```

## Estrutura

```
finance/        # pipeline Python (sync, rules, categorize, report, ...)
frontend/       # dashboard React (Vite)
data/
  taxonomy.yaml # categorias/subcategorias (você edita)
  rules.json    # modelo de categorização aprendido (versionado)
  budgets.json  # orçamento / planejamento
  ledger.jsonl  # 1 transação por linha (canônico)
  reports/      # YYYY-MM.{json,md} + dashboard.json
PLAN.md         # plano e arquitetura
CLAUDE.md       # contrato de operação (lido pelo Claude Code a cada sessão)
```

## Segurança

`.env` contém as credenciais da Pluggy e **nunca deve ser commitado** (está no `.gitignore`).
Arquivos efêmeros de trabalho (`data/.decisions.json`, `data/.claude_queue.jsonl`, backups)
também ficam fora do git.