import assert from 'node:assert/strict'
import test from 'node:test'

import { monthLong, shortAccount, timeAgo } from './format.js'

test('shortAccount drops corporate suffixes and parenthesized details', () => {
  assert.equal(shortAccount('PICPAY INSTITUIÇÃO DE PAGAMENTO S.A (Conta Pré-paga)'), 'Picpay')
  assert.equal(shortAccount('BANCO INTER S.A.'), 'Banco Inter')
  assert.equal(shortAccount('NU PAGAMENTOS S.A. - INSTITUIÇÃO DE PAGAMENTO'), 'NU Pagamentos')
})

test('shortAccount keeps mixed case names and short acronyms', () => {
  assert.equal(shortAccount('Cartão XP Visa Infinite'), 'Cartão XP Visa Infinite')
  assert.equal(shortAccount('XP'), 'XP')
  assert.equal(shortAccount(''), '')
})

test('monthLong spells the month and keeps years as they are', () => {
  assert.equal(monthLong('2026-10'), 'Outubro de 2026')
  assert.equal(monthLong('2026-03'), 'Março de 2026')
  assert.equal(monthLong('2026'), '2026')
})

test('timeAgo rounds to the largest useful unit', () => {
  const now = Date.parse('2030-01-10T12:00:00Z')
  assert.equal(timeAgo('2030-01-10T11:59:40Z', now), 'agora')
  assert.equal(timeAgo('2030-01-10T11:55:00Z', now), 'há 5 min')
  assert.equal(timeAgo('2030-01-10T10:00:00Z', now), 'há 2 h')
  assert.equal(timeAgo('2030-01-09T12:00:00Z', now), 'há 1 dia')
  assert.equal(timeAgo('2030-01-07T12:00:00Z', now), 'há 3 dias')
})
