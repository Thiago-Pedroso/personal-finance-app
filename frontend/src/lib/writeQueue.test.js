import test from 'node:test'
import assert from 'node:assert/strict'
import { serializeWrite } from './writeQueue.js'

test('taxonomy preview and apply share the queue with all writes', async () => {
  const started = []; let releaseEdit, releasePreview
  const edit = serializeWrite(() => new Promise((resolve) => { started.push('edit'); releaseEdit = resolve }))
  const preview = serializeWrite(() => new Promise((resolve) => { started.push('preview'); releasePreview = resolve }))
  const apply = serializeWrite(() => { started.push('apply'); return 'applied' })
  await Promise.resolve(); assert.deepEqual(started, ['edit'])
  releaseEdit(); await edit; await Promise.resolve(); assert.deepEqual(started, ['edit', 'preview'])
  releasePreview(); await preview; assert.equal(await apply, 'applied')
  assert.deepEqual(started, ['edit', 'preview', 'apply'])
})

test('serializes writes and continues after rejection', async () => {
  const started = []; let release
  const first = serializeWrite(() => new Promise((resolve) => { started.push('one'); release = resolve }))
  const second = serializeWrite(() => { started.push('two'); return 'ok' })
  await Promise.resolve(); assert.deepEqual(started, ['one'])
  release(); await first; assert.equal(await second, 'ok'); assert.deepEqual(started, ['one', 'two'])
  await assert.rejects(serializeWrite(() => Promise.reject(new Error('no'))))
  assert.equal(await serializeWrite(() => 'after'), 'after')
})
