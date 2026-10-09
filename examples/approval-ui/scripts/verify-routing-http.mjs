// Uses the actual browser-facing client workspace and codecs against a fresh
// backend. It verifies integration, not visual rendering or browser interaction.
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createScenarioApi } from '../src/scenarios/scenario-api.js'
import { createScenarioWorkspace } from '../src/scenarios/scenario-workspace.js'
import { paymentFixture, contractFixture, receivingFixture } from '../src/scenarios/scenario-fixtures.js'
import { pendingParticipants } from '../src/process.js'
import { evaluateRouting } from '../src/routing.js'
const jar = process.argv[2]
if (!jar) throw new Error('Usage: node scripts/verify-routing-http.mjs /absolute/path/to/backend.jar')
const port = Number(process.env.ARCFLOW_ROUTING_TEST_PORT || 18092), base = `http://127.0.0.1:${port}`, directory = await mkdtemp(join(tmpdir(), 'arcflow-routing-http-'))
const secrets = Object.fromEntries(['alice', 'bob', 'carol'].map(actor => [actor, randomUUID()]))
const backend = spawn(process.env.JAVA || 'java', ['-jar', resolve(jar), `--server.port=${port}`], { env: { ...process.env, APPROVAL_DATA_FILE: join(directory, 'state.json'), APPROVAL_UI_ORIGIN: 'http://localhost:5173', ...Object.fromEntries(Object.entries(secrets).map(([actor, secret]) => [`APPROVAL_${actor.toUpperCase()}_PASSWORD`, secret])) }, stdio: ['ignore', 'ignore', 'ignore'] })
let startupError = false, loseNext = false; backend.on('error', () => { startupError = true })
const pause = delay => new Promise(resolve => setTimeout(resolve, delay)), attempts = [], results = []
const api = createScenarioApi(async (path, options) => {
  const response = await fetch(new URL(path, base), options)
  if (path.endsWith('/documents') && options.method === 'POST') {
    attempts.push({ path, key: options.headers['Idempotency-Key'], body: options.body })
    if (loseNext) { loseNext = false; await response.text(); throw new TypeError('Injected response loss after real save') }
  }
  return response
})
const workspace = createScenarioWorkspace(api, randomUUID), s = workspace.state
const copy = value => JSON.parse(JSON.stringify(value))
function noError(operation) { assert.equal(s.error, null, `${operation}: ${s.error?.operation || 'none'} / ${s.error?.cause?.message || 'none'}`) }
async function login(actor, id) { workspace.logout(); await workspace.login(actor, secrets[actor]); noError(`Login ${actor}`); if (id) await workspace.activate(id); noError('Activate scenario') }
function select(id) { workspace.select(id); return s.items.find(view => view.request.id === id) }
async function submit(business) { workspace.setForm(business); await workspace.submit(); noError('Submit'); return select(s.selectedId) }
async function finish(view) {
  const scene = view.request.processId, id = view.request.id
  let votes = 0
  while (view.request.status === 'PENDING') {
    const actor = pendingParticipants(view.request)[0]; assert.ok(actor)
    await login(actor, scene); const current = select(id); assert.equal(workspace.canDecide(current), true)
    s.comment = 'Synthetic conditional-route review'; await workspace.decide('APPROVE'); noError('Vote'); view = select(id)
    assert.ok(++votes <= 8)
  }
  assert.equal(view.request.status, 'APPROVED'); return view
}
try {
  let ready = false
  for (let attempt = 0; attempt < 90; attempt++) { if (startupError || backend.exitCode !== null) throw new Error('Disposable Java backend did not start'); try { ready = (await fetch(`${base}/api/me`)).status === 401 } catch {} if (ready) break; await pause(1000) }
  assert.equal(ready, true)
  await login('alice'); const unchangedExpense = copy(s.process)
  const specs = [
    { id: 'erp-payment', fixture: paymentFixture, index: 1, predicate: { field: 'payment.netTotal', operator: 'GTE', currency: 'CNY', threshold: 10000 }, skipped: () => paymentFixture(), included: () => { const value = paymentFixture(); Object.assign(value.lines[0], { allocationAmount: '6000', deductionAmount: '0', deductionReason: '' }); value.lines[1].allocationAmount = '4000'; return value }, actual: ['CNY 6500', 'CNY 10000'] },
    { id: 'erp-receiving', fixture: receivingFixture, index: 1, predicate: { field: 'receiving.hasRejectedLines', operator: 'EQ', expected: true }, skipped: () => { const value = receivingFixture(); Object.assign(value.lines[0], { accepted: 80, rejected: 0, exceptionReason: '' }); return value }, included: receivingFixture, actual: ['false', 'true'] },
    { id: 'crm-contract', fixture: contractFixture, index: 2, predicate: { field: 'contract.termsKind', operator: 'IN', values: ['NONSTANDARD'] }, skipped: () => contractFixture({ termsKind: 'STANDARD', deviationReason: '' }), included: contractFixture, actual: ['STANDARD', 'NONSTANDARD'] },
  ]
  for (const spec of specs) {
    await login('alice', spec.id)
    const legacy = await submit(spec.fixture({ businessId: `${spec.id}-legacy`, title: `${spec.id} legacy` }))
    assert.equal(Object.hasOwn(legacy.request, 'routing'), false)
    s.draft.schemaVersion = 4; s.draft.nodes[spec.index].runIf = { mode: spec.id === 'crm-contract' ? 'ANY' : 'ALL', predicates: [spec.predicate] }
    await workspace.publish(); noError('Publish conditional process'); const published = copy(s.process), conditionalId = published.nodes[spec.index].id
    if (spec.id === 'erp-payment') {
      const count = attempts.length; workspace.setForm(paymentFixture({ currency: 'USD' })); await workspace.submit()
      assert.equal(s.error.operation, 'routing'); assert.equal(s.error.cause.code, 'CURRENCY_MISMATCH'); assert.equal(attempts.length, count)
    }
    const business = { ...spec.skipped(), businessId: `${spec.id}-skipped`, title: `${spec.id} skipped` }
    workspace.setForm(business); loseNext = true; await workspace.submit()
    assert.equal(s.uncertainSubmission, true); assert.equal(s.error.operation, 'submit')
    const firstAttempt = attempts.at(-1)
    delete s.draft.nodes[spec.index].runIf; await workspace.publish(); noError('Publish all-unconditional schema4'); assert.equal(s.process.schemaVersion, 4)
    assert.equal(workspace.submissionDefinition().version, published.version)
    await workspace.submit(); noError('Replay frozen conditional request'); assert.deepEqual(attempts.at(-1), firstAttempt)
    let skipped = copy(select(s.selectedId)); assert.equal(skipped.request.processVersion, published.version); assert.equal(skipped.request.routing.stepIds.includes(conditionalId), false)
    assert.equal(skipped.request.routing.evaluations[0].predicates[0].actualValue, spec.actual[0]); assert.deepEqual(skipped.request.routing, evaluateRouting(skipped.request.definition, skipped.request.business))
    const unconditional = await submit(spec.fixture({ businessId: `${spec.id}-unconditional`, title: `${spec.id} unconditional` }))
    assert.equal(unconditional.request.definition.schemaVersion, 4); assert.deepEqual(unconditional.request.routing.evaluations, [])
    s.draft.nodes[spec.index].runIf = copy(published.nodes[spec.index].runIf); await workspace.publish(); noError('Restore conditional rule in new version')
    let included = await submit({ ...spec.included(), businessId: `${spec.id}-included`, title: `${spec.id} included` })
    assert.equal(included.request.routing.stepIds.includes(conditionalId), true); assert.equal(included.request.routing.evaluations[0].predicates[0].actualValue, spec.actual[1])
    skipped = await finish(skipped); included = await finish(included)
    await login('alice', spec.id); const savedLegacy = select(legacy.request.id)
    assert.equal(savedLegacy.request.definition.schemaVersion, 3); assert.equal(Object.hasOwn(savedLegacy.request, 'routing'), false)
    assert.deepEqual(select(skipped.request.id).request.routing, skipped.request.routing)
    results.push({ scenario: spec.id, skippedSteps: skipped.request.routing.stepIds, includedSteps: included.request.routing.stepIds, actualValues: spec.actual, frozenVersion: skipped.request.processVersion, currentVersion: s.process.version, skippedVotes: skipped.request.history.length - 1, includedVotes: included.request.history.length - 1 })
  }
  await login('alice'); assert.deepEqual(copy(s.process), unchangedExpense)
  console.log('PASS: real client workspace and strict response validators with payment/receiving/contract routing; exact facts; currency block; ALL/ANY voting; excluded stages; schema4 unconditional route; old snapshots; lost-response retries pinned across publication; unchanged expense scope.')
  console.log(JSON.stringify({ backendSha256: createHash('sha256').update(await readFile(resolve(jar))).digest('hex'), browserRenderingVerified: false, results }, null, 2))
} catch (error) { console.error('Conditional HTTP acceptance failed: ' + String(error.message).split('\n')[0]); process.exitCode = 1 }
finally { workspace.dispose(); backend.kill('SIGTERM'); await Promise.race([new Promise(resolve => backend.once('exit', resolve)), pause(5000)]); if (backend.exitCode === null) backend.kill('SIGKILL'); await rm(directory, { recursive: true, force: true }) }
