import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPairIndex, fluxo } from './pairs.js'

const tx = (id, account, amount, date) => ({ id, account_name: account,
  signed_amount: amount, date })

test('par único: valor oposto, outra conta e até 3 dias', () => {
  const out = tx('a', 'Conta A', -100, '2026-03-01')
  const inn = tx('b', 'Conta B', 100, '2026-03-02')
  const idx = buildPairIndex([out, inn, tx('c', 'Conta A', -55, '2026-03-01')])
  assert.equal(idx.get('a'), inn)
  assert.equal(idx.get('b'), out)
  assert.equal(idx.has('c'), false)
  assert.deepEqual(fluxo(out, inn), { de: 'Conta A', para: 'Conta B', outraData: '2026-03-02' })
  assert.deepEqual(fluxo(inn, out), { de: 'Conta A', para: 'Conta B', outraData: '2026-03-01' })
})

test('sem account_id no payload, cai para account_name (não vira "mesma conta")', () => {
  const idx = buildPairIndex([tx('a', 'Conta A', -10, '2026-03-01'),
    tx('b', 'Conta B', 10, '2026-03-01')])
  assert.equal(idx.size, 2)
})

test('mesma conta, longe demais ou ambíguo: sem par', () => {
  assert.equal(buildPairIndex([tx('a', 'Conta A', -10, '2026-03-01'),
    tx('b', 'Conta A', 10, '2026-03-01')]).size, 0)
  assert.equal(buildPairIndex([tx('a', 'Conta A', -10, '2026-03-01'),
    tx('b', 'Conta B', 10, '2026-03-09')]).size, 0)
  const idx = buildPairIndex([tx('a', 'Conta A', -10, '2026-03-01'),
    tx('b', 'Conta B', 10, '2026-03-01'), tx('c', 'Conta C', 10, '2026-03-01')])
  assert.equal(idx.has('a'), false)
  assert.equal(fluxo(tx('a', 'Conta A', -10, '2026-03-01'), null), null)
})
