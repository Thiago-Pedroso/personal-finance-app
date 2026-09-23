import assert from 'node:assert/strict'
import test from 'node:test'

import { envelopeHistory, linkedCount } from './investEnvelopes.js'

const trades = [
  { id: 'a', date: '2026-08-23', ticker: 'VIAGEM', side: 'BALANCE', price: 1000,
    source: 'manual', note: 'saldo de abertura' },
  { id: 'b', date: '2026-09-08', ticker: 'VIAGEM', side: 'BUY', quantity: 0,
    price: 1200, ledger_id: 'tx-1' },
  { id: 'c', date: '2026-09-23', ticker: 'VIAGEM', side: 'BALANCE', price: 2230.5,
    source: 'pluggy', note: 'rendimento rateado pelo saldo' },
  { id: 'd', date: '2026-09-08', ticker: 'CONTA-CORRETORA', side: 'TRANSFER', price: 5000,
    ledger_id: 'tx-2' },
]
const links = [{ ledger_id: 'tx-1', description: 'Aporte na caixinha',
  date: '2026-09-08', links: [{ ticker: 'VIAGEM', amount: 1200 }] }]

test('history shows each movement with its origin, newest first', () => {
  const rows = envelopeHistory('VIAGEM', trades, links)
  assert.deepEqual(rows.map((row) => row.label),
    ['Rendimento rateado', 'Entrada', 'Saldo de abertura'])
  assert.equal(rows[1].origin.description, 'Aporte na caixinha')
  assert.equal(rows[1].amount, 1200)
  assert.equal(rows[1].balance, 2200)
  assert.equal(Math.round(rows[0].amount * 100) / 100, 30.5)
  assert.equal(rows[0].kind, 'in')
})

test('money sent to an account shows where it came from', () => {
  const rows = envelopeHistory('CONTA-CORRETORA', trades, [{ ledger_id: 'tx-2',
    description: 'PIX para a corretora', date: '2026-09-08' }])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].label, 'Chegou do Fluxo')
  assert.equal(rows[0].origin.description, 'PIX para a corretora')
  assert.equal(rows[0].balance, null)
})

test('counts ledger rows that feed an envelope', () => {
  assert.equal(linkedCount('VIAGEM', links), 1)
  assert.equal(linkedCount('RESERVA', links), 0)
})

test('account shows informed balances as they are', () => {
  const rows = envelopeHistory('CONTA-CORRETORA', [
    { id: 'x', date: '2026-09-07', ticker: 'CONTA-CORRETORA', side: 'BALANCE', price: 4000 },
    { id: 'y', date: '2026-09-23', ticker: 'CONTA-CORRETORA', side: 'BALANCE', price: 6000 },
  ], [], { account: true })
  assert.deepEqual(rows.map((row) => [row.kind, row.amount]),
    [['balance', 6000], ['balance', 4000]])
})
