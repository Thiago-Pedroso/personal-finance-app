# Binance — posições de cripto

Integração **somente leitura** com a API pública da Binance (gratuita, sem plano pago).
Confere a cripto da carteira (abas `Invest*`) no `finance.invest sync`, como a Pluggy faz
com as corretoras.

Módulo: [`finance/binance_client.py`](../finance/binance_client.py) — é uma *folha*: não
importa nada do resto do app. Quem compara com a carteira é
[`finance/invest/binance_sync.py`](../finance/invest/binance_sync.py).

---

## Credencial

Crie em **Binance → Perfil → Gerenciamento de API → Criar API** do tipo **HMAC**, marcando
**apenas "Habilitar Leitura"**. Não habilite trading nem saque: o pipeline nunca precisa
disso, e uma chave que não pode negociar não tem como perder dinheiro se vazar.

Coloque no `.env` (que é gitignored):

```
BINANCE_API_KEY=...
BINANCE_API_SECRET=...
```

Sem essas duas variáveis, `fetch_positions()` devolve `[]` em silêncio — o resto do
pipeline roda igual. Nada de Binance é obrigatório.

---

## Uso

```sh
uv run python -m finance.binance_client            # imprime as posições, não grava
uv run python -m finance.binance_client --json     # mesma coisa em JSON
uv run python -m finance.invest sync               # confere com a carteira (não grava)
```

## Conferência com a carteira (`invest sync`)

Cada moeda da Binance casa com um ativo de cotação da carteira pelo `pluggy_code` (ex.:
`BTC`), pelo ticker ou pelo `quote_symbol` `CURRENCY:BTCUSD`, preferindo os ativos da conta
`binance`. Lembrete: o `quote_symbol` de cripto é sempre `CURRENCY:XXXUSD`, porque a
fórmula já multiplica por USDBRL. Com `XXXBRL` o valor sai cerca de 5,5 vezes maior.

- Quantidade diferente → pendência `quantity_mismatch` com a movimentação sugerida
  (`BUY`/`SELL` da diferença, ao preço em BRL que a Binance usou). Ela vai para
  `binance_trades` no `data/.invest_pending.json` e **nunca é gravada sozinha**: confirme
  copiando para `trades` do `.invest_decisions.json` e rode `finance.invest apply`.
- Moeda com saldo (≥ R$ 10) fora da carteira → `unknown_asset`.
- Ativo da conta `binance` que sumiu de lá → `quantity_mismatch` sugerindo a venda.

A evolução da cripto vem do `InvestSnapshots`, como a de qualquer outro ativo da carteira.

---

## Onde o dinheiro fica (e por que uma chamada só não basta)

A Binance divide o saldo em carteiras separadas, cada uma com seu endpoint:

| Carteira | Endpoint |
|---|---|
| Spot | `GET /api/v3/account` |
| Funding / P2P | `POST /sapi/v1/asset/get-funding-asset` (é POST, não GET) |
| Simple Earn flexível | `GET /sapi/v1/simple-earn/flexible/position` |
| Simple Earn travado | `GET /sapi/v1/simple-earn/locked/position` |
| Conferência consolidada | `GET /sapi/v1/asset/wallet/balance` |

Quem olha só `/api/v3/account` acha que tem menos dinheiro do que tem.

### A armadilha do `LD*` — dupla contagem

Uma posição no Simple Earn aparece **também** na Spot, espelhada num token `LD<ATIVO>`
(`LDBTC`, `LDETH`…). Somar Spot + Earn conta esse dinheiro duas vezes, e o erro
pode passar de dezenas de por cento no total da moeda.

`_eh_espelho_de_earn()` descarta o espelho, mas **não** por `startswith("LD")`: isso
mataria a **LDO (Lido DAO)**, que é uma moeda de verdade. O prefixo só é removido se o
que sobra for um ativo que está mesmo no Earn.

A conferência que prova: Spot-sem-LD + Earn tem que bater com o total de
`/sapi/v1/asset/wallet/balance`. O módulo faz essa conta e avisa se divergir mais que 2%
(acima de R$ 50).

---

## Preço em BRL

Só ~18 pares `*BRL` estão em negociação, então a maioria dos ativos é convertida em dois
saltos: `<ATIVO>USDT × USDTBRL`. Ativo sem nenhuma das duas rotas sai com `value: None`
e uma nota — **nunca** `0.00`, que sumiria do patrimônio parecendo correto.

Poeira abaixo de R$ 5,00 é descartada (`LIMIAR_POEIRA_BRL`).

---

## Limites da API que doem na prática

- **Janela de histórico: 30 dias exatos.** 31 devolve `-6021 Query time range too large`.
  Varrer um ano são ~13 chamadas.
- **Não existe webhook.** A Binance só oferece um *user data stream* por WebSocket com
  `listenKey` renovável — inútil para um pipeline que roda sob demanda. Daí o polling.
- Assinatura: HMAC-SHA256 sobre a query string exata que vai na URL, com `timestamp` e
  `recvWindow`; a chave vai no header `X-MBX-APIKEY`.

> **Nunca deixe uma `HTTPError` da Binance escapar crua.** O `repr` dela carrega a URL
> completa, inclusive a `signature`, e isso acaba num log ou num relatório de erro. O
> módulo tem um único ponto de saída HTTP (`_request`) justamente para garantir isso.
