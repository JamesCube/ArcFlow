import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve, join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { validatePng } from './expense-routing-png.mjs'
import { expenseCaptureContract, expenseCaptureNames, expenseExpectedRoutes } from './expense-routing-capture-contract.mjs'
import { parseScenarioJson } from '../src/scenarios/scenario-api.js'
import { getScenarioHandler } from '../src/scenarios/scenario-registry.js'
import { sourceProvenance } from '../e2e/complex-evidence.mjs'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
async function files(directory) { const entries = await readdir(directory, { withFileTypes: true }); return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : entry.isFile() ? [join(directory, entry.name)] : []))).flat() }
export async function verifyExpenseCaptures(root, expected) {
  const all = await files(root), images = all.filter(file => file.endsWith('.png')), receipts = all.filter(file => basename(file) === 'expense-routing-receipt.json')
  const names = new Set(expenseCaptureNames), metadataByName = new Map(), locales = new Set(), handler = getScenarioHandler('oa-expense')
  assert.equal(images.length, names.size, 'Incomplete expense image matrix'); assert.equal(receipts.length, 2, 'Both language journeys are required')
  assert.match(expected.sourceRevision, /^[0-9a-f]{40}$/); assert.match(expected.uiSourceTreeSHA256, /^[0-9a-f]{64}$/)
  const runtime = expected.runtime
  assert.equal(runtime.schemaVersion, 1); assert.equal(runtime.sourceRevision, expected.sourceRevision)
  assert.equal(runtime.springBootVersion, '4.1.1'); assert.match(runtime.springFrameworkVersion, /^7\./); assert.match(runtime.springSecurityVersion, /^7\./)
  assert.match(runtime.backendJarSHA256, /^[0-9a-f]{64}$/)
  function provenance(metadata) {
    assert.equal(metadata.sourceRevision, expected.sourceRevision, 'Wrong source revision')
    assert.equal(metadata.sourceWorkingTree, 'clean-commit', 'Captures require a clean source commit')
    assert.equal(metadata.trackedDiffSHA256, hash(''), 'Clean captures must have an empty tracked diff')
    assert.equal(metadata.uiSourceTreeSHA256, expected.uiSourceTreeSHA256, 'Wrong UI source tree')
    assert.equal(metadata.backendRuntime, 'declared-Boot-4.1.1')
    assert.equal(metadata.backendJarSHA256, runtime.backendJarSHA256, 'Wrong inspected backend archive')
    for (const key of ['captureRunId', 'captureRunAttempt', 'captureRepository']) { assert.ok(expected[key], `${key} must be pinned`); assert.equal(metadata[key], expected[key], `Wrong ${key}`) }
  }
  for (const image of images) {
    assert.ok((await stat(image)).size <= 64 * 1024 * 1024)
    const stem = basename(image, '.png'), bytes = await readFile(image), metadata = JSON.parse(await readFile(image.replace(/\.png$/, '.json'), 'utf8'))
    assert.ok(names.delete(stem), `Unexpected or repeated image ${stem}`); provenance(metadata)
    assert.equal(metadata.state, stem); assert.equal(metadata.image, basename(image)); assert.equal(metadata.imageSHA256, hash(bytes), 'Image bytes differ from the sidecar')
    assert.equal(metadata.fullPage, true); assert.deepEqual(metadata.scrollOrigin, { x: 0, y: 0 })
    assert.deepEqual(metadata.viewport, stem.endsWith('-390px') ? { width: 390, height: 844 } : { width: 1440, height: 1000 })
    const pixels = validatePng(bytes); assert.equal(pixels.width, metadata.viewport.width); assert.ok(pixels.height >= metadata.viewport.height)
    assert.equal(metadata.locale, stem.includes('-zh-') ? 'zh-CN' : 'en'); assert.ok(Number.isFinite(Date.parse(metadata.capturedAt)))
    metadataByName.set(stem, metadata)
  }
  for (const receipt of receipts) {
    const metadata = JSON.parse(await readFile(receipt, 'utf8')); provenance(metadata)
    assert.equal(metadata.result, 'passed'); assert.equal(metadata.realBackend, true); assert.equal(metadata.browser, 'Chromium'); assert.equal(metadata.currencyMismatchPosts, 0)
    assert.ok(['en', 'zh'].includes(metadata.locale)); assert.ok(!locales.has(metadata.locale)); locales.add(metadata.locale)
    assert.equal(metadata.versions.conditional, metadata.versions.legacy + 1); assert.equal(metadata.versions.later, metadata.versions.conditional + 1)
    assert.equal(metadata.views.length, 5); assert.equal(new Set(metadata.views.map(view => view.request.id)).size, 5)
    // Validate each real-backend envelope independently, including exact sums,
    // route recomputation, selected-stage history and legacy omission rules.
    const views = metadata.views.map(view => handler.validateView(parseScenarioJson(JSON.stringify(view))))
    const checkpoints = new Map(metadata.checkpoints.map(checkpoint => [checkpoint.state, checkpoint]))
    assert.equal(checkpoints.size, metadata.checkpoints.length); assert.equal(checkpoints.size, Object.values(expenseCaptureContract).filter(Boolean).length)
    const journeyIds = new Map()
    for (const [state, requirement] of Object.entries(expenseCaptureContract)) {
      const checkpoint = checkpoints.get(state)
      if (requirement) {
        assert.ok(checkpoint, `Missing checkpoint ${state}`)
        const view = views.find(view => view.request.id === checkpoint.requestId), item = view?.request
        assert.ok(item, `No saved request for ${state}`); assert.equal(item.processId, 'oa-expense')
        assert.equal(checkpoint.status, requirement.status); assert.equal(checkpoint.currentStepId, requirement.currentStepId)
        assert.equal(checkpoint.processVersion, metadata.versions[requirement.version]); assert.equal(item.processVersion, checkpoint.processVersion)
        assert.deepEqual(item.history.slice(0, checkpoint.history.length), checkpoint.history)
        const votes = checkpoint.history.filter(event => event.action !== 'SUBMIT')
        assert.deepEqual(votes.map(event => [event.actorId, event.stepId, event.action]), requirement.expectedVotes, `Wrong votes at ${state}`)
        assert.ok(votes.every(event => typeof event.comment === 'string' && event.comment.trim()))
        if (requirement.status !== 'PENDING') { assert.equal(item.status, requirement.status); assert.equal(item.currentStepId, null); assert.deepEqual(item.history, checkpoint.history) }
        if (journeyIds.has(requirement.journey)) assert.equal(item.id, journeyIds.get(requirement.journey), 'Frozen journey switched requests')
        else journeyIds.set(requirement.journey, item.id)
        if (requirement.journey === 'legacy') { assert.equal(item.definition.schemaVersion, 2); assert.ok(!Object.hasOwn(item, 'routing')) }
        else {
          const route = expenseExpectedRoutes[requirement.journey]
          assert.equal(item.definition.schemaVersion, 4)
          assert.deepEqual(item.definition.nodes[1].runIf, { mode: 'ALL', predicates: [{ field: 'expense.totalAmount', operator: 'GTE', currency: 'CNY', threshold: route.threshold }] })
          assert.deepEqual(item.routing, { schemaVersion: 1, stepIds: route.stepIds, evaluations: [{ stepId: 'manager', result: route.result, predicates: [{ field: 'expense.totalAmount', actualValue: route.actualValue, result: route.result }] }] })
          assert.ok(votes.every(event => item.routing.stepIds.includes(event.stepId)), 'Skipped steps cannot have votes')
        }
      } else assert.equal(checkpoint, undefined)
      for (const viewport of ['desktop', '390px']) {
        const image = metadataByName.get(`${state}-${metadata.locale}-${viewport}`)
        assert.ok(image, `Missing paired capture ${state}`)
        assert.equal(image.requestId, checkpoint?.requestId ?? null); assert.equal(image.requestStatus, checkpoint?.status ?? null)
        assert.equal(image.currentStepId, checkpoint?.currentStepId ?? null); assert.equal(image.decisionCount, requirement?.expectedVotes.length ?? null)
      }
    }
    assert.equal(new Set(journeyIds.values()).size, 5, 'Distinct business journeys must use distinct requests')
  }
  assert.equal(names.size, 0); assert.equal(locales.size, 2)
  return 'Verified 48 complete expense routing PNGs and 2 successful real-backend browser journeys with exact source/tree/run/backend provenance. Integrity checks do not certify pixel quality or screenshot authenticity.'
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  for (const env of ['ARCFLOW_EXPECT_SOURCE_REVISION', 'ARCFLOW_EXPECT_RUNTIME_REPORT', 'ARCFLOW_EXPECT_CAPTURE_RUN_ID', 'ARCFLOW_EXPECT_CAPTURE_RUN_ATTEMPT', 'ARCFLOW_EXPECT_CAPTURE_REPOSITORY']) assert.ok(process.env[env], `${env} is required`)
  const expected = { sourceRevision: process.env.ARCFLOW_EXPECT_SOURCE_REVISION, uiSourceTreeSHA256: process.env.ARCFLOW_EXPECT_UI_SOURCE_TREE_SHA256 || (await sourceProvenance()).uiSourceTreeSHA256, captureRunId: process.env.ARCFLOW_EXPECT_CAPTURE_RUN_ID, captureRunAttempt: process.env.ARCFLOW_EXPECT_CAPTURE_RUN_ATTEMPT, captureRepository: process.env.ARCFLOW_EXPECT_CAPTURE_REPOSITORY, runtime: JSON.parse(await readFile(resolve(process.env.ARCFLOW_EXPECT_RUNTIME_REPORT), 'utf8')) }
  console.log(await verifyExpenseCaptures(resolve(process.argv[2] || 'expense-routing-results'), expected))
}
