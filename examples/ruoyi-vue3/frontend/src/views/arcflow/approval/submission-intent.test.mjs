import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const source = await readFile(new URL('./submission-intent.js', import.meta.url), 'utf8')
const { createSubmissionIntent, newSubmissionKey, isRejectedSubmissionVersion } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const fields = { title: ' Leave ', reason: ' Rest ', days: 2 }
test('native and standalone use the same bounded in-memory intent semantics', async () => {
  const standalone = await readFile(new URL('../../../../../../approval-ui/src/submission-intent.js', import.meta.url), 'utf8')
  assert.equal(source, standalone)
  assert.equal(await readFile(new URL('./submission-response.js', import.meta.url), 'utf8'),
    await readFile(new URL('../../../../../../approval-ui/src/submission-response.js', import.meta.url), 'utf8'))
  let count = 0
  const state = createSubmissionIntent(() => `submission-${++count}`)
  const first = state.prepare('100', fields, 1)
  assert.deepEqual(first.payload, { title: 'Leave', reason: 'Rest', days: 2, processVersion: 1 })
  assert.equal(state.prepare('100', { ...fields, title: 'Leave' }, 2), first)
  state.invalidate('100', { ...fields, days: 3 })
  assert.notEqual(state.prepare('100', fields, 2).key, first.key)
  const second = state.prepare('102', fields, 2)
  assert.notEqual(second.key, first.key)
  state.clear()
  assert.notEqual(state.prepare('102', fields, 2).key, second.key)
  const key = newSubmissionKey()
  assert.match(key, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
  assert.notEqual(key, newSubmissionKey())
})
test('only native HTTP409 with definitive stale-version reason can end an uncreated intent', () => {
  const msg = 'The published process changed; reload before submitting'
  assert.equal(isRejectedSubmissionVersion({ response: { status: 409, data: { code: 409, msg } } }), true)
  for (const error of ['error', { response: { status: 503, data: { msg } } }, { response: { status: 409, data: { msg: 'Idempotency-Key was already used for a different submission' } } }]) {
    assert.equal(isRejectedSubmissionVersion(error), false)
  }
})
test('native API forwards the same key and bypasses only the client duplicate-submit cache', async () => {
  const apiSource = await readFile(new URL('../../../api/arcflow/approval.js', import.meta.url), 'utf8')
  const stubbed = apiSource.replace("import request from '@/utils/request'", 'const request = options => Promise.resolve(options)')
  assert.notEqual(stubbed, apiSource)
  const { submitRequest } = await import(`data:text/javascript;base64,${Buffer.from(stubbed).toString('base64')}`)
  const data = { title: 'Leave', reason: 'Rest', days: 2, processVersion: 1 }
  const initial = await submitRequest(data, 'native:retry-1')
  assert.deepEqual(initial, { url: '/arcflow/requests', method: 'post', data, headers: { 'Idempotency-Key': 'native:retry-1', repeatSubmit: false } })
  assert.deepEqual(await submitRequest(data, 'native:retry-1'), initial)
  assert.deepEqual((await submitRequest(data)).headers, {})
})
