import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { processIdentity } from '../scripts/start-backend.mjs'

const suffixes = Object.freeze({travel: '.travel.graph.json', receiving: '.receiving.graph.json', quote: '.quote.graph.json'})
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export async function persistedBusinessGraph(scenario, expected) {
  assert.ok(Object.hasOwn(suffixes, scenario), 'A fixed graph scenario is required')
  assert.ok(process.env.ARCFLOW_TEST_DATA_FILE, 'The exact launched backend store is required')
  const bytes = await readFile(process.env.ARCFLOW_TEST_DATA_FILE + suffixes[scenario])
  const snapshot = JSON.parse(bytes.toString('utf8'))
  assert.equal(snapshot.storageSchemaVersion, 14)
  assert.equal(snapshot.definition.id, `${scenario}-graph`)
  const matches = snapshot.requests.filter(request => request.id === expected.id)
  assert.equal(matches.length, 1)
  assert.deepEqual(matches[0], expected, 'HTTP and durable business graph snapshots differ')
  return {scenario, observedAt: new Date().toISOString(), fileSHA256: hash(bytes), request: matches[0]}
}

// Use the existing private test-only child-JVM control. The normal payment
// store is independently witnessed by the launcher; this helper additionally
// proves that the selected business store survives the same complete restart.
export async function restartBusinessGraph(scenario, expected, provenance) {
  const directory = process.env.ARCFLOW_TEST_RESTART_DIRECTORY
  assert.ok(directory && provenance?.captureSessionId)
  const persistedBefore = await persistedBusinessGraph(scenario, expected)
  const paymentHash = hash(await readFile(`${process.env.ARCFLOW_TEST_DATA_FILE}.graph.json`))
  const status = JSON.parse(await readFile(join(directory, 'status.json'), 'utf8'))
  const before = await processIdentity(status.process.pid, status.process.spawnedAt)
  assert.deepEqual(before, status.process)
  const nonce = randomUUID(), temporary = join(directory, `business-${nonce}.tmp`)
  await writeFile(temporary, JSON.stringify({schemaVersion: 1, command: 'restart', nonce}), {flag: 'wx', mode: 0o600})
  await rename(temporary, join(directory, 'request.json'))
  const deadline = Date.now() + 90000
  let response
  while (Date.now() < deadline) {
    try { response = JSON.parse(await readFile(join(directory, `response-${nonce}.json`), 'utf8')); break }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    await delay(50)
  }
  assert.ok(response, 'Business graph JVM restart acknowledgement timed out')
  assert.equal(response.result, 'restarted')
  assert.equal(response.nonce, nonce)
  assert.deepEqual(response.processBefore, before)
  assert.notEqual(response.processBefore.pid, response.processAfter.pid)
  assert.notEqual(response.processBefore.spawnedAt, response.processAfter.spawnedAt)
  assert.equal(response.exitedBeforeReplacement, true)
  assert.ok(Date.parse(response.oldProcessExit.observedAt) <= Date.parse(response.processAfter.spawnedAt))
  const after = await processIdentity(response.processAfter.pid, response.processAfter.spawnedAt)
  assert.deepEqual(after, response.processAfter)
  if (process.platform === 'linux') {
    assert.ok(BigInt(after.linuxStartTicks) > BigInt(before.linuxStartTicks))
    await assert.rejects(readFile(`/proc/${before.pid}/stat`), {code: 'ENOENT'})
  }
  assert.equal(response.backendJarSHA256, provenance.backendJarSHA256)
  assert.equal(response.graphFileSHA256Before, paymentHash)
  assert.equal(response.graphFileSHA256AfterReady, paymentHash)
  const persistedAfterReady = await persistedBusinessGraph(scenario, expected)
  assert.equal(persistedAfterReady.fileSHA256, persistedBefore.fileSHA256)
  return {schemaVersion: 1, scenario, ...provenance, processBefore: before, processAfter: after,
    oldProcessExit: response.oldProcessExit, exitedBeforeReplacement: true,
    oldProcessAbsentAfterReady: process.platform === 'linux', persistedBefore, persistedAfterReady}
}
