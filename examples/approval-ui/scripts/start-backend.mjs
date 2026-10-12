import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const validNonce = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

export async function processIdentity(pid, spawnedAt) {
  // Field 22 is relative to boot. A different PID alone could be recycled.
  const stat = process.platform === 'linux' ? await readFile(`/proc/${pid}/stat`, 'utf8') : null
  const linuxStartTicks = stat === null ? null : stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19]
  if (stat !== null && !/^\d+$/.test(linuxStartTicks)) throw new Error('Unable to identify backend process start time.')
  return { pid, spawnedAt, observedAt: new Date().toISOString(), linuxStartTicks, startTimeSource: stat === null ? 'supervisor-spawn-time' : 'linux-proc-stat' }
}

async function waitForUnauthorizedReadiness(signal) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline && !signal.aborted) {
    try {
      const response = await fetch('http://127.0.0.1:8080/api/me', { signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]) })
      await response.body?.cancel()
      if (response.status === 401) return
    } catch {}
    await delay(100)
  }
  throw new Error('Replacement backend did not become ready with authentication required.')
}

// Test-only local control: absent this explicit directory, only the original
// child launch and signal forwarding exist. There is no HTTP restart endpoint.
export async function startBackendHarness({ env = process.env, spawnProcess = spawn, ready = waitForUnauthorizedReadiness, shutdownTimeoutMs = 10_000, pollIntervalMs = 75, onUnexpectedExit = () => {} } = {}) {
  const jar = resolve(env.ARCFLOW_TEST_BACKEND_JAR || env.ARCFLOW_BACKEND_JAR || '../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar')
  const directory = env.ARCFLOW_TEST_RESTART_DIRECTORY
  const graphFile = env.APPROVAL_DATA_FILE && `${env.APPROVAL_DATA_FILE}.graph.json`
  let backendJarSHA256
  if (directory) {
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || !graphFile) throw new Error('Restart control requires a private directory and an explicit data file.')
    backendJarSHA256 = digest(await readFile(jar))
  }
  let current, closing = false, busy = false, timer, stopPromise
  const seen = new Set(), shutdown = new AbortController()
  async function writeJSON(name, value) {
    const target = join(directory, name), temporary = `${target}.tmp`
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
    await rename(temporary, target)
  }
  async function launch() {
    const spawnedAt = new Date().toISOString()
    const child = spawnProcess(env.JAVA || 'java', ['-jar', jar], { stdio: 'inherit', env })
    const entry = { child, expectedExit: false }
    current = entry
    entry.exited = new Promise(resolveExit => {
      const finish = (code, signal) => {
        if (entry.exit) return
        entry.exit = { code, signal, observedAt: new Date().toISOString() }
        resolveExit(entry.exit)
        if (!entry.expectedExit && !closing) { void stop(); onUnexpectedExit(code || 1) }
      }
      child.once('exit', finish)
      child.once('error', () => { if (!child.pid) finish(1, null) })
    })
    await new Promise((resolveSpawn, rejectSpawn) => { child.once('spawn', resolveSpawn); child.once('error', rejectSpawn) })
    entry.identity = await processIdentity(child.pid, spawnedAt)
    if (entry.exit || closing) throw new Error('Backend child exited during launch.')
    if (directory) await writeJSON('status.json', { schemaVersion: 1, process: entry.identity, backendJarSHA256 })
    if (entry.exit || closing) throw new Error('Backend child exited during launch.')
    return entry
  }
  async function terminate(entry, signal = 'SIGTERM') {
    if (entry.exit) return entry.exit
    entry.expectedExit = true
    entry.child.kill(signal)
    const kill = setTimeout(() => entry.child.kill('SIGKILL'), shutdownTimeoutMs)
    try { return await entry.exited } finally { clearTimeout(kill) }
  }
  async function poll() {
    if (!directory || busy || closing) return
    busy = true
    let nonce
    try {
      const path = join(directory, 'request.json')
      let command
      try {
        const stat = await lstat(path)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512) { await unlink(path); return }
        command = JSON.parse(await readFile(path, 'utf8'))
        await unlink(path)
      } catch (error) {
        if (error.code === 'ENOENT') return
        if (error instanceof SyntaxError) { await unlink(path).catch(() => {}); return }
        throw error
      }
      if (!command || typeof command !== 'object' || Array.isArray(command) || command.schemaVersion !== 1 || command.command !== 'restart' || !validNonce(command.nonce) || Object.keys(command).length !== 3 || seen.has(command.nonce) || seen.size >= 8) return
      nonce = command.nonce
      seen.add(nonce)
      const before = current, graphFileSHA256Before = digest(await readFile(graphFile))
      const oldProcessExit = await terminate(before)
      if (closing) return
      // Make even coarse process-start clocks distinguish this fresh child.
      await delay(25)
      if (closing) return
      const after = await launch()
      if (closing) { await terminate(after); return }
      await ready(shutdown.signal)
      if (closing) return
      const graphFileSHA256AfterReady = digest(await readFile(graphFile))
      const jarAfter = digest(await readFile(jar))
      if (before.identity.pid === after.identity.pid || before.identity.spawnedAt === after.identity.spawnedAt || (process.platform === 'linux' && before.identity.linuxStartTicks === after.identity.linuxStartTicks) || jarAfter !== backendJarSHA256 || graphFileSHA256Before !== graphFileSHA256AfterReady) throw new Error('Restart process, artifact or durability witness did not match.')
      await writeJSON(`response-${nonce}.json`, { schemaVersion: 1, nonce, result: 'restarted', processBefore: before.identity, oldProcessExit, processAfter: after.identity, exitedBeforeReplacement: true, backendJarSHA256, graphFileSHA256Before, graphFileSHA256AfterReady, readyAt: new Date().toISOString() })
    } catch {
      if (!closing) {
        try {
          if (!nonce) throw new Error('Invalid restart control I/O.')
          await writeJSON(`response-${nonce}.json`, { schemaVersion: 1, nonce, result: 'failed' })
        } catch {
          // Do not await stop() inside poll: it waits for this busy operation.
          // The shutdown promise owns and reaps the child after finally runs.
          void stop()
          onUnexpectedExit(1)
        }
      }
    } finally { busy = false }
  }
  async function stop(signal = 'SIGTERM') {
    if (stopPromise) return stopPromise
    closing = true
    shutdown.abort()
    clearInterval(timer)
    stopPromise = (async () => {
      if (current) await terminate(current, signal)
      while (busy) await delay(10)
      if (current && !current.exit) await terminate(current, signal)
    })()
    return stopPromise
  }
  try { const initial = await launch(); if (initial.exit || closing) throw new Error('Backend child exited during initialization.') } catch (error) { await stop(); throw error }
  if (directory) timer = setInterval(() => { void poll() }, pollIntervalMs)
  return { stop, poll }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let harness, requestedSignal
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { requestedSignal = signal; if (harness) void harness.stop(signal) })
  try {
    harness = await startBackendHarness({ onUnexpectedExit: code => { process.exitCode = code; void harness?.stop() } })
    if (requestedSignal) await harness.stop(requestedSignal)
  } catch {
    console.error('Approval backend could not start. Check the Java executable, local backend jar and test harness configuration.')
    process.exitCode = 1
  }
}
