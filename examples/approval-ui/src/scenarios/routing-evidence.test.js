// Temporary header-only byte fixtures test the provenance gate; they are not
// screenshots, never enter capture output, and are removed after each test.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
const folders = [], states = ['payment-conditions-en-desktop', 'payment-conditions-zh-390px', 'payment-low-frozen-desktop', 'payment-high-complete-desktop', 'payment-low-complete-zh-390px', 'receiving-clean-frozen-desktop', 'receiving-clean-zh-390px', 'contract-in-any-editor-desktop', 'contract-in-any-editor-zh-390px', 'contract-standard-complete-desktop', 'contract-standard-complete-zh-390px']
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))) })
const common = { sourceRevision: '1'.repeat(40), sourceWorkingTree: 'clean-commit', trackedDiffSHA256: '2'.repeat(64), uiSourceTreeSHA256: '3'.repeat(64), backendJarSHA256: '4'.repeat(64), backendRuntime: 'declared-Boot-4.1.1', captureRunId: '123', captureRunAttempt: '1', captureRepository: 'fixture/repo' }
async function fixture(mutate = () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'routing-gate-unit-')); folders.push(root)
  const images = states.map(state => {
    const width = state.endsWith('-390px') ? 390 : 1440, height = width === 390 ? 844 : 1000
    const bytes = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes); bytes.write('IHDR', 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20)
    return { state, bytes, metadata: { ...common, state, image: `${state}.png`, imageSHA256: createHash('sha256').update(bytes).digest('hex'), viewport: { width, height }, fullPage: true, locale: state.includes('-zh-') ? 'zh-CN' : 'en', capturedAt: '2026-10-09T00:00:00Z' } }
  })
  const receipts = ['erp-payment', 'erp-receiving', 'crm-contract'].map(processId => ({ ...common, result: 'passed', realBackend: true, backendSha256: common.backendJarSHA256, requests: [false, true].map(result => ({ processId, status: 'APPROVED', routing: { evaluations: [{ result }] } })) }))
  mutate(images, receipts)
  for (const image of images) { await writeFile(join(root, `${image.state}.png`), image.bytes); await writeFile(join(root, `${image.state}.json`), JSON.stringify(image.metadata)) }
  for (const [index, receipt] of receipts.entries()) { const directory = join(root, `journey-${index}`); await mkdir(directory); await writeFile(join(directory, 'routing-receipt.json'), JSON.stringify(receipt)) }
  return root
}
const verify = root => spawnSync(process.execPath, [resolve('scripts/verify-routing-captures.mjs'), root], { encoding: 'utf8', env: { ...process.env, ARCFLOW_EXPECT_SOURCE_REVISION: common.sourceRevision, ARCFLOW_EXPECT_CAPTURE_RUN_ID: '123', ARCFLOW_EXPECT_CAPTURE_RUN_ATTEMPT: '1', ARCFLOW_EXPECT_CAPTURE_REPOSITORY: 'fixture/repo' } })
describe('routing screenshot matrix and provenance gate', () => {
  it('validates the required metadata matrix with isolated byte fixtures', async () => { const result = verify(await fixture()); expect(result.status, result.stderr).toBe(0); expect(result.stdout).toContain('11 real routing screenshots') })
  it.each([
    ['missing image', images => images.pop()],
    ['wrong revision', images => { images[0].metadata.sourceRevision = '5'.repeat(40) }],
    ['dirty source', images => { images[0].metadata.sourceWorkingTree = 'modified-local-worktree' }],
    ['different backend', images => { images[0].metadata.backendJarSHA256 = '5'.repeat(64) }],
    ['stale run attempt', images => { images[0].metadata.captureRunAttempt = '2' }],
    ['wrong locale', images => { images[0].metadata.locale = 'zh-CN' }],
    ['changed image bytes', images => { images[0].bytes[23]++ }],
    ['forged pixel width', images => { images[0].bytes.writeUInt32BE(390, 16); images[0].metadata.imageSHA256 = createHash('sha256').update(images[0].bytes).digest('hex') }],
    ['missing journey', (_images, receipts) => receipts.pop()],
    ['duplicate scenario', (_images, receipts) => { receipts[0].requests = receipts[1].requests }],
    ['incomplete journey', (_images, receipts) => { receipts[0].result = 'incomplete' }],
    ['no included path', (_images, receipts) => { receipts[0].requests[1].routing.evaluations[0].result = false }],
    ['no skipped path', (_images, receipts) => { receipts[0].requests[0].routing.evaluations[0].result = true }],
  ])('rejects %s', async (_label, mutate) => { expect(verify(await fixture(mutate)).status).not.toBe(0) })
})
