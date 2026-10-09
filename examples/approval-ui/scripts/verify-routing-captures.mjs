import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
const root = resolve(process.argv[2] || 'routing-visual-results')
const expected = new Set(['payment-conditions-en-desktop', 'payment-conditions-zh-390px', 'payment-low-frozen-desktop', 'payment-high-complete-desktop', 'payment-low-complete-zh-390px', 'receiving-clean-frozen-desktop', 'receiving-clean-zh-390px', 'contract-in-any-editor-desktop', 'contract-in-any-editor-zh-390px', 'contract-standard-complete-desktop', 'contract-standard-complete-zh-390px'])
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
async function files(directory) { const entries = await readdir(directory, { withFileTypes: true }); return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : entry.isFile() ? [join(directory, entry.name)] : []))).flat() }
const all = await files(root), images = all.filter(file => file.endsWith('.png')), receipts = all.filter(file => basename(file) === 'routing-receipt.json')
assert.equal(images.length, expected.size); assert.equal(receipts.length, 3)
assert.ok(process.env.ARCFLOW_EXPECT_SOURCE_REVISION, 'An expected source revision is required')
const identities = new Set(), scenarios = new Set()
function provenance(metadata) {
  assert.equal(metadata.sourceRevision, process.env.ARCFLOW_EXPECT_SOURCE_REVISION)
  assert.equal(metadata.sourceWorkingTree, 'clean-commit')
  assert.equal(metadata.backendRuntime, 'declared-Boot-4.1.1')
  for (const [key, env] of [['captureRunId', 'ARCFLOW_EXPECT_CAPTURE_RUN_ID'], ['captureRunAttempt', 'ARCFLOW_EXPECT_CAPTURE_RUN_ATTEMPT'], ['captureRepository', 'ARCFLOW_EXPECT_CAPTURE_REPOSITORY']]) { assert.ok(process.env[env]); assert.equal(metadata[key], process.env[env]) }
  for (const key of ['trackedDiffSHA256', 'uiSourceTreeSHA256', 'backendJarSHA256']) assert.match(metadata[key], /^[0-9a-f]{64}$/)
  identities.add(JSON.stringify([metadata.sourceRevision, metadata.uiSourceTreeSHA256, metadata.backendJarSHA256, metadata.captureRunId, metadata.captureRunAttempt]))
}
for (const image of images) {
  const stem = basename(image, '.png'), bytes = await readFile(image), metadata = JSON.parse(await readFile(image.replace(/\.png$/, '.json'), 'utf8'))
  assert.ok(expected.delete(stem), `Unexpected or duplicate capture ${stem}`); provenance(metadata)
  assert.equal(metadata.state, stem); assert.equal(metadata.image, basename(image)); assert.equal(metadata.imageSHA256, hash(bytes))
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]); assert.equal(bytes.subarray(12, 16).toString(), 'IHDR')
  assert.equal(metadata.fullPage, true); assert.equal(metadata.viewport.width, stem.endsWith('-390px') ? 390 : 1440)
  assert.equal(bytes.readUInt32BE(16), metadata.viewport.width); assert.ok(bytes.readUInt32BE(20) >= metadata.viewport.height)
  assert.equal(metadata.locale, stem.includes('-zh-') ? 'zh-CN' : 'en'); assert.ok(Number.isFinite(Date.parse(metadata.capturedAt)))
}
for (const receipt of receipts) {
  const metadata = JSON.parse(await readFile(receipt, 'utf8')); provenance(metadata)
  assert.equal(metadata.result, 'passed'); assert.equal(metadata.realBackend, true); assert.equal(metadata.backendSha256, metadata.backendJarSHA256)
  assert.ok(metadata.requests.length >= 2)
  const ids = new Set(metadata.requests.map(request => request.processId)); assert.equal(ids.size, 1); const scenario = [...ids][0]
  assert.ok(['erp-payment', 'erp-receiving', 'crm-contract'].includes(scenario)); assert.ok(!scenarios.has(scenario)); scenarios.add(scenario)
  assert.ok(metadata.requests.some(request => request.routing?.evaluations.some(evaluation => evaluation.result === false)))
  assert.ok(metadata.requests.some(request => request.routing?.evaluations.some(evaluation => evaluation.result === true)))
  if (scenario !== 'erp-receiving') assert.ok(metadata.requests.some(request => request.status === 'APPROVED'))
}
assert.equal(expected.size, 0); assert.equal(identities.size, 1); assert.equal(scenarios.size, 3)
console.log('Verified 11 real routing screenshots and 3 successful journeys with exact source/run/backend provenance.')
