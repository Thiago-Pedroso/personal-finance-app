// Paridade com o motor em Python: os mesmos casos, os mesmos números.
// O fixture é gerado por finance.invest e commitado junto, então uma mudança de regra
// de um lado só quebra o teste em vez de aparecer como número errado na tela.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildPlan } from './investPlan.js'

const fixture = JSON.parse(
  readFileSync(new URL('./investPlan.fixture.json', import.meta.url), 'utf8'))
const round = (value, places = 6) => Number(value.toFixed(places))

for (const { contribution, mode, expected } of fixture.cases) {
  test(`plano de ${contribution} em modo ${mode} bate com o Python`, () => {
    const plan = buildPlan({
      allocation: fixture.allocation, assets: fixture.assets,
      positions: fixture.positions, contribution, mode,
    })
    assert.equal(round(plan.allocated), expected.allocated)
    assert.equal(round(plan.leftover), expected.leftover)
    assert.deepEqual(
      plan.orders.map((o) => ({ ticker: o.ticker, quantity: round(o.quantity, 8),
        amount: round(o.amount) })),
      expected.orders)
    assert.deepEqual(
      plan.nodes.map((n) => ({ node: n.node, amount: round(n.amount),
        drift_after: round(n.drift_after, 8) })),
      expected.nodes)
  })
}

test('alvo alterado na tela muda o plano sem tocar no arquivo', () => {
  const targets = {}
  fixture.assets.forEach((asset) => { targets[asset.ticker] = asset.target_pct })
  const first = buildPlan({ ...fixture, contribution: 3000 })
  const changed = buildPlan({ ...fixture, contribution: 3000,
    targets: { ...targets, AC0: 1.0, AC1: 0, AC2: 0, AC3: 0, AC4: 0, AC5: 0, AC6: 0,
      AC7: 0, AC8: 0, AC9: 0 } })
  assert.notDeepEqual(first.orders, changed.orders)
})
