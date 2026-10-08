import { test, expect } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

// Uses the configured fresh real backend and disposable accounts. Successful
// saves are never fulfilled or fabricated. Capture is explicitly opt-in; no
// password screens, traces, HARs, storage state, or credential logs are retained.
const BASE = '/scenarios/oa-expense'
const DESKTOP = { width: 1440, height: 1000 }, MOBILE = { width: 390, height: 844 }
const CAPTURE = process.env.ARCFLOW_CAPTURE_SCENARIOS === '1'
const TITLE = 'Client visit · 客户拜访报销'
const TIMEOUT = 15_000
// Every execution gets a distinct artifact directory, including GitHub reruns.
// A local capture is explicitly not evidence of a verified commit. Consumers
// must compare sourceRevision, run identity and imageSHA256 before using proof.
const CAPTURE_SESSION = randomUUID()
const SOURCE_REVISION = process.env.GITHUB_SHA || 'LOCAL_UNVERIFIED_WORKTREE'
const GITHUB_RUN = process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
  ? { id: process.env.GITHUB_RUN_ID, repository: process.env.GITHUB_REPOSITORY, attempt: process.env.GITHUB_RUN_ATTEMPT || '1' }
  : null

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
  } catch {
    // Transport call logs can contain Authorization. Never propagate them.
    throw new Error(`Scenario fixture ${user} ${path}: transport failed; private request details omitted`)
  }
  expect(result.ok(), `Scenario fixture ${path}: HTTP ${result.status()}`).toBe(true)
  return result.json()
}
async function login(page, user = 'alice') {
  await page.getByLabel('Demo account').selectOption(user)
  try { await page.getByLabel('Password', { exact: true }).fill(process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`]) }
  catch { throw new Error(`Could not enter the disposable ${user} password; private input details omitted`) }
  await page.getByRole('button', { name: 'Open scenario library', exact: false }).click()
  await expect(page.locator('.sf-shell')).toBeVisible()
  await expect(page.locator('input[type=password]')).toHaveCount(0)
}
async function language(page, locale) {
  await page.locator('.sf-topbar').getByLabel('Language / 语言', { exact: true }).selectOption(locale)
  await expect(page.locator('.sf-shell')).toHaveAttribute('lang', locale === 'zh' ? 'zh-CN' : 'en')
}
async function switchUser(page, user) {
  await page.setViewportSize(DESKTOP); await language(page, 'en')
  await page.getByTestId('scenario-logout').click(); await login(page, user)
}
async function select(page, title = TITLE) {
  await page.locator('.sf-request-item').filter({ has: page.getByText(title, { exact: true }) }).click()
  await expect(page.locator('.sf-detail-header h2')).toHaveText(title)
}
async function noOverflow(page) {
  const sizes = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
  expect(sizes.document, 'Document fits the viewport').toBeLessThanOrEqual(sizes.width)
  expect(sizes.body, 'Body fits the viewport').toBeLessThanOrEqual(sizes.width)
}
async function touchControl(locator) {
  await expect(locator).toBeVisible()
  const box = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right, height: rect.height, font: parseFloat(getComputedStyle(element).fontSize), viewport: innerWidth }
  })
  expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(box.viewport)
  expect(box.height, 'Reviewer control touch height').toBeGreaterThanOrEqual(44)
  expect(box.font, 'Reviewer control readable text').toBeGreaterThanOrEqual(14)
}
async function capture(page, testInfo, name, mobile = false) {
  if (!CAPTURE) return
  await expect(page.locator('.sf-shell')).toBeVisible()
  await expect(page.locator('input[type=password]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  if (mobile) await page.locator('.sf-decision-panel').scrollIntoViewIfNeeded()
  else await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await noOverflow(page)
  const locale = (await page.locator('.sf-shell').getAttribute('lang')) === 'zh-CN' ? 'zh' : 'en'
  const viewport = page.viewportSize()
  const image = await page.screenshot({ fullPage: !mobile, animations: 'disabled' })
  const imagePath = testInfo.outputPath(`capture-${CAPTURE_SESSION}`, `${name}.png`)
  const evidence = {
    schemaVersion: 1,
    sourceRevision: SOURCE_REVISION,
    scenario: 'oa-expense',
    state: name.replace(/^\d+-/, '').replace(/-(?:zh|en)-(?:desktop|390)$/, ''),
    name,
    locale,
    viewport,
    fullPage: !mobile,
    image: `${name}.png`,
    imageSHA256: createHash('sha256').update(image).digest('hex'),
    capturedAt: new Date().toISOString(),
    captureSessionId: CAPTURE_SESSION,
    captureRunId: GITHUB_RUN?.id || `local-${CAPTURE_SESSION}`,
    captureRunAttempt: GITHUB_RUN?.attempt || null,
    captureRunUrl: GITHUB_RUN ? `https://github.com/${GITHUB_RUN.repository}/actions/runs/${GITHUB_RUN.id}` : null,
  }
  await mkdir(dirname(imagePath), { recursive: true })
  // Exclusive writes and a fresh session directory forbid old bytes or sidecars
  // from being silently presented as this execution's newly captured evidence.
  await writeFile(imagePath, image, { flag: 'wx' })
  await writeFile(testInfo.outputPath(`capture-${CAPTURE_SESSION}`, `${name}.json`), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' })
}
async function captureLocales(page, testInfo, prefix, assertion) {
  for (const locale of ['zh', 'en']) {
    await language(page, locale); await assertion(locale)
    await capture(page, testInfo, `${prefix}-${locale}-desktop`)
  }
}
async function mutation(page, path, action) {
  const [result] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith(`/api${path}`) && response.request().method() === 'POST', { timeout: TIMEOUT }), action(),
  ])
  expect(result.ok(), `Scenario UI POST ${path}: HTTP ${result.status()}`).toBe(true)
  const view = await result.json()
  await expect(page.getByTestId('scenario-refresh')).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  return view
}
async function fillExpense(page) {
  await page.getByTestId('new-tab').click()
  for (const [field, value] of Object.entries({ businessId: 'EXP-SHOWCASE-2026', title: TITLE, reason: 'Project workshop and customer handover. Synthetic data only. / 项目研讨与客户交接，仅合成数据。' })) await page.locator(`#expense-${field}`).fill(value)
  await page.locator('#expense-costCenter').selectOption('ENGINEERING'); await page.locator('#expense-currency').selectOption('CNY')
  const lines = [
    { spentOn: '2026-10-07', category: 'TRAVEL', description: 'Return train ticket · 往返高铁', amount: '1234.50', receiptRef: 'SYNTHETIC-TRAIN-001' },
    { spentOn: '2026-10-07', category: 'MEALS', description: 'Workshop lunch · 工作午餐', amount: '46.00', receiptRef: 'SYNTHETIC-MEAL-002' },
  ]
  for (const [index, line] of lines.entries()) {
    if (index) await page.getByTestId('add-expense-line').click()
    for (const [field, value] of Object.entries(line)) {
      const input = page.locator(`#expense-lines-${index}-${field}`)
      if (field === 'category') await input.selectOption(value); else await input.fill(value)
    }
  }
}

test('expense scenario: real publication, exact document, persisted sequential review, bilingual scenes and 390px controls', async ({ page, request }, testInfo) => {
  test.setTimeout(180_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  const legacy = await backend(request, 'alice', '/process')
  const initial = await backend(request, 'alice', `${BASE}/process`)
  const definition = { schemaVersion: 2, id: 'oa-expense', version: initial.version, name: 'Expense approval · 费用报销审批', nodes: [
    { id: 'start', type: 'start', name: 'Submit expense', assigneeId: null },
    { id: 'manager', type: 'approval', name: 'Manager review · 主管审核', assigneeId: 'bob' },
    { id: 'finance', type: 'approval', name: 'Finance review · 财务复核', assigneeId: 'carol' },
    { id: 'end', type: 'end', name: 'Completed', assigneeId: null },
  ] }
  const seeded = await backend(request, 'alice', `${BASE}/process`, { expectedVersion: initial.version, definition })
  const catalog = await backend(request, 'alice', '/scenarios')
  expect(catalog).toHaveLength(2); expect(catalog[0]).toMatchObject({ id: 'oa-expense', documentType: 'expense', documentVersion: 1, formVersion: 1 })

  await page.goto('/scenarios.html'); await login(page)
  await captureLocales(page, testInfo, '01-catalog', async locale => {
    await expect(page.getByTestId('open-expense')).toBeVisible()
    await expect(page.locator('.sf-template-card').filter({ has: page.getByTestId('open-expense') }).locator('.sf-template-info h2')).toHaveText(catalog[0].title[locale])
    await expect(page.locator('.sf-template-card')).toHaveCount(2)
  })

  await page.getByTestId('designer-tab').click()
  await page.getByTestId('process-name').fill('Expense approval · 项目费用审批')
  const published = await mutation(page, `${BASE}/process`, () => page.getByTestId('publish').dblclick())
  expect(published.id).toBe('oa-expense'); expect(published.version).toBe(seeded.version + 1)
  await expect(page.getByTestId('publish')).toBeDisabled()
  await captureLocales(page, testInfo, '03-designer', async locale => {
    await expect(page.locator('.designer-workbench')).toHaveAttribute('lang', locale === 'zh' ? 'zh-CN' : 'en')
    await expect(page.getByTestId('select-step')).toHaveCount(2)
    await expect(page.getByTestId('process-name')).toHaveValue(published.name)
  })

  await fillExpense(page)
  await captureLocales(page, testInfo, '02-filled-expense', async () => {
    await expect(page.locator('#expense-title')).toHaveValue(TITLE)
    await expect(page.locator('.sf-line-card')).toHaveCount(2)
    await expect(page.getByTestId('expense-total')).toHaveText('CNY 1,280.50')
    await expect(page.locator('#expense-lines-0-amount')).toHaveAttribute('type', 'text')
  })
  // An invalid decimal cannot trigger a save, and focus goes to its field.
  let documentPosts = 0
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`/api${BASE}/documents`)) documentPosts++ })
  await page.locator('#expense-lines-0-amount').fill('1.001'); await page.getByTestId('submit-expense').click()
  await expect(page.locator('#expense-lines-0-amount')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('#expense-lines-0-amount')).toBeFocused(); expect(documentPosts).toBe(0)
  await page.locator('#expense-lines-0-amount').fill('1234.50')
  const created = await mutation(page, `${BASE}/documents`, () => page.getByTestId('submit-expense').dblclick())
  expect(documentPosts).toBe(1)
  expect(created.total).toBe('1280.50'); expect(created.request).toMatchObject({ status: 'PENDING', processId: 'oa-expense', processVersion: published.version, currentStepId: 'manager', applicantId: 'alice' })
  expect(created.request.business.lines.map(line => line.amount)).toEqual([1234.5, 46])
  expect(new Set(created.request.business.lines.map(line => line.lineId)).size).toBe(2)
  await expect(page.getByTestId('approve-expense')).toHaveCount(0)
  await captureLocales(page, testInfo, '04-request-detail-pending', async () => {
    await expect(page.locator('.sf-detail-header h2')).toHaveText(TITLE)
    await expect(page.locator('.sf-saved-lines section')).toHaveCount(2)
    await expect(page.locator('.sf-detail-header')).toContainText('CNY 1,280.50')
    await expect(page.locator('.timeline li')).toHaveCount(1)
  })

  // A later real publication must not rewrite the already-saved route.
  const later = await backend(request, 'alice', `${BASE}/process`, { expectedVersion: published.version, definition: { ...published, name: 'Future expense process', nodes: [published.nodes[0], { ...published.nodes[1], assigneeId: 'carol' }, { ...published.nodes[2], assigneeId: 'bob' }, published.nodes[3]] } })
  const saved = (await backend(request, 'alice', `${BASE}/requests`)).find(view => view.request.id === created.request.id)
  expect(saved.request.definition).toEqual(created.request.definition); expect(later.version).toBe(created.request.processVersion + 1)
  expect(await backend(request, 'alice', '/process')).toEqual(legacy)

  await switchUser(page, 'carol'); await page.getByTestId('review-tab').click()
  await expect(page.locator('.sf-request-item').filter({ has: page.getByText(TITLE, { exact: true }) })).toHaveCount(0)
  await page.getByTestId('designer-tab').click(); await expect(page.getByTestId('publish')).toHaveCount(0)
  await switchUser(page, 'bob'); await page.getByTestId('review-tab').click(); await select(page)
  await page.locator('#scenario-comment').fill('Receipts and purpose verified. / 已核对凭证和用途。')
  await captureLocales(page, testInfo, '05-review-pending', async () => {
    await expect(page.getByTestId('approve-expense')).toBeEnabled(); await expect(page.getByTestId('reject-expense')).toBeEnabled()
    await expect(page.locator('.sf-snapshot-flow')).toContainText('Manager review')
    await expect(page.locator('.sf-detail-header')).toContainText('CNY 1,280.50')
  })
  await page.setViewportSize(MOBILE)
  for (const locale of ['zh', 'en']) {
    await language(page, locale); await noOverflow(page)
    await touchControl(page.locator('#scenario-comment')); await touchControl(page.getByTestId('approve-expense')); await touchControl(page.getByTestId('reject-expense'))
    await capture(page, testInfo, `06-review-pending-${locale}-390`, true)
  }
  await page.setViewportSize(DESKTOP); await language(page, 'en')
  let decisionPosts = 0
  await page.route(`**/api${BASE}/requests/${created.request.id}/decisions`, async route => {
    decisionPosts++; await new Promise(resolve => setTimeout(resolve, 100)); await route.continue()
  })
  const first = await mutation(page, `${BASE}/requests/${created.request.id}/decisions`, () => page.getByTestId('approve-expense').dblclick())
  expect(decisionPosts).toBe(1); expect(first.request.currentStepId).toBe('finance'); expect(first.request.status).toBe('PENDING'); expect(first.request.history).toHaveLength(2)
  await page.unroute(`**/api${BASE}/requests/${created.request.id}/decisions`)
  await expect(page.getByTestId('approve-expense')).toHaveCount(0)
  await page.getByTestId('handled-tab').click(); await select(page); await expect(page.locator('.timeline li')).toHaveCount(2)

  await switchUser(page, 'carol'); await page.getByTestId('review-tab').click(); await select(page)
  const completed = await mutation(page, `${BASE}/requests/${created.request.id}/decisions`, () => page.getByTestId('approve-expense').click())
  expect(completed.request.status).toBe('APPROVED'); expect(completed.request.history).toHaveLength(3)
  expect(completed.request.business).toEqual(created.request.business); expect(completed.request.definition).toEqual(created.request.definition)
  await expect(page.getByTestId('approve-expense')).toHaveCount(0)

  await page.reload(); await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')
  await login(page, 'alice'); await page.getByTestId('mine-tab').click(); await select(page)
  await expect(page.locator('.sf-detail-header .sf-status')).toHaveText('Approved'); await expect(page.locator('.timeline li')).toHaveCount(3)
  await captureLocales(page, testInfo, '07-request-detail-approved', async locale => {
    await expect(page.locator('.sf-detail-header .sf-status')).toHaveText(locale === 'zh' ? '已通过' : 'Approved')
    await expect(page.locator('.timeline li')).toHaveCount(3)
    await expect(page.getByTestId('approve-expense')).toHaveCount(0)
    await expect(page.locator('.sf-saved-lines section')).toHaveCount(2)
  })
  // Only a failing read is intercepted. Existing confirmed data survives and the
  // next refresh returns to the actual backend without a fabricated save.
  await page.route(`**/api${BASE}/requests`, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Synthetic temporary outage"}' }))
  await page.getByTestId('scenario-refresh').click(); await expect(page.getByRole('alert')).toContainText('Refresh failed')
  await expect(page.locator('.sf-detail-header h2')).toHaveText(TITLE)
  await page.unroute(`**/api${BASE}/requests`); await page.getByTestId('scenario-refresh').click()
  await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.getByRole('status')).toContainText('Data refreshed')
  expect((await backend(request, 'alice', `${BASE}/requests`)).find(view => view.request.id === created.request.id)).toEqual(completed)
  // A second real document uses the newly published route, then exercises the
  // rejection endpoint through the browser without changing its saved business.
  const rejectedTitle = 'Rejected expense · 费用驳回'
  const rejectBusiness = { ...created.request.business, businessId: 'EXP-REJECTION-2026', title: rejectedTitle }
  const rejectCandidate = await backend(request, 'alice', `${BASE}/documents`, { business: rejectBusiness, processVersion: later.version }, `scenario-reject-${Date.now()}`)
  expect(rejectCandidate.request.currentStepId).toBe('manager'); expect(rejectCandidate.request.approverId).toBe('carol')
  await switchUser(page, 'carol'); await page.getByTestId('review-tab').click(); await select(page, rejectedTitle)
  await page.locator('#scenario-comment').fill('The expense needs correction. / 费用明细需要修正。')
  const rejected = await mutation(page, `${BASE}/requests/${rejectCandidate.request.id}/decisions`, () => page.getByTestId('reject-expense').click())
  expect(rejected.request.status).toBe('REJECTED'); expect(rejected.request.currentStepId).toBeNull()
  expect(rejected.request.history).toHaveLength(2); expect(rejected.request.business).toEqual(rejectCandidate.request.business)
  await expect(page.getByTestId('approve-expense')).toHaveCount(0); await expect(page.getByTestId('reject-expense')).toHaveCount(0)
  await page.reload(); await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')
  await login(page, 'alice'); await page.getByTestId('mine-tab').click(); await select(page, rejectedTitle)
  const reloadedRejection = (await backend(request, 'alice', `${BASE}/requests`)).find(view => view.request.id === rejectCandidate.request.id)
  expect(reloadedRejection).toEqual(rejected)
  expect(reloadedRejection.request.definition).toEqual(rejectCandidate.request.definition)
  await captureLocales(page, testInfo, '08-request-detail-rejected', async locale => {
    await expect(page.locator('.sf-detail-header .sf-status')).toHaveText(locale === 'zh' ? '已驳回' : 'Rejected')
    await expect(page.locator('.timeline li')).toHaveCount(2)
    await expect(page.getByTestId('approve-expense')).toHaveCount(0)
    await expect(page.getByTestId('reject-expense')).toHaveCount(0)
    await expect(page.locator('.timeline')).toContainText('The expense needs correction.')
  })
  expect(errors).toEqual([])
})
