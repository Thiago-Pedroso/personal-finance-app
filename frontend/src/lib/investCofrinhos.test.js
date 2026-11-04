import test from 'node:test'
import assert from 'node:assert/strict'
import { balanceAgeDays, groupSuggestions, isStaleBalance, STALE_DAYS }
  from './investCofrinhos.js'

const today = new Date(2026, 10, 3)   // 03/11/2026, hora local

test('idade do saldo manual e aviso de desatualizado', () => {
  const fresh = { valuation: 'balance', last_balance_date: '2026-11-03' }
  const old = { valuation: 'balance', last_balance_date: '2026-09-01' }
  assert.equal(balanceAgeDays(fresh, today), 0)
  assert.equal(balanceAgeDays(old, today), 63)
  assert.equal(isStaleBalance(fresh, today), false)
  assert.equal(isStaleBalance(old, today), true)
  assert.equal(isStaleBalance({ valuation: 'balance' }, today), true, 'nunca informado')
  assert.equal(isStaleBalance({ ...old, valuation: 'account' }, today), false)
  assert.equal(isStaleBalance({ valuation: 'balance', last_balance_date: '2026-10-04' },
    today), false, `${STALE_DAYS} dias ainda não é velho`)
})

test('agrupa sugestões por cofrinho e monta os links', () => {
  const groups = groupSuggestions([
    { ledger_id: 'b', date: '2026-10-13', side: 'out', amount: 1960.29,
      name: 'Cofrinho Praia', ticker: 'COFRINHO-PRAIA', account: 'banco' },
    { ledger_id: 'a', date: '2026-08-09', side: 'in', amount: 2000,
      name: 'Cofrinho Praia', ticker: 'COFRINHO-PRAIA', account: 'banco' },
    { ledger_id: 'c', date: '2026-08-09', side: 'in', amount: 6000, name: 'Carro',
      ticker: null, account: 'banco' },
    { ledger_id: 'd', date: '2026-10-13', side: 'out', amount: 6000, name: 'Carro',
      ticker: null, account: 'banco' },
  ])
  assert.equal(groups.length, 2)
  const [ml, carro] = groups
  assert.equal(ml.ticker, 'COFRINHO-PRAIA')
  assert.deepEqual(ml.items.map((i) => i.ledger_id), ['a', 'b'])
  assert.equal(ml.net, 39.71)
  assert.deepEqual(ml.links[0], { ledger_id: 'a',
    destinations: [{ ticker: 'COFRINHO-PRAIA', amount: 2000 }] })
  assert.equal(carro.ticker, null)
  assert.equal(carro.net, 0)
  assert.deepEqual(carro.links, [])
})
