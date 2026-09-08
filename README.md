# Finance Control

Assistente de controle financeiro pessoal operado **via [Claude Code](https://claude.com/claude-code)**,
com dados do **Open Finance** (via [Pluggy](https://pluggy.ai)) e um **banco de dados no Google
Sheets**. Um pipeline Python enxuto busca as transações, aplica regras determinísticas de
categorização e gera relatórios; o Claude Code categoriza o que sobra na conversa e aprende
novas regras. Um dashboard React (leitura + edição leve) visualiza tudo.

> **Princípio central:** a categorização assistida por IA é feita pelo próprio agente do
> Claude Code na conversa — **sem chave de API de modelo, sem custo extra**. O Python só faz
> o trabalho mecânico (buscar, aplicar regras, agregar). Veja [`CLAUDE.md`](CLAUDE.md) para o
> contrato de operação.

> 🔒 **Seus dados moram na SUA planilha do Google Sheets** — privados, na sua conta, fora do
> git. Por isso o repositório é público e colaborável sem expor as finanças de ninguém. Os
> dados de exemplo em `data/seed/` são **sintéticos/fictícios**, só para o onboarding.

## Funcionalidades

- **Banco de dados no Google Sheets**: ledger, regras, taxonomia (com metadados visuais
  de categorias e subcategorias), mapa da Pluggy e orçamento vivem numa
  planilha sua; nada de dados financeiros no git.
- **Sync incremental** das transações da Pluggy (`finance.sync`).
- **Categorização** por regras determinísticas + loop assistido pelo Claude, com
  **aprendizado de regras** retroativo (`finance.categorize`).
- **Relatórios** mensais (JSON + Markdown) e um `dashboard.json` agregado (`finance.report`).
- **Tags pessoais** em múltiplos lançamentos, com edição em massa, filtros e análise por
  período. As tags ficam somente na planilha de cada usuário.
- **Dashboard React/Vite**: visão geral, transações com filtros, análise por categoria,
  análise por tags, planejamento/orçamento, fila de revisão, edição via o mesmo pipeline,
  splits e drill-down global.
- **Modo de privacidade** no dashboard: oculta valores agregados sem esconder percentuais,
  gráficos ou lançamentos individuais. A preferência fica somente no navegador.
- **Seed de demonstração** — um comando popula sua planilha com um banco mocado funcional.
- **Espaço Investimentos**: carteira derivada das suas movimentações, com cotação vinda do
  `GOOGLEFINANCE` da própria planilha, política de alocação em árvore, simulador de aporte
  e caixinhas. Detalhes em [Investimentos](#investimentos).

## Stack

- **Backend:** Python 3.13 + [uv](https://docs.astral.sh/uv/), `pluggy-sdk`, `gspread` +
  `google-auth` (Google Sheets), `pyyaml`, `python-dotenv`.
- **Dados:** Google Sheets (fonte da verdade). Relatórios gerados localmente em `data/reports/`.
- **Frontend:** Vite + React 18 + Tailwind v4 + Recharts + TanStack Table.

## Setup / Onboarding

### 1. Google Sheets (banco de dados)

O app guarda seus dados numa planilha sua, acessada por uma **Service Account** — uma "conta de
robô" do Google Cloud (um e-mail + uma chave JSON) que o programa usa para ler/gravar a planilha
**sem abrir navegador nem pedir seu login**. Você faz esta configuração **uma vez só**. As
instruções abaixo seguem os nomes do console em português.

**1.1. Crie um projeto no Google Cloud.** Acesse [https://console.cloud.google.com](https://console.cloud.google.com), clique no
seletor de projeto no topo → *Novo projeto* → dê um nome (ex.: `finance-control`) → *Criar*.

**1.2. Habilite as duas APIs.** No menu ☰ → *APIs e serviços* → *Biblioteca*. Busque
**"Google Sheets API"**, abra e clique *Ativar*. Volte à Biblioteca, busque **"Google Drive API"**
e clique *Ativar* também. (O app precisa do Drive para abrir a planilha pelo ID.)

**1.3. Crie a Service Account.** Menu ☰ → *APIs e serviços* → *Credenciais* → botão
*+ Criar credenciais* → **Conta de serviço**. Dê um nome (ex.: `finance-bot`), clique *Criar e
continuar* e depois *Concluir* (pode pular as etapas de papel/acesso).

**1.4. Gere a chave JSON.** De volta na tela *Credenciais*, na seção **Contas de serviço**,
**clique na conta que você acabou de criar**. Abra a aba **Chaves** (Keys) → *Adicionar chave* →
*Criar nova chave* → escolha o tipo **JSON** → *Criar*. O navegador baixa um arquivo `.json` —
**salve-o como `credentials.json` na raiz do projeto** (a pasta `finance-control/`). Ele já está
no `.gitignore`.

**1.5. Copie o e-mail da Service Account.** Ainda na conta de serviço, na aba *Detalhes* (ou na
lista de Credenciais), copie o **e-mail** dela — é algo como
`finance-bot@finance-control.iam.gserviceaccount.com`. (Ele também está dentro do
`credentials.json`, no campo `"client_email"`.)

**1.6. Crie a planilha e compartilhe com a Service Account.** No [https://sheets.google.com](https://sheets.google.com) crie
uma **planilha em branco** (você é o dono). Clique em *Compartilhar* e cole o **e-mail da Service
Account** do passo anterior, dando permissão de **Editor**. ⚠️ **Este é o passo que mais gente
esquece** — sem ele o app dá "permission denied".

**1.7. Pegue o SHEET_ID.** Está na URL da planilha, entre `/d/` e `/edit`:
`https://docs.google.com/spreadsheets/d/`**`<SHEET_ID>`**`/edit`.

**1.8. Configure o `.env` e popule a demo:**

```bash
cp .env.example .env
# no .env, preencha SHEET_ID=<o id do passo 1.7>
# (GOOGLE_SA_CREDENTIALS já aponta para credentials.json por padrão)

uv run python -m finance.seed        # cria as abas e enche com dados fictícios
uv run python main.py                # confere a conexão e mostra as abas
```

Detalhes, esquema das abas e troubleshooting: [`docs/SHEETS_INTEGRATION.md`](docs/SHEETS_INTEGRATION.md).

### 2. Pluggy (Open Finance) — opcional para começar

Para trazer suas transações reais, preencha também no `.env`:

```
CLIENT_ID, CLIENT_SECRET, ITEM_IDS   # credenciais de https://dashboard.pluggy.ai
```

Sem isso, você ainda explora o app inteiro com os dados de demonstração do seed.

### 3. Frontend

```bash
cd frontend && npm install
```

## Operação (fluxo recorrente)

Para abrir o app no dia a dia, um comando só (atualiza os relatórios a partir do Sheets e sobe
o dashboard):

```bash
./start.sh            # atualiza + dashboard em http://localhost:5273
./start.sh --sync     # puxa transações novas da Pluggy antes de atualizar
```

Ou os passos individuais, em linguagem natural com o Claude Code ou direto pelo CLI:

```bash
uv run python -m finance.sync --days 30     # puxa transações novas da Pluggy → Sheets
uv run python -m finance.categorize         # categoriza (+ apply --learn)
uv run python -m finance.report             # gera relatórios locais a partir do Sheets
uv run python -m finance.migrate            # acrescenta campos novos sem apagar dados
uv run python -m finance.migrate --dry-run  # confere migrações de data sem gravar
```

Comandos de inspeção (somente leitura):

```bash
uv run python -m finance.show stats
uv run python -m finance.show queue
uv run python -m finance.show find "texto"
```

## Investimentos

O segundo espaço do app acompanha a carteira. Ele é opcional: quem só quer controlar
gastos nunca precisa criar as abas.

```bash
uv run python -m finance.seed --invest       # carteira de demonstração (dados sintéticos)
uv run python -m finance.invest report       # gera data/reports/invest.json
uv run python -m finance.invest show         # resumo no terminal
uv run python -m finance.invest plan 3000    # simula um aporte
uv run python -m finance.invest sync         # confere com as corretoras (Pluggy)
uv run python -m finance.invest apply        # aplica data/.invest_decisions.json
```

**Onde o dinheiro está.** O app separa o patrimônio pelo compromisso de cada real, não
por onde ele está guardado. Quem decide é a coluna `role` de cada nó da política:

| role | o que é |
|---|---|
| `strategy` | a carteira, o que entra no rebalanceamento |
| `reserved` | guardado com um destino (reserva de emergência, viagem, entrada do imóvel) |
| `to_invest` | já saiu da conta e ainda não virou posição |
| `free` | saldo sem compromisso |

Só esses quatro valores são fixos. Quantos nós existem em cada papel, e como se chamam,
é escolha sua.

**Como o valor de cada ativo é apurado.** Três fontes, escolhidas por ativo na coluna
`valuation`:

| valuation | de onde vem | para quê |
|---|---|---|
| `quote` | fórmula `GOOGLEFINANCE` na aba `Quotes` | ações, FIIs, ETFs, cripto, câmbio |
| `balance` | saldo que você informa, com data | conta no exterior, caixinha, papel sem cotação |
| `pluggy` | saldo sincronizado da instituição | Tesouro, CDB, fundos e **saldo de conta corrente** |

Saldo de conta é um ativo por saldo como qualquer outro: aponta para a conta pelo
`pluggy_code` e se atualiza no `sync`. Fatura de cartão fica de fora, porque é dívida.
Saldo em moeda estrangeira é informado na moeda dele e convertido pelo câmbio do dia em que
você olha, não pelo do dia em que foi informado.

A aba `Quotes` é a única com fórmula. O app escreve a chamada quando um ticker novo
aparece e lê o resultado já calculado, então não existe chave de API nem preço digitado à
mão. A cotação da bolsa tem o atraso de licenciamento de sempre (cerca de 20 minutos) e a
tela mostra o horário do último cálculo em vez de fingir que é agora.

**Política de alocação.** A aba `InvestPolicy` é uma árvore: `target_pct` é a fatia do nó
dentro do pai, e o alvo de uma folha é o produto do caminho até a raiz. A forma é livre,
então dá para tirar o nível de país, trocar "EUA" por "Global" ou acrescentar um terceiro
país sem tocar em código. `in_totals: FALSE` mantém o dinheiro no patrimônio e o tira do
rebalanceamento, que é como cripto, reserva e caixinha entram.

**Premissas que valem conhecer.**

- Preço médio é a média ponderada **só das compras**, a regra brasileira. Uma venda reduz a
  quantidade, preserva o preço médio e produz resultado realizado.
- Rentabilidade é lucro dividido por custo, nunca a soma dos percentuais das classes.
- O motor de aporte **nunca sugere venda**: rebalanceia com dinheiro novo, e o que não cabe
  num lote inteiro fica visível como sobra.
- A Pluggy entrega posição boa e transação fraca, então ela **compara e avisa**, sem
  escrever na carteira. Diferença de quantidade pede a movimentação que falta; diferença de
  valor em ativo por saldo vira lançamento de atualização.
- **Transação de investimento da Pluggy nunca é importada.** Numa conta real, das 68 que
  ela tinha, todas eram compra, nenhuma venda, nenhum provento, quatro ativos sem nenhuma
  e uma compra fatiada em onze linhas de uma cota. Elas não reconstroem carteira, então o
  caminho automático é só o saldo.
- `BUY` diz quanto dinheiro entrou e `BALANCE` diz quanto o ativo vale. São dimensões
  diferentes: registrar um não altera o outro, e num ativo sincronizado os dois convivem.
- Imposto está fora do escopo: o app não calcula DARF nem controla faixa de isenção.

**Quem já tem uma planilha** pode importar o histórico:

```bash
uv run python -m finance.invest.import_sheet <ID_DA_PLANILHA_ANTIGA>
uv run python -m finance.invest apply
```

## Estrutura

```
finance/        # pipeline Python (sync, rules, categorize, report, sheets, seed, ...)
  sheets.py     # camada de acesso ao Google Sheets (banco de dados)
  seed.py       # inicializa a planilha com o banco de demonstração
  invest/       # carteira: política, ativos, movimentações, cotações, aporte, Pluggy
frontend/       # dashboard React (Vite)
data/
  seed/         # fixtures SINTÉTICOS do banco mocado (versionados) — fonte do seed
  reports/      # YYYY-MM.{json,md} + dashboard.json + invest.json (gerados; gitignored)
docs/
  SHEETS_INTEGRATION.md  # esquema do banco, auth, quotas, troubleshooting
CLAUDE.md       # contrato de operação (lido pelo Claude Code a cada sessão)
```

## Segurança

- `credentials.json` (chave da Service Account) e `.env` (SHEET_ID + credenciais Pluggy)
  **nunca devem ser commitados** — estão no `.gitignore`.
- Seus dados financeiros vivem na **sua** planilha do Google Sheets, não no repositório.
- Backup: o Google Sheets mantém *Histórico de versões* nativo (*Arquivo → Histórico de versões*).

## Testes

```bash
PYTHONPATH=. uv run python tests/test_sheets_roundtrip.py   # coerção de tipos (sem rede)
PYTHONPATH=. uv run python tests/test_pipeline_inmemory.py  # pipeline end-to-end (em memória)
PYTHONPATH=. uv run python tests/test_schema_migration.py    # migração aditiva (sem rede)
```
