import test from 'node:test'
import assert from 'node:assert/strict'
import { NAV, SPACES, findItem, hashFor, navItems, parseHash } from './nav.js'

test('cada espaço tem telas únicas e ícone em todas', () => {
  for (const space of Object.keys(NAV)) {
    const keys = navItems(space).map((item) => item.key)
    assert.equal(new Set(keys).size, keys.length, `tela repetida em ${space}`)
    for (const item of navItems(space)) assert.ok(item.icon && item.label, item.key)
  }
})

test('atalhos da barra inferior apontam para telas existentes', () => {
  for (const [space, cfg] of Object.entries(NAV)) {
    assert.ok(cfg.shortcuts.length <= 4, 'barra inferior: 4 atalhos + Mais')
    for (const key of cfg.shortcuts) assert.ok(SPACES[space].includes(key), key)
  }
})

test('hash válido vira espaço e aba; inválido cai no padrão', () => {
  assert.deepEqual(parseHash('#/investimentos/carteira'),
    { space: 'investimentos', tab: 'carteira' })
  assert.deepEqual(parseHash('#/financas/review'), { space: 'financas', tab: 'review' })
  assert.deepEqual(parseHash('#/financas/nao-existe'), { space: 'financas', tab: 'overview' })
  assert.deepEqual(parseHash('#/xyz/carteira'), { space: 'financas', tab: 'overview' })
  assert.deepEqual(parseHash(''), { space: 'financas', tab: 'overview' })
})

test('hashFor e findItem', () => {
  assert.equal(hashFor('investimentos'), '#/investimentos/visao')
  assert.equal(hashFor('financas', 'tags'), '#/financas/tags')
  assert.equal(findItem('financas', 'review').badge, 'pending')
  assert.equal(findItem('financas', 'carteira'), null)
})
