import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOperation, canConfirm, impactText, taxonomyRows } from './taxonomyManager.js'

test('builds the five management payload shapes and rejects incomplete names', () => {
  assert.deepEqual(buildOperation('create-category', { category: ' Casa ', treatment: 'fluxo' }),
    { kind: 'create-category', category: 'Casa', treatment: 'fluxo' })
  assert.deepEqual(buildOperation('create-subcategory', { category: 'Casa', subcategory: 'Luz' }),
    { kind: 'create-subcategory', category: 'Casa', subcategory: 'Luz' })
  assert.deepEqual(buildOperation('rename-category', { category: 'Casa', newCategory: 'Moradia' }),
    { kind: 'rename-category', category: 'Casa', newCategory: 'Moradia' })
  assert.deepEqual(buildOperation('rename-subcategory', { category: 'Casa', subcategory: 'Luz', newSubcategory: 'Energia' }),
    { kind: 'rename-subcategory', category: 'Casa', subcategory: 'Luz', newSubcategory: 'Energia' })
  assert.deepEqual(buildOperation('delete-category', { category: 'Casa' }), { kind: 'delete-category', category: 'Casa' })
  assert.equal(buildOperation('create-category', { category: 'A,B', treatment: 'fluxo' }), null)
  assert.equal(buildOperation('create-category', { category: 'Casa', treatment: '' }), null)
})

test('sorts view rows without changing dashboard input and binds confirmation to intent', () => {
  const taxonomy = { Z: [], A: ['b', 'a'] }; const treatments = { Z: 'movimento', A: 'fluxo' }
  assert.deepEqual(taxonomyRows(taxonomy, treatments), [
    { category: 'A', subcategories: ['a', 'b'], treatment: 'fluxo' },
    { category: 'Z', subcategories: [], treatment: 'movimento' },
  ])
  assert.deepEqual(taxonomy, { Z: [], A: ['b', 'a'] })
  const op = { kind: 'delete-category', category: 'A' }
  const preview = { operation: op, fingerprint: 'token', impact: { normalTransactions: 2, rules: 1, splitTransactions: 1, splitParts: 3 } }
  assert(canConfirm(op, preview, true)); assert(!canConfirm({ ...op, category: 'Z' }, preview, true)); assert(!canConfirm(op, preview, false))
  assert.match(impactText(preview.impact), /2 lançamentos normais.*1 regra.*3 partes de split/)
})
