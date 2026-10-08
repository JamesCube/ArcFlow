// Real client + disposable loopback backend. No package installation or external I/O.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { createApi } from '../src/api.js'
import { createMemberInbox } from '../src/member-inbox.js'
import { validateSubmissionResponse, validateDecisionResponse } from '../src/submission-response.js'
import { procurementTotal } from '../src/business-document.js'
const jar = resolve(process.argv[2] || '../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar')
await access(jar)
const probe = createServer(); await new Promise((yes, no) => { probe.once('error', no); probe.listen(0, '127.0.0.1', yes) })
const port = probe.address().port; await new Promise(yes => probe.close(yes))
const directory = await mkdtemp(join(tmpdir(), 'arcflow-inbox-client-'))
const passwords = Object.fromEntries(['alice', 'bob', 'carol'].map(id => [id, randomBytes(24).toString('base64url')]))
const env = { ...process.env, APPROVAL_DATA_FILE: join(directory, 'requests.json') }
for (const [id, value] of Object.entries(passwords)) env[`APPROVAL_${id.toUpperCase()}_PASSWORD`] = value
const child = spawn(process.env.JAVA || 'java', ['-jar', jar, `--server.port=${port}`, '--server.address=127.0.0.1'], { env, stdio: 'ignore' })
const inboxBodies = []
const api = createApi(async (path, options) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, signal: AbortSignal.any([options.signal, AbortSignal.timeout(10000)]) })
  if (response.ok && path.startsWith('/api/requests/inbox?')) inboxBodies.push(await response.clone().text())
  return response
})
const inbox = createMemberInbox((path, options) => api.request(path, options))
let assertions = 0
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions++ }
const login = actor => { api.login(actor, passwords[actor]); inbox.setActor(actor) }
const refresh = async () => { await inbox.refresh(); equal(inbox.state.PENDING.error, null); equal(inbox.state.HANDLED.error, null) }
try {
  login('alice')
  let ready = false
  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null) throw new Error('Disposable backend exited')
    try { await api.request('/me'); ready = true; break } catch { await sleep(100) }
  }
  assert(ready, 'Backend did not start')
  const previous = await api.request('/process')
  const definition = { schemaVersion: 3, id: 'leave-approval', version: previous.version, name: 'Synthetic client paging', nodes: [
    { id: 'start', type: 'start', name: 'Start', assigneeId: null },
    { id: 'team', type: 'parallelApproval', name: 'Team', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ALL' },
    { id: 'again', type: 'approval', name: 'Follow-up', assigneeId: 'bob' },
    { id: 'end', type: 'end', name: 'End', assigneeId: null },
  ] }
  const published = await api.request('/process', { method: 'POST', body: JSON.stringify({ expectedVersion: previous.version, definition }) })
  for (let index = 0; index < 26; index++) await api.request('/requests', { method: 'POST', body: JSON.stringify({ title: `Synthetic ${index}`, reason: 'No personal information', days: 1, processVersion: published.version }) })
  const business = { type: 'procurement', businessId: 'PO-HTTP-INBOX', title: 'Synthetic chairs', reason: 'No personal information', item: 'Synthetic office chair', quantity: 3, unitPrice: 199.99, currency: 'CNY' }
  const payload = { business, processVersion: published.version }, intent = randomBytes(24).toString('base64url')
  const submit = () => api.request('/documents', { method: 'POST', headers: { 'Idempotency-Key': intent }, body: JSON.stringify(payload) })
  const procurement = await submit()
  equal(validateSubmissionResponse(procurement, 'alice', payload, published).business, business)
  equal((await submit()).id, procurement.id)
  await refresh(); equal(inbox.items('PENDING').length, 0); equal(inbox.items('HANDLED').length, 0)
  equal((await api.request('/requests')).length, 27)
  login('bob'); await inbox.load('PENDING'); equal(inbox.items('PENDING').length, 25); equal(typeof inbox.state.PENDING.nextCursor, 'string')
  await inbox.load('PENDING', true); equal(inbox.items('PENDING').length, 27); equal(inbox.state.PENDING.nextCursor, null)
  const selected = inbox.items('PENDING')[0]
  equal(selected.id, procurement.id); equal(selected.business, business)
  equal(procurementTotal(selected.business.quantity, selected.business.unitPrice, selected.business.currency), '599.97')
  equal(inboxBodies.some(body => /"unitPrice"\s*:\s*199\.99(?:[,}])/.test(body)), true)
  const decide = (stepId = 'team') => api.request(`/requests/${encodeURIComponent(selected.id)}/decisions`, { method: 'POST', body: JSON.stringify({ stepId, decision: 'APPROVE', comment: 'Synthetic verification' }) })
  const partial = await decide()
  equal(validateDecisionResponse(partial, selected, 'bob', 'team', 'APPROVE').business, business)
  inbox.remember(partial); await refresh()
  equal(inbox.items('PENDING').some(item => item.id === selected.id), false)
  equal(inbox.items('HANDLED').map(item => item.id), [selected.id]); equal(inbox.items('HANDLED')[0].status, 'PENDING'); equal(inbox.items('HANDLED')[0].business, business)
  login('carol'); await decide()
  login('bob'); await refresh(); equal(inbox.items('PENDING').some(item => item.id === selected.id), true)
  equal(inbox.items('HANDLED')[0].currentStepId, 'again')
  equal(inbox.items('HANDLED')[0].business, business)
  const beforeFinal = inbox.items('HANDLED')[0], final = await decide('again')
  equal(validateDecisionResponse(final, beforeFinal, 'bob', 'again', 'APPROVE').business, business)
  inbox.remember(final); await refresh()
  equal(inbox.items('PENDING').some(item => item.id === selected.id), false)
  equal(inbox.items('HANDLED')[0].status, 'APPROVED'); equal(inbox.items('HANDLED')[0].business, business)
  inbox.setFilters('HANDLED', { status: 'APPROVED', processVersion: String(published.version) })
  while (inbox.state.HANDLED.loading) await sleep(10)
  equal(inbox.items('HANDLED').map(item => item.id), [procurement.id]); equal(inbox.state.HANDLED.error, null)
  api.logout(); inbox.dispose(); equal(inbox.state.entities, {}); equal(inbox.state.PENDING.nextCursor, null)
  console.log(`PASS: ${assertions} real client/HTTP assertions; 27 synthetic requests (26 leave + 1 procurement); independent pages, exact money tokens, typed idempotent creation, immutable business through partial/final votes, repeated-stage overlap, filter reset and logout.`)
} finally {
  api.logout(); inbox.dispose(); child.kill('SIGTERM')
  await Promise.race([new Promise(yes => { if (child.exitCode !== null) yes(); else child.once('exit', yes) }), sleep(10000).then(() => child.kill('SIGKILL'))])
  await rm(directory, { recursive: true, force: true })
}
