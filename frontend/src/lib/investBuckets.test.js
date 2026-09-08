import assert from 'node:assert/strict'
import test from 'node:test'

import { buildBucketReconciliations } from './investBuckets.js'

test('reconciles each bucket account once without its synced cash balance', () => {
  const reconciliations = buildBucketReconciliations({
    accounts: [
      { id: 'picpay', name: 'PicPay', kind: 'bucket' },
      { id: 'xp', name: 'XP', kind: 'broker' },
    ],
    positions: [
      { account: 'picpay', valuation: 'balance', value: 41702.12 },
      { account: 'picpay', valuation: 'balance', value: 28871.24 },
      { account: 'picpay', valuation: 'pluggy', value: 30902.71 },
    ],
    reports: { picpay: { total: 70573.36 } },
  })

  assert.equal(reconciliations.length, 1)
  assert.equal(reconciliations[0].registered, 70573.36)
  assert.equal(reconciliations[0].difference, 0)
})
