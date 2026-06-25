# Plano — Assistente Financeiro pessoal via Claude Code

> Objetivo: controle total e **simples** dos seus gastos, categorizados com categorias/subcategorias
> previsíveis, com categorização assistida por IA (Claude Code), fluxo recorrente (dia/semana/mês),
> análise histórica e um front-end visual fácil de rodar. Dados do Open Finance via Pluggy
> (começa com um banco/conta; adicionar outros depois é só somar `ITEM_ID`, sem mudar código).

---

## 1. Princípio central de design (o que torna isto simples)

**A categorização é feita pelo próprio agente do Claude Code, na conversa — não por uma API paga.**

- O Python faz só o trabalho mecânico: buscar transações da Pluggy, aplicar **regras determinísticas**
  e montar um lote compacto do que ainda está sem categoria.
- O **Claude Code (você conversando comigo)** lê esse lote, sugere categoria/subcategoria, você
  confirma/ajusta, e um script grava de volta.
- Quando um padrão se repete (mesmo lugar → sempre "Alimentação"), o sistema **escreve uma regra
  nova automaticamente** em `data/rules.json`. Da próxima vez já vem categorizado sozinho —
  exatamente o que você pediu. Exceção: se uma transação fugir muito do padrão histórico daquele
  lugar (valor/tipo muito diferente), ela é marcada para revisão manual em vez de auto-aplicada.

Consequências boas: **zero chave de API extra**, zero custo de modelo além do próprio Claude Code,
setup mínimo, e funciona **independente** de a Pluggy estar no plano Pro ou não.

---

## 2. Arquitetura (a mais enxuta possível)

```
finance-control/
├── CLAUDE.md                 # contexto curto p/ toda sessão (arquitetura, fluxo, convenções)
├── PLAN.md                   # este documento
├── pyproject.toml            # uv (já existe) + deps novas
├── .env                      # CLIENT_ID / CLIENT_SECRET / ITEM_IDS  (gitignored — já está)
│
├── finance/                  # código Python (núcleo, top-level, roda via `uv run python -m finance.x`)
│   ├── pluggy_client.py      # auth + fetch (evolui o main.py atual)
│   ├── ledger.py             # ler/gravar o ledger, upsert por id da transação
│   ├── rules.py              # motor de regras determinísticas + aprendizado de regra
│   ├── categorize.py         # prepara lote p/ o Claude e grava a categorização
│   └── report.py             # agrega o ledger -> JSON p/ o front e resumo em markdown
│
├── data/                     # estado persistido (o "banco de dados" em texto)
│   ├── taxonomy.yaml         # SUAS categorias e subcategorias (você manda nisto)
│   ├── rules.json            # modelo de categorização aprendido (versionado)
│   ├── ledger.jsonl          # 1 transação por linha (canônico, fácil de diff/grep)
│   └── reports/              # YYYY-MM.json + YYYY-MM.md (histórico de análises)
│
├── .claude/skills/           # como você opera tudo isto pelo Claude Code
│   ├── finance-sync/         # "puxa minhas últimas transações"
│   ├── finance-categorize/   # "categoriza meus gastos novos"
│   └── finance-report/       # "me mostra os gastos do mês / análise histórica"
│
└── frontend/                 # dashboard React (Vite) — só visualização, roda com npm
```

Por que **JSONL** para o ledger: uma transação por linha → diffs de git legíveis, fácil de eu
(Claude) ler e dar `grep`, fácil de carregar em pandas, upsert por `id` simples. Sem banco binário.

Por que **não** MCP: o fluxo é um pipeline coeso e local (sync → categorize → report) acoplado ao
seu schema. Skills + scripts Python são mais simples, versionáveis e suficientes. (Reavaliamos se um
dia integrarmos 3+ serviços externos.)

---

## 3. As 3 Skills (toda a operação acontece por aqui)

Cada skill tem `SKILL.md` (instruções + quando disparar) e chama scripts em `src/finance/`.
Descrições serão escritas para disparar com frases naturais suas.

| Skill | Você diz algo como… | O que faz |
|---|---|---|
| **finance-sync** | "puxa minhas transações", "o que entrou de novo" | Autentica na Pluggy, busca **incremental** (só o novo desde o último sync, via `createdAtFrom`), faz upsert no `ledger.jsonl`, mostra um resumo do que chegou. |
| **finance-categorize** | "vamos categorizar", "categoriza os gastos novos" | 1) aplica `rules.json` (determinístico, instantâneo); 2) me mostra o que sobrou sem categoria em lotes, com a `taxonomy.yaml` e exemplos parecidos do histórico; 3) você confirma/ajusta; 4) grava no ledger; 5) **aprende regra nova** quando o padrão é estável; 6) sinaliza anomalias. |
| **finance-report** | "gastos do mês", "compara com o mês passado", "análise do ano" | Agrega o ledger por categoria/subcategoria/mês, gera `reports/YYYY-MM.{json,md}` e atualiza o JSON que o front consome. |

Fluxo recorrente típico (o que você faz toda semana, em 1 frase): *"sincroniza, categoriza os
novos e me mostra o resumo do mês"* — eu encadeio as três.

`CLAUDE.md` (curto, < ~150 linhas) documenta esse fluxo para toda sessão já começar com o contexto
certo, sem você precisar reexplicar.

---

## 4. Categorização — o coração

- **`data/taxonomy.yaml`** — suas categorias/subcategorias, previsíveis e editáveis por você.
  Semente inicial proposta (você ajusta livre): Alimentação {Supermercado, Restaurante, Delivery,
  Café/Padaria}, Transporte {Combustível, App/Táxi, Público, Estacionamento}, Moradia {Aluguel,
  Condomínio, Energia, Água, Internet/TV, Gás}, Saúde {Plano, Farmácia, Consultas, Academia},
  Lazer {Streaming, Bares, Cinema/Eventos, Viagem}, Compras {Vestuário, Eletrônicos, Casa},
  Serviços {Assinaturas, Profissionais}, Educação, Impostos/Taxas, Transferências {PIX enviado,
  PIX recebido, TED/DOC}, Investimentos, Renda {Salário, Rendimentos}, Outros.
- **`data/rules.json`** — lista ordenada de regras: casa por descrição normalizada / CNPJ do
  lojista / MCC do cartão → categoria+subcategoria (match `contains`/`exact`/`regex`). É o "modelo"
  que cresce com o tempo. **Versionado no git** = trilha de auditoria do aprendizado.
- **Anomalia**: se uma transação bate numa regra de lojista mas o valor/tipo destoa muito do
  histórico daquele lojista, não auto-aplica — manda para sua revisão. (Atende seu "a não ser que
  fuja muito do padrão".)
- A Pluggy às vezes manda uma categoria própria; usamos **só como dica** para minha sugestão,
  nunca como verdade (pode sumir fora do trial Pro).

**Backfill inicial (o que você pediu: "categorizar pelo menos esse ano")**: no primeiro uso,
`finance-sync` puxa os ~12 meses que a Pluggy disponibiliza para a conta; depois fazemos uma rodada
grande de `finance-categorize` — eu te ajudo a varrer tudo rápido em lotes e já saio criando as
regras, pra daqui pra frente ser quase tudo automático.

---

## 5. Persistência, recorrência e GitHub

- **Recorrência**: a Pluggy/Meu Pluggy já atualiza as contas **diariamente** sozinha. Você não precisa
  agendar nada: quando abrir o Claude Code (dia/semana/mês), roda o fluxo de 1 frase. Se um dia
  quiser 100% automático sem abrir o terminal, dá para usar `/schedule` (rotina na nuvem) — fica
  como opção futura, não no setup inicial (mantém simples).
- **Persistir no computador**: sim, tudo em `data/` (texto, versionado).
- **GitHub**: recomendo **repositório privado** e **commitar tudo, inclusive o `ledger.jsonl` e os
  `reports/`** → você ganha backup + histórico financeiro completo + análise histórica (que você
  pediu), com diffs legíveis. `.env` continua fora do git (já está). *Esta é a principal decisão
  que deixo para você* — alternativa mais conservadora: `gitignore` no ledger e versionar só
  regras/taxonomy/relatórios (mais privado, mas perde o backup do histórico bruto).

---

## 6. Front-end (visual, fácil de rodar) — destrinchado

### 6.1 Princípios

- `frontend/` em **Vite + React 18**, **100% leitura**, **sem backend**: consome os JSON que o
  `finance-report` já gera em `data/reports/`. Rodar = `npm install` (uma vez) + `npm run dev`.
- **Zero dependência de gráfico**: charts são SVG feitos à mão (barras, donut, sparkline). Só
  `react`, `react-dom`, `vite`, `@vitejs/plugin-react`. Mantém o princípio de simplicidade extrema.
- **Dados ao vivo**: um middleware do Vite (`vite.config.js`) serve `/data/*` direto de
  `../data/reports` com `Cache-Control: no-store`. Toda vez que você roda `finance-report`, o
  dashboard reflete na hora (F5) — sem build, sem copiar arquivo, sem symlink frágil.
- **Leitura + edição controlada** (v2, ver §6.6): além de mostrar, o front **edita**
  categorização passando pelo mesmo pipeline de regras (`decisions.json` →
  `categorize apply [--learn]` → `report`). Sem MCP, sem API paga. A fila "mandar pro
  Claude" mantém a decisão na conversa quando você preferir.
- Idioma e formato **PT-BR / BRL** (`Intl.NumberFormat`), rótulos de mês tipo `mai/2026`.

### 6.2 Contrato de dados (o que o front lê)

| Arquivo | Quando o front usa | Conteúdo |
|---|---|---|
| `data/reports/dashboard.json` | sempre (1 fetch no load) | `months[]` (agregados 13m, **sem** transações), `by_category_12m[]`, `recent[60]`, `needs_review`, `uncategorized`, `total_transactions`, `cashflow_excludes` |
| `data/reports/YYYY-MM.json` | ao selecionar um mês | agregados do mês **+ `transactions[]`** (lista compacta: `id, date, description, signed_amount, type, account_name, category, subcategory, counterparty, needs_review`) |

> Mudança mínima no Python: `report.py` passa a incluir `transactions[]` **só nos arquivos
> mensais** (`YYYY-MM.json`). O `dashboard.json` continua enxuto (só agregados) para carregar rápido.

### 6.3 Telas (as 5 abas) — funcionalidades por aba

**1. Visão Geral** — *consulta rápida do estado financeiro*
- Seletor de mês (dropdown com os 13 meses do `dashboard.json`).
- 3 KPIs do mês selecionado: **Receitas / Gastos / Saldo**, cada um com Δ vs. mês anterior (▲▼ e %).
- Gráfico de barras **13 meses**: receita vs. gasto por mês + linha de saldo (SVG).
- **Top categorias do mês** (barras horizontais, maior → menor, com % do total e nº de lançamentos).
- Faixa de **alertas**: nº a revisar (`needs_review`) e sem categoria (`uncategorized`) → leva à aba Revisar.
- Resumo **"fora do fluxo"**: líquido de Reserva/Formatura/Compartilhado/Investimentos/Transferências
  do mês (para você *ver o dinheiro se mexendo* sem poluir o fluxo de caixa).

**2. Transações** — *consulta detalhada e apoio à categorização*
- Tabela do mês (de `YYYY-MM.json.transactions`): data, descrição, contraparte, conta, categoria/sub,
  valor (verde entrada / vermelho saída), selo "revisar".
- Filtros combináveis: **busca textual** (descrição/contraparte), **categoria**, **conta**, **tipo**
  (entrada/saída), e toggle **só a revisar**.
- Ordenação por data ou valor; rodapé com **soma do conjunto filtrado** (entradas, saídas, líquido)
  e contagem — responde "quanto gastei em X em maio?" em 2 cliques.

**3. Categorias** — *análise histórica e drill-down*
- Escolhe uma categoria → **tendência 13 meses** dela (barras) + **quebra por subcategoria** no mês
  selecionado + participação no total do mês.
- **Donut** da composição do mês (todas as categorias de fluxo).
- Tabela **mês vs. mês anterior** por categoria, com variação ▲▼ em R$ e %.

**4. Movimentações** — *o dinheiro "por baixo dos panos", visível mas fora do fluxo*
- Cartões para Reserva (cofrinhos), Formatura, Compartilhado, Investimentos, Transferências:
  **entrou / saiu / líquido** no mês e no acumulado 13m, com quebra por subcategoria.
- Deixa explícito que esses valores **não** entram em Receitas/Gastos (atende o pedido de não poluir
  o fluxo, mas conseguir auditar empréstimos, comissão de formatura, rateios e cofrinhos).

**5. Revisar** — *fila de pendências + como agir*
- Lista as transações `needs_review` (anomalias) e as sem categoria do mês.
- Painel "como resolver": os comandos exatos
  (`uv run python -m finance.sync` → `… categorize` → `… report`) e a explicação de que a
  decisão final é feita comigo na conversa (não pelo front).

### 6.4 Estrutura de arquivos do front

```
frontend/
├── package.json            # react, react-dom, vite, @vitejs/plugin-react (só isso)
├── vite.config.js          # plugin react + middleware que serve /data/* ao vivo
├── index.html
├── .gitignore              # node_modules, dist
└── src/
    ├── main.jsx  App.jsx
    ├── api.js              # fetch dashboard.json / YYYY-MM.json
    ├── format.js           # BRL, datas, rótulo de mês PT-BR
    ├── styles.css
    └── components/         # MonthPicker, Kpi, BarsMonthly, CategoryBars, Donut,
                            # Overview, Transactions, Categories, Movements, Review
```

### 6.5 Como rodar / operar

- `uv run python -m finance.report` (ou a skill) gera os JSON → `cd frontend && npm install` (1x)
  → `npm run dev` → abre no navegador. Skill **finance-dashboard**: você diz "abre o dashboard"
  e eu rodo o report e subo o dev server.
- O servidor de *connect-token* do `tmp.md` **não é necessário** (você já conectou via Meu Pluggy).
  `tmp.md` é resíduo do onboarding — pode apagar depois.

### 6.6 Frontend v2 — redesign UX + edição (substitui o protótipo)

> Motivado por feedback: filtros pobres, UI/UX fraca, sem editar. Pesquisa: padrões
> Monarch/Copilot + boas práticas de dashboard fintech (hierarquia de KPI, drill-down,
> resumo do filtrado, regras retroativas, edição em massa).

**Stack v2:** Vite + React + **Tailwind v4** (CSS-first), **Recharts** (gráficos
interativos), **TanStack Table** (grid com filtros/ordenção/paginação/seleção),
`lucide-react` (ícones), `@radix-ui/react-dialog` (modal acessível).

**Edição (3 modos por lançamento, e em massa via seleção):**
1. **Só este lançamento** → grava `manual` no ledger só nessa tx (via
   `data/.decisions.json` → `categorize apply`).
2. **Editar + criar regra** → cria regra (campo/match/valor pré-preenchidos a partir
   de `merchant_name`/`counterparty`/`description`) → `categorize apply --learn`;
   aplica **retroativo** a tudo que casa (padrão Monarch "apply to existing").
3. **Mandar pra fila do Claude** → abre **campo de texto livre**; grava em
   `data/.claude_queue.jsonl` (id + nota + sugestão). Não mexe no ledger; eu trato
   na conversa. A aba **Revisar** mostra a fila.

**Mecanismo (sem MCP, sem API paga — arquitetura preservada):** o middleware do
Vite ganha `POST /api/edit` e `GET /api/queue`. Ele faz **backup** de
`ledger.jsonl`/`rules.json` em `data/.bak/`, escreve `data/.decisions.json` e roda
`uv run python -m finance.categorize apply [--learn]` + `finance.report`; a tela
recarrega sozinha. Edições são serializadas (lock) para não corromper o ledger.

**UX aplicada:** KPIs no topo (com sparkline/variação), donut de gastos com
drill-down → filtra a tabela; tabela com **busca global + filtros por coluna**
(intervalo de data, intervalo de valor, multi-categoria, multi-conta, tipo, "a
revisar"), ordenção, paginação, **seleção → edição em massa**, **barra-resumo do
conjunto filtrado** (padrão Monarch); estados de loading/vazio, toasts ao salvar,
responsivo, acessível, tema escuro.

### 6.7 Estrutura v2

```
frontend/src/
├── lib/        api.js (fetch + POST /api/edit, /api/queue) · format.js · useData.js
├── components/
│   ├── ui/     Card Button Modal Toast Badge MultiSelect RangeFilter Skeleton
│   ├── charts/ CashflowChart CategoryDonut TrendBars  (Recharts)
│   ├── EditModal.jsx           (3 modos + bulk + campo livre)
│   ├── TransactionsTable.jsx   (TanStack: filtros/ordem/paginação/seleção/resumo)
│   └── Overview Categories Movements Review
└── App.jsx · main.jsx · index.css (Tailwind v4 + tokens)
```

### 6.8 Frontend v3 — planejamento financeiro + drill-down global

> Feedback: faltam funcionalidades de **planejamento** e **interatividade**; querer
> clicar em qualquer número e ver as transações que o compõem. Pesquisa:
> YNAB/Monarch (orçamento por categoria, renda esperada, ritmo/projeção,
> traffic-light), Subaio/Belvo (detecção de recorrências), Smashing/P&P
> (drill-down via slide-over, progressive disclosure).

**Novo dado — `data/budgets.json`** (versionado, editável por você ou pelo
dashboard; JSON p/ casar com `rules.json` e ser fácil no Node+Python):
```jsonc
{
  "income_plan": { "recurring": 14000, "months": { "2026-05": 16000 } },
  "spending": {
    "recurring": { "Alimentação": 1800, "Transporte": 2500, "...": 0 },
    "months": { "2026-05": { "Lazer": 800 } }      // override do mês
  },
  "savings_goals": [ { "name": "Reserva de emergência", "target": 20000 } ]
}
```
Teto efetivo do mês = `spending.months[m][cat] ?? spending.recurring[cat]`.

**Python:** `finance/budgets.py` (load/save + merge mês, CLI
`python -m finance.budgets [YYYY-MM]` para eu usar na conversa).
`report.py` passa a calcular e exportar:
- por mês: `plan` (por categoria: `planned, realized, remaining, projected,
  status` ∈ no_caminho/folgado/estourando/estourou), totais, `days_in_month`,
  `days_elapsed`, `daily_allowed`, `planned_balance`, `projected_balance`;
  `savings` (poupança acumulada da Reserva vs metas); `insights` (determinísticos:
  estouros, maior variação vs mês anterior, maior gasto, renda vs plano, metas).
- no `dashboard.json`: `budgets` (echo p/ editar), `recurring` (assinaturas
  detectadas: agrupa por lojista/contraparte, ≥3 ocorrências, cadência ~mensal,
  valor estável ±15%, exclui Alimentação/Combustível).

**Middleware:** `POST /api/budget` (grava `data/budgets.json`, backup em
`data/.bak/`, roda `finance.report`). Mantém sem MCP/API paga.

**Skill nova `finance-plan`** ("meu orçamento", "quanto posso gastar",
"como está meu planejamento", "ajusta o teto de X") + `CLAUDE.md`: eu também
edito budgets e dou orientação de planejamento na conversa.

**UX aplicada:**
- Aba **Planejamento**: editar renda esperada, **tetos por categoria** (todo mês
  ou só este mês) inline; ver realizado/falta/projeção com **barra traffic-light**;
  totais (saldo planejado e projetado, dias restantes, "pode gastar R$/dia");
  **metas de poupança** (add/editar/remover); **Insights**; **Recorrências**.
- **Drill-down global**: contexto `useDrill()` + slide-over (`DrillDrawer`)
  reaproveitando a `TransactionsTable` (com edição). **Qualquer número clicável**
  abre as transações que o compõem — KPIs, fatias do donut, barras de categoria,
  linhas de Movimentações, linhas do Planejamento, subcategorias. Progressive
  disclosure, sem sair da tela.
- Filtros/realce em quase todas as telas; transições suaves; tabela ganha
  `initialFilter` (categoria/subcategoria/tipo/revisar) p/ os drill-downs.

### 6.9 Estrutura v3 (deltas sobre v2)

```
finance/budgets.py                         # plano: load/save/merge + CLI
frontend/src/
├── lib/ api.js (+postBudget) · useDrill.js (contexto de drill-down)
├── components/
│   ├── ui/ Drawer.jsx (slide-over Radix)
│   ├── Planejamento.jsx  Insights.jsx  Recurring.jsx
│   ├── DrillDrawer.jsx   (TransactionsTable num slide-over)
│   └── (Overview/Categories/Movements ganham números clicáveis → drill)
data/budgets.json                          # versionado (gitignore: .bak/.queue)
.claude/skills/finance-plan/SKILL.md
```

### 6.10 Frontend v4 — split de transação + feedback da fila

> Feedback: (a) "paguei por alguém e me reembolsam" poluía o fluxo; (b) sem
> retorno visual ao mandar pra fila do Claude.

**Split de transação** (padrão YNAB/Monarch). Registro do ledger ganha
`splits: [{amount, category, subcategory, note}]` (soma = `signed_amount`;
`None` = simples). `report.py`/`budgets.py` **expandem** cada parte na sua
categoria (sua parte conta no fluxo; a parte adiantada vai p/ `Compartilhado`,
fora do fluxo, e anula com o reembolso). `categorize.py` trata split como
travado (igual `manual`): não reaplica regra, conta como categorizado, fora de
"sem categoria"/anomalia. `ledger._OURS` preserva `splits` no upsert/sync.
Pipeline: `decisions.json` → assignment com `splits` → `categorize apply` →
`report`. Modal ganha modo **"Dividir"** (só 1 lançamento): linhas
valor/categoria/sub/nota, "resto na 1ª parte", preset **"parte de outra
pessoa"** (→ Compartilhado/Outro), validação soma=total. Tabela mostra selo
**dividido (N)** e filtra/drill por qualquer categoria das partes.

**Feedback da fila do Claude:** chip azul **"Fila do Claude (N)"** fixo no
header (qualquer aba → Revisar); itens da fila **editáveis** (nota +
categoria/sub sugerida) via `POST /api/queue/update`, além de remover; toast
ao enfileirar aponta onde ver. CLAUDE.md: no início de categorização, ler
`data/.claude_queue.jsonl`, resolver (inclusive com split) e esvaziar.

---

## 7. Ordem de execução (depois que você aprovar)

1. **Fundação**: criar `src/finance/`, `data/taxonomy.yaml` semente, `rules.json` vazio,
   `CLAUDE.md`, dependências (`uv add`). Reaproveita o `main.py` atual.
2. **finance-sync**: skill + cliente Pluggy incremental (`/v2/transactions`, cursor, `createdAtFrom`),
   upsert no ledger.
3. **finance-categorize**: motor de regras + loop de categorização comigo + aprendizado de regra.
4. **Backfill + 1ª categorização** dos ~12 meses disponíveis (categorizar o ano).
5. **finance-report**: agregações + JSON do front + resumo em markdown.
6. **Frontend** Vite/React mínimo lendo o JSON.
7. (Opcional/depois) `/schedule` para automação total; mais contas = adicionar `ITEM_ID`.

> Sugiro fazer **1 → 4 primeiro** (já te dá controle e categorização do ano). Front-end (5–6) é
> independente e pode vir logo depois, sem travar o resto.
