// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startBackendHarness } from '../../scripts/start-backend.mjs'
import { restartBackend, readPersistedRequest, restartRequestState } from '../../e2e/backend-restart.mjs'

const fixtures = []
afterEach(async () => { vi.unstubAllEnvs(); for (const f of fixtures.splice(0)) { await f.harness?.stop(); await rm(f.root, { recursive: true, force: true }) } })
async function fixture({ control = true, ready = async () => {}, pollIntervalMs = 60_000 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'arcflow-restart-unit-')), directory = join(root, 'control'), data = join(root, 'requests.json'), jar = join(root, 'backend.jar')
  const instance = { id: 'synthetic-request', submissionKey: 'synthetic-key', applicantId: 'alice', status: 'PENDING', createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:01Z', commandRevision: 1, definition: { version: 2 }, business: { synthetic: true }, tasks: [], forks: [], routes: [], commands: [], events: [] }
  const graph = { storageSchemaVersion: 14, requests: [instance] }, bytes = JSON.stringify(graph)
  await mkdir(directory, { mode: 0o700 }); await writeFile(jar, 'immutable jar bytes'); await writeFile(`${data}.graph.json`, bytes)
  const f = { root, directory, data, jar, instance, graph, bytes, launches: [] }; fixtures.push(f)
  f.env = { ...process.env, ARCFLOW_TEST_BACKEND_JAR: jar, APPROVAL_DATA_FILE: data, APPROVAL_BOB_PASSWORD: 'unit-secret-never-record', ...(control ? { ARCFLOW_TEST_RESTART_DIRECTORY: directory } : {}) }
  if (!control) delete f.env.ARCFLOW_TEST_RESTART_DIRECTORY
  f.open = () => startBackendHarness({ env: f.env, ready, pollIntervalMs, shutdownTimeoutMs: 500, spawnProcess: (executable, args, options) => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { ...options, stdio: 'ignore' })
    f.launches.push({ executable, args, env: options.env, child }); return child
  } })
  f.harness = await f.open()
  f.command = async value => { await writeFile(join(directory, 'request.json'), typeof value === 'string' ? value : JSON.stringify(value)); await f.harness.poll() }
  f.restart = async (nonce = randomUUID()) => { await f.command({ schemaVersion: 1, command: 'restart', nonce }); return JSON.parse(await readFile(join(directory, `response-${nonce}.json`), 'utf8')) }
  return f
}

describe('test-only child process restart control', () => {
  it('reaps the old child before a distinct process and preserves the same jar, environment and store bytes', async () => {
    const f = await fixture(), response = await f.restart()
    expect(response.result).toBe('restarted'); expect(f.launches).toHaveLength(2)
    expect(response.processBefore.pid).not.toBe(response.processAfter.pid)
    expect(response.processBefore.spawnedAt).not.toBe(response.processAfter.spawnedAt)
    expect(Date.parse(response.oldProcessExit.observedAt)).toBeLessThanOrEqual(Date.parse(response.processAfter.spawnedAt))
    expect(response.exitedBeforeReplacement).toBe(true)
    if (process.platform === 'linux') {
      expect(BigInt(response.processAfter.linuxStartTicks)).toBeGreaterThan(BigInt(response.processBefore.linuxStartTicks))
      await expect(readFile(`/proc/${response.processBefore.pid}/stat`)).rejects.toMatchObject({ code: 'ENOENT' })
    }
    expect(response.graphFileSHA256Before).toBe(createHash('sha256').update(f.bytes).digest('hex'))
    expect(response.graphFileSHA256AfterReady).toBe(response.graphFileSHA256Before)
    expect(f.launches.map(value => value.args)).toEqual([['-jar', f.jar], ['-jar', f.jar]])
    expect(f.launches[1].env).toBe(f.launches[0].env)
    expect(JSON.stringify(response)).not.toContain('unit-secret-never-record')
    const saved = await readFile(join(f.directory, `response-${response.nonce}.json`), 'utf8')
    await f.command({ schemaVersion: 1, command: 'restart', nonce: response.nonce })
    expect(f.launches).toHaveLength(2)
    expect(await readFile(join(f.directory, `response-${response.nonce}.json`), 'utf8')).toBe(saved)
  })

  it('completes the browser helper nonce handshake with independently observed operating-system process identities', async () => {
    const f = await fixture({ pollIntervalMs: 5 })
    vi.stubEnv('ARCFLOW_TEST_RESTART_DIRECTORY', f.directory); vi.stubEnv('ARCFLOW_TEST_DATA_FILE', f.data)
    const provenance = { captureSessionId: randomUUID(), captureRunId: 'unit-run', captureRunAttempt: null, captureRepository: null, captureRunUrl: null }
    const witness = await restartBackend(f.instance, provenance)
    expect(witness.result).toBe('restarted')
    expect(witness.captureSessionId).toBe(provenance.captureSessionId); expect(witness.captureRunId).toBe(provenance.captureRunId)
    expect(witness.persistedBefore.request).toEqual(f.instance); expect(witness.persistedAfterReady.request).toEqual(f.instance)
    expect(witness.persistedBefore.graphFileSHA256).toBe(witness.graphFileSHA256Before)
    expect(witness.persistedAfterReady.graphFileSHA256).toBe(witness.graphFileSHA256AfterReady)
    expect(Date.parse(witness.startedAt)).toBeLessThanOrEqual(Date.parse(witness.readyAt)); expect(Date.parse(witness.readyAt)).toBeLessThanOrEqual(Date.parse(witness.completedAt))
    expect(witness.independentlyObservedProcessBefore.pid).toBe(witness.processBefore.pid)
    expect(witness.independentlyObservedProcessAfter.pid).toBe(witness.processAfter.pid)
    expect(witness.graphFileSHA256Before).toBe(witness.graphFileSHA256AfterReady)
    if (process.platform === 'linux') expect(witness.oldProcessAbsentAfterReady).toBe(true)
  })

  it('preserves complete request identity and timestamps in detached evidence snapshots', async () => {
    const f = await fixture(), copy = restartRequestState(f.instance)
    expect(copy).toEqual(f.instance); expect(copy).not.toBe(f.instance)
    copy.business.synthetic = false; expect(f.instance.business.synthetic).toBe(true)
  })

  it.each(['applicantId', 'submissionKey', 'createdAt', 'updatedAt'])('rejects on-disk changes to the complete %s identity field', async field => {
    const f = await fixture(); vi.stubEnv('ARCFLOW_TEST_DATA_FILE', f.data)
    await expect(readPersistedRequest({ ...f.instance, [field]: 'different' })).rejects.toThrow('differs from its HTTP snapshot')
  })

  it('does not confuse unrelated file writes with a durable decision on the target request', async () => {
    const f = await fixture(); vi.stubEnv('ARCFLOW_TEST_DATA_FILE', f.data)
    await writeFile(`${f.data}.graph.json`, JSON.stringify({ ...f.graph, unrelated: 'changed bytes' }))
    await expect(readPersistedRequest({ ...f.instance, commandRevision: 2 })).rejects.toThrow('differs from its HTTP snapshot')
    for (const requests of [[], [f.instance, f.instance]]) {
      await writeFile(`${f.data}.graph.json`, JSON.stringify({ ...f.graph, requests }))
      await expect(readPersistedRequest(f.instance)).rejects.toThrow('must occur exactly once')
    }
  })

  it.runIf(process.platform === 'linux')('the CLI exits promptly when its initial child exits before initialization finishes', async () => {
    const f = await fixture(); await f.harness.stop()
    const script = fileURLToPath(new URL('../../scripts/start-backend.mjs', import.meta.url))
    for (let index = 0; index < 6; index++) {
      const child = spawn(process.execPath, [script], { env: { ...f.env, JAVA: '/bin/true' }, stdio: 'ignore' })
      let stalled = false
      const result = await new Promise((resolveExit, rejectExit) => {
        const timer = setTimeout(() => { stalled = true; child.kill('SIGKILL') }, 3000)
        child.once('exit', (code, signal) => { clearTimeout(timer); resolveExit({ code, signal }) })
        child.once('error', error => { clearTimeout(timer); rejectExit(error) })
      })
      expect(stalled).toBe(false); expect(result.code).toBe(1); expect(result.signal).toBeNull()
    }
  })

  it('ignores malformed, unexpected and path-like commands without launching or injecting arguments', async () => {
    const f = await fixture()
    for (const command of [null, [], '{', 'x'.repeat(513), { schemaVersion: 1, command: 'restart', nonce: '../outside' }, { schemaVersion: 1, command: 'restart', nonce: randomUUID(), jar: '/other.jar' }, { schemaVersion: 1, command: 'shell', nonce: randomUUID() }]) await f.command(command)
    expect(f.launches).toHaveLength(1)
  })

  it('keeps restart control absent by default and forwards teardown to the only child', async () => {
    const f = await fixture({ control: false })
    await expect(readFile(join(f.directory, 'status.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await f.harness.stop('SIGINT')
    expect(f.launches).toHaveLength(1); expect(f.launches[0].child.signalCode).toBe('SIGINT')
  })

  it('fails promptly if the Java executable cannot be spawned, without waiting for an impossible exit event', async () => {
    const f = await fixture(); await f.harness.stop()
    await expect(startBackendHarness({ env: { ...f.env, JAVA: join(f.root, 'missing-java') } })).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a control directory readable by other users before spawning', async () => {
    const f = await fixture(); await f.harness.stop(); await chmod(f.directory, 0o755)
    await expect(f.open()).rejects.toThrow('private directory')
    expect(f.launches).toHaveLength(1)
  })

  it('does not acknowledge success if startup changes durable graph bytes', async () => {
    let f
    f = await fixture({ ready: async () => { await writeFile(`${f.data}.graph.json`, '{"unexpected":"rewrite"}') } })
    const response = await f.restart()
    expect(response).toEqual({ schemaVersion: 1, nonce: response.nonce, result: 'failed' })
    expect(f.launches).toHaveLength(2)
  })

  it('reaps the replacement when both the acknowledgement and failure acknowledgement cannot be written', async () => {
    let f
    f = await fixture({ ready: async () => { await rename(f.directory, `${f.directory}-removed`) } })
    await expect(f.command({ schemaVersion: 1, command: 'restart', nonce: randomUUID() })).resolves.toBeUndefined()
    expect(f.launches).toHaveLength(2)
    const replacement = f.launches[1].child
    if (replacement.exitCode === null && replacement.signalCode === null) await new Promise((resolveExit, rejectExit) => {
      const timer = setTimeout(() => rejectExit(new Error('Acknowledgement failure left its child alive.')), 2000)
      replacement.once('exit', () => { clearTimeout(timer); resolveExit() })
    })
    expect(f.launches.every(value => value.child.exitCode !== null || value.child.signalCode !== null)).toBe(true)
    if (process.platform === 'linux') await expect(readFile(`/proc/${f.launches[1].child.pid}/stat`)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('cancels replacement readiness and reaps the replacement on teardown', async () => {
    let enteredReady
    const entered = new Promise(resolve => { enteredReady = resolve })
    const f = await fixture({ ready: signal => new Promise((resolve, reject) => { enteredReady(); signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }) }) })
    const pending = f.command({ schemaVersion: 1, command: 'restart', nonce: randomUUID() })
    await entered; await f.harness.stop('SIGTERM'); await pending
    expect(f.launches).toHaveLength(2); expect(f.launches.every(value => value.child.exitCode !== null || value.child.signalCode !== null)).toBe(true)
  })
})
