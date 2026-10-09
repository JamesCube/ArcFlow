// Temporary valid PNG fixtures test integrity/provenance, not screenshot
// authenticity. They never enter capture output and are removed after each test.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { crc32, deflateSync } from 'node:zlib'
const folders = [], states = ['payment-conditions-en-desktop', 'payment-conditions-zh-390px', 'payment-low-frozen-desktop', 'payment-high-complete-desktop', 'payment-low-complete-zh-390px', 'receiving-clean-frozen-desktop', 'receiving-clean-zh-390px', 'contract-in-any-editor-desktop', 'contract-in-any-editor-zh-390px', 'contract-standard-complete-desktop', 'contract-standard-complete-zh-390px']
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))) })
const common = { sourceRevision: '1'.repeat(40), sourceWorkingTree: 'clean-commit', trackedDiffSHA256: '2'.repeat(64), uiSourceTreeSHA256: '3'.repeat(64), backendJarSHA256: '4'.repeat(64), backendRuntime: 'declared-Boot-4.1.1', captureRunId: '123', captureRunAttempt: '1', captureRepository: 'fixture/repo' }
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
function chunk(type, data) {
  const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); bytes.write(type, 4); data.copy(bytes, 8)
  bytes.writeUInt32BE(crc32(bytes.subarray(4, bytes.length - 4)), bytes.length - 4); return bytes
}
function png(width, height, { colorType = 2, raw, compressed, splitData = false, separateData = false } = {}) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = colorType
  const data = compressed ?? deflateSync(raw ?? Buffer.alloc((width * (colorType === 2 ? 3 : 4) + 1) * height))
  const parts = splitData || separateData ? [chunk('IDAT', data.subarray(0, 5)), ...(separateData ? [chunk('tEXt', Buffer.from('fixture\0split'))] : []), chunk('IDAT', data.subarray(5))] : [chunk('IDAT', data)]
  return Buffer.concat([signature, chunk('IHDR', header), ...parts, chunk('IEND', Buffer.alloc(0))])
}
const desktopPng = png(1440, 1000, { splitData: true }), mobilePng = png(390, 844, { colorType: 6 })
function replaceBytes(image, bytes) { image.bytes = bytes; image.metadata.imageSHA256 = createHash('sha256').update(bytes).digest('hex') }
async function fixture(mutate = () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'routing-gate-unit-')); folders.push(root)
  const images = states.map(state => {
    const width = state.endsWith('-390px') ? 390 : 1440, height = width === 390 ? 844 : 1000
    const bytes = Buffer.from(width === 390 ? mobilePng : desktopPng)
    return { state, bytes, metadata: { ...common, state, image: `${state}.png`, imageSHA256: createHash('sha256').update(bytes).digest('hex'), viewport: { width, height }, fullPage: true, locale: state.includes('-zh-') ? 'zh-CN' : 'en', capturedAt: '2026-10-09T00:00:00Z' } }
  })
  const receipts = ['erp-payment', 'erp-receiving', 'crm-contract'].map(processId => ({ ...common, result: 'passed', realBackend: true, backendSha256: common.backendJarSHA256, requests: [false, true].map(result => ({ processId, status: 'APPROVED', routing: { evaluations: [{ result }] } })) }))
  const runtime = { schemaVersion: 1, sourceRevision: common.sourceRevision, backendJarSHA256: common.backendJarSHA256, springBootVersion: '4.1.1', springFrameworkVersion: '7.0.0', springSecurityVersion: '7.0.0' }
  mutate(images, receipts, runtime)
  await writeFile(join(root, 'routing-runtime.json'), JSON.stringify(runtime))
  for (const image of images) { await writeFile(join(root, `${image.state}.png`), image.bytes); await writeFile(join(root, `${image.state}.json`), JSON.stringify(image.metadata)) }
  for (const [index, receipt] of receipts.entries()) { const directory = join(root, `journey-${index}`); await mkdir(directory); await writeFile(join(directory, 'routing-receipt.json'), JSON.stringify(receipt)) }
  return root
}
const verify = root => spawnSync(process.execPath, [resolve('scripts/verify-routing-captures.mjs'), root], { encoding: 'utf8', env: { ...process.env, ARCFLOW_EXPECT_SOURCE_REVISION: common.sourceRevision, ARCFLOW_EXPECT_RUNTIME_REPORT: join(root, 'routing-runtime.json'), ARCFLOW_EXPECT_CAPTURE_RUN_ID: '123', ARCFLOW_EXPECT_CAPTURE_RUN_ATTEMPT: '1', ARCFLOW_EXPECT_CAPTURE_REPOSITORY: 'fixture/repo' } })
describe('routing screenshot matrix and provenance gate', () => {
  it('validates complete RGB/RGBA PNGs, consecutive IDAT chunks and the required metadata matrix', async () => { const result = verify(await fixture()); expect(result.status, result.stderr).toBe(0); expect(result.stdout).toContain('11 complete routing PNGs') })
  it.each([
    ['missing image', images => images.pop()],
    ['wrong revision', images => { images[0].metadata.sourceRevision = '5'.repeat(40) }],
    ['dirty source', images => { images[0].metadata.sourceWorkingTree = 'modified-local-worktree' }],
    ['different backend', images => { images[0].metadata.backendJarSHA256 = '5'.repeat(64) }],
    ['stale run attempt', images => { images[0].metadata.captureRunAttempt = '2' }],
    ['wrong locale', images => { images[0].metadata.locale = 'zh-CN' }],
    ['wrong viewport height', images => { images[0].metadata.viewport.height = 1 }],
    ['changed image bytes', images => { images[0].bytes[23]++ }],
    ['forged pixel width', images => replaceBytes(images[0], png(390, 1000))],
    ['runtime report revision', (_images, _receipts, runtime) => { runtime.sourceRevision = '5'.repeat(40) }],
    ['runtime report backend', (_images, _receipts, runtime) => { runtime.backendJarSHA256 = '5'.repeat(64) }],
    ['runtime report Boot', (_images, _receipts, runtime) => { runtime.springBootVersion = '3.5.0' }],
    ['runtime report Spring', (_images, _receipts, runtime) => { runtime.springFrameworkVersion = '6.2.0' }],
    ['runtime report Security', (_images, _receipts, runtime) => { runtime.springSecurityVersion = '6.5.0' }],
    ['missing journey', (_images, receipts) => receipts.pop()],
    ['duplicate scenario', (_images, receipts) => { receipts[0].requests = receipts[1].requests }],
    ['incomplete journey', (_images, receipts) => { receipts[0].result = 'incomplete' }],
    ['no included path', (_images, receipts) => { receipts[0].requests[1].routing.evaluations[0].result = false }],
    ['no skipped path', (_images, receipts) => { receipts[0].requests[0].routing.evaluations[0].result = true }],
  ])('rejects %s', async (_label, mutate) => { expect(verify(await fixture(mutate)).status).not.toBe(0) })
  it.each([
    ['header-only placeholder', () => desktopPng.subarray(0, 24), 'Truncated PNG chunk data'],
    ['truncated chunk', () => desktopPng.subarray(0, -2), 'Truncated PNG chunk'],
    ['bad CRC', () => { const bytes = Buffer.from(desktopPng); bytes[29] ^= 1; return bytes }, 'Invalid PNG IHDR CRC'],
    ['invalid IDAT', () => png(1440, 1000, { compressed: Buffer.from('invalid zlib stream') }), 'incorrect header check'],
    ['truncated IDAT stream', () => png(1440, 1000, { compressed: deflateSync(Buffer.alloc(4321000)).subarray(0, -2) }), 'unexpected end of file'],
    ['missing IEND', () => desktopPng.subarray(0, -12), 'Incomplete PNG image'],
    ['trailing bytes', () => Buffer.concat([desktopPng, Buffer.from([0])]), 'Data after PNG IEND'],
    ['nonconsecutive IDAT', () => png(1440, 1000, { separateData: true }), 'PNG IDAT chunks must be consecutive'],
    ['duplicate IHDR', () => Buffer.concat([desktopPng.subarray(0, 33), desktopPng.subarray(8, 33), desktopPng.subarray(33)]), 'Duplicate or misplaced PNG header'],
    ['unknown critical chunk', () => Buffer.concat([desktopPng.subarray(0, 33), chunk('ABCD', Buffer.alloc(0)), desktopPng.subarray(33)]), 'Unsupported critical PNG chunk'],
    ['oversized dimensions', () => png(32769, 1, { compressed: deflateSync(Buffer.alloc(1)) }), 'PNG dimensions exceed the supported bounds'],
    ['oversized decoded image', () => png(1440, 32768, { compressed: deflateSync(Buffer.alloc(1)) }), 'PNG exceeds the decoded size limit'],
    ['short scanlines', () => png(1440, 1000, { raw: Buffer.alloc(4320999) }), 'Invalid PNG scanline length'],
    ['excess scanlines', () => png(1440, 1000, { raw: Buffer.alloc(4321001) }), 'larger than'],
    ['invalid scanline filter', () => { const raw = Buffer.alloc(4321000); raw[0] = 5; return png(1440, 1000, { raw }) }, 'Invalid PNG scanline filter'],
    ['trailing zlib data', () => png(1440, 1000, { compressed: Buffer.concat([deflateSync(Buffer.alloc(4321000)), Buffer.from([0])]) }), 'Trailing data in PNG zlib stream'],
  ])('rejects %s even when the sidecar hash matches', async (_label, bytes, message) => {
    const result = verify(await fixture(images => replaceBytes(images[0], bytes())))
    expect(result.status).not.toBe(0); expect(result.stderr).toContain(message)
  })
})
