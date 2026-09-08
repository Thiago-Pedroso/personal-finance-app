import assert from 'node:assert/strict'
import test from 'node:test'

import { groupPolicyNodes, orderPortfolioNodes,
  updateGroupTargets } from './investPolicy.js'

test('groups any number of policy siblings by parent', () => {
  const policy = [
    { node: 'variable', name: 'Renda variável', parent: null, counts: true },
    { node: 'brazil', name: 'Brasil', parent: 'variable', counts: true },
    { node: 'usa', name: 'EUA', parent: 'variable', counts: true },
    { node: 'ireland', name: 'Irlanda', parent: 'variable', counts: true },
    { node: 'global', name: 'Global', parent: 'variable', counts: true },
    { node: 'reserve', name: 'Reserva', parent: null, counts: false },
  ]

  const groups = groupPolicyNodes(policy)

  assert.deepEqual(groups.map((group) => [group.name, group.nodes.length]), [
    ['Renda variável', 4],
  ])
})

test('keeps a binary policy group at one hundred percent', () => {
  const nodes = [{ node: 'fixed' }, { node: 'variable' }]
  const targets = updateGroupTargets(
    { fixed: 0.2, variable: 0.8 }, nodes, 'fixed', 0.35)

  assert.equal(targets.fixed, 0.35)
  assert.equal(targets.variable, 0.65)
})

test('redistributes a multi-option group proportionally', () => {
  const nodes = [{ node: 'brazil' }, { node: 'usa' }, { node: 'ireland' }]
  const targets = updateGroupTargets(
    { brazil: 0.5, usa: 0.3, ireland: 0.2 }, nodes, 'brazil', 0.4)

  assert.equal(targets.brazil, 0.4)
  assert.equal(targets.usa, 0.36)
  assert.equal(targets.ireland, 0.24)
  assert.equal(Object.values(targets).reduce((sum, value) => sum + value, 0), 1)
})

test('orders portfolio nodes by role and policy structure without using names', () => {
  const policy = [
    { node: 'excluded', role: 'strategy', target_pct: 0, parent: null },
    { node: 'waiting', role: 'to_invest', target_pct: 0, parent: null },
    { node: 'cash', role: 'free', target_pct: 0, parent: null },
    { node: 'stable', role: 'strategy', target_pct: 0.2, parent: null },
    { node: 'growth', role: 'strategy', target_pct: 0.8, parent: null },
    { node: 'local', role: 'strategy', target_pct: 0.6, parent: 'growth' },
    { node: 'equity', role: 'strategy', target_pct: 0.7, parent: 'local' },
    { node: 'real_estate', role: 'strategy', target_pct: 0.3, parent: 'local' },
    { node: 'foreign', role: 'strategy', target_pct: 0.4, parent: 'growth' },
    { node: 'international', role: 'strategy', target_pct: 0.7, parent: 'foreign' },
    { node: 'foreign_real_estate', role: 'strategy', target_pct: 0.3,
      parent: 'foreign' },
    { node: 'reserve', role: 'reserved', target_pct: 0, parent: null },
  ]
  const allocation = [
    ['international', true], ['reserve', false], ['equity', true],
    ['excluded', false], ['waiting', false], ['stable', true],
    ['foreign_real_estate', true], ['cash', false], ['real_estate', true],
  ].map(([node, inTotals]) => ({ node, in_totals: inTotals }))

  const ordered = orderPortfolioNodes(allocation, policy)

  assert.deepEqual(ordered.map((item) => item.node), [
    'reserve', 'cash', 'waiting', 'stable', 'equity', 'real_estate',
    'international', 'foreign_real_estate', 'excluded',
  ])
})
