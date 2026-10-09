import { test, expect } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expectUnifiedCatalog, expectCatalogCards } from './scenario-catalog.mjs'

// Real backend, synthetic documents, disposable account credentials. No mocked
// successful mutations and no real sealing, signing, file lookup or upload.
// Browser/pixel acceptance requires executing this journey and reviewing images.
const BASE = '/scenarios/oa-seal-use', TIMEOUT = 15_000
const DESKTOP = { width: 1440, height: 1000 }, MOBILE = { width: 390, height: 844 }
const CAPTURE = process.env.ARCFLOW_CAPTURE_SCENARIOS === '1', SESSION = randomUUID()
const TITLE = 'Synthetic handover review · 合成交接材料用印审核'
const SOURCE = process.env.ARCFLOW_SOURCE_REVISION || process.env.GITHUB_SHA || 'LOCAL_UNVERIFIED_WORKTREE'
test.use({ locale: 'en-GB', timezoneId: 'UTC', reducedMotion: 'reduce', actionTimeout: TIMEOUT, navigationTimeout: TIMEOUT })
async function backend(request, user, path, data, key) {
  const password = process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`]
  if (!password) throw new Error(`Missing disposable ${user} test password`)
  let result
  try {
    result = await request.fetch(`http://127.0.0.1:8080/api${path}`, {
      method: data === undefined ? 'GET' : 'POST', timeout: TIMEOUT,
      headers: { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`, 'X-Arcflow-Client': 'approval-demo', ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(data === undefined ? {} : { data }),
    })
  } catch { throw new Error(`Seal fixture ${user} ${path}: transport failed; private request details omitted`) }
  expect(result.ok(), `Seal fixture ${path}: HTTP ${result.status()}`).toBe(true)
  return result.json()
}
async function login(page, user = 'alice') {
  await page.getByLabel('Demo account').selectOption(user)
  try { await page.getByLabel('Password', { exact: true }).fill(process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`]) }
  catch { throw new Error(`Could not enter disposable ${user} password; private input details omitted`) }
  await page.getByRole('button', { name: 'Open scenario library', exact: false }).click()
  await expect(page.locator('.sf-shell')).toBeVisible(); await expect(page.locator('input[type=password]')).toHaveCount(0)
}
async function language(page, locale) {
  await page.locator('.sf-topbar').getByLabel('Language / 语言', { exact: true }).selectOption(locale)
  await expect(page.locator('.sf-shell')).toHaveAttribute('lang', locale === 'zh' ? 'zh-CN' : 'en')
}
async function openSeal(page) {
  await page.getByTestId('catalog-tab').click(); await page.getByTestId('open-seal').click()
  await expect(page.getByTestId('scenario-refresh')).toBeEnabled(); await expect(page.getByRole('alert')).toHaveCount(0)
}
async function switchUser(page, user) {
  await page.setViewportSize(DESKTOP); await language(page, 'en'); await page.getByTestId('scenario-logout').click()
  await login(page, user); await openSeal(page)
}
async function select(page, title = TITLE) {
  await page.locator('.sf-request-item').filter({ has: page.getByText(title, { exact: true }) }).click()
  await expect(page.locator('.sf-detail-header h2')).toHaveText(title)
}
async function noOverflow(page) {
  const sizes = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
  expect(sizes.document).toBeLessThanOrEqual(sizes.width); expect(sizes.body).toBeLessThanOrEqual(sizes.width)
}
async function capture(page, testInfo, name, mobile = false) {
  if (!CAPTURE) return
  await expect(page.locator('.sf-shell')).toBeVisible(); await expect(page.locator('input[type=password]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  if (mobile) await page.locator('.sf-decision-panel').scrollIntoViewIfNeeded()
  else await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await noOverflow(page)
  const image = await page.screenshot({ fullPage: !mobile, animations: 'disabled' })
  const path = testInfo.outputPath(`capture-${SESSION}`, `${name}.png`)
  const run = process.env.GITHUB_RUN_ID, repository = process.env.GITHUB_REPOSITORY
  const evidence = { schemaVersion: 1, sourceRevision: SOURCE, scenario: 'oa-seal-use', state: name.replace(/^\d+-/, '').replace(/-(?:zh|en)-(?:desktop|390)$/, ''), name,
    locale: (await page.locator('.sf-shell').getAttribute('lang')) === 'zh-CN' ? 'zh' : 'en', viewport: page.viewportSize(), fullPage: !mobile,
    image: `${name}.png`, imageSHA256: createHash('sha256').update(image).digest('hex'), capturedAt: new Date().toISOString(), captureSessionId: SESSION,
    captureRunId: run || `local-${SESSION}`, captureRunAttempt: run ? process.env.GITHUB_RUN_ATTEMPT || '1' : null,
    captureRunUrl: run && repository ? `https://github.com/${repository}/actions/runs/${run}` : null }
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, image, { flag: 'wx' })
  await writeFile(testInfo.outputPath(`capture-${SESSION}`, `${name}.json`), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' })
}
async function locales(page, testInfo, name, assertion = async () => {}) {
  for (const locale of ['zh', 'en']) { await language(page, locale); await assertion(locale); await capture(page, testInfo, `${name}-${locale}-desktop`) }
}
async function mutation(page, path, action) {
  const [response] = await Promise.all([page.waitForResponse(r => r.url().endsWith(`/api${path}`) && r.request().method() === 'POST', { timeout: TIMEOUT }), action()])
  expect(response.ok(), `Seal UI POST ${path}: HTTP ${response.status()}`).toBe(true)
  const view = await response.json(); await expect(page.getByTestId('scenario-refresh')).toBeEnabled(); await expect(page.getByRole('alert')).toHaveCount(0)
  return view
}
const designer = page => page.locator('.designer-workbench:visible')

test('Seal: real two-stage document review, bilingual form/designer/results and 390px reviewer', async ({ page, request }, testInfo) => {
  test.setTimeout(180_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  const expense = await backend(request, 'alice', '/scenarios/oa-expense/process'), initial = await backend(request, 'alice', `${BASE}/process`)
  const seeded = await backend(request, 'alice', `${BASE}/process`, { expectedVersion: initial.version, definition: {
    schemaVersion: 2, id: 'oa-seal-use', version: initial.version, name: 'Seal-use review · 用印审核', nodes: [
      { id: 'start', type: 'start', name: 'Submit request · 提交申请', assigneeId: null },
      { id: 'documentReview', type: 'approval', name: 'Document review · 文件审核', assigneeId: 'bob' },
      { id: 'sealReview', type: 'approval', name: 'Seal-use review · 用印复核', assigneeId: 'carol' },
      { id: 'end', type: 'end', name: 'Review complete · 审核完成', assigneeId: null },
    ],
  } })
  const catalog = await backend(request, 'alice', '/scenarios'); expectUnifiedCatalog(catalog)
  await page.goto('/scenarios.html'); await login(page)
  await locales(page, testInfo, '01-seal-catalog', async locale => { await expectCatalogCards(page, catalog, locale) })
  await openSeal(page); await page.getByTestId('designer-tab').click()
  await designer(page).getByTestId('process-name').fill('Delivery document review · 交付文件用印审核')
  const published = await mutation(page, `${BASE}/process`, () => designer(page).getByTestId('publish').click())
  expect(published.version).toBe(seeded.version + 1); expect(published.id).toBe('oa-seal-use')
  await locales(page, testInfo, '02-seal-designer', async () => { await expect(designer(page).getByTestId('select-step')).toHaveCount(2); await expect(designer(page).getByTestId('publish')).toBeDisabled() })
  await page.getByTestId('new-tab').click()
  for (const [field, value] of Object.entries({ businessId: 'SEAL-SHOWCASE-001', title: TITLE, reason: 'Synthetic project handover review only. / 仅合成项目交接审核。', documentName: 'Synthetic handover · 合成交接文件', documentRef: 'DEMO-DOC-001', copyCount: ' 02 ' })) await page.locator(`#seal-${field}`).fill(value)
  await page.locator('#seal-sealType').selectOption('OFFICIAL')
  await locales(page, testInfo, '03-seal-form', async () => { await expect(page.locator('#seal-copyCount')).toHaveValue(' 02 '); await expect(page.locator('#seal-copyCount')).toHaveAttribute('inputmode', 'numeric'); await expect(page.getByTestId('expense-total')).toHaveCount(0) })
  let posts = 0
  page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith(`/api${BASE}/documents`)) posts++ })
  await page.locator('#seal-copyCount').fill('1e2'); await page.getByTestId('submit-seal').click()
  await expect(page.locator('#seal-copyCount')).toBeFocused(); await expect(page.locator('#seal-copyCount')).toHaveValue('1e2'); expect(posts).toBe(0)
  await locales(page, testInfo, '04-seal-validation', async () => { await expect(page.locator('#seal-copyCount')).toHaveAttribute('aria-invalid', 'true') })
  await page.locator('#seal-copyCount').fill(' 02 ')
  // Only delay the genuine request; never fulfill a successful mutation.
  await page.route(`**/api${BASE}/documents`, async route => { await new Promise(resolve => setTimeout(resolve, 100)); await route.continue() })
  const created = await mutation(page, `${BASE}/documents`, () => page.getByTestId('submit-seal').dblclick())
  await page.unroute(`**/api${BASE}/documents`)
  expect(posts).toBe(1); expect(created.total).toBeNull(); expect(created.request.business.copyCount).toBe(2)
  expect(created.request).toMatchObject({ processId: 'oa-seal-use', currentStepId: 'documentReview', status: 'PENDING', processVersion: published.version })
  expect(Object.keys(created.request.business).sort()).toEqual(['type', 'documentVersion', 'businessId', 'title', 'reason', 'documentName', 'documentRef', 'sealType', 'copyCount'].sort())
  await locales(page, testInfo, '05-seal-pending', async locale => { await expect(page.locator('.sf-detail-header')).toContainText(locale === 'zh' ? '2 份' : '2 copies'); await expect(page.locator('.sf-saved-lines')).toHaveCount(0); await expect(page.locator('.timeline li')).toHaveCount(1) })
  const later = await backend(request, 'alice', `${BASE}/process`, { expectedVersion: published.version, definition: { ...published, name: 'Later review · 后续审核' } })
  expect(later.version).toBe(published.version + 1); expect(await backend(request, 'alice', '/scenarios/oa-expense/process')).toEqual(expense)
  await switchUser(page, 'carol'); await page.getByTestId('review-tab').click(); await expect(page.locator('.sf-request-item').filter({ has: page.getByText(TITLE, { exact: true }) })).toHaveCount(0)
  await switchUser(page, 'bob'); await page.getByTestId('review-tab').click(); await select(page)
  await page.locator('#scenario-comment').fill('Synthetic document reviewed. / 已审核合成文件。')
  await page.setViewportSize(MOBILE)
  for (const locale of ['zh', 'en']) {
    await language(page, locale); await noOverflow(page)
    for (const control of [page.locator('#scenario-comment'), page.getByTestId('approve-seal'), page.getByTestId('reject-seal')]) {
      await expect(control).toBeVisible()
      const bounds = await control.evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, height: rect.height, width: innerWidth } })
      expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(bounds.width); expect(bounds.height).toBeGreaterThanOrEqual(44)
    }
    await capture(page, testInfo, `06-seal-review-${locale}-390`, true)
  }
  await page.setViewportSize(DESKTOP); await language(page, 'en')
  const next = await mutation(page, `${BASE}/requests/${created.request.id}/decisions`, () => page.getByTestId('approve-seal').click())
  expect(next.request.currentStepId).toBe('sealReview'); expect(next.request.status).toBe('PENDING'); expect(next.total).toBeNull()
  await page.getByTestId('handled-tab').click(); await select(page)
  await locales(page, testInfo, '07-seal-next-stage', async () => { await expect(page.locator('.timeline li')).toHaveCount(2); await expect(page.getByTestId('approve-seal')).toHaveCount(0) })
  await switchUser(page, 'carol'); await page.getByTestId('review-tab').click(); await select(page)
  const approved = await mutation(page, `${BASE}/requests/${created.request.id}/decisions`, () => page.getByTestId('approve-seal').click())
  expect(approved.request.status).toBe('APPROVED'); expect(approved.total).toBeNull(); expect(approved.request.business).toEqual(created.request.business); expect(approved.request.definition).toEqual(created.request.definition)
  await page.reload(); await login(page); await openSeal(page); await page.getByTestId('mine-tab').click(); await select(page)
  await locales(page, testInfo, '08-seal-approved', async locale => { await expect(page.locator('.sf-detail-header .sf-status')).toHaveText(locale === 'zh' ? '已通过' : 'Approved'); await expect(page.locator('.timeline li')).toHaveCount(3) })
  const rejectedTitle = 'Synthetic correction · 合成用印驳回'
  const candidate = await backend(request, 'alice', `${BASE}/documents`, { processVersion: later.version, business: { ...created.request.business, businessId: 'SEAL-SHOWCASE-REJECT', title: rejectedTitle } }, `seal-reject-${SESSION}`)
  await switchUser(page, 'bob'); await page.getByTestId('review-tab').click(); await select(page, rejectedTitle)
  await page.locator('#scenario-comment').fill('Revise the synthetic purpose. / 请修正合成用途说明。')
  const rejected = await mutation(page, `${BASE}/requests/${candidate.request.id}/decisions`, () => page.getByTestId('reject-seal').click())
  expect(rejected.request.status).toBe('REJECTED'); expect(rejected.request.business).toEqual(candidate.request.business)
  await page.reload(); await login(page); await openSeal(page); await page.getByTestId('mine-tab').click(); await select(page, rejectedTitle)
  await locales(page, testInfo, '09-seal-rejected', async locale => { await expect(page.locator('.sf-detail-header .sf-status')).toHaveText(locale === 'zh' ? '已驳回' : 'Rejected'); await expect(page.locator('.timeline li')).toHaveCount(2); await expect(page.getByTestId('approve-seal')).toHaveCount(0) })
  expect((await backend(request, 'alice', `${BASE}/requests`)).find(view => view.request.id === candidate.request.id)).toEqual(rejected)
  expect(errors).toEqual([])
})
