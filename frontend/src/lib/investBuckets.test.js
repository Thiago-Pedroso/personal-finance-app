import assert from 'node:assert/strict'
import test from 'node:test'

import { buildBucketReconciliations } from './investBuckets.js'

test('reconciles each bucket account once without its synced cash balance', () => {
  const reconciliations = buildBucketReconciliations({
    accounts: [
      { id: 'banco', name: 'Banco', kind: 'bucket' },
      { id: 'corretora', name: 'Corretora', kind: 'broker' },
    ],
    positions: [
      { account: 'banco', valuation: 'balance', value: 12000 },
      { account: 'banco', valuation: 'balance', value: 8000 },
      { account: 'banco', valuation: 'account', value: 5000 },
    ],
    reports: { banco: { total: 20000 } },
  })

  assert.equal(reconciliations.length, 1)
  assert.equal(reconciliations[0].registered, 20000)
  assert.equal(reconciliations[0].difference, 0)
})
