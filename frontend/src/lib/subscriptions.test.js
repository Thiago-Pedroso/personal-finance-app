import test from 'node:test'
import assert from 'node:assert/strict'
import { subscriptionRows } from './subscriptions.js'

test('returns an empty list when no transaction has the Assinaturas subcategory', () => {
  assert.deepEqual(subscriptionRows([
    { id: 'x', category: 'Serviços', subcategory: 'Seguros', signed_amount: -30 },
  ]), [])
})

test('excludes rasurado regular and split subscriptions', () => {
  const regular = { id: 'regular', category: 'Serviços', subcategory: 'Assinaturas', signed_amount: -35, excluded: true, splits: null }
  const split = { id: 'split', category: null, subcategory: null, signed_amount: -120, excluded: true, splits: [
    { amount: -20, category: 'Serviços', subcategory: 'Assinaturas' },
  ] }

  assert.deepEqual(subscriptionRows([regular, split]), [])
})

test('uses the transaction amount for regular subscriptions and each part for splits', () => {
  const allocated = { id: 'allocated', category: 'Serviços', subcategory: 'Assinaturas',
    signed_amount: -20 }
  // Report aggregates the individual parts of a split, so a subscription part stays at
  // its own amount.
  const split = { id: 'split', signed_amount: -100, splits: [
    { amount: -25, category: 'Trabalho', subcategory: 'Assinaturas' },
    { amount: -75, category: 'Compras', subcategory: 'Online' },
  ] }

  const rows = subscriptionRows([allocated, split])

  assert.deepEqual(rows.map(({ id, amount }) => ({ id, amount })), [
    { id: 'allocated', amount: -20 }, { id: 'split:0', amount: -25 },
  ])
  assert.equal(rows.reduce((total, row) => total + row.amount, 0), -45)
})

test('extracts regular and split subscription amounts across categories', () => {
  const personal = { id: 'personal', category: 'Serviços', subcategory: 'Assinaturas', signed_amount: -35, splits: null }
  const work = { id: 'work', category: 'Trabalho', subcategory: 'Assinaturas', signed_amount: -90, splits: [] }
  const split = { id: 'split', category: null, subcategory: null, signed_amount: -120, splits: [
    { amount: -20, category: 'Serviços', subcategory: 'Assinaturas' },
    { amount: -100, category: 'Compras', subcategory: 'Online' },
  ] }
  const other = { id: 'other', category: 'Serviços', subcategory: 'Seguros', signed_amount: -50 }

  const rows = subscriptionRows([personal, work, split, other])

  assert.deepEqual(rows.map(({ id, amount, category, isSplit }) => ({ id, amount, category, isSplit })), [
    { id: 'personal', amount: -35, category: 'Serviços', isSplit: false },
    { id: 'work', amount: -90, category: 'Trabalho', isSplit: false },
    { id: 'split:0', amount: -20, category: 'Serviços', isSplit: true },
  ])
  assert.equal(rows[2].transaction, split)
})
