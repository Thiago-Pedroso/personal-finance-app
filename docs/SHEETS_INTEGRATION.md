# Integração com o Google Sheets

O Finance Control usa uma **planilha do Google Sheets como banco de dados**. Cada pessoa tem a
sua planilha (privada, na própria conta Google), então o código pode ser público e colaborável
enquanto os **dados financeiros nunca entram no git** nem ficam presos numa máquina.

Este documento é o guia técnico da integração: o esquema do banco, a camada de acesso
(`finance/sheets.py`), auth, quotas e troubleshooting. Para o passo a passo de setup, veja o
[README](../README.md).

---

## 1. Por que Google Sheets (e não um arquivo/DB tradicional)

- **Gratuito e universal** — qualquer pessoa com conta Google tem, sem servidor para manter.
- **Fora do git** — os dados vivem na nuvem do usuário; o repositório fica limpo e público.
- **Independente de máquina** — troque de computador e seus dados continuam lá.
- **Inspecionável e editável à mão** — é uma planilha; dá para olhar/ajustar direto se precisar.
- **Histórico de versões nativo** — *Arquivo → Histórico de versões* já faz o papel de backup
  (por isso o app não mantém `.bak/` local).
- **Compartilhável** — dá para compartilhar sua planilha com alguém (ex.: um mentor) que
  acompanha suas finanças sem acesso ao seu código.

---

## 2. Autenticação — Service Account

Usamos uma **Service Account (SA)** — daqui em diante "SA": uma "conta de robô" do Google Cloud,
identificada por um e-mail (`...@....iam.gserviceaccount.com`) e autenticada por uma **chave
JSON** (o `credentials.json`). Vantagens para um app operado via Claude Code no terminal: **sem
fluxo de navegador**, 100% headless e reproduzível.

O passo a passo clicável (criar projeto → ativar Sheets/Drive API → criar a SA → **clicar na SA →
aba Chaves → Adicionar chave → JSON** → compartilhar a planilha com o e-mail da SA) está no
[README](../README.md#1-google-sheets-banco-de-dados). Resumo do modelo mental:

Fluxo mental:

```
Você cria a planilha (é o dono)  ──compartilha (Editor)──▶  e-mail da Service Account
        │                                                          │
        └── SHEET_ID no .env                     credentials.json (chave da SA) no .env
                              ▼                        ▼
                       finance/sheets.py  ── gspread + google-auth ──▶  Google Sheets API
```

**Pitfall nº 1 (99% dos erros de permissão):** esquecer de **compartilhar a planilha com o
e-mail da SA**. A SA só enxerga planilhas explicitamente compartilhadas com ela.

Escopos usados: `spreadsheets` (ler/gravar células) e `drive` (abrir a planilha por ID e criar
abas).

Variáveis de ambiente (`.env`):

| Var | Descrição |
|---|---|
| `SHEET_ID` | ID da planilha (da URL `.../spreadsheets/d/<SHEET_ID>/edit`) |
| `GOOGLE_SA_CREDENTIALS` | caminho do JSON da SA (default `credentials.json` na raiz) |

Ambos `credentials.json` e `.env` estão no `.gitignore` — **nunca commite**.

---

## 3. Esquema do banco (4 abas)

A linha 1 de cada aba é o cabeçalho. Tipos entre parênteses referem-se à coerção em
`finance/sheets.py` (`str` texto; `opt` texto opcional/vazio=None; `float` número; `fnum`
número opcional; `bool` TRUE/FALSE; `json` serializado como JSON).

### Aba `Ledger` — uma transação por linha

Espelha o que `finance/ledger.py::normalize()` produz. Colunas:

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | str | chave (UUID da Pluggy, ou `pix-YYYYMMDD-nome`/`manual-*`) |
| `item_id`, `account_id` | str | identificadores da Pluggy |
| `account_name` | str | nome da conta |
| `account_type` | opt | `BANK` \| `CREDIT` |
| `date` | str | `YYYY-MM-DD` |
| `datetime` | opt | ISO 8601 |
| `description` | str | descrição do lançamento |
| `amount` | float | valor absoluto (como veio) |
| `signed_amount` | float | **valor com sinal** (negativo=saída) |
| `currency` | opt | `BRL`, `USD`, ... |
| `type` | opt | `DEBIT` \| `CREDIT` |
| `status` | opt | `POSTED` \| `PENDING` |
| `pluggy_category`, `pluggy_category_id` | opt | palpite da Pluggy |
| `merchant_name`, `counterparty`, `merchant_cnpj`, `mcc` | opt | metadados do lojista |
| `payment_method`, `installment` | opt | forma de pagamento / parcela |
| `category`, `subcategory` | opt | **nossa** classificação |
| `category_source` | opt | `rule` \| `pluggy-map` \| `manual` \| `split` |
| `rule_id` | opt | regra que classificou |
| `needs_review`, `reviewed` | bool | controle de qualidade |
| `splits` | json | `[{amount, category, subcategory, note}]` ou vazio |
| `note` | opt | observação livre |
| `amount_override` | fnum | sobrepõe `signed_amount` nos relatórios |
| `synced_at` | opt | timestamp do sync |

### Aba `Rules` — uma regra por linha

| Coluna | Tipo |
|---|---|
| `id` | str |
| `field` | str (`description`/`merchant_name`/`counterparty`/...) |
| `match` | str (`contains`/`exact`/`startswith`/`regex`) |
| `value` | str |
| `category` | str |
| `subcategory` | opt |
| `note` | opt |
| `type` | opt (`DEBIT`/`CREDIT` — restringe a regra) |
| `amount_abs_min`, `amount_abs_max` | fnum (faixa de valor absoluto) |
| `created_at` | opt |

### Aba `Taxonomy` — uma categoria por linha

| `Category` (str) | `Subcategories` (str, separadas por vírgula) |
|---|---|
| Alimentação | Supermercado, Restaurante, Delivery, ... |

`taxonomy.load()` reconstrói o dict `{categoria: [subs]}`.

### Aba `Config` — blobs JSON (chave/valor)

| `key` | `value` (JSON) |
|---|---|
| `budgets` | o objeto de orçamento inteiro (income_plan, spending, savings_goals) |
| `sync_state` | cursores de sincronização por conta |
| `schema_version` | versão do esquema (atualmente `1`) |

---

## 4. Camada de acesso — `finance/sheets.py`

Contrato público (todas as funções fazem **1 request** por chamada e têm retry com backoff):

| Função | O que faz |
|---|---|
| `read_records(tab)` | lê a aba tabular inteira → `list[dict]` tipado |
| `write_records(tab, records)` | grava a aba inteira (resize + update em batch) |
| `read_config(key, default)` | lê um blob JSON da aba Config |
| `write_config(key, value)` | grava/atualiza uma chave na aba Config |
| `ensure_tabs()` | cria as abas + cabeçalhos que faltam (idempotente) |
| `check()` | valida auth/acesso → `{title, url, tabs}` |
| `reset_cache()` | descarta handles cacheados (após seed/em testes) |

Os módulos de domínio só chamam essas funções — **mesma assinatura de antes** (`load_ledger()`
devolve `{id: rec}`, etc.), então todo o pipeline (`categorize`, `report`, `show`) ficou
intacto. Trocamos apenas o backend de arquivo para Sheets:

| Módulo | Antes (arquivo) | Agora (Sheets) |
|---|---|---|
| `ledger.py` | `data/ledger.jsonl` | aba `Ledger` |
| `rules.py` | `data/rules.json` | aba `Rules` |
| `taxonomy.py` | `data/taxonomy.yaml` | aba `Taxonomy` |
| `budgets.py` | `data/budgets.json` | `Config[budgets]` |
| `sync.py` | `data/.sync_state.json` | `Config[sync_state]` |

Os **relatórios** (`data/reports/*.json`) continuam gerados **localmente** por `finance.report`
(lendo do Sheets) — o frontend os consome direto, sem custo de quota e com carga rápida. São
regeneráveis e ficam no `.gitignore`.

### Coerção de tipos (o ponto crítico)

O Google Sheets guarda tudo como texto e **não distingue célula vazia de `None`**. A convenção:
célula vazia ↔ `None` (para tipos opcionais) ou `""`/`0.0` (para obrigatórios). Bools viram
`TRUE`/`FALSE`; `splits` vira JSON. Escrevemos com `value_input_option="RAW"` para o Sheets
**não** reinterpretar datas/números. Os testes em `tests/test_sheets_roundtrip.py` garantem que
`serialize → coerce` é estável e idêntico ao formato do `normalize()`.

---

## 5. Quotas e resiliência

Limites da Google Sheets API v4 (jul/2026):

- **60 leituras + 60 escritas por minuto por usuário** (300 por minuto por projeto).
- Sem limite diário se ficar sob a quota por minuto.
- Cada `batchGet`/`batchUpdate` conta como **1 request** — por isso lemos/gravamos a aba inteira
  de uma vez.

Por operação típica: um `sync` ou uma edição no dashboard gasta ~5–8 requests (várias
leituras/escritas de abas), muito abaixo do teto. Em `429 Too Many Requests` ou erros 5xx, o
decorator `@_retry` aplica **backoff exponencial** (`min((2^n)+random_ms, 64s)`, até 6
tentativas).

> Cobrança por excesso de quota deve começar "ainda em 2026" — o uso normal deste app fica muito
> longe disso.

---

## 6. Troubleshooting

| Sintoma | Causa provável | Correção |
|---|---|---|
| `Credenciais da Service Account não encontradas` | falta o `credentials.json` | baixe o JSON da SA e salve na raiz (ou ajuste `GOOGLE_SA_CREDENTIALS`) |
| `SHEET_ID vazio no .env` | `.env` sem `SHEET_ID` | copie o ID da URL da planilha |
| `Planilha não encontrada` / `PermissionError` | não compartilhou com a SA | compartilhe a planilha com o e-mail `...@....iam.gserviceaccount.com` como **Editor** |
| `Aba 'X' não existe` | banco não inicializado | rode `uv run python -m finance.seed` |
| `APIError 403 ... has not been used/enabled` | APIs desabilitadas | habilite **Google Sheets API** e **Google Drive API** no projeto |
| `429` recorrente | muitas operações em rajada | o retry já cobre; se persistir, espere 1 min |

Diagnóstico rápido: `uv run python main.py` mostra a planilha conectada e as abas presentes.

---

## 7. Resetar / recomeçar

- **Repopular a demo:** `uv run python -m finance.seed --force` (a versão anterior fica no
  histórico do Google Sheets).
- **Migrar dados de arquivos** (ex.: um layout antigo em `data/`):
  `uv run python -m finance.seed --source <DIR> --force`, onde `<DIR>` contém
  `ledger.jsonl`, `rules.json`, `taxonomy.yaml`, `budgets.json`.
- **Reverter uma bagunça:** *Arquivo → Histórico de versões* na própria planilha.
