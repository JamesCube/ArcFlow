import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { processIdentity } from '../scripts/start-backend.mjs'

export async function graphFileSHA256() {
  assert.ok(process.env.ARCFLOW_TEST_DATA_FILE, 'The browser restart must use the launched backend store.')
  return createHash('sha256').update(await readFile(`${process.env.ARCFLOW_TEST_DATA_FILE}.graph.json`)).digest('hex')
}

export function restartRequestState(value) {
  // Retain the complete instance, including its submission/applicant identity
  // and timestamps, rather than silently dropping newly added durable fields.
  return structuredClone(value)
}

export async function readPersistedRequest(expected) {
  assert.ok(process.env.ARCFLOW_TEST_DATA_FILE, 'The browser restart must use the launched backend store.')
  assert.ok(expected && typeof expected.id === 'string' && expected.id, 'A specific HTTP request snapshot is required.')
  const bytes = await readFile(`${process.env.ARCFLOW_TEST_DATA_FILE}.graph.json`)
  const snapshot = JSON.parse(bytes.toString('utf8'))
  assert.equal(snapshot.storageSchemaVersion, 14, 'Unexpected graph storage schema.')
  assert.ok(Array.isArray(snapshot.requests), 'The durable graph requests are missing.')
  const matches = snapshot.requests.filter(value => value.id === expected.id)
  assert.equal(matches.length, 1, 'The target durable request must occur exactly once.')
  assert.deepEqual(matches[0], expected, 'The target on-disk graph request differs from its HTTP snapshot.')
  return { observedAt: new Date().toISOString(), graphFileSHA256: createHash('sha256').update(bytes).digest('hex'), storageSchemaVersion: snapshot.storageSchemaVersion, request: matches[0] }
}

// Only filesystem IPC in a disposable 0700 directory. No product endpoint or
// password is added to the request, acknowledgement or evidence artifact.
export async function restartBackend(expected, provenance) {
  const startedAt = new Date().toISOString()
  assert.ok(provenance?.captureSessionId && provenance?.captureRunId, 'Restart evidence must belong to this browser capture run.')
  const capture = Object.fromEntries(['captureSessionId', 'captureRunId', 'captureRunAttempt', 'captureRepository', 'captureRunUrl'].map(key => [key, provenance[key]]))
  const directory = process.env.ARCFLOW_TEST_RESTART_DIRECTORY
  assert.ok(directory, 'Real browser restart control is required for this journey.')
  const status = JSON.parse(await readFile(join(directory, 'status.json'), 'utf8'))
  const before = await processIdentity(status.process.pid, status.process.spawnedAt)
  assert.equal(before.linuxStartTicks, status.process.linuxStartTicks)
  const persistedBefore = await readPersistedRequest(expected), graphBefore = persistedBefore.graphFileSHA256, nonce = randomUUID()
  const temporary = join(directory, `request-${nonce}.tmp`)
  await writeFile(temporary, JSON.stringify({ schemaVersion: 1, command: 'restart', nonce }), { flag: 'wx', mode: 0o600 })
  await rename(temporary, join(directory, 'request.json'))
  const deadline = Date.now() + 90_000
  let response
  while (Date.now() < deadline) {
    try { response = JSON.parse(await readFile(join(directory, `response-${nonce}.json`), 'utf8')); break } catch (error) { if (error.code !== 'ENOENT') throw error }
    await delay(50)
  }
  assert.ok(response, 'Backend child-JVM restart acknowledgement timed out.')
  assert.equal(response.schemaVersion, 1)
  assert.equal(response.nonce, nonce)
  assert.equal(response.result, 'restarted', 'Backend child-JVM restart failed.')
  assert.deepEqual(response.processBefore, status.process)
  assert.notEqual(response.processBefore.pid, response.processAfter.pid)
  assert.notEqual(response.processBefore.spawnedAt, response.processAfter.spawnedAt)
  assert.ok(Date.parse(response.oldProcessExit.observedAt) <= Date.parse(response.processAfter.spawnedAt))
  assert.equal(response.exitedBeforeReplacement, true)
  const after = await processIdentity(response.processAfter.pid, response.processAfter.spawnedAt)
  assert.equal(after.linuxStartTicks, response.processAfter.linuxStartTicks)
  if (process.platform === 'linux') {
    assert.ok(BigInt(after.linuxStartTicks) > BigInt(before.linuxStartTicks))
    await assert.rejects(readFile(`/proc/${before.pid}/stat`), { code: 'ENOENT' })
  }
  assert.equal(response.backendJarSHA256, status.backendJarSHA256)
  assert.equal(response.graphFileSHA256Before, graphBefore)
  assert.equal(response.graphFileSHA256AfterReady, graphBefore)
  const persistedAfterReady = await readPersistedRequest(expected)
  assert.equal(persistedAfterReady.graphFileSHA256, graphBefore)
  return { ...response, ...capture, startedAt, completedAt: new Date().toISOString(), persistedBefore, persistedAfterReady, platform: process.platform, independentlyObservedProcessBefore: before, independentlyObservedProcessAfter: after, oldProcessAbsentAfterReady: process.platform === 'linux' ? true : null }
}
