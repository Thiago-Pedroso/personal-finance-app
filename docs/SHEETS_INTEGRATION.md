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

## 3. Esquema do banco (13 abas)

Sete abas do controle de gastos e seis do controle de investimentos. As de investimento
só são criadas para quem usa a carteira.

A linha 1 de cada aba é o cabeçalho. Tipos entre parênteses referem-se à coerção em
`finance/sheets.py` (`str` texto; `opt` texto opcional/vazio=None; `float` número; `fnum`
número opcional; `bool` TRUE/FALSE; `json` serializado como JSON; `qnum` número vindo de
fórmula, tolerante a `#N/A`).

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
| `splits` | json | `[{amount, category, subcategory, note, settle_with?}]` ou vazio |
| `note` | opt | observação livre |
| `amount_override` | fnum | sobrepõe `signed_amount` nos relatórios |
| `synced_at` | opt | timestamp do sync |
| `tags` | json | lista de etiquetas pessoais, por exemplo `["Viagem"]` |
| `settle_with` | opt | com quem o valor vai ser acertado (pessoa ou instituição); marca pendência até ser abatido |

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
| `amount_abs_min`, `amount_abs_max` | fnum (faixa de valor absoluto, inclusiva nos dois lados; min = max significa "igual a"). Regras com faixa são testadas antes das sem faixa |
| `created_at` | opt |
| `propagate_note` | bool — quando `TRUE`, `note` também é gravado na transação toda vez que a regra casar; quando `FALSE` (padrão), `note` é só documentação da regra |
| `instruction` | opt (o que o agente deve fazer quando a regra casar; listado em `finance.show queue`, nunca vai para a transação) |

### Aba `Taxonomy` — uma categoria por linha

| coluna | tipo | para que serve |
|---|---|---|
| `Category` | str | nome da categoria |
| `Subcategories` | str | separadas por vírgula |
| `Treatment` | str | `fluxo` (conta em Receitas/Gastos), `poupança` (vira "Poupado") ou `movimento` (fora da conta, só auditoria) |
| `Color` | opt | hex do chip e do gráfico, ex.: `#2a78d6` |
| `Icon` | opt | nome de um ícone `lucide-react`, ex.: `Utensils` |
| `Essential` | bool | entra na base de cálculo da reserva de emergência |

`taxonomy.load()` devolve `{categoria: [subs]}`; `load_full()` devolve
`(taxonomia, tratamentos, meta)` numa leitura só.

As quatro últimas colunas são **opcionais**: uma planilha antiga, com só
`Category` e `Subcategories`, continua sendo lida (o `Treatment` cai num
fallback por categoria e cor/ícone caem num neutro). Elas aparecem sozinhas na
próxima gravação da aba.

Cor e ícone vivem aqui, e não no código, para que o dashboard não precise
conhecer os nomes das suas categorias — cada pessoa tem as suas.

### Aba `SubcategoryMeta`: apresentação opcional por subcategoria

| coluna | tipo | para que serve |
|---|---|---|
| `Category` | str | categoria existente na aba `Taxonomy` |
| `Subcategory` | str | subcategoria existente dentro da categoria |
| `Color` | opt | cor hexadecimal própria, por exemplo `#d7a21e` |
| `Icon` | opt | nome opcional de um ícone `lucide-react` |

Quando não há uma linha configurada, o dashboard deriva uma cor estável sem persistir dados.
As preferências pessoais continuam somente na planilha. Cores escuras são ajustadas apenas
na renderização para manter contraste adequado; o valor salvo não é alterado.

### Aba `PluggyMap` — categoria da Pluggy → categoria sua

| `PluggyCategory` (str) | `Category` (str) | `Subcategory` (opt) |
|---|---|---|
| Eating out | Alimentação | Restaurante |
| Groceries | Alimentação | Supermercado |

Semente do `data/seed/pluggy_map.yaml`, usada como **dica**: o `categorize`
descarta o que não existir na sua taxonomia. Sem a aba, o mapa cai no fixture.

### Aba `Reimbursements`: uma entrada abate uma saída

| Coluna | Tipo |
|---|---|
| `id` | str (`ab_0001`) |
| `credit_id`, `debit_id` | str (id do lançamento que abate e do abatido) |
| `credit_part`, `debit_part` | fnum (índice da parte do split; vazio = lançamento inteiro) |
| `amount` | float (valor abatido, sempre positivo) |
| `note` | opt |
| `created_at` | opt |

A soma abatida nunca passa do valor de cada lado. Vínculo inválido é ignorado no relatório
com aviso. Em categoria de `fluxo`, o valor abatido sai da conta no mês de cada lado; em
`movimento` e `poupança` o vínculo só registra que a pendência foi acertada.

### Aba `Config` — blobs JSON (chave/valor)

| `key` | `value` (JSON) |
|---|---|
| `budgets` | o objeto de orçamento inteiro (income_plan, spending, savings_goals) |
| `sync_state` | cursores de sincronização por conta |
| `timezone` | fuso IANA usado nas datas locais, por exemplo `America/Sao_Paulo` |
| `min_transaction_date` | piso opcional (`YYYY-MM-DD`); o sync descarta lançamentos anteriores |
| `schema_version` | versão do esquema (atualmente `9`) |
| `invest_monthly_contribution` | aporte mensal usado como padrão no simulador |
| `invest_contribution_mode` | modo do simulador de aporte: `spread` ou `focus` |
| `invest_allocation_sim` | rascunho da aba Simulador: `{base, items: [{label, amount}]}` — nunca vira trade |
| `invest_destination_subcategories` | subcategorias de poupança que pedem destino na carteira; ausente = `["Aporte", "Resgate"]` |

---

## 3b. Abas de investimento

### Aba `InvestTrades` — uma movimentação por linha

`id` · `date` · `ticker` · `side` · `quantity` (fnum) · `price` (fnum) · `fees` (fnum) ·
`currency` · `fx_rate` (fnum) · `account` · `note` · `source` · `ledger_id` · `created_at`

É a única entrada de fatos: todo o resto é derivado daqui. `side` cobre `BUY`, `SELL`,
`DIVIDEND`, `JCP`, `SPLIT`, `ADJUST`, `BALANCE` (saldo informado de ativo sem cotação) e
`TRANSFER` (dinheiro do Fluxo que chegou numa conta; não mexe no saldo, só liga a origem).
Compra em moeda estrangeira guarda o preço na moeda de origem e o câmbio do dia, para
depois separar o resultado do ativo do resultado do câmbio. `ledger_id` liga a operação à
transação bancária de origem: é o destino de um aporte ou resgate do Fluxo, e um lançamento
pode ter várias operações, desde que a soma não passe do valor dele.

### Aba `InvestAssets` — o catálogo

`ticker` · `name` · `node` · `account` · `sector` · `currency` · `quote_symbol` ·
`valuation` · `pluggy_code` · `target_pct` (fnum) · `lot_size` (fnum) · `active` (bool) ·
`note` · `isin`

`node` aponta para uma folha da política, `valuation` diz de onde vem o valor (`quote`,
`balance`, `pluggy` ou `account`) e `target_pct` é o alvo do ativo **dentro** da classe.
`account` é saldo de conta: não tem custo nem lucro, e o valor é o saldo que a Pluggy
informa. `isin` identifica o ativo quando o extrato cita o código ISIN em vez do ticker
(provento de ação alugada). `sector` é
texto livre: a lista do autocomplete nasce do que já está em uso, sem taxonomia no código.

`pluggy_code` guarda o código do papel na corretora **ou o id de uma conta**: saldo de
conta corrente é um ativo por saldo como qualquer outro, e é assim que ele se sincroniza.
Num ativo em moeda estrangeira, todo lançamento é gravado na moeda do ativo (`currency` do
lançamento vem do ativo quando não é informado) e a conversão para reais acontece na
leitura, pelo câmbio do momento, nunca pelo do dia em que o saldo foi informado. A linha de
câmbio (`USDBRL`) é criada sozinha na aba `Quotes`; sem ela o valor em reais fica pendente
e aparece nos avisos, em vez de o dólar virar real em silêncio.

### Aba `InvestAccounts` — onde o dinheiro está

`id` · `name` · `institution` · `kind` · `pluggy_item_id` · `currency`

`kind` separa `broker`, `wallet` e `bucket` (conta de caixinhas). `pluggy_item_id` amarra a
conta ao item da Pluggy, que é o que permite comparar o total informado pela instituição
com a divisão que você fez.

### Aba `InvestPolicy` — a política como árvore

`node` · `name` · `parent` · `target_pct` (fnum) · `in_totals` (bool) · `role` · `color` ·
`icon`

`node` é id estável e `name` é o rótulo editável, então renomear uma classe não quebra o
histórico. `target_pct` é a fatia dentro do pai, e o alvo de uma folha é o produto do
caminho até a raiz. `in_totals=FALSE` tira o nó do denominador dos percentuais e do
rebalanceamento, sem tirar o dinheiro do patrimônio.

`role` diz o que o nó representa e aceita quatro valores, os únicos fixos no código:

| role | o que é | entra no rebalanceamento |
|---|---|---|
| `strategy` (padrão) | a carteira | sim, se `in_totals` |
| `reserved` | guardado com um destino | não |
| `to_invest` | saiu da conta, ainda não virou posição | não |
| `free` | saldo sem compromisso | não |

Quantos nós existem em cada papel, e como se chamam, é escolha do usuário. Um nó
`strategy` com `in_totals=FALSE` é o caso de cripto: faz parte da carteira e fica fora
dos alvos.

### Aba `Quotes` — a única com fórmula

`ticker` · `quote_symbol` · `price` (qnum) · `currency` · `kind` · `updated_at` (qnum) ·
`last_price` (fnum) · `last_price_at`

`price` guarda a chamada do `GOOGLEFINANCE` e a API devolve o resultado já calculado. As
fórmulas são escritas **sem separador de argumentos**, porque esse caractere segue o locale
da planilha:

```
Ação BR / FII     =GOOGLEFINANCE("BVMF:WEGE3")
Stock / ETF EUA   =GOOGLEFINANCE("VOO")*GOOGLEFINANCE("CURRENCY:USDBRL")
Cripto            =GOOGLEFINANCE("CURRENCY:BTCUSD")*GOOGLEFINANCE("CURRENCY:USDBRL")
Câmbio            =GOOGLEFINANCE("CURRENCY:USDBRL")
```

`updated_at` guarda `=NOW()`, que serve para detectar planilha que parou de recalcular.
`last_price` guarda o último valor bom: uma falha momentânea da fórmula marca a cotação
como defasada em vez de zerar a posição.

> Esta aba **não aceita** `write_records()`: reescrever com `RAW` transformaria a fórmula
> em texto. Use `append_rows()` e `update_fields(..., value_input_option="USER_ENTERED")`.
> A lista de abas protegidas está em `sheets.FORMULA_TABS`.

### Aba `InvestSnapshots` — o histórico

`date` · `node` · `value` (float) · `cost` (float)

Uma linha por nó por dia, gravada a cada `finance.invest report`. Rodar duas vezes no mesmo
dia substitui em vez de duplicar. É o histórico de patrimônio que a planilha nunca teve.

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
| `ensure_current_schema()` | acrescenta abas e colunas novas sem remover dados |
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

Atualizações de schema são aplicadas por `uv run python -m finance.migrate`. O `start.sh`, o
sync e a categorização também conferem a versão antes de gravar. A migração da versão 3 adiciona
`Config[timezone]` e recalcula datas importadas da Pluggy a partir do timestamp UTC. A versão 4
acrescenta a aba opcional `SubcategoryMeta` sem alterar a taxonomia existente. Use
`uv run python -m finance.migrate --dry-run` para conferir a quantidade de registros antes de
gravar. Datas de lançamentos manuais são preservadas.

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
