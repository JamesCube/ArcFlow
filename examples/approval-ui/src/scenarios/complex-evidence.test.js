// Header-only byte fixtures exercise the verifier. They are not screenshots,
// never become capture output, and are removed after each test.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
const folders = [], states = { 'form-filled': 1440, 'form-summary': 390, 'validation-errors': 1440, 'designer-published': 1440, 'saved-original-snapshot': 1440, 'review-controls': 390, 'all-partial': 1440, 'any-partial-rejection': 1440, approved: 1440, rejected: 1440 }
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))) })
async function fixture(mutate = () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'complex-evidence-unit-')); folders.push(root)
  const dir = join(root, 'capture-complex-TEST-FIXTURES'); await mkdir(dir)
  const fixtures = []
  for (const scenario of ['erp-payment', 'crm-contract']) for (const [state, width] of Object.entries(states)) for (const locale of ['en', 'zh']) {
    const bytes = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(width === 390 ? 844 : 1000, 20)
    const name = `${scenario}-${state}-${locale}`, evidence = { schemaVersion: 1, sourceRevision: '1'.repeat(40), sourceWorkingTree: 'clean-commit', trackedDiffSHA256: '2'.repeat(64), uiSourceTreeSHA256: '3'.repeat(64), backendJarSHA256: '4'.repeat(64), backendRuntime: 'declared-Boot-4.1.1', captureSessionId: 'fixture-session', captureRunId: '123', captureRunAttempt: '1', captureRepository: 'example/test', scenario, state, locale, viewport: { width, height: width === 390 ? 844 : 1000 }, fullPage: width !== 390, image: `${name}.png`, imageSHA256: createHash('sha256').update(bytes).digest('hex'), capturedAt: '2026-10-09T00:00:00Z' }
    fixtures.push({ name, evidence, bytes })
  }
  mutate(fixtures)
  for (const { name, evidence, bytes } of fixtures) { await writeFile(join(dir, `${name}.json`), JSON.stringify(evidence)); await writeFile(join(dir, `${name}.png`), bytes) }
  return root
}
function verify(root, env = {}) { return spawnSync(process.execPath, [resolve('scripts/verify-complex-captures.mjs'), root], { encoding: 'utf8', env: { ...process.env, ARCFLOW_EXPECT_SOURCE_REVISION: '1'.repeat(40), ARCFLOW_EXPECT_BACKEND_RUNTIME: 'declared-Boot-4.1.1', ARCFLOW_EXPECT_CAPTURE_RUN_ID: '123', ARCFLOW_EXPECT_CAPTURE_RUN_ATTEMPT: '1', ARCFLOW_EXPECT_CAPTURE_REPOSITORY: 'example/test', ARCFLOW_REQUIRE_CLEAN_COMPLEX: '1', ...env } }) }
describe('complex capture provenance and complete matrix gate', () => {
  it('accepts the exact matrix with matching clean source/run/runtime', async () => { const result = verify(await fixture()); expect(result.status).toBe(0); expect(result.stdout).toContain('Verified 40') })
  it.each([
    ['missing image', data => data.pop()],
    ['duplicate state in different session', data => { data[1].evidence.state = data[0].evidence.state; data[1].evidence.locale = data[0].evidence.locale; data[1].evidence.captureSessionId = 'other' }],
    ['mixed backend bytes', data => { data[1].evidence.backendJarSHA256 = '5'.repeat(64) }],
    ['mixed source files', data => { data[1].evidence.uiSourceTreeSHA256 = '5'.repeat(64) }],
    ['wrong revision', data => { data[0].evidence.sourceRevision = '5'.repeat(40) }],
    ['dirty source', data => { data[0].evidence.sourceWorkingTree = 'modified-local-worktree' }],
    ['supplementary runtime', data => { data[0].evidence.backendRuntime = 'supplementary-Boot-3' }],
    ['previous run attempt', data => { data[0].evidence.captureRunAttempt = '2' }],
    ['different repository', data => { data[0].evidence.captureRepository = 'elsewhere/repo' }],
    ['forged dimensions', data => { data[0].bytes.writeUInt32BE(390, 16) }],
    ['changed image hash', data => { data[0].evidence.imageSHA256 = '0'.repeat(64) }],
    ['path escape', data => { data[0].evidence.image = '../outside.png' }],
    ['incorrect capture mode', data => { data[0].evidence.fullPage = false }],
  ])('rejects %s', async (_name, mutate) => { expect(verify(await fixture(mutate)).status).not.toBe(0) })
})
