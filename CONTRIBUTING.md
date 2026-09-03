# Contribuindo com o Finance Control

Obrigado por colaborar! Este projeto é um app de finanças pessoais operado via Claude Code, e
funciona num modelo em que **o código é público, mas os dados de cada pessoa são privados**.
Entender essa separação é o que mantém a colaboração segura.

## A regra de ouro

> **Nunca commite dados financeiros nem segredos.** Só código, docs e os fixtures sintéticos.

Os dados de cada usuário vivem na **planilha Google Sheets dele** (fonte da verdade), e as
credenciais ficam em arquivos locais que o `.gitignore` bloqueia. Um Pull Request **jamais** deve
conter finanças reais ou chaves.

## O que é seguro / o que nunca vai pro git

| Pode versionar | Nunca versionar (bloqueado pelo `.gitignore`) |
|---|---|
| Código (`finance/`, `frontend/`, `main.py`, `start.sh`) | `.env`, `credentials.json`, `token.json`, `*.pem` |
| Docs (`README.md`, `docs/`, `CLAUDE.md`) | Qualquer coisa em `data/` **exceto** `data/seed/` |
| Fixtures **sintéticos** em `data/seed/` | Seu ledger, relatórios, orçamento, sync_state reais |

O `.gitignore` já bloqueia **tudo** em `data/` fora de `data/seed/`, além de nomes comuns de
chave (`credentials*.json`, `service_account*.json`, `.env.*`, `*.pem`). Ainda assim: confira o
`git status` antes de commitar.

## Como começar

1. **Fork** deste repositório e clone o seu fork.
2. Siga o onboarding do [README](README.md#setup--onboarding): crie a sua Service Account, a sua
   planilha e o seu `.env`. **Você usa a sua própria planilha e credenciais** — nunca as de outra
   pessoa.
3. `uv run python -m finance.seed` popula um banco de **demonstração** (dados fictícios). Dá pra
   desenvolver a maioria das features sem nenhum dado real.

## Fluxo de contribuição

1. Crie uma branch a partir da `main` (`git switch -c minha-feature`).
2. Faça as mudanças e rode os testes:
   ```bash
   PYTHONPATH=. uv run python tests/test_sheets_roundtrip.py
   PYTHONPATH=. uv run python tests/test_pipeline_inmemory.py
   PYTHONPATH=. uv run python tests/test_schema_migration.py
   ```
   Esses testes usam armazenamento e diretório de relatórios temporários. Eles não acessam a
   planilha configurada no `.env`.
3. Abra um **Pull Request** contra a `main`. A CI roda uma varredura de segredos (gitleaks); o PR
   é revisado antes do merge.
4. PRs devem conter **apenas código/docs** — nunca `data/` (fora de `seed/`) nem segredos.

## Estilo

- **Commits** curtos e no imperativo, sem trailer de coautoria.
- **Python** segue o estilo do código existente (funções enxutas, docstrings curtas em pt-BR).
- Mudou a persistência? Veja o contrato da camada Sheets em
  [`docs/SHEETS_INTEGRATION.md`](docs/SHEETS_INTEGRATION.md) e mantenha os testes de round-trip
  verdes.

## Achou um segredo vazado?

Se identificar uma credencial commitada por engano (sua ou de alguém), **não abra issue pública**:
avise o mantenedor em privado e rotacione a chave (gere uma nova no Google Cloud / Pluggy e
descarte a antiga).
