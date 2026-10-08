import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const moduleFrom = async name => import(`data:text/javascript;base64,${Buffer.from(await readFile(new URL(name, import.meta.url), 'utf8')).toString('base64')}`)
const { createMemberInbox, createInboxBoxes, inboxQuery, hasHandled } = await moduleFrom('./inbox.js')
const { canVote } = await moduleFrom('./process.js')
const definition = { nodes: [
  { id: 'group', type: 'parallelApproval', assigneeIds: ['101', '102'], completionMode: 'ALL' },
  { id: 'later', type: 'approval', assigneeId: '102' }
] }
const item = (id, extra = {}) => ({ id, status: 'PENDING', processVersion: 2, currentStepId: 'group', approverId: '101', definition,
  history: [{ actorId: '100', action: 'SUBMIT', stepId: null }], ...extra })
const voted = (id, action = 'APPROVE', extra = {}) => item(id, { history: [...item(id).history, { actorId: '102', action, stepId: 'group' }], ...extra })
const page = (items = [], nextCursor = null) => ({ data: { items, nextCursor } })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function setup(impl = () => page()) {
  const calls = [], model = createMemberInbox({ canVote, loadPage: (query, signal) => { calls.push({ query, signal }); return impl(query, signal) } })
  model.setIdentity('102')
  return { ...model, calls }
}
test('query omits optional empty fields and actor, keeps cursor opaque and pages bounded', () => {
  const state = createInboxBoxes().HANDLED
  assert.deepEqual(inboxQuery('HANDLED', state), { box: 'HANDLED', limit: 25 })
  state.status = 'PENDING'; state.processVersion = '2'
  assert.deepEqual(inboxQuery('HANDLED', state, 'opaque+/=?cursor'), { box: 'HANDLED', limit: 25, status: 'PENDING', processVersion: 2, cursor: 'opaque+/=?cursor' })
  for (const version of ['0', '-1', '1.5', '01', '1e2', ' ', '2147483648', '9007199254740992']) {
    state.processVersion = version; assert.throws(() => inboxQuery('PENDING', state))
  }
})
test('process version accepts the signed-int boundary and rejects larger versions before sending', async () => {
  const model = setup()
  await model.setFilters('PENDING', { processVersion: '2147483647' })
  assert.equal(model.calls[0].query.processVersion, 2147483647)
  await model.setFilters('PENDING', { processVersion: '2147483648' })
  assert.equal(model.calls.length, 1)
  assert.ok(model.boxes.PENDING.error)
})
test('independent pending and handled cursors append server order, suppress duplicates and stop at null', async () => {
  const results = [page([item('z'), item('y')], 'pending-1'), page([voted('h')], 'handled-1'), page([item('y'), item('x')]), page([voted('g')])]
  const model = setup(() => results.shift())
  await model.load('PENDING'); await model.load('HANDLED'); await model.load('PENDING'); await model.load('HANDLED'); await model.load('PENDING')
  assert.deepEqual(model.boxes.PENDING.items.map(r => r.id), ['z', 'y', 'x'])
  assert.deepEqual(model.boxes.HANDLED.items.map(r => r.id), ['h', 'g'])
  assert.deepEqual(model.calls.map(c => c.query.cursor), [undefined, undefined, 'pending-1', 'handled-1'])
})
test('handled requires an actual vote; non-first member and repeated-stage overlap follow snapshots', async () => {
  assert.equal(hasHandled(item('a'), '100'), false)
  assert.equal(hasHandled(voted('a', 'REJECT'), '102'), true)
  const next = voted('a', 'APPROVE', { currentStepId: 'later' })
  const model = setup(() => page([next]))
  await model.load('PENDING'); await model.load('HANDLED')
  assert.equal(model.boxes.PENDING.items.length, 1)
  assert.equal(model.boxes.HANDLED.items.length, 1)
})
test('filter edits abort old page and ignore late completion even when transport ignores abort', async () => {
  const old = deferred(), fresh = deferred()
  const model = setup(query => query.status ? fresh.promise : old.promise)
  const load = model.load('PENDING')
  const change = model.setFilters('PENDING', { status: 'PENDING', processVersion: '2' })
  assert.equal(model.calls[0].signal.aborted, true)
  assert.equal(model.boxes.PENDING.loading, true)
  old.resolve(page([item('stale')], 'old-cursor')); await load
  assert.deepEqual(model.boxes.PENDING.items, [])
  assert.equal(model.boxes.PENDING.loading, true)
  fresh.resolve(page([item('fresh')])); await change
  assert.deepEqual(model.boxes.PENDING.items.map(r => r.id), ['fresh'])
  assert.deepEqual(model.calls[1].query, { box: 'PENDING', limit: 25, status: 'PENDING', processVersion: 2 })
})
test('double load-more click makes one call and network failure keeps the page and retry cursor', async () => {
  const more = deferred(); let count = 0
  const model = setup(() => ++count === 1 ? page([item('z')], 'next') : count === 2 ? more.promise : page([item('y')]))
  await model.load('PENDING')
  const pending = model.load('PENDING'); await model.load('PENDING')
  assert.equal(count, 2)
  more.reject(new Error('offline')); await pending
  assert.deepEqual(model.boxes.PENDING.items.map(r => r.id), ['z'])
  assert.equal(model.boxes.PENDING.nextCursor, 'next')
  assert.ok(model.boxes.PENDING.error)
  await model.load('PENDING')
  assert.equal(model.calls[2].query.cursor, 'next')
  assert.deepEqual(model.boxes.PENDING.items.map(r => r.id), ['z', 'y'])
})
test('actor and session reset clear all rows, filters and cursors, and ignore old errors', async () => {
  const old = deferred(); const model = setup(() => old.promise)
  model.boxes.PENDING.status = 'PENDING'
  const pending = model.load('PENDING')
  model.setIdentity('103')
  assert.equal(model.calls[0].signal.aborted, true)
  assert.equal(model.boxes.PENDING.status, '')
  old.reject(new Error('old session')); await pending
  assert.equal(model.boxes.PENDING.error, '')
  model.reset()
  assert.deepEqual(model.boxes, createInboxBoxes())
})
test('dispose prevents late success and any later load', async () => {
  const old = deferred(); const model = setup(() => old.promise)
  const pending = model.load('PENDING'); model.dispose(); old.resolve(page([item('old')], 'next')); await pending
  await model.load('HANDLED')
  assert.equal(model.calls.length, 1)
  assert.deepEqual(model.boxes, createInboxBoxes())
})
test('partial vote reconciliation cancels old pages and refreshes handled from first page', async () => {
  const old = deferred(); let index = 0
  const partial = voted('partial')
  const model = setup(query => ++index === 1 ? page([item('partial')], 'older') : index === 2 ? old.promise : page(query.box === 'HANDLED' ? [partial] : []))
  await model.load('PENDING'); const more = model.load('PENDING')
  model.reconcile(partial)
  assert.equal(model.calls[1].signal.aborted, true)
  assert.deepEqual(model.boxes.PENDING.items, [])
  await model.load('HANDLED', { restart: true })
  assert.equal(model.calls[2].query.cursor, undefined)
  assert.deepEqual(model.boxes.HANDLED.items.map(r => r.id), ['partial'])
  old.resolve(page([item('partial')])); await more
  assert.deepEqual(model.boxes.PENDING.items, [])
})
test('newer decision snapshot cannot regress through a slower overlapping box or legacy result', async () => {
  const next = voted('same', 'APPROVE', { currentStepId: 'later' })
  const model = setup(() => page([item('same')]))
  model.reconcile(next)
  await model.load('PENDING', { restart: true })
  assert.equal(model.boxes.PENDING.items[0].currentStepId, 'later')
  assert.equal(model.remember([item('same')])[0].history.length, 2)
  await model.load('HANDLED', { restart: true })
  assert.equal(model.boxes.HANDLED.items[0].currentStepId, 'later')
})
test('filtered handled removes a formerly pending row after terminal decision', async () => {
  const model = setup(() => page([voted('a')]))
  await model.setFilters('HANDLED', { status: 'PENDING' })
  assert.equal(model.boxes.HANDLED.items.length, 1)
  model.reconcile(voted('a', 'APPROVE', { status: 'APPROVED', currentStepId: null, history: [...voted('a').history, { actorId: '101', action: 'APPROVE', stepId: 'group' }] }))
  assert.deepEqual(model.boxes.HANDLED.items, [])
})
test('invalid cursor presents restart recovery, refresh omits the rejected cursor', async () => {
  let count = 0
  const model = setup(() => ++count === 1 ? page([item('a')], 'expired') : count === 2 ? Promise.reject({ response: { status: 400 } }) : page())
  await model.load('PENDING'); await model.load('PENDING')
  assert.match(model.boxes.PENDING.error, /第一页/)
  await model.load('PENDING', { restart: true })
  assert.equal(model.calls[2].query.cursor, undefined)
  assert.equal(model.boxes.PENDING.error, '')
})
test('authentication failures clear both boxes and notify host once', async () => {
  let unauthorized = 0
  const model = createMemberInbox({ canVote, loadPage: () => Promise.reject({ response: { status: 401 } }), onUnauthorized: () => unauthorized++ })
  model.setIdentity('102'); model.boxes.HANDLED.items = [voted('a')]
  await model.load('PENDING')
  assert.equal(unauthorized, 1); assert.deepEqual(model.boxes, createInboxBoxes())
})
test('malformed envelopes and non-advancing cursors fail without corrupting saved pages', async () => {
  for (const response of [{ items: [], nextCursor: null }, page([], 'bad'), page([item('x'), item('x')]), page([null]), { data: { items: [] } }]) {
    const model = setup(() => response); await model.load('PENDING')
    assert.equal(model.boxes.PENDING.loaded, false); assert.ok(model.boxes.PENDING.error)
  }
  const model = setup(() => page([item('a')], 'same'))
  await model.load('PENDING'); await model.load('PENDING')
  assert.equal(model.boxes.PENDING.items.length, 1); assert.ok(model.boxes.PENDING.error)
})
test('native API forwards only supplied paging parameters and cancellation through RuoYi request', async () => {
  const calls = []
  globalThis.__nativeInboxRequest = config => { calls.push(config); return config }
  try {
    const source = (await readFile(new URL('../../../api/arcflow/approval.js', import.meta.url), 'utf8')).replace("import request from '@/utils/request'", 'const request = globalThis.__nativeInboxRequest').replace("'../../views/arcflow/approval/business-document.js'", JSON.stringify(new URL('./business-document.js', import.meta.url).href))
    const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
    const signal = new AbortController().signal, params = { box: 'HANDLED', limit: 25, cursor: 'opaque+/=:' }
    api.getInbox(params, signal)
    const { transformResponse, ...config } = calls[0]
    assert.deepEqual(config, { url: '/arcflow/requests/inbox', method: 'get', params, signal })
    assert.equal(typeof transformResponse[0], 'function')
    for (const business of ['{"currency":"USD","unitPrice":1000000000.00000001}', '{"quantity":1.00000000000000001}']) {
      assert.throws(() => transformResponse[0](`{"code":200,"data":{"items":[{"business":${business}}],"nextCursor":null}}`))
    }
    assert.equal(transformResponse[0]('{"code":200,"data":{"items":[{"business":{"currency":"USD","unitPrice":1E+9}}],"nextCursor":null}}').data.items[0].business.unitPrice, 1000000000)
    for (const method of ['getMe', 'getPeople', 'getProcess', 'getRequests']) assert.equal(api[method](signal).signal, signal)
  } finally { delete globalThis.__nativeInboxRequest }
})

test('snapshot cache rejects immutable business changes and rewritten audit prefixes atomically', async () => {
  const business = { type: 'procurement', businessId: 'PO-1', title: 'Adapters', reason: 'Synthetic', item: 'Adapter', quantity: 3, unitPrice: 0.1, currency: 'USD' }
  const original = item('typed', { business })
  const model = setup()
  model.remember([original])
  for (const changed of [
    { ...original, business: { ...business, quantity: 4 } },
    { ...original, definition: { ...definition, version: 99 } },
    { ...original, history: [{ ...original.history[0], actorId: 'other' }] },
    { ...original, status: 'APPROVED' }
  ]) assert.throws(() => model.remember([voted('uncommitted'), changed]))
  assert.equal(model.remember([item('uncommitted')])[0].history.length, 1)
  assert.deepEqual(model.remember([original])[0], original)
  const next = { ...original, history: [...original.history, { actorId: '102', action: 'APPROVE', stepId: 'group' }] }
  model.remember([next])
  assert.deepEqual(model.remember([original])[0], next)
})
