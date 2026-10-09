// Uses the actual installed transport/workspace with a disposable real backend.
// Synthetic fixtures only; no browser, downloads, remote writes or existing store.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createScenarioApi } from '../src/scenarios/scenario-api.js'
import { createScenarioWorkspace } from '../src/scenarios/scenario-workspace.js'
import { receivingFixture } from '../src/scenarios/scenario-fixtures.js'
const jar = process.argv[2]
if (!jar) throw new Error('Usage: node scripts/verify-receiving-http.mjs /absolute/path/to/backend.jar')
const port = Number(process.env.ARCFLOW_RECEIVING_TEST_PORT || 18089), base = `http://127.0.0.1:${port}`
const directory = await mkdtemp(join(tmpdir(), 'arcflow-receiving-http-'))
const secrets = Object.fromEntries(['alice', 'bob', 'carol'].map(actor => [actor, randomUUID()]))
const backend = spawn(process.env.JAVA || 'java', ['-jar', resolve(jar), `--server.port=${port}`], { env: { ...process.env, APPROVAL_DATA_FILE: join(directory, 'state.json'), APPROVAL_UI_ORIGIN: 'http://localhost:5173', ...Object.fromEntries(Object.entries(secrets).map(([actor, secret]) => [`APPROVAL_${actor.toUpperCase()}_PASSWORD`, secret])) }, stdio: ['ignore', 'ignore', 'ignore'] })
let startupError = false; backend.on('error', () => { startupError = true })
const pause = delay => new Promise(resolve => setTimeout(resolve, delay))
let loseNextSubmission = false
const postedKeys = []
const api = createScenarioApi(async (path, options) => {
  const response = await fetch(new URL(path, base), options)
  if (path.endsWith('/documents') && options.method === 'POST') {
    postedKeys.push(options.headers['Idempotency-Key'])
    if (loseNextSubmission) { loseNextSubmission = false; await response.text(); throw new TypeError('Injected lost acknowledgement after actual save') }
  }
  return response
})
const workspace = createScenarioWorkspace(api, randomUUID, 'erp-receiving'), s = workspace.state
function receipt(suffix) {
  const business = receivingFixture({ businessId: `GRN-${suffix}`, title: `Receiving ${suffix}` })
  for (const line of business.lines) for (const key of ['ordered', 'received', 'accepted', 'rejected']) line[key] = String(line[key])
  return business
}
function noError(operation) { assert.equal(s.error, null, `${operation}: failure operation=${s.error?.operation || 'none'}, code=${s.error?.cause?.code || 'none'}`) }
async function login(actor) { workspace.logout(); await workspace.login(actor, secrets[actor]); noError(`Login ${actor}`); assert.equal(s.me.id, actor) }
function select(id) { workspace.select(id); return s.items.find(view => view.request.id === id) }
try {
  let ready = false
  for (let attempt = 0; attempt < 90; attempt++) {
    if (startupError || backend.exitCode !== null) throw new Error('Disposable Java backend did not start')
    try { ready = (await fetch(`${base}/api/me`)).status === 401 } catch {}
    if (ready) break
    await pause(1000)
  }
  assert.equal(ready, true, 'Disposable Java backend must become ready')
  await login('alice'); assert.deepEqual(s.catalog.map(entry => entry.id), ['crm-contract', 'erp-payment', 'erp-receiving', 'oa-expense', 'oa-seal-use', 'oa-travel']); assert.equal(s.process.id, 'erp-receiving')
  workspace.setForm(receipt('retry')); loseNextSubmission = true; await workspace.submit()
  assert.equal(s.uncertainSubmission, true); assert.equal(s.form.title, 'Receiving retry')
  await workspace.submit(); noError('Idempotent retry'); const saved = s.items[0], id = saved.request.id
  assert.equal(postedKeys.length, 2); assert.equal(postedKeys[0], postedKeys[1]); assert.equal(saved.total, null)
  assert.deepEqual(JSON.parse(JSON.stringify(saved.summary)), { kind: 'receiving', lineCount: 2, exceptionLineCount: 1, quantities: [{ unit: 'PCS', received: 80, accepted: 78, rejected: 2 }, { unit: 'BOX', received: 10, accepted: 10, rejected: 0 }] })
  const originalVersion = saved.request.processVersion
  s.draft.name = 'Updated real receiving process'; await workspace.publish(); noError('Process publication')
  assert.equal(s.process.version, originalVersion + 1); assert.equal(saved.request.processVersion, originalVersion)
  await login('bob'); select(id); s.comment = 'Warehouse checked quantities'; await workspace.decide('APPROVE'); noError('Warehouse approval')
  assert.equal(select(id).request.currentStepId, 'receiving-inspection'); assert.equal(workspace.canDecide(select(id)), false)
  await login('carol'); select(id); s.comment = 'Quality exceptions recorded'; await workspace.decide('APPROVE'); noError('Quality approval')
  assert.equal(select(id).request.currentStepId, 'procurement-review')
  await login('bob'); assert.equal(workspace.canDecide(select(id)), true); s.comment = 'Procurement reviewed'; await workspace.decide('APPROVE'); noError('Procurement approval')
  assert.equal(select(id).request.status, 'APPROVED'); assert.equal(select(id).request.history.length, 4)
  await login('alice'); assert.equal(select(id).request.status, 'APPROVED'); assert.equal(select(id).request.processVersion, originalVersion)
  workspace.setForm(receipt('rejected')); await workspace.submit(); noError('Second receiving submission'); const rejectedId = s.selectedId
  await login('carol'); select(rejectedId); s.comment = 'Rejected at quality inspection'; await workspace.decide('REJECT'); noError('ALL rejection')
  assert.equal(select(rejectedId).request.status, 'REJECTED'); assert.equal(select(rejectedId).request.currentStepId, null)
  await login('bob'); assert.equal(workspace.canDecide(select(rejectedId)), false)
  console.log('PASS: real installed scenario transport + workspace: catalog, integer codec, per-unit summary, saved-response-loss retry, immutable publication, ALL votes, repeated Bob, rejection, identity changes and re-login.')
  console.log('Backend: ' + (process.env.ARCFLOW_VERIFICATION_BACKEND || 'provided jar; verify framework version separately'))
} catch (error) {
  console.error('Receiving HTTP acceptance failed: ' + String(error.message).split('\n')[0]); process.exitCode = 1
} finally {
  workspace.dispose(); backend.kill('SIGTERM')
  await Promise.race([new Promise(resolve => backend.once('exit', resolve)), pause(5000)])
  if (backend.exitCode === null) backend.kill('SIGKILL')
  await rm(directory, { recursive: true, force: true })
}
