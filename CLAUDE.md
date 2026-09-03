# CLAUDE.md — Contexto do projeto (leia toda sessão)

Controle financeiro pessoal operado via Claude Code. As transações chegam do Open Finance
(Pluggy). O Claude categoriza os gastos na conversa e grava as decisões via pipeline Python.

> **Banco de dados = Google Sheets.** Ledger, regras, taxonomia e orçamento vivem numa planilha
> do usuário (privada, na conta Google dele), **não no git**. O código é público/colaborável; os
> dados, não. Esquema e auth em [`docs/SHEETS_INTEGRATION.md`](docs/SHEETS_INTEGRATION.md).
> Os dados em `data/seed/` são **sintéticos** (fonte do banco de demonstração).
> **Nunca commitar `.env` nem `credentials.json`.**

---

## Fluxo recorrente

```
1. uv run python -m finance.sync --days N      # puxa transações da Pluggy → Sheets
2. uv run python -m finance.show queue         # lê a Fila do Claude (dashboard)
3. escrever data/.decisions.json + apply       # categoriza o que chegou (grava no Sheets)
4. uv run python -m finance.report             # SEMPRE rodar após qualquer categorização
5. git commit                                  # commitar só CÓDIGO/DOCS (dados já estão no Sheets)
```

> Os dados **persistem automaticamente no Google Sheets** a cada `apply`/`sync`. Não há mais
> `ledger.jsonl` para commitar — o git guarda só código, docs e os fixtures sintéticos de
> `data/seed/`. O histórico dos dados fica no *Histórico de versões* da própria planilha.

Para abrir o dashboard no dia a dia: **`./start.sh`** (atualiza os relatórios a partir do Sheets
e sobe o front num comando só; `./start.sh --sync` puxa da Pluggy antes).

Comandos úteis de inspeção (só leitura, seguros):
```bash
uv run python main.py                          # confere conexão Sheets + Pluggy
uv run python -m finance.show stats
uv run python -m finance.show find "texto"
uv run python -m finance.show cat "Categoria/Sub"
uv run python -m finance.show tx <id-prefixo>
uv run python -m finance.categorize stats
```

---

## Banco no Google Sheets (4 abas)

| Aba | Conteúdo | Módulo |
|---|---|---|
| `Ledger` | 1 transação por linha | `finance/ledger.py` |
| `Rules` | regras de categorização | `finance/rules.py` |
| `Taxonomy` | categorias → subcategorias | `finance/taxonomy.py` |
| `Config` | blobs JSON: `budgets`, `sync_state`, `schema_version` | `finance/budgets.py`, `finance/sync.py` |

A camada de acesso é `finance/sheets.py` (auth via Service Account, 1 request por operação,
retry com backoff). Se algo falhar, `uv run python main.py` dá o diagnóstico. Para (re)inicializar
o banco: `uv run python -m finance.seed [--force]`.

---

## Contas (exemplo)

As contas vêm dos `items` conectados na Pluggy. Cada `account` tem `account_name`, `account_type`
(`BANK` | `CREDIT`) e `account_id` (UUID). Exemplos nos dados de demonstração:

| account_name | Tipo | Notas |
|---|---|---|
| Conta Corrente | BANK | conta corrente |
| Cartão de Crédito | CREDIT | cobranças internacionais em USD podem precisar de `amount_override` |
| Conta Pagamento | BANK | conta de pagamento / carteira |

---

## Ledger (aba `Ledger`)

Uma transação por linha. Chave = `id` (UUID da Pluggy, ou `manual-*`/`pix-YYYYMMDD-nome` para
entradas manuais).

Campos relevantes:
- `signed_amount` — valor com sinal (negativo = saída, positivo = entrada)
- `amount_override` — sobrepõe `signed_amount` nos relatórios (usar quando a Pluggy grava valor
  errado, ex.: cobranças USD em cartão)
- `category` / `subcategory` — classificação (deve existir na aba `Taxonomy`)
- `category_source` — `"rule"` | `"pluggy-map"` | `"manual"` | `"split"`
- `splits` — array `[{amount, category, subcategory, note}]` onde a soma = valor efetivo
- `note` — observação livre (aparece no hover do dashboard)
- `needs_review` / `reviewed` — controle de qualidade interno

**Valor efetivo** = `amount_override` se definido, senão `signed_amount`.

---

## Categorização — como escrever `data/.decisions.json`

Arquivo de trabalho **efêmero e local** (gitignored). O `apply` lê ele e grava o resultado na
aba `Ledger` do Sheets.

```json
{
  "assignments": [
    {
      "ids": ["uuid-completo"],
      "category": "Alimentação",
      "subcategory": "Restaurante",
      "note": "Texto opcional"
    },
    {
      "ids": ["uuid-completo"],
      "category": "Transporte",
      "subcategory": "App/Táxi",
      "amount_override": -77.00,
      "note": "Pluggy gravou USD, valor real R$77"
    },
    {
      "ids": ["uuid-completo"],
      "splits": [
        {"amount": -150.00, "category": "Lazer", "subcategory": "Viagem", "note": "Minha parte"},
        {"amount": -150.00, "category": "Compartilhado", "subcategory": "Outro", "note": "Parte de terceiro"}
      ]
    }
  ],
  "confirm_provisional": false
}
```

Depois: `uv run python -m finance.categorize apply && uv run python -m finance.report`

---

## Taxonomia

**Não está no código.** Categorias, subcategorias, tratamento, cor e ícone vivem na aba
`Taxonomy` da planilha, e cada pessoa tem as suas. Para ver as atuais:

```bash
uv run python -m finance.show stats          # contadores por categoria
```

O **tratamento** de cada categoria decide como ela entra na conta:

| tratamento | efeito |
|---|---|
| `fluxo` | conta em Receitas/Gastos (padrão) |
| `poupança` | não é gasto; alimenta "Poupado" e a taxa de poupança |
| `movimento` | fora da conta, só auditoria (transferências, rateios) |

`data/seed/taxonomy.yaml` é só a **semente de demonstração**, para quem começa do zero.

Ao adicionar ou renomear categorias, avise o Claude para reclassificar o que for preciso
e para conferir se as regras da aba `Rules` e o mapa da `PluggyMap` continuam apontando
para nomes que existem.

---

## Padrões recorrentes (aplique sem perguntar)

> Os nomes de categoria abaixo são **exemplos** da taxonomia de demonstração. Confira os
> equivalentes na aba `Taxonomy` antes de gravar.

### Compromissadas / aplicações automáticas
Entradas com "APLICAÇÃO COMPROMISSADA"/"RECOMPRA COMPROMISSADA" → `Investimentos/Aporte` ou
`Investimentos/Resgate`. "IRRF" → `Impostos/Taxas/Impostos`. "Rendimento automático" →
`Investimentos/Rendimentos`. Costumam aparecer em pares e são auto-categorizáveis em lote.

### Cobranças internacionais (cartão de crédito)
A Pluggy às vezes grava o valor em USD em vez de BRL. Quando o valor real em BRL for informado,
usar `amount_override`. Ex.: Pluggy gravou -6.26, valor real -77.00 → `"amount_override": -77.00`.

### PIX para terceiros como proxy de pagamento
Quando se paga via PIX para alguém que comprou algo em seu nome:
1. Marcar o PIX original como `Transferências/TED/DOC` com nota "Proxy PIX → detalhado abaixo".
2. Criar entradas individuais no ledger com IDs `pix-YYYYMMDD-nome` para cada compra real
   (copiando `item_id`, `account_id`, `account_name`, `date`, `datetime` do PIX original).

### Gastos compartilhados (splits)
Quando parte é sua e parte é adiantada para outra pessoa (reembolso esperado/recebido):
- Sua parte → categoria real (ex.: `Lazer/Viagem`).
- Parte do outro → `Compartilhado/Outro` com nota indicando reembolso pendente/recebido.

O reembolso, quando chega (PIX recebido), → `Compartilhado/Outro` para anular o saldo.

### Entradas em moeda estrangeira (cartão/conta multimoeda)
Para entradas manuais em USD: `signed_amount` = valor original em USD (negativo),
`amount_override` = valor preciso em BRL (USD × taxa), `currency` = `"USD"`. **Sempre cruzar a
unidade com a fonte antes de recalcular** — não multiplicar pela taxa um valor que já está em BRL.

---

## Fila do Claude (`data/.claude_queue.jsonl`)

Arquivo **local efêmero** (gitignored). O dashboard permite "mandar pro Claude" — grava itens na
fila com nota e sugestão de categoria. Ao iniciar sessão, sempre verificar:
```bash
uv run python -m finance.show queue
```
Processar todos os itens, depois limpar o arquivo:
```python
open("data/.claude_queue.jsonl", "w").close()
```

---

## Segurança

- `.env` (SHEET_ID + credenciais Pluggy) e `credentials.json` (chave da Service Account) estão no
  `.gitignore` — **nunca commitar, nunca expor**.
- Os dados financeiros vivem na **planilha do Google Sheets do usuário**, fora do git.
- Arquivos de trabalho efêmeros e locais (`data/.to_categorize.json`, `data/.decisions.json`,
  `data/.budget_input.json`, `data/.claude_queue.jsonl`) e os relatórios gerados
  (`data/reports/`) também estão no `.gitignore`.
- `data/seed/` é versionado de propósito: são **fixtures sintéticos**, nunca dados reais.
