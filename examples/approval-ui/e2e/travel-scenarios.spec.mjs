import { test, expect } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expectUnifiedCatalog, expectCatalogCards } from './scenario-catalog.mjs'

// Fresh real backend, disposable accounts and synthetic documents only. A lost
// response is injected only AFTER a real save; successful saves are never faked.
// Capture is opt-in. No login screenshots, traces, HARs, videos, storage state,
// credentials or authentication request logs are retained.
const BASE = '/scenarios/oa-travel', EXPENSE = '/scenarios/oa-expense'
const DESKTOP = { width: 1440, height: 1000 }, MOBILE = { width: 390, height: 844 }
const CAPTURE = process.env.ARCFLOW_CAPTURE_TRAVEL_SCENARIOS === '1'
const TIMEOUT = 15_000
const TITLE = 'Project delivery · 上海出差申请'
const CAPTURE_SESSION = randomUUID()
// A local worktree capture is not evidence of a verified commit. Consumers must
// compare sourceRevision, run identity and imageSHA256 before using the proof.
const SOURCE_REVISION = process.env.ARCFLOW_SOURCE_REVISION || process.env.GITHUB_SHA || 'LOCAL_UNVERIFIED_WORKTREE'
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
    // Transport logs can contain Authorization. Never propagate them.
    throw new Error(`Travel fixture ${user} ${path}: transport failed; private request details omitted`)
  }
  expect(result.ok(), `Travel fixture ${path}: HTTP ${result.status()}`).toBe(true)
  return result.json()
}
async function seedProcess(request, type) {
  const base = `/scenarios/oa-${type}`, initial = await backend(request, 'alice', `${base}/process`)
  const travel = type === 'travel'
  const definition = { schemaVersion: 2, id: `oa-${type}`, version: initial.version, name: travel ? 'Travel approval · 出差审批' : 'Expense approval · 费用报销审批', nodes: [
    { id: 'start', type: 'start', name: travel ? 'Submit travel request' : 'Submit expense', assigneeId: null },
    { id: travel ? 'tripReview' : 'manager', type: 'approval', name: travel ? 'Trip review · 行程审核' : 'Manager review · 主管审核', assigneeId: 'bob' },
    { id: travel ? 'budget' : 'finance', type: 'approval', name: travel ? 'Budget review · 预算复核' : 'Finance review · 财务复核', assigneeId: 'carol' },
    { id: 'end', type: 'end', name: 'Completed', assigneeId: null },
  ] }
  return backend(request, 'alice', `${base}/process`, { expectedVersion: initial.version, definition })
}
async function publishLater(request, base, published) {
  return backend(request, 'alice', `${base}/process`, { expectedVersion: published.version, definition: {
    ...published, name: `Future ${published.id} process`,
    nodes: [published.nodes[0], { ...published.nodes[1], assigneeId: 'carol' }, { ...published.nodes[2], assigneeId: 'bob' }, published.nodes[3]],
  } })
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
async function openScenario(page, type = 'travel') {
  await page.getByTestId('catalog-tab').click()
  await page.getByTestId(`open-${type}`).click()
  // Catalog restores each scope's previous tab; this helper explicitly opens
  // its form before exercising retained form data or navigating to a worklist.
  await page.getByTestId('new-tab').click()
  await expect(page.locator(`#${type}-title`)).toBeEnabled()
  await expect(page.getByTestId('scenario-refresh')).toBeEnabled()
  await expect(page.locator(`#${type === 'travel' ? 'expense' : 'travel'}-title`)).toHaveCount(0)
  await expect(page.locator('input[type=password]')).toHaveCount(0)
}
async function switchUser(page, user) {
  await page.setViewportSize(DESKTOP); await language(page, 'en')
  await page.getByTestId('scenario-logout').click(); await login(page, user); await openScenario(page)
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
  // Original browser PNG bytes only: full page on desktop, full viewport on
  // mobile. No cropping, resizing, retouching, uploads or publication.
  const image = await page.screenshot({ fullPage: !mobile, animations: 'disabled' })
  const directory = `capture-travel-${CAPTURE_SESSION}`
  const imagePath = testInfo.outputPath(directory, `${name}.png`)
  const evidence = {
    schemaVersion: 1, sourceRevision: SOURCE_REVISION, scenario: 'oa-travel',
    state: name.replace(/^travel-\d+-/, '').replace(/-(?:zh|en)-(?:desktop|390)$/, ''),
    name, locale, viewport, fullPage: !mobile, image: `${name}.png`,
    imageSHA256: createHash('sha256').update(image).digest('hex'),
    capturedAt: new Date().toISOString(), captureSessionId: CAPTURE_SESSION,
    captureRunId: GITHUB_RUN?.id || `local-${CAPTURE_SESSION}`,
    captureRunAttempt: GITHUB_RUN?.attempt || null,
    captureRunUrl: GITHUB_RUN ? `https://github.com/${GITHUB_RUN.repository}/actions/runs/${GITHUB_RUN.id}` : null,
  }
  await mkdir(dirname(imagePath), { recursive: true })
  // Exclusive writes and a unique directory prohibit stale bytes/sidecars from
  // being silently presented as fresh evidence, including on CI reruns.
  await writeFile(imagePath, image, { flag: 'wx' })
  await writeFile(testInfo.outputPath(directory, `${name}.json`), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' })
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
  expect(result.ok(), `Travel UI POST ${path}: HTTP ${result.status()}`).toBe(true)
  const view = await result.json()
  await expect(page.getByTestId('scenario-refresh')).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  return view
}
const travelFields = (title = TITLE, businessId = 'TRAVEL-SHOWCASE-2026') => ({
  businessId, title, reason: 'Synthetic project workshop and customer handover. / 仅合成数据：项目研讨与客户交接。',
  destination: 'Shanghai · 上海', startDate: '2026-10-19', endDate: '2026-10-21', estimatedCost: '2480.50',
})
async function fillTravel(page, title = TITLE, businessId = 'TRAVEL-SHOWCASE-2026') {
  await page.getByTestId('new-tab').click()
  for (const [field, value] of Object.entries(travelFields(title, businessId))) await page.locator(`#travel-${field}`).fill(value)
  await page.locator('#travel-costCenter').selectOption('ENGINEERING')
  await page.locator('#travel-currency').selectOption('CNY')
  await page.locator('#travel-purpose').selectOption('PROJECT_DELIVERY')
}
async function fillExpense(page, title) {
  await page.getByTestId('new-tab').click()
  for (const [field, value] of Object.entries({ businessId: 'EXP-ISOLATED-RETRY-2026', title, reason: 'Synthetic workshop supplies. / 仅合成数据：项目研讨用品。' })) await page.locator(`#expense-${field}`).fill(value)
  await page.locator('#expense-costCenter').selectOption('ENGINEERING')
  await page.locator('#expense-currency').selectOption('CNY')
  for (const [field, value] of Object.entries({ spentOn: '2026-10-07', description: 'Workshop materials · 研讨用品', amount: '86.40', receiptRef: 'SYNTHETIC-RETRY-001' })) await page.locator(`#expense-lines-0-${field}`).fill(value)
  await page.locator('#expense-lines-0-category').selectOption('OFFICE')
}
async function assertSavedTravel(page, locale, historyLength) {
  await expect(page.locator('.sf-detail-header')).toContainText('CNY 2,480.50')
  await expect(page.getByTestId('saved-travel-duration')).toHaveText(locale === 'zh' ? '3 天' : '3 days')
  await expect(page.locator('.sf-detail-fields')).toContainText(['Shanghai · 上海', locale === 'zh' ? '3 天' : '3 days'])
  await expect(page.locator('.sf-saved-lines')).toHaveCount(0)
  await expect(page.locator('.timeline li')).toHaveCount(historyLength)
}

test('travel scenario: real publication, exact itinerary, sequential review, bilingual scenes and 390px controls', async ({ page, request }, testInfo) => {
  test.setTimeout(180_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  const legacy = await backend(request, 'alice', '/process')
  const expenseProcess = await backend(request, 'alice', `${EXPENSE}/process`)
  const expenseRequests = await backend(request, 'alice', `${EXPENSE}/requests`)
  const seeded = await seedProcess(request, 'travel')
  const catalog = await backend(request, 'alice', '/scenarios')
  expectUnifiedCatalog(catalog)
  expect(catalog.find(entry => entry.id === 'oa-travel')).toMatchObject({ documentType: 'travel', documentVersion: 1, formVersion: 1 })

  await page.goto('/scenarios.html'); await login(page)
  await captureLocales(page, testInfo, 'travel-01-catalog', async locale => {
    await expectCatalogCards(page, catalog, locale)
  })
  await openScenario(page)
  await page.getByTestId('designer-tab').click()
  await page.getByTestId('process-name').fill('Travel approval · 项目出差审批')
  const published = await mutation(page, `${BASE}/process`, () => page.getByTestId('publish').dblclick())
  expect(published.id).toBe('oa-travel'); expect(published.version).toBe(seeded.version + 1)
  await expect(page.getByTestId('publish')).toBeDisabled()
  await captureLocales(page, testInfo, 'travel-03-designer', async locale => {
    await expect(page.locator('.designer-workbench')).toHaveAttribute('lang', locale === 'zh' ? 'zh-CN' : 'en')
    await expect(page.getByTestId('select-step')).toHaveCount(2)
    await expect(page.getByTestId('process-name')).toHaveValue(published.name)
    await expect(page.locator('.designer-workbench')).toContainText('Trip review')
    await expect(page.locator('.designer-workbench')).toContainText('Budget review')
  })

  await fillTravel(page)
  await captureLocales(page, testInfo, 'travel-02-filled-travel', async locale => {
    await expect(page.locator('#travel-title')).toHaveValue(TITLE)
    await expect(page.locator('#travel-purpose')).toHaveValue('PROJECT_DELIVERY')
    await expect(page.getByTestId('travel-duration')).toHaveText(locale === 'zh' ? '3 天' : '3 days')
    await expect(page.getByTestId('travel-total')).toHaveText('CNY 2,480.50')
    await expect(page.locator('#travel-estimatedCost')).toHaveAttribute('type', 'text')
    await expect(page.locator('.sf-line-card')).toHaveCount(0)
  })
  let documentPosts = 0
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`/api${BASE}/documents`)) documentPosts++ })
  // Invalid decimals, fractional yen and out-of-range dates must fail locally.
  await page.locator('#travel-estimatedCost').fill('2480.501'); await page.getByTestId('submit-travel').click()
  await expect(page.locator('#travel-estimatedCost')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('#travel-estimatedCost')).toBeFocused(); expect(documentPosts).toBe(0)
  await page.locator('#travel-estimatedCost').fill('2480.50'); await page.locator('#travel-currency').selectOption('JPY')
  await page.getByTestId('submit-travel').click(); await expect(page.locator('#travel-estimatedCost')).toBeFocused(); expect(documentPosts).toBe(0)
  await page.locator('#travel-estimatedCost').fill('2480')
  await expect(page.getByTestId('travel-total')).toHaveText('JPY 2,480')
  await expect(page.locator('#travel-estimatedCost')).toHaveAttribute('aria-invalid', 'false')
  await page.locator('#travel-currency').selectOption('CNY'); await page.locator('#travel-estimatedCost').fill('2480.50')
  await page.locator('#travel-endDate').fill('2026-10-18'); await page.getByTestId('submit-travel').click()
  await expect(page.locator('#travel-endDate')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('#travel-endDate')).toBeFocused(); expect(documentPosts).toBe(0)
  await page.locator('#travel-estimatedCost').fill('2480.501'); await page.getByTestId('submit-travel').click()
  await captureLocales(page, testInfo, 'travel-10-validation-errors', async locale => {
    await expect(page.locator('#travel-endDate')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('#travel-estimatedCost')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('#travel-endDate-error')).toContainText(locale === 'zh' ? '1–90 天' : '1–90 days')
    await expect(page.locator('#travel-estimatedCost-error')).toContainText(locale === 'zh' ? '最多两位小数' : 'up to 2 decimals')
    await expect(page.getByTestId('travel-duration')).toHaveText('—')
    await expect(page.getByTestId('travel-total')).toHaveText('—')
    expect(documentPosts).toBe(0)
  })
  await page.locator('#travel-estimatedCost').fill('2480.50')
  await page.locator('#travel-startDate').fill('2026-01-01'); await page.locator('#travel-endDate').fill('2026-03-31')
  await expect(page.getByTestId('travel-duration')).toHaveText('90 days')
  await page.locator('#travel-endDate').fill('2026-04-01'); await page.getByTestId('submit-travel').click()
  await expect(page.locator('#travel-endDate')).toBeFocused(); expect(documentPosts).toBe(0)
  await page.locator('#travel-startDate').fill('2026-10-19'); await page.locator('#travel-endDate').fill('2026-10-19')
  await expect(page.getByTestId('travel-duration')).toHaveText('1 day')
  await page.locator('#travel-endDate').fill('2026-10-21')
  const created = await mutation(page, `${BASE}/documents`, () => page.getByTestId('submit-travel').dblclick())
  expect(documentPosts).toBe(1)
  expect(created.total).toBe('2480.50')
  expect(created.request).toMatchObject({ status: 'PENDING', processId: 'oa-travel', processVersion: published.version, currentStepId: 'tripReview', approverId: 'bob', applicantId: 'alice', days: 0 })
  expect(created.request.business).toEqual({ ...travelFields(), type: 'travel', documentVersion: 1, estimatedCost: 2480.5, currency: 'CNY', costCenter: 'ENGINEERING', purpose: 'PROJECT_DELIVERY' })
  await expect(page.getByTestId('approve-travel')).toHaveCount(0)
  await captureLocales(page, testInfo, 'travel-04-request-detail-pending', async locale => {
    await expect(page.locator('.sf-detail-header h2')).toHaveText(TITLE)
    await expect(page.locator('.sf-detail-header .sf-status')).toHaveText(locale === 'zh' ? '审批中' : 'Pending')
    await assertSavedTravel(page, locale, 1)
  })

  // A later travel publication changes only future travel requests.
  const later = await publishLater(request, BASE, published)
  const saved = (await backend(request, 'alice', `${BASE}/requests`)).find(view => view.request.id === created.request.id)
  expect(saved).toEqual(created); expect(later.version).toBe(created.request.processVersion + 1)
  expect(await backend(request, 'alice', `${EXPENSE}/process`)).toEqual(expenseProcess)
  expect(await backend(request, 'alice', `${EXPENSE}/requests`)).toEqual(expenseRequests)
  expect(await backend(request, 'alice', '/process')).toEqual(legacy)

  await switchUser(page, 'carol'); await page.getByTestId('review-tab').click()
  await expect(page.locator('.sf-request-item').filter({ has: page.getByText(TITLE, { exact: true }) })).toHaveCount(0)
  await page.getByTestId('designer-tab').click(); await expect(page.getByTestId('publish')).toHaveCount(0)
  await switchUser(page, 'bob'); await page.getByTestId('review-tab').click(); await select(page)
  await page.locator('#scenario-comment').fill('Itinerary and purpose verified. / 已核对行程与用途。')
  await captureLocales(page, testInfo, 'travel-05-review-pending', async locale => {
    await expect(page.getByTestId('approve-travel')).toBeEnabled(); await expect(page.getByTestId('reject-travel')).toBeEnabled()
    await expect(page.locator('.sf-snapshot-flow li.current')).toContainText('Trip review')
    await assertSavedTravel(page, locale, 1)
  })
  await page.setViewportSize(MOBILE)
  for (const locale of ['zh', 'en']) {
    await language(page, locale); await noOverflow(page)
    await touchControl(page.locator('#scenario-comment')); await touchControl(page.getByTestId('approve-travel')); await touchControl(page.getByTestId('reject-travel'))
    await capture(page, testInfo, `travel-06-review-pending-${locale}-390`, true)
  }
  await page.setViewportSize(DESKTOP); await language(page, 'en')
  let decisionPosts = 0
  const decisionRoute = `**/api${BASE}/requests/${created.request.id}/decisions`
  await page.route(decisionRoute, async route => { decisionPosts++; await new Promise(resolve => setTimeout(resolve, 100)); await route.continue() })
  const first = await mutation(page, `${BASE}/requests/${created.request.id}/decisions`, () => page.getByTestId('approve-travel').dblclick())
  expect(decisionPosts).toBe(1); expect(first.request.currentStepId).toBe('budget')
  expect(first.request.status).toBe('PENDING'); expect(first.request.history).toHaveLength(2)
  expect(first.request.business).toEqual(created.request.business); expect(first.request.definition).toEqual(created.request.definition)
  await page.unroute(decisionRoute)
  await expect(page.getByTestId('approve-travel')).toHaveCount(0)
  await page.getByTestId('handled-tab').click(); await select(page); await expect(page.locator('.timeline li')).toHaveCount(2)

  await switchUser(page, 'carol'); await page.getByTestId('review-tab').click(); await select(page)
  await page.locator('#scenario-comment').fill('Budget confirmed. / 已确认预算。')
  await captureLocales(page, testInfo, 'travel-07-review-next', async locale => {
    await expect(page.getByTestId('approve-travel')).toBeEnabled()
    await expect(page.locator('.sf-snapshot-flow li.current')).toContainText('Budget review')
    await expect(page.locator('.sf-snapshot-flow li.approved')).toContainText('Trip review')
    await expect(page.locator('.timeline')).toContainText('Itinerary and purpose verified.')
    await assertSavedTravel(page, locale, 2)
  })
  const completed = await mutation(page, `${BASE}/requests/${created.request.id}/decisions`, () => page.getByTestId('approve-travel').click())
  expect(completed.request.status).toBe('APPROVED'); expect(completed.request.currentStepId).toBeNull()
  expect(completed.request.history).toHaveLength(3)
  expect(completed.request.business).toEqual(created.request.business); expect(completed.request.definition).toEqual(created.request.definition)
  await expect(page.getByTestId('approve-travel')).toHaveCount(0)
  await page.reload(); await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')
  await login(page); await openScenario(page); await page.getByTestId('mine-tab').click(); await select(page)
  await captureLocales(page, testInfo, 'travel-08-request-detail-approved', async locale => {
    await expect(page.locator('.sf-detail-header .sf-status')).toHaveText(locale === 'zh' ? '已通过' : 'Approved')
    await expect(page.getByTestId('approve-travel')).toHaveCount(0)
    await assertSavedTravel(page, locale, 3)
  })
  expect((await backend(request, 'alice', `${BASE}/requests`)).find(view => view.request.id === created.request.id)).toEqual(completed)

  const rejectedTitle = 'Revised itinerary needed · 出差申请驳回'
  const rejectCandidate = await backend(request, 'alice', `${BASE}/documents`, {
    business: { ...created.request.business, businessId: 'TRAVEL-REJECTION-2026', title: rejectedTitle }, processVersion: later.version,
  }, `travel-reject-${randomUUID()}`)
  expect(rejectCandidate.request.currentStepId).toBe('tripReview'); expect(rejectCandidate.request.approverId).toBe('carol')
  await switchUser(page, 'carol'); await page.getByTestId('review-tab').click(); await select(page, rejectedTitle)
  await page.locator('#scenario-comment').fill('Please revise the itinerary. / 请调整出差行程。')
  const rejected = await mutation(page, `${BASE}/requests/${rejectCandidate.request.id}/decisions`, () => page.getByTestId('reject-travel').click())
  expect(rejected.request.status).toBe('REJECTED'); expect(rejected.request.currentStepId).toBeNull()
  expect(rejected.request.history).toHaveLength(2)
  expect(rejected.request.business).toEqual(rejectCandidate.request.business); expect(rejected.request.definition).toEqual(rejectCandidate.request.definition)
  await expect(page.getByTestId('approve-travel')).toHaveCount(0); await expect(page.getByTestId('reject-travel')).toHaveCount(0)
  await page.reload(); await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')
  await login(page); await openScenario(page); await page.getByTestId('mine-tab').click(); await select(page, rejectedTitle)
  expect((await backend(request, 'alice', `${BASE}/requests`)).find(view => view.request.id === rejectCandidate.request.id)).toEqual(rejected)
  await captureLocales(page, testInfo, 'travel-09-request-detail-rejected', async locale => {
    await expect(page.locator('.sf-detail-header .sf-status')).toHaveText(locale === 'zh' ? '已驳回' : 'Rejected')
    await expect(page.getByTestId('approve-travel')).toHaveCount(0); await expect(page.getByTestId('reject-travel')).toHaveCount(0)
    await expect(page.locator('.timeline')).toContainText('Please revise the itinerary.')
    await assertSavedTravel(page, locale, 2)
  })
  expect(await backend(request, 'alice', `${EXPENSE}/process`)).toEqual(expenseProcess)
  expect(await backend(request, 'alice', `${EXPENSE}/requests`)).toEqual(expenseRequests)
  expect(await backend(request, 'alice', '/process')).toEqual(legacy)
  expect(errors).toEqual([])
})

async function loseFirstSubmission(page, type) {
  const record = { attempts: [], saved: null, failure: null }
  await page.route(`**/api/scenarios/oa-${type}/documents`, async route => {
    const request = route.request()
    if (request.method() !== 'POST') return route.continue()
    // Retain only synthetic payload and idempotency identity, never headers or
    // the request object itself (which also contains disposable credentials).
    record.attempts.push({ key: request.headers()['idempotency-key'], payload: request.postDataJSON() })
    if (record.attempts.length !== 1) return route.continue()
    try {
      const response = await route.fetch({ timeout: TIMEOUT, maxRetries: 0, maxRedirects: 0 })
      if (!response.ok()) record.failure = `Real ${type} save returned HTTP ${response.status()}`
      else record.saved = await response.json()
    } catch {
      record.failure = `Real ${type} save transport failed; private request details omitted`
    }
    // The server has genuinely processed the POST. Only the browser's delivery
    // is interrupted. There is deliberately no fulfilled successful response.
    await route.abort('failed')
  })
  return record
}
async function submitLost(page, type, record) {
  await page.getByTestId(`submit-${type}`).click()
  await expect(page.getByRole('alert')).toContainText('Submission was not confirmed')
  await expect(page.getByTestId(`submit-${type}`)).toContainText('Retry original request')
  expect(record.failure).toBeNull(); expect(record.saved).not.toBeNull()
  expect(record.attempts).toHaveLength(1)
  expect(record.attempts[0].key).toEqual(expect.any(String)); expect(record.attempts[0].key.length).toBeGreaterThan(0)
}
async function assertDraft(page, name) {
  await page.getByTestId('designer-tab').click()
  await expect(page.getByTestId('process-name')).toHaveValue(name)
}

test('travel and expense: one session preserves typed form/designer drafts and each unresolved original key/process retry', async ({ page, request }) => {
  test.setTimeout(150_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  const legacy = await backend(request, 'alice', '/process')
  const travelProcess = await seedProcess(request, 'travel'), expenseProcess = await seedProcess(request, 'expense')
  const travelTitle = 'Travel retry retained · 出差重试保留', expenseTitle = 'Expense retry retained · 报销重试保留'
  const travelDraft = 'Unpublished travel process · 未发布出差草稿', expenseDraft = 'Unpublished expense process · 未发布报销草稿'
  await page.goto('/scenarios.html'); await login(page)
  await openScenario(page, 'expense'); await fillExpense(page, expenseTitle)
  await page.getByTestId('designer-tab').click(); await page.getByTestId('process-name').fill(expenseDraft)
  await openScenario(page); await fillTravel(page, travelTitle, 'TRAVEL-ISOLATED-RETRY-2026')
  await page.getByTestId('designer-tab').click(); await page.getByTestId('process-name').fill(travelDraft)
  for (const locale of ['zh', 'en']) {
    await language(page, locale)
    await openScenario(page, 'expense')
    await expect(page.locator('#expense-title')).toHaveValue(expenseTitle)
    await expect(page.locator('#expense-lines-0-amount')).toHaveValue('86.40')
    await assertDraft(page, expenseDraft)
    await page.getByTestId('undo').click(); await expect(page.getByTestId('process-name')).toHaveValue(expenseProcess.name)
    await page.getByTestId('redo').click(); await expect(page.getByTestId('process-name')).toHaveValue(expenseDraft)
    await openScenario(page)
    await expect(page.locator('#travel-title')).toHaveValue(travelTitle)
    await expect(page.locator('#travel-destination')).toHaveValue('Shanghai · 上海')
    await assertDraft(page, travelDraft)
    await page.getByTestId('undo').click(); await expect(page.getByTestId('process-name')).toHaveValue(travelProcess.name)
    await page.getByTestId('redo').click(); await expect(page.getByTestId('process-name')).toHaveValue(travelDraft)
  }
  await page.getByTestId('new-tab').click()
  const travelLost = await loseFirstSubmission(page, 'travel'); await submitLost(page, 'travel', travelLost)
  expect(travelLost.saved.request.processId).toBe('oa-travel')
  expect(travelLost.saved.request.processVersion).toBe(travelProcess.version)
  expect(travelLost.saved.request.definition).toEqual(travelProcess)
  await openScenario(page, 'expense')
  await expect(page.getByTestId('submit-expense')).not.toContainText('Retry original request')
  await expect(page.locator('#expense-title')).toHaveValue(expenseTitle)
  const expenseLost = await loseFirstSubmission(page, 'expense'); await submitLost(page, 'expense', expenseLost)
  expect(expenseLost.saved.request.processId).toBe('oa-expense')
  expect(expenseLost.saved.request.processVersion).toBe(expenseProcess.version)
  expect(expenseLost.saved.request.definition).toEqual(expenseProcess)
  expect(expenseLost.attempts[0].key).not.toBe(travelLost.attempts[0].key)
  expect(expenseLost.saved.request.id).not.toBe(travelLost.saved.request.id)

  // Both saves happened despite lost responses. Publish genuinely newer routes,
  // then refresh each workspace; neither retry may inherit the newer process.
  const laterTravel = await publishLater(request, BASE, travelProcess)
  const laterExpense = await publishLater(request, EXPENSE, expenseProcess)
  await openScenario(page); await page.getByTestId('scenario-refresh').click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByTestId('scenario-refresh')).toBeEnabled()
  await expect(page.locator('#travel-title')).toHaveValue(travelTitle)
  await expect(page.getByTestId('submit-travel')).toContainText('Retry original request')
  await expect(page.locator('.sf-context-note strong')).toContainText(`v${travelProcess.version}`)
  await assertDraft(page, travelDraft); await expect(page.getByTestId('stale-draft')).toBeVisible()
  await page.getByTestId('new-tab').click()
  const retriedTravel = await mutation(page, `${BASE}/documents`, () => page.getByTestId('submit-travel').click())
  expect(travelLost.attempts).toHaveLength(2); expect(travelLost.attempts[1]).toEqual(travelLost.attempts[0])
  expect(retriedTravel).toEqual(travelLost.saved)
  await expect(page.locator('.sf-request-item').filter({ has: page.getByText(expenseTitle, { exact: true }) })).toHaveCount(0)
  await page.getByTestId('new-tab').click(); await expect(page.locator('#travel-title')).toHaveValue('')
  await assertDraft(page, travelDraft)

  // Travel success clears only Travel. Expense still holds its complete form,
  // its own dirty designer and its original unresolved key/definition.
  await openScenario(page, 'expense')
  await expect(page.locator('#expense-title')).toHaveValue(expenseTitle)
  await expect(page.locator('#expense-lines-0-amount')).toHaveValue('86.40')
  await expect(page.getByTestId('submit-expense')).toContainText('Retry original request')
  await page.getByTestId('scenario-refresh').click(); await expect(page.getByTestId('scenario-refresh')).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.locator('.sf-context-note strong')).toContainText(`v${expenseProcess.version}`)
  await assertDraft(page, expenseDraft); await expect(page.getByTestId('stale-draft')).toBeVisible()
  await page.getByTestId('new-tab').click()
  const retriedExpense = await mutation(page, `${EXPENSE}/documents`, () => page.getByTestId('submit-expense').click())
  expect(expenseLost.attempts).toHaveLength(2); expect(expenseLost.attempts[1]).toEqual(expenseLost.attempts[0])
  expect(retriedExpense).toEqual(expenseLost.saved)
  await expect(page.locator('.sf-request-item').filter({ has: page.getByText(travelTitle, { exact: true }) })).toHaveCount(0)
  await page.getByTestId('new-tab').click(); await expect(page.locator('#expense-title')).toHaveValue('')
  await assertDraft(page, expenseDraft)
  await openScenario(page); await expect(page.locator('#travel-title')).toHaveValue(''); await assertDraft(page, travelDraft)

  const travelSaved = await backend(request, 'alice', `${BASE}/requests`), expenseSaved = await backend(request, 'alice', `${EXPENSE}/requests`)
  expect(travelSaved.filter(view => view.request.title === travelTitle)).toEqual([retriedTravel])
  expect(expenseSaved.filter(view => view.request.title === expenseTitle)).toEqual([retriedExpense])
  expect(travelSaved.every(view => view.request.processId === 'oa-travel' && view.request.business.type === 'travel')).toBe(true)
  expect(expenseSaved.every(view => view.request.processId === 'oa-expense' && view.request.business.type === 'expense')).toBe(true)
  expect(await backend(request, 'alice', `${BASE}/process`)).toEqual(laterTravel)
  expect(await backend(request, 'alice', `${EXPENSE}/process`)).toEqual(laterExpense)
  expect(await backend(request, 'alice', '/process')).toEqual(legacy)

  // Bob reviews the genuinely persisted original routes, despite newer
  // publications. Navigate through rendered catalog buttons so unsent comments
  // and selection are exercised through the same path as a real reviewer.
  let reviewerDecisionPosts = 0
  page.on('request', outgoing => {
    if (outgoing.method() === 'POST' && /\/api\/scenarios\/oa-(?:travel|expense)\/requests\/[^/]+\/decisions$/.test(outgoing.url())) reviewerDecisionPosts++
  })
  await switchUser(page, 'bob')
  const reviewerNotes = { travel: 'Travel review in progress · 出差审核草稿', expense: 'Expense review in progress · 报销审核草稿' }
  const reviewerTitles = { travel: travelTitle, expense: expenseTitle }
  for (const type of ['travel', 'expense']) {
    await openScenario(page, type); await page.getByTestId('review-tab').click(); await select(page, reviewerTitles[type])
    await page.locator('#scenario-comment').fill(reviewerNotes[type])
  }
  for (const locale of ['zh', 'en']) {
    await language(page, locale)
    for (const type of ['travel', 'expense']) {
      await openScenario(page, type); await page.getByTestId('review-tab').click()
      await expect(page.locator('.sf-detail-header h2')).toHaveText(reviewerTitles[type])
      await expect(page.locator('.sf-request-item[aria-pressed="true"]')).toContainText(reviewerTitles[type])
      await expect(page.locator('#scenario-comment')).toHaveValue(reviewerNotes[type])
      await expect(page.getByTestId(`approve-${type}`)).toBeEnabled()
      await expect(page.locator('input[type=password]')).toHaveCount(0)
    }
  }
  expect(reviewerDecisionPosts).toBe(0)
  expect(errors).toEqual([])
})
