import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { paymentFixture, contractFixture } from '../src/scenarios/scenario-fixtures.js'
import { getScenarioHandler } from '../src/scenarios/scenario-registry.js'
import { expectUnifiedCatalog, expectCatalogCards } from './scenario-catalog.mjs'
import { captureComplex } from './complex-evidence.mjs'
const DESKTOP = { width: 1440, height: 1000 }, MOBILE = { width: 390, height: 844 }, TIMEOUT = 15000
const specs = [{ id: 'erp-payment', prefix: 'payment', fixture: paymentFixture }, { id: 'crm-contract', prefix: 'contract', fixture: contractFixture }]
test.use({ locale: 'en-GB', timezoneId: 'UTC', reducedMotion: 'reduce', actionTimeout: TIMEOUT, navigationTimeout: TIMEOUT })
async function api(request, user, path, data, key, expected = undefined) {
  let response
  try { response = await request.fetch(`http://127.0.0.1:8080/api${path}`, { method: data === undefined ? 'GET' : 'POST', timeout: TIMEOUT, headers: { Authorization: `Basic ${Buffer.from(`${user}:${process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`]}`).toString('base64')}`, 'Content-Type': 'application/json', 'X-Arcflow-Client': 'approval-demo', ...(key ? { 'Idempotency-Key': key } : {}) }, ...(data === undefined ? {} : { data }) }) }
  catch { throw new Error(`Complex scenario ${path}: transport failed; private request details omitted`) }
  expect(response.status(), `Complex scenario ${path}`).toBe(expected ?? (data !== undefined && path.endsWith('/documents') ? 201 : 200))
  return response.json()
}
async function seed(request, spec) {
  const initial = await api(request, 'alice', `/scenarios/${spec.id}/process`)
  expect(initial.version).toBe(1)
  expect(initial.nodes.slice(1, -1).map(node => [node.id, node.completionMode || 'SINGLE'])).toEqual(spec.prefix === 'payment' ? [['payment-check', 'ALL'], ['payment-final', 'ANY']] : [['commercial-review', 'SINGLE'], ['contract-review', 'ALL']])
  return initial
}
async function login(page, user = 'alice') {
  await page.getByLabel('Demo account').selectOption(user)
  try { await page.getByLabel('Password', { exact: true }).fill(process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`]) } catch { throw new Error('Could not fill disposable account password; private input omitted') }
  await page.getByRole('button', { name: 'Open scenario library', exact: false }).click(); await expect(page.locator('.sf-shell')).toBeVisible(); await expect(page.locator('input[type=password]')).toHaveCount(0)
}
async function language(page, locale) { await page.locator('.sf-topbar').getByLabel('Language / 语言').selectOption(locale) }
async function open(page, spec, tab = 'new') { await page.getByTestId('catalog-tab').click(); await page.getByTestId(`open-${spec.prefix}`).click(); await page.getByTestId(`${tab}-tab`).click(); await expect(page.getByTestId('scenario-refresh')).toBeEnabled() }
async function switchUser(page, user, spec, tab = 'review') { await page.setViewportSize(DESKTOP); await language(page, 'en'); await page.getByTestId('scenario-logout').click(); await login(page, user); await open(page, spec, tab) }
async function select(page, title) { await page.locator('.sf-request-item').filter({ has: page.getByText(title, { exact: true }) }).click(); await expect(page.locator('.sf-detail-header h2')).toHaveText(title) }
async function fill(page, spec, business) {
  await page.getByTestId('new-tab').click()
  for (const [field, value] of Object.entries(business)) {
    if (['type', 'documentVersion', 'lines'].includes(field)) continue
    const locator = page.locator(`#${spec.prefix}-${field}`)
    if (await locator.evaluate(element => element.tagName === 'SELECT')) await locator.selectOption(String(value)); else await locator.fill(String(value))
  }
  while (await page.locator('.xf-line-card').count() < business.lines.length) await page.getByTestId(`add-${spec.prefix}-line`).click()
  for (const [index, line] of business.lines.entries()) for (const [field, value] of Object.entries(line)) if (field !== 'lineId') await page.locator(`#${spec.prefix}-lines-${index}-${field}`).fill(String(value))
}
async function mutation(page, path, action) {
  const [response] = await Promise.all([page.waitForResponse(response => response.url().endsWith(`/api${path}`) && response.request().method() === 'POST'), action()])
  expect(response.ok(), `Complex UI POST ${path}: ${response.status()}`).toBe(true)
  const result = await response.json(); await expect(page.getByTestId('scenario-refresh')).toBeEnabled(); await expect(page.locator('.sf-alert')).toHaveCount(0); return result
}
async function fits(page) { const result = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth })); expect(result.document).toBeLessThanOrEqual(result.viewport); expect(result.body).toBeLessThanOrEqual(result.viewport) }
async function captures(page, info, spec, state, narrow = false) {
  for (const locale of ['en', 'zh']) {
    await language(page, locale); await fits(page)
    if (!narrow) await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
    await captureComplex(page, info, spec.id, state, narrow)
  }
  await language(page, 'en')
}
async function vote(page, spec, view, decision, double = false) {
  await page.locator('#scenario-comment').fill(`Synthetic ${decision.toLowerCase()} for ${view.request.currentStepId} / 合成人工审核意见`)
  const result = await mutation(page, `/scenarios/${spec.id}/requests/${view.request.id}/decisions`, () => double ? page.getByTestId(`${decision === 'APPROVE' ? 'approve' : 'reject'}-${spec.prefix}`).dblclick() : page.getByTestId(`${decision === 'APPROVE' ? 'approve' : 'reject'}-${spec.prefix}`).click())
  expect(result.request.business).toEqual(view.request.business); expect(result.request.definition).toEqual(view.request.definition)
  expect(result.request.history).toHaveLength(view.request.history.length + 1)
  return result
}
async function mobileControls(page, info, spec) {
  await page.setViewportSize(MOBILE)
  for (const locale of ['en', 'zh']) {
    await language(page, locale)
    await page.locator('.sf-decision-panel').scrollIntoViewIfNeeded(); await fits(page)
    for (const selector of ['#scenario-comment', `[data-testid=approve-${spec.prefix}]`, `[data-testid=reject-${spec.prefix}]`]) {
      const box = await page.locator(selector).evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, height: rect.height, font: parseFloat(getComputedStyle(element).fontSize), width: innerWidth } })
      expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(box.width); expect(box.height).toBeGreaterThanOrEqual(44); expect(box.font).toBeGreaterThanOrEqual(14)
    }
    await captureComplex(page, info, spec.id, 'review-controls', true)
  }
  await page.setViewportSize(DESKTOP); await language(page, 'en')
}
for (const spec of specs) test(`complex scenarios: ${spec.prefix} exact form, publication, lost-response retry, repeated reviewers and bilingual 390px`, async ({ page, request }, info) => {
  test.setTimeout(240000)
  const base = `/scenarios/${spec.id}`, original = await seed(request, spec), legacy = await api(request, 'alice', '/process'), expense = await api(request, 'alice', '/scenarios/oa-expense/process')
  const catalog = await api(request, 'alice', '/scenarios'); expectUnifiedCatalog(catalog)
  const suffix = randomUUID().slice(0, 8), business = spec.fixture({ title: `${spec.prefix} review ${suffix} · 合成审核`, businessId: `${spec.prefix.toUpperCase()}-${suffix}` })
  const errors = [], posts = [], externalWrites = []
  page.on('pageerror', error => errors.push(error.message)); page.on('request', outgoing => { if (outgoing.method() === 'POST') { const url = new URL(outgoing.url()); posts.push(url.pathname); if (!['localhost', '127.0.0.1'].includes(url.hostname)) externalWrites.push(url.hostname) } })
  await page.goto('/scenarios.html'); await login(page); await expectCatalogCards(page, catalog, 'en'); await open(page, spec); await fill(page, spec, business)
  await captures(page, info, spec, 'form-filled')
  await page.setViewportSize(MOBILE); await page.getByTestId(`${spec.prefix}-summary`).scrollIntoViewIfNeeded(); await captures(page, info, spec, 'form-summary', true); await page.setViewportSize(DESKTOP)
  if (spec.prefix === 'payment') {
    await page.locator('#payment-lines-0-allocationAmount').fill('6000.01'); await page.getByTestId('submit-payment').click()
    await expect(page.locator('#payment-lines-0-allocationAmount')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('#payment-lines-0-allocationAmount-error')).toContainText('minus settled')
  } else {
    await page.locator('#contract-lines-2-amount').fill('29999.99'); await page.locator('#contract-lines-2-dueOn').fill('2100-01-01'); await page.getByTestId('submit-contract').click()
    await expect(page.getByTestId('contract-balance')).toHaveText('CNY 0.01'); await expect(page.locator('#contract-lines-2-dueOn')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('.xf-total-error')).toContainText('exactly')
  }
  expect(posts).toEqual([]); await captures(page, info, spec, 'validation-errors'); await fill(page, spec, business)
  if (spec.prefix === 'contract') {
    await page.locator('#contract-termsKind').selectOption('STANDARD'); await page.getByTestId('submit-contract').click(); await expect(page.locator('#contract-deviationReason')).toHaveAttribute('aria-invalid', 'true'); await expect(page.locator('#contract-deviationReason')).toHaveValue(business.deviationReason); await page.locator('#contract-termsKind').selectOption('NONSTANDARD')
  }
  // A real save succeeds; only delivery back to this browser is lost.
  const attempts = []; let saved
  await page.route(`**/api${base}/documents`, async route => {
    attempts.push({ key: route.request().headers()['idempotency-key'], payload: route.request().postDataJSON() })
    if (attempts.length !== 1) return route.continue()
    let response
    try { response = await route.fetch({ maxRetries: 0, maxRedirects: 0 }) } catch { throw new Error('Real-save transport failed; private request details omitted') }
    expect(response.ok()).toBe(true); saved = await response.json(); await route.abort('failed')
  })
  await page.getByTestId(`submit-${spec.prefix}`).click(); await expect(page.getByTestId(`submit-${spec.prefix}`)).toContainText('Retry original request'); expect(saved.request.processVersion).toBe(original.version)
  const other = specs.find(value => value.id !== spec.id)
  await open(page, other); await expect(page.getByTestId(`submit-${other.prefix}`)).not.toContainText('Retry original request'); await page.locator(`#${other.prefix}-title`).fill('Independent unsent draft / 独立未提交草稿')
  await open(page, spec); await expect(page.locator(`#${spec.prefix}-title`)).toHaveValue(business.title); await expect(page.getByTestId(`submit-${spec.prefix}`)).toContainText('Retry original request')
  let bothRejected = spec.prefix === 'payment' ? await api(request, 'alice', `${base}/documents`, { business: { ...saved.request.business, businessId: `PAY-ALL-REJECT-${suffix}`, title: `payment all reject ${suffix}` }, processVersion: original.version }, `all-reject-${randomUUID()}`) : null
  // Publish an actual changed route while the original submission intent remains pinned.
  await page.getByTestId('designer-tab').click()
  if (spec.prefix === 'contract') {
    await page.getByTestId('add-step').click(); await page.getByTestId('select-step').nth(2).click(); await page.getByLabel('Step 3 name', { exact: true }).fill('Final review / 最终复核'); await page.getByLabel('Step 3 review mode', { exact: true }).selectOption('ANY')
  } else { await page.getByTestId('select-step').nth(1).click(); await page.getByLabel('Step 2 review mode', { exact: true }).selectOption('SINGLE'); await page.getByLabel('Step 2 approver', { exact: true }).selectOption('carol') }
  await page.getByTestId('process-name').fill(`${spec.prefix} revised fixed route / 修订固定路线`)
  const later = await mutation(page, `${base}/process`, () => page.getByTestId('publish').click()); expect(later.version).toBe(original.version + 1)
  await captures(page, info, spec, 'designer-published')
  await page.getByTestId('new-tab').click(); await expect(page.locator('.sf-context-note strong')).toContainText(`v${original.version}`)
  let view = await mutation(page, `${base}/documents`, () => page.getByTestId(`submit-${spec.prefix}`).click())
  expect(view).toEqual(saved); expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]); await page.unroute(`**/api${base}/documents`)
  expect(view.total).toBe(spec.prefix === 'payment' ? '6500.00' : '100000.00'); expect(view.request.definition).toEqual(original)
  await captures(page, info, spec, 'saved-original-snapshot')
  // A fresh revision uses the newly published route; the old request does not.
  const laterBusiness = { ...view.request.business, businessId: `${spec.prefix.toUpperCase()}-NEW-${suffix}`, title: `${spec.prefix} later ${suffix}` }
  let newer = await api(request, 'alice', `${base}/documents`, { business: laterBusiness, processVersion: later.version }, `new-${randomUUID()}`)
  expect(newer.request.definition).toEqual(later)
  await switchUser(page, 'bob', spec); await select(page, business.title); await expect(page.getByTestId('publish')).toHaveCount(0)
  await mobileControls(page, info, spec)
  let decisions = 0
  await page.route(`**/api${base}/requests/${view.request.id}/decisions`, async route => { decisions++; await new Promise(resolve => setTimeout(resolve, 100)); await route.continue() })
  view = await vote(page, spec, view, 'APPROVE', true); expect(decisions).toBe(1); await page.unroute(`**/api${base}/requests/${view.request.id}/decisions`)
  expect(view.request.status).toBe('PENDING')
  if (spec.prefix === 'payment') {
    expect(view.request.currentStepId).toBe('payment-check'); await page.getByTestId('handled-tab').click(); await select(page, business.title); await captures(page, info, spec, 'all-partial')
    await switchUser(page, 'carol', spec); await select(page, business.title); view = await vote(page, spec, view, 'APPROVE'); expect(view.request.currentStepId).toBe('payment-final')
    await switchUser(page, 'bob', spec); await select(page, business.title); view = await vote(page, spec, view, 'REJECT'); expect(view.request.status).toBe('PENDING'); expect(view.request.currentStepId).toBe('payment-final')
    await page.getByTestId('handled-tab').click(); await select(page, business.title); await captures(page, info, spec, 'any-partial-rejection')
    await switchUser(page, 'carol', spec); await select(page, business.title); view = await vote(page, spec, view, 'APPROVE')
  } else {
    expect(view.request.currentStepId).toBe('contract-review'); await expect(page.getByTestId('approve-contract')).toBeEnabled()
    view = await vote(page, spec, view, 'APPROVE'); expect(view.request.status).toBe('PENDING'); await page.getByTestId('handled-tab').click(); await select(page, business.title); await captures(page, info, spec, 'all-partial')
    await switchUser(page, 'carol', spec); await select(page, business.title); view = await vote(page, spec, view, 'APPROVE')
  }
  expect(view.request.status).toBe('APPROVED'); await page.reload(); await expect(page.getByLabel('Password', { exact: true })).toHaveValue(''); await login(page); await open(page, spec, 'mine'); await select(page, business.title)
  await captures(page, info, spec, 'approved'); await expect(page.locator('.xf-detail-outcome').first()).toContainText(spec.prefix === 'payment' ? 'No payment has been made' : 'not been signed')
  expect((await api(request, 'alice', `${base}/requests`)).find(item => item.request.id === view.request.id)).toEqual(view)
  // The new route is exercised too; every repeated reviewer casts a new vote.
  await switchUser(page, 'bob', spec); await select(page, laterBusiness.title); newer = await vote(page, spec, newer, 'APPROVE')
  if (spec.prefix === 'contract') { newer = await vote(page, spec, newer, 'APPROVE'); await switchUser(page, 'carol', spec); await select(page, laterBusiness.title); newer = await vote(page, spec, newer, 'APPROVE'); await switchUser(page, 'bob', spec); await select(page, laterBusiness.title); newer = await vote(page, spec, newer, 'REJECT'); expect(newer.request.status).toBe('PENDING'); await page.getByTestId('handled-tab').click(); await select(page, laterBusiness.title); await captures(page, info, spec, 'any-partial-rejection'); await switchUser(page, 'carol', spec); await select(page, laterBusiness.title); newer = await vote(page, spec, newer, 'APPROVE') }
  else { await switchUser(page, 'carol', spec); await select(page, laterBusiness.title); newer = await vote(page, spec, newer, 'APPROVE'); expect(newer.request.currentStepId).toBe('payment-final'); newer = await vote(page, spec, newer, 'APPROVE') }
  expect(newer.request.status).toBe('APPROVED')
  // A separate request preserves rejected amounts/terms in its final snapshot.
  const rejectedBusiness = { ...laterBusiness, businessId: `${spec.prefix.toUpperCase()}-REJECT-${suffix}`, title: `${spec.prefix} rejected ${suffix}` }
  let rejected = await api(request, 'alice', `${base}/documents`, { business: rejectedBusiness, processVersion: later.version }, `reject-${randomUUID()}`)
  await switchUser(page, 'bob', spec); await select(page, rejectedBusiness.title)
  if (spec.prefix === 'contract') { rejected = await vote(page, spec, rejected, 'APPROVE'); rejected = await vote(page, spec, rejected, 'APPROVE'); await switchUser(page, 'carol', spec); await select(page, rejectedBusiness.title) }
  rejected = await vote(page, spec, rejected, 'REJECT'); expect(rejected.request.status).toBe('REJECTED')
  await page.getByTestId('handled-tab').click(); await select(page, rejectedBusiness.title); await captures(page, info, spec, 'rejected'); await expect(page.getByTestId(`approve-${spec.prefix}`)).toHaveCount(0)
  if (spec.prefix === 'contract') await expect(page.locator('.sf-snapshot-flow li.skipped')).toContainText('Final review')
  if (bothRejected) {
    const title = bothRejected.request.title
    await switchUser(page, 'bob', spec); await select(page, title); bothRejected = await vote(page, spec, bothRejected, 'APPROVE')
    await switchUser(page, 'carol', spec); await select(page, title); bothRejected = await vote(page, spec, bothRejected, 'APPROVE')
    await switchUser(page, 'bob', spec); await select(page, title); bothRejected = await vote(page, spec, bothRejected, 'REJECT'); expect(bothRejected.request.status).toBe('PENDING')
    await switchUser(page, 'carol', spec); await select(page, title); bothRejected = await vote(page, spec, bothRejected, 'REJECT'); expect(bothRejected.request.status).toBe('REJECTED'); expect(bothRejected.request.history).toHaveLength(5)
  }
  expect(await api(request, 'alice', '/process')).toEqual(legacy); expect(await api(request, 'alice', '/scenarios/oa-expense/process')).toEqual(expense)
  expect(externalWrites).toEqual([]); expect(posts.every(path => path.startsWith(`/api${base}/`))).toBe(true); expect(errors).toEqual([])
})
