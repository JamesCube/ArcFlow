// Temporary generated PNGs exercise evidence integrity only. They are not
// browser screenshots and are never copied into an acceptance-artifact folder.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { crc32, deflateSync } from 'node:zlib'
import { verifyExpenseCaptures } from '../../scripts/verify-expense-routing-captures.mjs'
import { expenseCaptureContract, expenseCaptureNames, expenseExpectedRoutes } from '../../scripts/expense-routing-capture-contract.mjs'
import { clone, decidedFixture, viewFixture } from './scenario-fixtures.js'
const hash = value => createHash('sha256').update(value).digest('hex')
const folders = []
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))) })
const common = { sourceRevision: '1'.repeat(40), sourceWorkingTree: 'clean-commit', trackedDiffSHA256: hash(''), uiSourceTreeSHA256: '3'.repeat(64), backendJarSHA256: '4'.repeat(64), backendRuntime: 'declared-Boot-4.1.1', captureRunId: '123', captureRunAttempt: '1', captureRepository: 'fixture/repo' }
const runtime = { schemaVersion: 1, sourceRevision: common.sourceRevision, backendJarSHA256: common.backendJarSHA256, springBootVersion: '4.1.1', springFrameworkVersion: '7.0.0', springSecurityVersion: '7.0.0' }
const expected = { ...common, runtime }
function chunk(type, data) { const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); bytes.write(type, 4); data.copy(bytes, 8); bytes.writeUInt32BE(crc32(bytes.subarray(4, bytes.length - 4)), bytes.length - 4); return bytes }
function png(width, height) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((width * 3 + 1) * height))), chunk('IEND', Buffer.alloc(0))])
}
const desktop = png(1440, 1000), mobile = png(390, 844)
function baseView(journey, locale) {
  const version = journey === 'legacy' ? 1 : journey === 'new' ? 3 : 2, route = expenseExpectedRoutes[journey]
  const view = viewFixture({ id: `${journey}-${locale}`, processVersion: version })
  view.request.business.lines[0].amount = ['threshold', 'rejected'].includes(journey) ? '9999.90' : '9999.89'
  view.request.business.lines[1].amount = '0.10'; view.total = ['threshold', 'rejected'].includes(journey) ? '10000.00' : '9999.99'
  view.request.definition.version = version
  if (route) {
    view.request.definition.schemaVersion = 4
    view.request.definition.nodes[1] = { id: 'manager', type: 'parallelApproval', name: 'Expense total review', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ALL', runIf: { mode: 'ALL', predicates: [{ field: 'expense.totalAmount', operator: 'GTE', currency: 'CNY', threshold: route.threshold }] } }
    view.request.routing = { schemaVersion: 1, stepIds: route.stepIds, evaluations: [{ stepId: 'manager', result: route.result, predicates: [{ field: 'expense.totalAmount', actualValue: route.actualValue, result: route.result }] }] }
    view.request.currentStepId = route.stepIds[0]; view.request.approverId = route.result ? 'bob' : 'carol'
  }
  return view
}
async function fixture(mutate = () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'expense-routing-gate-')); folders.push(root)
  const images = expenseCaptureNames.map(state => {
    const narrow = state.endsWith('-390px'), bytes = Buffer.from(narrow ? mobile : desktop)
    return { state, bytes, metadata: { ...common, state, image: `${state}.png`, imageSHA256: hash(bytes), viewport: narrow ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, fullPage: true, scrollOrigin: { x: 0, y: 0 }, locale: state.includes('-zh-') ? 'zh-CN' : 'en', capturedAt: '2026-10-10T00:00:00Z', requestId: null, requestStatus: null, currentStepId: null, decisionCount: null } }
  })
  const receipts = ['en', 'zh'].map(locale => {
    const views = new Map(), checkpoints = []
    for (const [state, requirement] of Object.entries(expenseCaptureContract)) {
      if (!requirement) continue
      let view = baseView(requirement.journey, locale)
      for (const [actor, step, decision] of requirement.expectedVotes) { expect(view.request.currentStepId).toBe(step); view = decidedFixture(view, actor, decision, 'Reviewed synthetic receipt details.') }
      views.set(requirement.journey, view)
      checkpoints.push({ state, requestId: view.request.id, status: view.request.status, currentStepId: view.request.currentStepId, processVersion: view.request.processVersion, history: view.request.history })
      for (const viewport of ['desktop', '390px']) Object.assign(images.find(image => image.state === `${state}-${locale}-${viewport}`).metadata, { requestId: view.request.id, requestStatus: view.request.status, currentStepId: view.request.currentStepId, decisionCount: requirement.expectedVotes.length })
    }
    const wireViews = [...views.values()].map(value => { const view = clone(value); view.request.business.lines.forEach(line => { line.amount = Number(line.amount) }); return view })
    return { ...common, result: 'passed', realBackend: true, browser: 'Chromium', locale, versions: { legacy: 1, conditional: 2, later: 3 }, currencyMismatchPosts: 0, checkpoints, views: wireViews }
  })
  mutate(images, receipts)
  for (const image of images) { await writeFile(join(root, `${image.state}.png`), image.bytes); await writeFile(join(root, `${image.state}.json`), JSON.stringify(image.metadata)) }
  for (const [index, receipt] of receipts.entries()) { const directory = join(root, `language-${index}`); await mkdir(directory); await writeFile(join(directory, 'expense-routing-receipt.json'), JSON.stringify(receipt)) }
  return root
}
describe('expense routing capture matrix and exact-source evidence gate', () => {
  it('requires 48 images for one new business case in twelve states, two languages and two widths', async () => {
    expect(expenseCaptureNames).toHaveLength(48)
    expect(await verifyExpenseCaptures(await fixture(), expected)).toContain('Verified 48 complete expense routing PNGs')
  })
  it.each([
    ['missing state', images => images.pop()],
    ['wrong source', images => { images[0].metadata.sourceRevision = '5'.repeat(40) }],
    ['dirty source', images => { images[0].metadata.sourceWorkingTree = 'modified-local-worktree' }],
    ['different source tree', images => { images[0].metadata.uiSourceTreeSHA256 = '5'.repeat(64) }],
    ['different backend', images => { images[0].metadata.backendJarSHA256 = '5'.repeat(64) }],
    ['wrong run', images => { images[0].metadata.captureRunAttempt = '2' }],
    ['corrupt PNG', images => { images[0].bytes[20]++; images[0].metadata.imageSHA256 = hash(images[0].bytes) }],
    ['image hash mismatch', images => { images[0].metadata.imageSHA256 = '5'.repeat(64) }],
    ['wrong locale', images => { images[0].metadata.locale = 'zh-CN' }],
    ['scrolled screenshot', images => { images[0].metadata.scrollOrigin.y = 100 }],
    ['missing language', (_images, receipts) => receipts.pop()],
    ['currency mismatch transmitted', (_images, receipts) => { receipts[0].currencyMismatchPosts = 1 }],
    ['missing checkpoint', (_images, receipts) => receipts[0].checkpoints.pop()],
    ['forged selected path', (_images, receipts) => { receipts[0].views.find(view => view.request.id.startsWith('low')).request.routing.stepIds.unshift('manager') }],
    ['changed exact total', (_images, receipts) => { receipts[0].views.find(view => view.request.id.startsWith('low')).total = '10000.00' }],
    ['rewritten old publication', (_images, receipts) => { receipts[0].versions.conditional++ }],
    ['skipped fake vote', (_images, receipts) => { receipts[0].checkpoints.find(checkpoint => checkpoint.state === 'expense-low-approved').history[1].stepId = 'manager' }],
  ])('rejects %s', async (_name, mutate) => { await expect(verifyExpenseCaptures(await fixture(mutate), expected)).rejects.toThrow() })
})
