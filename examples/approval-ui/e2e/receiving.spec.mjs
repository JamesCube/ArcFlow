import { test, expect } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { readSourceProvenance } from './receiving-evidence.mjs'

const DESKTOP = { width: 1440, height: 1000 }, MOBILE = { width: 390, height: 844 }
const BASE = '/api/scenarios/erp-receiving', INSPECTION = 'receiving-inspection', PROCUREMENT = 'procurement-review'
const captureEnabled = process.env.ARCFLOW_CAPTURE_RECEIVING === '1'
const TIMEOUT = 15_000
// Successful saves always come from the real backend. The sole failure
// injection discards one genuine saved response to exercise manual retry.
// Screenshot capture is opt-in and never includes login, traces or HARs.
test.use({ locale: 'en-GB', timezoneId: 'UTC', reducedMotion: 'reduce', actionTimeout: TIMEOUT, navigationTimeout: TIMEOUT, trace: 'off', video: 'off', screenshot: 'off' })
async function backendRead(request, path) {
  const password = process.env.APPROVAL_ALICE_PASSWORD
  if (!password) throw new Error('Missing disposable Alice password')
  let response
  try { response = await request.get(`http://127.0.0.1:8080/api${path}`, { timeout: TIMEOUT, headers: { Authorization: `Basic ${Buffer.from(`alice:${password}`).toString('base64')}`, 'X-Arcflow-Client': 'approval-demo' } }) }
  catch { throw new Error(`Read-only namespace check ${path} failed; private transport details omitted`) }
  expect(response.ok(), `Read-only namespace check ${path}: HTTP ${response.status()}`).toBe(true)
  return response.json()
}
async function login(page, actor = 'alice') {
  await page.getByLabel('Demo account').selectOption(actor)
  const password = process.env[`APPROVAL_${actor.toUpperCase()}_PASSWORD`]
  if (!password) throw new Error(`Disposable ${actor} password missing`)
  try { await page.getByLabel('Password', { exact: true }).fill(password) }
  catch { throw new Error('Could not enter disposable credential; private input details omitted') }
  await page.getByRole('button', { name: 'Open workspace', exact: false }).click()
  await expect(page.locator('.rf-shell')).toBeVisible(); await expect(page.locator('input[type=password]')).toHaveCount(0)
}
async function language(page, value) {
  await page.locator('.sf-topbar').getByLabel('Language / 语言', { exact: true }).selectOption(value)
  await expect(page.locator('.rf-shell')).toHaveAttribute('lang', value === 'zh' ? 'zh-CN' : 'en')
}
async function switchUser(page, actor) {
  await page.setViewportSize(DESKTOP); await language(page, 'en'); await page.getByTestId('receiving-logout').click(); await login(page, actor)
}
async function selectReceipt(page, title) {
  await page.locator('.sf-request-item').filter({ has: page.getByText(title, { exact: true }) }).click()
  await expect(page.locator('.sf-detail-header h2')).toHaveText(title)
}
async function fillReceipt(page, title, reference) {
  await page.getByTestId('new-tab').click(); await page.getByTestId('fill-receiving-sample').click()
  await page.locator('#receiving-title').fill(title); await page.locator('#receiving-businessId').fill(reference)
}
async function savedMutation(page, path, act) {
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'POST')
  await act(); const response = await responsePromise
  expect(response.ok(), `Real receiving mutation ${path}: HTTP ${response.status()}`).toBe(true)
  const result = await response.json()
  await expect(page.locator('.sf-content>.notice')).toBeVisible()
  return result
}
async function submitReceipt(page) {
  const view = await savedMutation(page, `${BASE}/documents`, () => page.getByTestId('submit-receiving').click())
  await expect(page.locator('.sf-content>.notice')).toContainText('Receipt saved')
  expect(view.request.processId).toBe('erp-receiving'); expect(view.request.business.type).toBe('receiving'); expect(view.total).toBeNull()
  return view
}
async function vote(page, view, actor, decision, comment) {
  await page.locator('#scenario-comment').fill(comment)
  const updated = await savedMutation(page, `${BASE}/requests/${view.request.id}/decisions`, () => page.getByTestId(decision === 'APPROVE' ? 'approve-receiving' : 'reject-receiving').click())
  expect(updated.request.history.at(-1)).toMatchObject({ actorId: actor, action: decision, stepId: view.request.currentStepId, comment })
  return updated
}
const inspection = page => page.locator('.sf-snapshot-flow>li').first()
const procurement = page => page.locator('.sf-snapshot-flow>li').nth(1)
const participant = (page, name) => inspection(page).locator('.sf-vote').filter({ has: page.getByText(name, { exact: true }) })
async function noOverflow(page) {
  const size = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
  expect(size.document, 'Document fits viewport').toBeLessThanOrEqual(size.width); expect(size.body, 'Body fits viewport').toBeLessThanOrEqual(size.width)
}
async function touchControl(locator) {
  await expect(locator).toBeVisible()
  const box = await locator.evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, height: rect.height, font: parseFloat(getComputedStyle(element).fontSize), width: innerWidth } })
  expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(box.width)
  expect(box.height).toBeGreaterThanOrEqual(44); expect(box.font).toBeGreaterThanOrEqual(14)
}
async function capture(page, info, name, provenance) {
  await expect(page.locator('.rf-shell')).toBeVisible(); await expect(page.locator('input[type=password]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => { scrollTo({ top: 0, behavior: 'instant' }); return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
  await noOverflow(page)
  if (!captureEnabled) return
  const image = await page.screenshot({ fullPage: true, animations: 'disabled' })
  await writeFile(info.outputPath(`${name}.png`), image)
  await writeFile(info.outputPath(`${name}.json`), JSON.stringify({ schemaVersion: 1, ...provenance, scenario: 'erp-receiving', state: name, capturedAt: new Date().toISOString(), viewport: page.viewportSize(), locale: await page.locator('.rf-shell').getAttribute('lang'), fullPage: true, image: `${name}.png`, imageSHA256: createHash('sha256').update(image).digest('hex'), retry: info.retry }, null, 2))
}

test('receiving: real ALL→ANY publication, immutable ALL votes, repeated Bob, rejection, retry and bilingual 390px evidence', async ({ page, request }, info) => {
  test.setTimeout(240_000)
  const provenance = readSourceProvenance(process.env, captureEnabled)
  const suffix = randomUUID().slice(0, 8), allTitle = `ALL receiving ${suffix}`, rejectedTitle = `Rejected receiving ${suffix}`, anyTitle = `ANY receiving ${suffix}`
  const originalMain = await backendRead(request, '/process'), originalExpense = await backendRead(request, '/scenarios/oa-expense/process')
  const errors = [], mutationPaths = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.method() === 'POST') mutationPaths.push(new URL(request.url()).pathname) })
  await page.goto('/receiving.html'); await login(page)
  await page.getByTestId('designer-tab').click(); await page.getByTestId('select-step').first().click()
  await expect(page.getByLabel('Step 1 review mode', { exact: true })).toHaveValue('ALL')
  await expect(page.getByLabel('Step 1 participant Bob', { exact: true })).toBeChecked()
  await expect(page.getByLabel('Step 1 participant Carol', { exact: true })).toBeChecked()
  await fillReceipt(page, allTitle, `GRN-ALL-${suffix}`)
  await expect(page.getByTestId('receiving-summary')).toContainText('PCS'); await expect(page.getByTestId('receiving-summary')).toContainText('BOX')
  await capture(page, info, '01-form-en-desktop', provenance)
  await language(page, 'zh'); await capture(page, info, '02-form-zh-desktop', provenance)
  await page.setViewportSize(MOBILE); await capture(page, info, '03-form-zh-390', provenance)
  await page.setViewportSize(DESKTOP); await language(page, 'en')
  await page.locator('#receiving-lines-0-accepted').fill('77'); await page.getByTestId('submit-receiving').click()
  await expect(page.locator('#receiving-lines-0-accepted')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('#receiving-lines-0-accepted-error')).toContainText('must equal received')
  expect(mutationPaths).toEqual([])
  await capture(page, info, '04-quantity-error-en-desktop', provenance)
  await page.setViewportSize(MOBILE); await language(page, 'zh'); await capture(page, info, '05-quantity-error-zh-390', provenance)
  await page.setViewportSize(DESKTOP); await language(page, 'en'); await page.locator('#receiving-lines-0-accepted').fill('78')
  let lost = false, lostSavedId
  const submissionKeys = []
  await page.route(`**${BASE}/documents`, async route => {
    if (route.request().method() !== 'POST') return route.continue()
    submissionKeys.push(route.request().headers()['idempotency-key'])
    if (!lost) {
      lost = true
      let saved
      try { saved = await route.fetch() } catch { throw new Error('Injected-loss backend call failed; private request details omitted') }
      expect(saved.ok()).toBe(true); lostSavedId = (await saved.json()).request.id
      await route.abort('failed')
    } else await route.continue()
  })
  await page.getByTestId('submit-receiving').click()
  await expect(page.getByTestId('submit-receiving')).toContainText('Retry original receipt')
  await expect(page.locator('.sf-alert')).toContainText('Submission was not confirmed')
  let allView = await submitReceipt(page)
  await page.unroute(`**${BASE}/documents`)
  expect(allView.request.id).toBe(lostSavedId); expect(submissionKeys).toHaveLength(2); expect(submissionKeys[0]).toBeTruthy(); expect(submissionKeys[1]).toBe(submissionKeys[0])
  expect(allView.request.definition.nodes[1].completionMode).toBe('ALL')
  await expect(page.locator('.sf-request-item').filter({ has: page.getByText(allTitle, { exact: true }) })).toHaveCount(1)
  const allVersion = allView.request.processVersion
  await fillReceipt(page, rejectedTitle, `GRN-REJECT-${suffix}`); let rejectedView = await submitReceipt(page)
  expect(rejectedView.request.processVersion).toBe(allVersion)

  // The real designer changes an execution rule, not just a process label.
  await page.getByTestId('designer-tab').click(); await page.getByTestId('select-step').first().click()
  await page.getByLabel('Step 1 review mode', { exact: true }).selectOption('ANY')
  await expect(page.locator('.step-inspector .group-rule')).toContainText('ANY: one approval completes this group.')
  await expect(page.getByTestId('publish')).toBeEnabled()
  const published = await savedMutation(page, `${BASE}/process`, () => page.getByTestId('publish').click())
  expect(published.id).toBe('erp-receiving'); expect(published.version).toBe(allVersion + 1)
  expect(published.nodes[1]).toMatchObject({ id: INSPECTION, type: 'parallelApproval', assigneeIds: ['bob', 'carol'], completionMode: 'ANY' })
  expect(published.nodes[2]).toMatchObject({ id: PROCUREMENT, assigneeId: 'bob' })
  await expect(page.getByTestId('publish')).toBeDisabled(); await expect(page.getByLabel('Step 1 review mode', { exact: true })).toHaveValue('ANY')
  await capture(page, info, '06-published-any-designer-en-desktop', provenance)
  await language(page, 'zh'); await page.setViewportSize(MOBILE); await page.locator('.mobile-designer-switch button').nth(1).click()
  await capture(page, info, '07-published-any-designer-zh-390', provenance)
  await page.setViewportSize(DESKTOP); await language(page, 'en')
  await page.getByTestId('mine-tab').click(); await selectReceipt(page, allTitle)
  await expect(page.locator('.sf-detail-section h3').filter({ hasText: 'Approval snapshot' }).locator('small')).toHaveText(`v${allVersion}`)
  await expect(inspection(page).locator('.sf-group-rule')).toContainText('ALL: everyone must approve')
  await capture(page, info, '08-immutable-all-snapshot-en-desktop', provenance)
  await fillReceipt(page, anyTitle, `GRN-ANY-${suffix}`); let anyView = await submitReceipt(page)
  expect(anyView.request.processVersion).toBe(published.version); expect(anyView.request.definition.nodes[1].completionMode).toBe('ANY')

  await switchUser(page, 'bob'); await selectReceipt(page, allTitle)
  allView = await vote(page, allView, 'bob', 'APPROVE', 'Warehouse counted 80 pieces and 10 boxes.')
  expect(allView.request.currentStepId).toBe(INSPECTION); expect(allView.request.status).toBe('PENDING')
  await expect(page.getByTestId('approve-receiving')).toHaveCount(0)
  await expect(participant(page, 'Bob')).toContainText('Approved'); await expect(participant(page, 'Carol')).toContainText('Awaiting vote')
  await expect(procurement(page)).toHaveClass('upcoming')
  await capture(page, info, '09-all-partial-bob-vote-en-desktop', provenance)
  await switchUser(page, 'carol'); await selectReceipt(page, allTitle)
  await page.setViewportSize(MOBILE); await language(page, 'zh')
  await touchControl(page.getByTestId('approve-receiving')); await touchControl(page.getByTestId('reject-receiving'))
  await capture(page, info, '10-all-quality-review-zh-390', provenance)
  allView = await vote(page, allView, 'carol', 'APPROVE', 'Two bent brackets recorded in the exception note.')
  expect(allView.request.currentStepId).toBe(PROCUREMENT)
  await switchUser(page, 'bob'); await selectReceipt(page, allTitle)
  await expect(procurement(page)).toHaveClass('current'); await expect(inspection(page)).toHaveClass('approved')
  await expect(page.getByTestId('approve-receiving')).toBeVisible()
  await capture(page, info, '11-bob-procurement-review-en-desktop', provenance)
  allView = await vote(page, allView, 'bob', 'APPROVE', 'Procurement reviewed the quantity exceptions.')
  expect(allView.request.status).toBe('APPROVED'); expect(allView.request.history).toHaveLength(4)
  await expect(page.locator('.sf-detail-header .sf-status')).toHaveText('Approved'); await expect(page.locator('.timeline li')).toHaveCount(4)
  await capture(page, info, '12-all-approved-en-desktop', provenance)

  await switchUser(page, 'carol'); await selectReceipt(page, rejectedTitle)
  rejectedView = await vote(page, rejectedView, 'carol', 'REJECT', 'Rejected after quality inspection.')
  expect(rejectedView.request.status).toBe('REJECTED'); expect(rejectedView.request.currentStepId).toBeNull()
  await expect(procurement(page)).toHaveClass('skipped'); await expect(page.getByTestId('approve-receiving')).toHaveCount(0)
  await language(page, 'zh'); await expect(page.locator('.sf-detail-header .sf-status')).toHaveText('已驳回')
  await capture(page, info, '13-all-rejected-zh-desktop', provenance)

  // The new ANY snapshot must actually advance after only Bob's first vote.
  await switchUser(page, 'bob'); await selectReceipt(page, anyTitle)
  anyView = await vote(page, anyView, 'bob', 'APPROVE', 'ANY inspection approved by Bob.')
  expect(anyView.request.currentStepId).toBe(PROCUREMENT); expect(anyView.request.history).toHaveLength(2)
  await expect(participant(page, 'Carol')).toContainText('Not required'); await expect(procurement(page)).toHaveClass('current')
  await expect(page.getByTestId('approve-receiving')).toBeVisible()
  await capture(page, info, '14-any-early-advance-en-desktop', provenance)
  anyView = await vote(page, anyView, 'bob', 'APPROVE', 'Separate procurement review approved by Bob.')
  expect(anyView.request.status).toBe('APPROVED'); expect(anyView.request.history).toHaveLength(3)
  await page.setViewportSize(MOBILE); await language(page, 'zh'); await capture(page, info, '15-any-approved-zh-390', provenance)

  await page.reload(); await expect(page.locator('.rf-login')).toBeVisible(); await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')
  await login(page, 'alice'); await page.getByTestId('mine-tab').click(); await selectReceipt(page, allTitle)
  await expect(page.locator('.sf-detail-header .sf-status')).toHaveText('Approved')
  await expect(inspection(page).locator('.sf-group-rule')).toContainText('ALL: everyone must approve')
  expect(await backendRead(request, '/process')).toEqual(originalMain)
  expect(await backendRead(request, '/scenarios/oa-expense/process')).toEqual(originalExpense)
  expect(mutationPaths.length).toBeGreaterThan(0)
  expect(mutationPaths.every(path => path.startsWith(`${BASE}/`)), 'Receiving journey never mutates the main or expense process').toBe(true)
  expect(errors).toEqual([])
  if (captureEnabled) await writeFile(info.outputPath('receiving-acceptance.json'), JSON.stringify({ ...provenance, scenario: 'erp-receiving', result: 'passed', capturedStates: 15, allSnapshotVersion: allVersion, anySnapshotVersion: published.version, mainAndExpenseProcessesUnchanged: true, browser: info.project.name || 'chromium', completedAt: new Date().toISOString() }, null, 2))
})
