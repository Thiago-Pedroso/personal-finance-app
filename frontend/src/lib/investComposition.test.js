import assert from 'node:assert/strict'
import test from 'node:test'

import { buildInvestmentComposition } from './investComposition.js'

const allocation = [
  { node: 'stocks', name: 'Ações globais', value: 800, in_totals: true },
  { node: 'crypto', name: 'Ativos digitais', value: 200, in_totals: false },
  { node: 'reserve', name: 'Reserva', value: 500, in_totals: false },
]
const policy = [
  { node: 'stocks', role: 'strategy' },
  { node: 'crypto', role: 'strategy' },
  { node: 'reserve', role: 'reserved' },
]

test('shows only allocation targets in strategy scope', () => {
  const composition = buildInvestmentComposition({ allocation, policy })

  assert.equal(composition.total, 800)
  assert.deepEqual(composition.slices.map((slice) => slice.name), ['Ações globais'])
})

test('includes any extra investment class without including reserves', () => {
  const composition = buildInvestmentComposition({
    allocation, policy, scope: 'portfolio',
  })

  assert.equal(composition.total, 1000)
  assert.deepEqual(composition.slices.map((slice) => slice.name), [
    'Ações globais', 'Ativos digitais',
  ])
  assert.equal(composition.slices[1].share, 0.2)
})
