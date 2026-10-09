// Actual installed browser-facing transport and workspace, exercised over HTTP.
// This does not replace rendering or real-browser acceptance.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createScenarioApi } from '../src/scenarios/scenario-api.js'
import { createScenarioWorkspace } from '../src/scenarios/scenario-workspace.js'
import { paymentFixture, contractFixture } from '../src/scenarios/scenario-fixtures.js'
const jar = process.argv[2]
if (!jar) throw new Error('Usage: node scripts/verify-complex-http.mjs /absolute/path/to/backend.jar')
const port = Number(process.env.ARCFLOW_COMPLEX_TEST_PORT || 18091), base = `http://127.0.0.1:${port}`, directory = await mkdtemp(join(tmpdir(), 'arcflow-complex-http-'))
const secrets = Object.fromEntries(['alice', 'bob', 'carol'].map(actor => [actor, randomUUID()]))
const backend = spawn(process.env.JAVA || 'java', ['-jar', resolve(jar), `--server.port=${port}`], { env: { ...process.env, APPROVAL_DATA_FILE: join(directory, 'state.json'), APPROVAL_UI_ORIGIN: 'http://localhost:5173', ...Object.fromEntries(Object.entries(secrets).map(([actor, secret]) => [`APPROVAL_${actor.toUpperCase()}_PASSWORD`, secret])) }, stdio: ['ignore', 'ignore', 'ignore'] })
let startupError = false, loseNext = false; backend.on('error', () => { startupError = true })
const pause = delay => new Promise(resolve => setTimeout(resolve, delay)), attempts = []
const api = createScenarioApi(async (path, options) => {
  const response = await fetch(new URL(path, base), options)
  if (path.endsWith('/documents') && options.method === 'POST') { attempts.push({ path, key: options.headers['Idempotency-Key'], body: options.body }); if (loseNext) { loseNext = false; await response.text(); throw new TypeError('Injected response loss after real save') } }
  return response
})
const workspace = createScenarioWorkspace(api, randomUUID), s = workspace.state
function noError(operation) { assert.equal(s.error, null, `${operation}: ${s.error?.operation || 'none'} / ${s.error?.cause?.message || 'none'}`) }
async function login(actor, id) { workspace.logout(); await workspace.login(actor, secrets[actor]); noError(`Login ${actor}`); if (id) await workspace.activate(id); noError('Activate scenario') }
function select(id) { workspace.select(id); return s.items.find(view => view.request.id === id) }
async function vote(actor, scene, id, decision) { await login(actor, scene); assert.equal(workspace.canDecide(select(id)), true); s.comment = `Synthetic ${actor} ${decision}`; await workspace.decide(decision); noError('Decision'); return select(id) }
try {
  let ready = false
  for (let attempt = 0; attempt < 90; attempt++) { if (startupError || backend.exitCode !== null) throw new Error('Disposable Java backend did not start'); try { ready = (await fetch(`${base}/api/me`)).status === 401 } catch {} if (ready) break; await pause(1000) }
  assert.equal(ready, true)
  await login('alice'); assert.deepEqual(s.catalog.map(entry => entry.id), ['crm-contract', 'erp-payment', 'erp-receiving', 'oa-expense', 'oa-seal-use', 'oa-travel'])
  const initialExpense = JSON.stringify(s.process)
  const specs = [{ id: 'erp-payment', fixture: paymentFixture }, { id: 'crm-contract', fixture: contractFixture }]
  const saved = {}
  // Independent lost acknowledgements, original process pins, and dirty drafts.
  for (const spec of specs) {
    await workspace.activate(spec.id); noError('Activate form'); assert.equal(s.process.version, 1); workspace.setForm(spec.fixture()); s.draft.name = `${spec.id} unpublished draft`
    loseNext = true; await workspace.submit(); assert.equal(s.uncertainSubmission, true); assert.equal(s.error.operation, 'submit'); saved[spec.id] = { definition: JSON.stringify(workspace.submissionDefinition()), title: s.form.title }
  }
  for (const spec of specs) {
    await workspace.activate(spec.id); assert.equal(s.form.title, saved[spec.id].title); assert.equal(s.draft.name, `${spec.id} unpublished draft`)
    await workspace.publish(); noError('Publish v2'); assert.equal(s.process.version, 2); assert.equal(JSON.stringify(workspace.submissionDefinition()), saved[spec.id].definition)
    await workspace.submit(); noError('Replay original submission'); saved[spec.id].view = s.items[0]; assert.equal(saved[spec.id].view.request.processVersion, 1); assert.equal(s.form.title, '')
    const posts = attempts.filter(attempt => attempt.path.includes(spec.id)); assert.equal(posts.length, 2); assert.deepEqual(posts[0], posts[1])
  }
  assert.notEqual(attempts[0].key, attempts[1].key)
  let payment = saved['erp-payment'].view, contract = saved['crm-contract'].view
  assert.equal(payment.total, '6500.00'); assert.deepEqual(JSON.parse(JSON.stringify(payment.paymentSummary)), { type: 'paymentRequest', declaredOutstanding: '10000.00', grossAllocation: '7000.00', deductionTotal: '500.00', netTotal: '6500.00' })
  assert.equal(contract.total, '100000.00'); assert.equal(typeof contract.request.business.contractRevision, 'number')
  payment = await vote('bob', 'erp-payment', payment.request.id, 'APPROVE'); assert.equal(payment.request.currentStepId, 'payment-check'); assert.equal(workspace.canDecide(payment), false)
  payment = await vote('carol', 'erp-payment', payment.request.id, 'APPROVE'); assert.equal(payment.request.currentStepId, 'payment-final')
  payment = await vote('bob', 'erp-payment', payment.request.id, 'REJECT'); assert.equal(payment.request.status, 'PENDING')
  payment = await vote('carol', 'erp-payment', payment.request.id, 'APPROVE'); assert.equal(payment.request.status, 'APPROVED'); assert.equal(payment.request.history.length, 5)
  contract = await vote('bob', 'crm-contract', contract.request.id, 'APPROVE'); assert.equal(contract.request.currentStepId, 'contract-review'); assert.equal(workspace.canDecide(contract), true)
  contract = await vote('bob', 'crm-contract', contract.request.id, 'APPROVE'); assert.equal(contract.request.status, 'PENDING'); assert.equal(workspace.canDecide(contract), false)
  contract = await vote('carol', 'crm-contract', contract.request.id, 'APPROVE'); assert.equal(contract.request.status, 'APPROVED'); assert.equal(contract.request.history.length, 4)
  for (const spec of specs) {
    await login('alice', spec.id); const old = saved[spec.id].view; assert.equal(select(old.request.id).request.status, 'APPROVED'); assert.equal(select(old.request.id).request.processVersion, 1)
    workspace.setForm(spec.fixture({ businessId: `${spec.id}-reject`, title: `${spec.id} reject` })); await workspace.submit(); noError('Submit current v2'); const id = s.selectedId; assert.equal(select(id).request.processVersion, 2)
    const rejected = await vote('bob', spec.id, id, 'REJECT'); assert.equal(rejected.request.status, 'REJECTED')
  }
  await login('alice'); assert.equal(JSON.stringify(s.process), initialExpense)
  console.log('PASS: six-entry real catalog; exact payment/contract codecs and totals; two independent lost-response retries; v1 intent pins after v2 publication; real ALL/ANY votes; repeated Bob; terminal outcomes; identity and scenario isolation.')
  console.log('Backend: ' + (process.env.ARCFLOW_BACKEND_RUNTIME || 'provided jar; framework version not asserted'))
} catch (error) { console.error('Complex HTTP acceptance failed: ' + String(error.message).split('\n')[0]); process.exitCode = 1 }
finally { workspace.dispose(); backend.kill('SIGTERM'); await Promise.race([new Promise(resolve => backend.once('exit', resolve)), pause(5000)]); if (backend.exitCode === null) backend.kill('SIGKILL'); await rm(directory, { recursive: true, force: true }) }
