import assert from 'node:assert/strict'
import { captureContract, captureNames, captureJourneys, expectedRoutes } from './routing-capture-contract.mjs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { crc32, inflateSync } from 'node:zlib'
const root = resolve(process.argv[2] || 'routing-visual-results')
const expected = new Set(captureNames)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const maxPngBytes = 64 * 1024 * 1024, maxInflatedBytes = 128 * 1024 * 1024
// Chromium emits non-interlaced 8-bit RGB/RGBA PNGs. Validate the complete
// encoded image, not just its header. This proves integrity, not authenticity.
function validatePng(bytes) {
  assert.ok(bytes.length <= maxPngBytes, 'PNG exceeds the encoded size limit')
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'Invalid PNG signature')
  let offset = 8, width, height, channels, seenHeader = false, seenPalette = false, ended = false, closedData = false
  const data = []
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, 'Truncated PNG chunk')
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length
    assert.ok(end <= bytes.length, 'Truncated PNG chunk data')
    const type = bytes.subarray(offset + 4, offset + 8).toString('latin1'), payload = bytes.subarray(offset + 8, end - 4)
    assert.match(type, /^[A-Za-z]{2}[A-Z][A-Za-z]$/, 'Invalid PNG chunk type')
    assert.equal(bytes.readUInt32BE(end - 4), crc32(bytes.subarray(offset + 4, end - 4)), `Invalid PNG ${type} CRC`)
    assert.ok(seenHeader || type === 'IHDR', 'PNG must start with IHDR')
    if (type === 'IHDR') {
      assert.ok(!seenHeader && offset === 8, 'Duplicate or misplaced PNG header'); assert.equal(length, 13)
      seenHeader = true; width = payload.readUInt32BE(0); height = payload.readUInt32BE(4)
      assert.ok(width > 0 && height > 0 && width <= 32768 && height <= 32768, 'PNG dimensions exceed the supported bounds')
      assert.equal(payload[8], 8, 'Only 8-bit browser captures are supported')
      assert.ok([2, 6].includes(payload[9]), 'Only RGB/RGBA browser captures are supported'); channels = payload[9] === 2 ? 3 : 4
      assert.deepEqual([...payload.subarray(10)], [0, 0, 0], 'Unsupported PNG compression, filter or interlace method')
    } else if (type === 'IDAT') {
      assert.ok(!closedData, 'PNG IDAT chunks must be consecutive'); data.push(payload)
    } else {
      if (data.length) closedData = true
      if (type === 'IEND') {
        assert.equal(length, 0); assert.ok(data.length, 'PNG has no IDAT'); assert.equal(end, bytes.length, 'Data after PNG IEND')
        ended = true
      } else if (type === 'PLTE') {
        assert.ok(!seenPalette && !data.length && length > 0 && length <= 768 && length % 3 === 0, 'Invalid PNG palette'); seenPalette = true
      } else assert.ok(type[0] === type[0].toLowerCase(), `Unsupported critical PNG chunk ${type}`)
    }
    offset = end
  }
  assert.ok(seenHeader && ended && data.length, 'Incomplete PNG image')
  const rowLength = width * channels + 1, expectedLength = rowLength * height
  assert.ok(expectedLength <= maxInflatedBytes, 'PNG exceeds the decoded size limit')
  const compressed = Buffer.concat(data), inflated = inflateSync(compressed, { maxOutputLength: expectedLength, info: true })
  assert.equal(inflated.engine.bytesWritten, compressed.length, 'Trailing data in PNG zlib stream')
  assert.equal(inflated.buffer.length, expectedLength, 'Invalid PNG scanline length')
  for (let row = 0; row < height; row++) assert.ok(inflated.buffer[row * rowLength] <= 4, 'Invalid PNG scanline filter')
  return { width, height }
}
async function files(directory) { const entries = await readdir(directory, { withFileTypes: true }); return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : entry.isFile() ? [join(directory, entry.name)] : []))).flat() }
const all = await files(root), images = all.filter(file => file.endsWith('.png')), receipts = all.filter(file => basename(file) === 'routing-receipt.json')
assert.equal(images.length, expected.size); assert.equal(receipts.length, 6)
assert.ok(process.env.ARCFLOW_EXPECT_SOURCE_REVISION, 'An expected source revision is required')
assert.ok(process.env.ARCFLOW_EXPECT_RUNTIME_REPORT, 'A verified backend archive report is required')
const runtime = JSON.parse(await readFile(resolve(process.env.ARCFLOW_EXPECT_RUNTIME_REPORT), 'utf8'))
assert.equal(runtime.schemaVersion, 1); assert.equal(runtime.sourceRevision, process.env.ARCFLOW_EXPECT_SOURCE_REVISION)
assert.equal(runtime.springBootVersion, '4.1.1'); assert.match(runtime.springFrameworkVersion, /^7\./); assert.match(runtime.springSecurityVersion, /^7\./)
assert.match(runtime.backendJarSHA256, /^[0-9a-f]{64}$/)
const identities = new Set(), scenarios = new Set(), captureMetadata = new Map()
function provenance(metadata) {
  assert.equal(metadata.sourceRevision, process.env.ARCFLOW_EXPECT_SOURCE_REVISION)
  assert.equal(metadata.sourceWorkingTree, 'clean-commit')
  assert.equal(metadata.backendRuntime, 'declared-Boot-4.1.1')
  assert.equal(metadata.backendJarSHA256, runtime.backendJarSHA256, 'Capture backend differs from the inspected archive')
  for (const [key, env] of [['captureRunId', 'ARCFLOW_EXPECT_CAPTURE_RUN_ID'], ['captureRunAttempt', 'ARCFLOW_EXPECT_CAPTURE_RUN_ATTEMPT'], ['captureRepository', 'ARCFLOW_EXPECT_CAPTURE_REPOSITORY']]) { assert.ok(process.env[env]); assert.equal(metadata[key], process.env[env]) }
  for (const key of ['trackedDiffSHA256', 'uiSourceTreeSHA256', 'backendJarSHA256']) assert.match(metadata[key], /^[0-9a-f]{64}$/)
  identities.add(JSON.stringify([metadata.sourceRevision, metadata.uiSourceTreeSHA256, metadata.backendJarSHA256, metadata.captureRunId, metadata.captureRunAttempt]))
}
for (const image of images) {
  assert.ok((await stat(image)).size <= maxPngBytes, 'PNG exceeds the encoded size limit')
  const stem = basename(image, '.png'), bytes = await readFile(image), metadata = JSON.parse(await readFile(image.replace(/\.png$/, '.json'), 'utf8'))
  assert.ok(expected.delete(stem), `Unexpected or duplicate capture ${stem}`); provenance(metadata)
  assert.equal(metadata.state, stem); assert.equal(metadata.image, basename(image)); assert.equal(metadata.imageSHA256, hash(bytes))
  const pixels = validatePng(bytes)
  assert.equal(metadata.fullPage, true); assert.deepEqual(metadata.viewport, stem.endsWith('-390px') ? { width: 390, height: 844 } : { width: 1440, height: 1000 })
  assert.equal(pixels.width, metadata.viewport.width); assert.ok(pixels.height >= metadata.viewport.height)
  captureMetadata.set(stem, metadata)
  assert.equal(metadata.locale, stem.includes('-zh-') ? 'zh-CN' : 'en'); assert.ok(Number.isFinite(Date.parse(metadata.capturedAt)))
}
for (const receipt of receipts) {
  const metadata = JSON.parse(await readFile(receipt, 'utf8')); provenance(metadata)
  assert.equal(metadata.result, 'passed'); assert.equal(metadata.realBackend, true); assert.equal(metadata.backendSha256, metadata.backendJarSHA256)
  assert.ok(metadata.requests.length >= 2)
  const ids = new Set(metadata.requests.map(request => request.processId)); assert.equal(ids.size, 1); const scenario = [...ids][0]
  assert.ok(Object.hasOwn(captureContract, scenario)); assert.ok(['en', 'zh'].includes(metadata.locale))
  const identity = `${scenario}-${metadata.locale}`
  assert.ok(!scenarios.has(identity)); scenarios.add(identity)
  assert.ok(metadata.requests.some(request => request.routing?.evaluations.some(evaluation => evaluation.result === false)))
  assert.ok(metadata.requests.some(request => request.routing?.evaluations.some(evaluation => evaluation.result === true)))
  assert.ok(metadata.requests.some(request => request.status === 'APPROVED'))
  if (scenario === 'erp-receiving') assert.ok(metadata.requests.some(request => request.status === 'REJECTED'))
  assert.equal(new Set(metadata.requests.map(request => request.id)).size, metadata.requests.length, 'Duplicate saved request')
  const checkpoints = new Map(metadata.checkpoints.map(checkpoint => [checkpoint.state, checkpoint]))
  assert.equal(checkpoints.size, metadata.checkpoints.length, 'Duplicate checkpoint')
  assert.equal(checkpoints.size, Object.values(captureContract[scenario]).filter(Boolean).length, 'Missing business checkpoint')
  for (const journey of captureJourneys[scenario]) {
    const ids = journey.map(state => checkpoints.get(state)?.requestId)
    assert.ok(ids.every(id => id && id === ids[0]), `One request must continue through ${journey.join(', ')}`)
    const final = metadata.requests.find(request => request.id === ids[0]), route = expectedRoutes[journey[0]]
    assert.ok(final, 'Journey has no saved request')
    assert.deepEqual(final.routing.stepIds, route.stepIds, `Wrong saved route for ${journey[0]}`)
    assert.equal(final.routing.evaluations.length, 1)
    assert.equal(final.routing.evaluations[0].stepId, route.conditionStepId)
    assert.equal(final.routing.evaluations[0].result, route.result)
    assert.equal(final.routing.evaluations[0].predicates.length, 1)
    assert.equal(final.routing.evaluations[0].predicates[0].actualValue, route.actualValue)
    assert.equal(final.routing.evaluations[0].predicates[0].result, route.result)
  }
  for (const [state, requirement] of Object.entries(captureContract[scenario])) {
    const checkpoint = checkpoints.get(state)
    if (requirement) {
      assert.ok(checkpoint, `Missing checkpoint ${state}`)
      assert.equal(checkpoint.status, requirement.status); assert.equal(checkpoint.currentStepId, requirement.currentStepId)
      const votes = checkpoint.history.filter(event => event.action !== 'SUBMIT')
      assert.deepEqual(votes.map(event => [event.actorId, event.stepId, event.action]), requirement.expectedVotes, `Wrong actual votes at ${state}`)
      assert.ok(votes.every(event => typeof event.comment === 'string' && event.comment.trim()), `Missing business comment at ${state}`)
      const final = metadata.requests.find(request => request.id === checkpoint.requestId)
      assert.ok(final, `Checkpoint has no saved request: ${state}`)
      if (requirement.status !== 'PENDING') {
        assert.equal(final.status, requirement.status, `Saved terminal status differs at ${state}`)
        assert.equal(final.currentStepId, requirement.currentStepId, `Saved terminal step differs at ${state}`)
        assert.deepEqual(final.history, checkpoint.history, `Terminal checkpoint has extra or missing votes: ${state}`)
      }
      assert.deepEqual(final.history.slice(0, checkpoint.history.length), checkpoint.history, `Checkpoint does not match saved history: ${state}`)
      assert.ok(votes.every(event => final.routing.stepIds.includes(event.stepId)), 'A skipped stage cannot have votes')
    }
    for (const viewport of ['desktop', '390px']) {
      const image = captureMetadata.get(`${state}-${metadata.locale}-${viewport}`)
      assert.ok(image, `Missing paired capture ${state}`)
      assert.equal(image.requestId, checkpoint?.requestId ?? null)
      assert.equal(image.requestStatus, checkpoint?.status ?? null)
      assert.equal(image.currentStepId, checkpoint?.currentStepId ?? null)
      assert.equal(image.decisionCount, requirement?.expectedVotes.length ?? null)
    }
  }
}
assert.equal(expected.size, 0); assert.equal(identities.size, 1); assert.equal(scenarios.size, 6)
console.log('Verified 80 complete routing PNGs and 6 successful browser-journey receipts with exact source/run/inspected-backend provenance. Image integrity is not independent pixel acceptance or authenticity certification.')
