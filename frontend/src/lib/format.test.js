import assert from 'node:assert/strict'
import test from 'node:test'

import { shortAccount } from './format.js'

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
