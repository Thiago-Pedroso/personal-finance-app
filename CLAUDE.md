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
2. uv run python -m finance.show queue         # Fila do Claude + instruções das regras
3. escrever data/.decisions.json + apply       # categoriza o que chegou (grava no Sheets)
4. uv run python -m finance.report             # SEMPRE rodar após qualquer categorização
5. git commit                                  # commitar só CÓDIGO/DOCS (dados já estão no Sheets)
```

Mexeu na carteira? `uv run python -m finance.invest report` depois de qualquer `apply`,
pelo mesmo motivo do passo 4.

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

## Banco no Google Sheets (7 abas de gastos + 6 de investimentos)

| Aba | Conteúdo | Módulo |
|---|---|---|
| `Ledger` | 1 transação por linha | `finance/ledger.py` |
| `Rules` | regras de categorização | `finance/rules.py` |
| `Taxonomy` | categorias → subcategorias | `finance/taxonomy.py` |
| `SubcategoryMeta` | cor e ícone opcionais por subcategoria | `finance/taxonomy.py` |
| `PluggyMap` | categoria da Pluggy → taxonomia pessoal | `finance/pluggy_map.py` |
| `Reimbursements` | abatimentos: qual entrada abate qual saída, e quanto | `finance/reimbursements.py` |
| `Config` | blobs JSON: `budgets`, `sync_state`, `timezone`, `min_transaction_date`, `schema_version`, `invest_monthly_contribution`, `invest_contribution_mode`, `invest_allocation_sim`, `invest_destination_subcategories` | `finance/budgets.py`, `finance/sync.py` |
| `InvestTrades` | 1 movimentação por linha (a única entrada de fatos da carteira) | `finance/invest/trades.py` |
| `InvestAssets` | catálogo: classe, conta, setor, alvo, como o valor é apurado | `finance/invest/assets.py` |
| `InvestAccounts` | onde o dinheiro está custodiado (corretora, carteira, caixinhas) | `finance/invest/accounts.py` |
| `InvestPolicy` | política de alocação como árvore, com o papel de cada nó | `finance/invest/policy.py` |
| `Quotes` | cotações via `GOOGLEFINANCE` (**única aba com fórmula**) | `finance/invest/quotes.py` |
| `InvestSnapshots` | 1 linha por nó por dia: histórico de patrimônio | `finance/invest/report.py` |

`Config[timezone]` guarda o fuso IANA usado para transformar timestamps UTC da Pluggy em datas
locais. O padrão é `America/Sao_Paulo`; nunca derive datas financeiras do fuso do computador.

A camada de acesso é `finance/sheets.py` (auth via Service Account, 1 request por operação,
retry com backoff). Se algo falhar, `uv run python main.py` dá o diagnóstico. Para (re)inicializar
o banco: `uv run python -m finance.seed [--force]`.

---

## Investimentos (segundo espaço do app)

Carteira derivada das movimentações, com cotação vinda do `GOOGLEFINANCE` da própria
planilha. É opcional: quem só controla gastos nunca cria essas abas.

```bash
uv run python -m finance.invest show          # resumo da carteira
uv run python -m finance.invest plan 3000     # simula um aporte
uv run python -m finance.invest report        # gera data/reports/invest.json
uv run python -m finance.invest sync          # confere com as corretoras via Pluggy
uv run python -m finance.invest apply         # aplica data/.invest_decisions.json
uv run python -m finance.seed --invest        # carteira de demonstração (sintética)
```

### Como registrar pela conversa: `data/.invest_decisions.json`

Arquivo **efêmero e local** (gitignored), espelho do `.decisions.json` da categorização.

```json
{
  "trades":   [{"date": "2026-09-07", "ticker": "SAPR11", "side": "BUY",
                "quantity": 30, "price": 4.5, "account": "xp"}],
  "balances": [{"ticker": "INTER-GLOBAL", "date": "2026-09-07", "value": 13450}],
  "assets":   [{"ticker": "SAPR11", "node": "fiis", "sector": "Saneamento",
                "target_pct": 0.1}],
  "targets":  {"acoes": {"BBAS3": 0.07}},
  "locked":   {"acoes": ["ITUB3"]},
  "links":    [{"ledger_id": "uuid-do-aporte", "destinations": [
                 {"ticker": "VIAGEM", "amount": 1200}]}]
}
```

Depois: `uv run python -m finance.invest apply`. Ticker que ainda não existe é cadastrado
sozinho, com o símbolo deduzido do formato e a linha de cotação criada; a **classe** dele
fica pendente, porque isso é decisão de política.

### Onde o dinheiro está

Cada nó da política tem um `role`, e é ele que divide o patrimônio em quatro números:
`strategy` (a carteira), `reserved` (guardado com destino), `to_invest` (guardado para
investir, ainda em conta) e `free` (sem compromisso). Só o vocabulário é fixo: quantos nós
existem em cada papel, e os nomes deles, são do usuário.

Três tipos de lugar, pelo `valuation` do ativo:

- **Conta** (`account`): saldo de conta com `pluggy_code` = id da conta, atualizado no
  `sync`. Sem custo nem lucro. Conta de corretora fica num nó `to_invest`: o saldo dela é
  o dinheiro a aportar. Cartão de crédito não entra: fatura é dívida.
- **Caixinha** (`balance`): saldo separado por objetivo dentro de um banco, com rendimento
  rateado.
- **Ativo**: cotação (`quote`) ou saldo da corretora (`pluggy`).

Só se registra **fato**: dinheiro na corretora é "a aportar" até virar posição. Intenção
("esse dinheiro é para a viagem") fica no Simulador, nunca na carteira.

### Ligação com o Fluxo (destino)

Todo lançamento de categoria `poupança` com subcategoria de aporte ou resgate precisa de
**destino** (os nomes vêm de `Config[invest_destination_subcategories]`, padrão
`["Aporte", "Resgate"]`): movimentações com o `ledger_id` dele somando o valor. Defina com `links` no
`.invest_decisions.json` (ou pelo campo de destino na edição do lançamento):

- Caixinha: aporte vira `BUY`, resgate vira `SELL`.
- Conta (PIX para a corretora): vira `TRANSFER`, que só documenta a chegada.

**Poupança conta quando o dinheiro sai do dia a dia**: o PIX para a corretora é
`Investimentos/Aporte` com destino na conta dela. Transferência entre contas do próprio
usuário depois disso é `Transferências` (movimento).

Aporte sem destino aparece no `finance.show queue` (com os tickers de destino válidos), no
`sync`, na aba Revisar e na Visão Geral de Investimentos, e **suspende o rateio** do
rendimento das caixinhas daquela conta.

`statement_missing` no `sync` = a conta variou sem lançamento no Ledger (a Pluggy nem
sempre traz todas as transações, principalmente de conta de corretora): peça o extrato e
grave com `manual_transactions`.

### Regras do domínio (aplique sem perguntar)

- **Preço médio** é a média ponderada **só das compras**. Venda reduz a quantidade,
  preserva o preço médio e gera resultado realizado. Imposto está fora do escopo.
- **Rentabilidade** é lucro dividido por custo. Nunca somar os percentuais das classes.
- **Ativo por saldo** (`valuation: balance`): um `BALANCE` antes de qualquer movimento é
  abertura e vira custo; depois de um aporte, a diferença vira rendimento. Nunca lançar
  atualização de saldo como aporte.
- **A Pluggy compara, não escreve**: diferença de quantidade pede a movimentação que falta;
  diferença de valor em ativo por saldo vira `BALANCE`.
- **Proventos** saem da descrição do próprio ledger (`RENDIMENTOS DE CLIENTES VISC11 S/ 10`).
  Quando a quantidade não bate com a carteira, é sinal de compra não registrada.
- **Nunca sugerir venda** para rebalancear: só entra dinheiro novo.
- **Transação de investimento da Pluggy nunca é importada**, só posição. As que ela tem são
  incompletas e fatiadas, e não reconstroem a carteira.
- `BUY` é quanto entrou, `BALANCE` é quanto vale. Um não substitui o outro, e no mesmo dia
  só o último `BALANCE` conta.
- Saldo em moeda estrangeira fica gravado **na moeda do ativo** e usa o câmbio de hoje na
  leitura, nunca o do dia em que foi informado. Quem informa saldo informa na moeda do
  ativo; quem converte é o app.
- A aba `Quotes` não aceita `write_records()` (viraria texto). Use `append_rows()` ou
  `update_fields(..., value_input_option="USER_ENTERED")`.

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
- `tags` — lista JSON de etiquetas pessoais, independente da categoria
- `settle_with` — com quem o valor vai ser acertado (pessoa ou instituição), em qualquer
  categoria; também existe em cada parte de `splits`. Enquanto não for totalmente abatido,
  aparece como pendência em "Em aberto"
- `needs_review` / `reviewed` — controle de qualidade interno

**Valor efetivo** = `amount_override` se definido, senão `signed_amount`.

---

## Categorização — como escrever `data/.decisions.json`

Arquivo de trabalho **efêmero e local** (gitignored). O `apply` lê ele e grava o resultado na
aba `Ledger` do Sheets.

Antes de categorizar um lojista/descrição que não bate com nenhuma regra em `Rules`, procure no
Ledger se ele já apareceu antes — às vezes já tem precedente (categoria e principalmente `note`)
que nunca virou regra determinística. `uv run python -m finance.show find "texto"` acha as
ocorrências, mas não imprime `note`; pra ver a nota grave um script curto lendo `L.load_ledger()`
ou confira pelo dashboard. Encontrou precedente? Siga ele em vez de adivinhar de novo e, se for
recorrente, promova pra regra (ver `rules` abaixo) em vez de corrigir manualmente toda vez.

```json
{
  "rules": [
    {
      "field": "description",
      "match": "contains",
      "value": "texto do lojista",
      "category": "Supermercado",
      "note": "Nota que vai pra transação toda vez que casar",
      "propagate_note": true
    },
    {
      "field": "description",
      "match": "contains",
      "value": "lojista com preço fixo",
      "amount_abs_min": 99.90,
      "amount_abs_max": 99.90,
      "category": "Serviços & Assinaturas",
      "instruction": "O que o agente deve checar quando essa regra casar"
    }
  ],
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
        {"amount": -150.00, "category": "Terceiros", "subcategory": "Outro", "note": "Parte de terceiro",
         "settle_with": "Pedro"}
      ]
    },
    {
      "ids": ["uuid-1", "uuid-2"],
      "tags_add": ["Viagem Recife"],
      "tags_remove": ["Trabalho"]
    }
  ],
  "reimbursements": [
    {"credit_id": "uuid-do-pix", "debit_id": "uuid-do-gasto", "amount": 798.87,
     "note": "reembolso do gasto"},
    {"credit_id": "uuid-do-pix", "debit_id": "uuid-do-split", "debit_part": 1, "amount": 60}
  ],
  "reimbursements_remove": ["ab_0003"],
  "manual_transactions": [
    {"account_id": "uuid-da-conta", "date": "2026-09-15", "amount": 12.00,
     "description": "RENDIMENTOS DE CLIENTES ABCD11 S/ 20",
     "category": "Investimentos", "subcategory": "Rendimentos",
     "invest": {"ticker": "ABCD11", "side": "DIVIDEND", "quantity": 20}}
  ],
  "confirm_provisional": false
}
```

`manual_transactions` grava linhas de extrato que a Pluggy não trouxe, copiando os dados
da conta de um lançamento já sincronizado (o `account_id` sai de `finance.show tx` numa
linha da mesma conta). Linha igual a uma existente (mesma conta, data,
valor e descrição) é pulada. `invest` cria a movimentação da carteira já ligada à linha.

`rules` cria regras determinísticas (aba `Rules`), pra merchant recorrente que apareceu 2+ vezes
sem virar regra. `note` na regra é só documentação (por quê/como foi criada); só é gravada na
transação toda vez que a regra casar quando `propagate_note: true`. Sem esse flag (padrão
`false`), a nota fica interna e não aparece nas transações — use assim pra regras cujo `note` é
tipo "importado do Mobills" ou "dashboard <data>", não pra descrever a transação em si.

`amount_abs_min`/`amount_abs_max` (opcionais) restringem a regra a uma faixa de valor absoluto,
inclusiva nos dois lados; min = max significa "igual a". Regras com faixa são testadas antes das
sem faixa, então dá pra ter uma regra genérica do lojista e outra específica para um valor.

`instruction` (opcional) é uma ordem para o agente, escrita pelo usuário, que nunca vai para a
transação. O `finance.show queue` lista os lançamentos recentes que casaram com regras que têm
instrução: siga cada uma ao categorizar. Um lançamento resolvido com `assignment` vira `manual`
e sai da lista; os que não pedem ação continuam até sair da janela (`--days`, padrão 45).

Depois: `uv run python -m finance.categorize apply --learn --report` (o `--learn` só é
necessário quando o arquivo tem `rules`; sem elas, `apply --report` basta).

Tags são manuais e podem ser aplicadas em massa pelo dashboard ou pelo arquivo de decisões.
Não crie regras automáticas para tags. Valores reais de tags pertencem à planilha privada do
usuário e nunca devem entrar no repositório.

---

## Taxonomia

**Não está no código.** Categorias, subcategorias, tratamento, cor e ícone vivem nas abas
`Taxonomy` e `SubcategoryMeta` da planilha, e cada pessoa tem as suas. Para ver as atuais:

```bash
uv run python -m finance.show stats          # contadores por categoria
```

O **tratamento** de cada categoria decide como ela entra na conta:

| tratamento | efeito |
|---|---|
| `fluxo` | conta em Receitas/Gastos (padrão) |
| `poupança` | não é gasto; alimenta "Poupado" e a taxa de poupança |
| `movimento` | fora da conta, só auditoria (transferências, rateios) |

Os números do mês: **Poupado** = aportes − resgates (subcategorias de
`Config[invest_destination_subcategories]`); **Saldo** = Receitas − Gastos − Poupado, o que
ficou livre. Resgate volta para o Saldo sem virar receita. Rendimento fica fora dos três, e
qualquer outra subcategoria de poupança (custo, taxa) conta como fluxo. A parte com
destino num nó de papel `free` fica fora do Poupado e continua no Saldo.

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

### Abatimento e "Com quem" (sem interface)
Tudo pelo `data/.decisions.json` + `uv run python -m finance.categorize apply --report`.

1. **Registrar quem deve** (pendência): `settle_with` no lançamento ou na parte do split.
   ```json
   {"assignments": [{"ids": ["uuid-gasto"], "category": "Terceiros",
                     "subcategory": "Outro", "settle_with": "FUNAPE"}]}
   ```
   Categoria de terceiros = neutro desde já; categoria real = conta no fluxo até abater.
2. **Abater** quando o acerto chega (entrada abate saída, total ou parcial):
   ```json
   {"reimbursements": [{"credit_id": "uuid-pix", "debit_id": "uuid-gasto",
                        "amount": 798.87, "note": "reembolso"}]}
   ```
   Parte de split: `"debit_part": 1` (índice). Desfazer: `"reimbursements_remove": ["ab_0001"]`.
3. **Conferir**: `finance.show queue` lista possíveis reembolsos; "Em aberto" (aba
   Movimentações) mostra o que falta acertar.

Regras: a soma abatida nunca passa do valor de cada lado; em categoria de fluxo o abatido
sai da conta no mês de cada lado. Nunca use `amount_override` para simular abatimento.

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
  `data/.budget_input.json`, `data/.claude_queue.jsonl`, `data/.invest_decisions.json`,
  `data/.invest_pending.json`, `data/.reimbursements.json`) e os relatórios gerados (`data/reports/`) também estão no
  `.gitignore`.
- `data/seed/` é versionado de propósito: são **fixtures sintéticos**, nunca dados reais.
