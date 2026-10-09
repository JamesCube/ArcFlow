import { test, expect } from '@playwright/test'
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { paymentFixture, contractFixture } from '../src/scenarios/scenario-fixtures.js'
import { getScenarioHandler } from '../src/scenarios/scenario-registry.js'
import { sourceProvenance } from './complex-evidence.mjs'
const DESKTOP = { width: 1440, height: 1000 }, MOBILE = { width: 390, height: 844 }
test.use({ locale: 'en-GB', timezoneId: 'UTC', reducedMotion: 'reduce', actionTimeout: 15000 })
async function api(request, user, path, data, key) {
  let response
  try { response = await request.fetch(`http://127.0.0.1:8080/api${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Basic ${Buffer.from(`${user}:${process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`]}`).toString('base64')}`, 'Content-Type': 'application/json', 'X-Arcflow-Client': 'approval-demo', ...(key ? { 'Idempotency-Key': key } : {}) }, ...(data === undefined ? {} : { data }) }) } catch { throw new Error('Conditional routing API transport failed; credential-bearing request details omitted') }
  expect(response.status(), `Conditional API ${path}`).toBe(data !== undefined && path.endsWith('/documents') ? 201 : 200)
  return response.json()
}
async function login(page, user = 'alice') {
  await page.getByLabel('Demo account').selectOption(user)
  try { await page.getByLabel('Password', { exact: true }).fill(process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`]) } catch { throw new Error('Unable to enter disposable credentials; private input omitted') }
  await page.getByRole('button', { name: 'Open scenario library' }).click(); await expect(page.locator('.sf-shell')).toBeVisible()
}
async function open(page, prefix, tab = 'new') { await page.getByTestId('catalog-tab').click(); await page.getByTestId(`open-${prefix}`).click(); await page.getByTestId(`${tab}-tab`).click(); await expect(page.getByTestId('scenario-refresh')).toBeEnabled() }
async function language(page, value) { await page.locator('.sf-topbar').getByLabel('Language / 语言').selectOption(value) }
async function switchUser(page, user, prefix, tab = 'review') { await page.setViewportSize(DESKTOP); await language(page, 'en'); await page.getByTestId('scenario-logout').click(); await login(page, user); await open(page, prefix, tab) }
async function select(page, title) { await page.locator('.sf-request-item').filter({ has: page.getByText(title, { exact: true }) }).click(); await expect(page.locator('.sf-detail-header h2')).toHaveText(title) }
async function mutation(page, path, action) {
  const [response] = await Promise.all([page.waitForResponse(response => response.url().endsWith(`/api${path}`) && response.request().method() === 'POST'), action()])
  expect(response.ok(), `${path}: ${response.status()}`).toBe(true)
  const result = await response.json(); await expect(page.getByTestId('scenario-refresh')).toBeEnabled(); await expect(page.locator('.sf-alert')).toHaveCount(0); return result
}
async function fill(page, prefix, business) {
  await page.getByTestId('new-tab').click()
  for (const [field, value] of Object.entries(business)) if (!['type', 'documentVersion', 'lines'].includes(field)) {
    const input = page.locator(`#${prefix}-${field}`)
    if (await input.evaluate(element => element.tagName === 'SELECT')) await input.selectOption(String(value)); else await input.fill(String(value))
  }
  while (await page.locator('.xf-line-card').count() < business.lines.length) await page.getByTestId(`add-${prefix}-line`).click()
  for (const [index, line] of business.lines.entries()) for (const [field, value] of Object.entries(line)) if (field !== 'lineId') await page.locator(`#${prefix}-lines-${index}-${field}`).fill(String(value))
}
async function capture(page, info, name, mobile = false) {
  await page.setViewportSize(mobile ? MOBILE : DESKTOP)
  const width = await page.evaluate(() => ({ inner: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
  expect(width.document).toBeLessThanOrEqual(width.inner); expect(width.body).toBeLessThanOrEqual(width.inner)
  await expect(page.locator('input[type=password]')).toHaveCount(0)
  await expect(page.locator('.sf-shell')).toBeVisible()
  if (mobile && await page.locator('.designer-workbench').isVisible()) await page.locator('.mobile-designer-switch').getByRole('button', { name: /节点设置|Step settings/ }).click()
  await page.evaluate(() => document.fonts.ready)
  const stem = `${name}${mobile ? '-390px' : '-desktop'}`, bytes = await page.screenshot({ fullPage: true, animations: 'disabled' })
  writeFileSync(info.outputPath(`${stem}.png`), bytes, { flag: 'wx' })
  writeFileSync(info.outputPath(`${stem}.json`), JSON.stringify({ ...await sourceProvenance(), state: stem, image: `${stem}.png`, imageSHA256: createHash('sha256').update(bytes).digest('hex'), viewport: page.viewportSize(), locale: await page.locator('.sf-shell').getAttribute('lang'), fullPage: true, capturedAt: new Date().toISOString() }, null, 2), { flag: 'wx' })
}
async function receipt(info, views) {
  const jar = process.env.ARCFLOW_TEST_BACKEND_JAR
  writeFileSync(info.outputPath('routing-receipt.json'), JSON.stringify({ ...await sourceProvenance(), result: 'passed', browser: 'Chromium', realBackend: true, backendSha256: jar ? createHash('sha256').update(readFileSync(jar)).digest('hex') : null, requests: views.map(view => ({ id: view.request.id, processId: view.request.processId, processVersion: view.request.processVersion, definition: view.request.definition, routing: view.request.routing, status: view.request.status, currentStepId: view.request.currentStepId, history: view.request.history })) }, null, 2))
}
async function approve(page, prefix, view) { return mutation(page, `/scenarios/${view.request.processId}/requests/${view.request.id}/decisions`, () => page.getByTestId(`approve-${prefix}`).click()) }

test('conditional routing: payment: configure conditions, preserve old snapshot, freeze low/high routes, reject currency mismatch and render mobile', async ({ page, request }, info) => {
  test.setTimeout(150000)
  const base = '/scenarios/erp-payment', suffix = randomUUID().slice(0, 8), errors = []
  page.on('pageerror', error => errors.push(error.message))
  const initial = await api(request, 'alice', `${base}/process`), handler = getScenarioHandler('erp-payment')
  const legacyBusiness = paymentFixture({ businessId: `PAY-OLD-${suffix}`, title: `Old fixed payment ${suffix}` })
  const legacy = await api(request, 'alice', `${base}/documents`, handler.serialize({ business: legacyBusiness, processVersion: initial.version }), randomUUID())
  expect(legacy.request.routing).toBeUndefined()
  await page.goto('/scenarios.html'); await login(page); await open(page, 'payment', 'designer')
  await page.getByTestId('select-step').first().click(); await page.getByTestId('condition-enabled').selectOption('conditional')
  await page.getByLabel('Condition 1 threshold', { exact: true }).fill('10000')
  await page.getByLabel('Step 1 review mode', { exact: true }).selectOption('SINGLE')
  await page.getByLabel('Step 1 review mode', { exact: true }).selectOption('ALL')
  await page.getByTestId('undo').click(); await expect(page.getByLabel('Step 1 review mode', { exact: true })).toHaveValue('SINGLE')
  await page.getByTestId('redo').click(); await expect(page.getByLabel('Condition 1 threshold', { exact: true })).toHaveValue('10000')
  const published = await mutation(page, `${base}/process`, () => page.getByTestId('publish').click())
  expect(published.schemaVersion).toBe(4); expect(published.nodes[1].runIf.predicates[0].threshold).toBe(10000)
  await capture(page, info, 'payment-conditions-en'); await language(page, 'zh'); await capture(page, info, 'payment-conditions-zh', true); await page.setViewportSize(DESKTOP); await language(page, 'en')
  const business = paymentFixture({ businessId: `PAY-LOW-${suffix}`, title: `Payment below threshold ${suffix}` })
  await fill(page, 'payment', business); await expect(page.getByTestId('route-preview')).toContainText('1 approval stages included')
  let documentPosts = 0; page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith(`${base}/documents`)) documentPosts++ })
  await page.locator('#payment-currency').selectOption('USD'); await page.getByTestId('submit-payment').click()
  await expect(page.locator('.sf-alert')).toContainText('currency does not match'); expect(documentPosts).toBe(0)
  await page.locator('#payment-currency').selectOption('CNY')
  let low = await mutation(page, `${base}/documents`, () => page.getByTestId('submit-payment').click())
  expect(low.request.routing.stepIds).toEqual(['payment-final']); expect(low.request.routing.evaluations[0].predicates[0].actualValue).toBe('CNY 6500')
  await expect(page.locator('.sf-snapshot-flow > li.conditional-skipped')).toContainText('Condition not met'); await capture(page, info, 'payment-low-frozen')
  await page.getByTestId('designer-tab').click(); await page.getByTestId('condition-enabled').selectOption('always')
  const unconditional = await mutation(page, `${base}/process`, () => page.getByTestId('publish').click()); expect(unconditional.schemaVersion).toBe(4); expect(unconditional.nodes.every(node => !Object.hasOwn(node, 'runIf'))).toBe(true)
  await page.getByTestId('mine-tab').click(); await select(page, business.title); await expect(page.getByTestId('routing-progress')).toContainText('0 / 1'); await select(page, legacyBusiness.title); await expect(page.getByTestId('routing-progress')).toHaveCount(0)
  // Restoring the condition creates a later version; neither older instance changes.
  await page.getByTestId('designer-tab').click(); await page.getByTestId('condition-enabled').selectOption('conditional')
  const latest = await mutation(page, `${base}/process`, () => page.getByTestId('publish').click())
  const highBusiness = paymentFixture({ businessId: `PAY-HIGH-${suffix}`, title: `Payment at threshold ${suffix}` })
  Object.assign(highBusiness.lines[0], { allocationAmount: '6000', deductionAmount: '0', deductionReason: '' }); highBusiness.lines[1].allocationAmount = '4000'
  await fill(page, 'payment', highBusiness); await expect(page.getByTestId('route-preview')).toContainText('2 approval stages included')
  let high = await mutation(page, `${base}/documents`, () => page.getByTestId('submit-payment').click())
  expect(high.request.routing.stepIds).toEqual(['payment-check', 'payment-final']); expect(high.request.routing.evaluations[0].predicates[0].actualValue).toBe('CNY 10000')
  await switchUser(page, 'bob', 'payment'); await select(page, business.title); low = await approve(page, 'payment', low); expect(low.request.status).toBe('APPROVED')
  await select(page, highBusiness.title); high = await approve(page, 'payment', high); expect(high.request.currentStepId).toBe('payment-check')
  await switchUser(page, 'carol', 'payment'); await select(page, highBusiness.title); high = await approve(page, 'payment', high); expect(high.request.currentStepId).toBe('payment-final'); high = await approve(page, 'payment', high); expect(high.request.status).toBe('APPROVED')
  await page.getByTestId('handled-tab').click(); await select(page, highBusiness.title); await capture(page, info, 'payment-high-complete')
  await switchUser(page, 'bob', 'payment', 'handled'); await select(page, business.title); await language(page, 'zh'); await capture(page, info, 'payment-low-complete-zh', true)
  await page.getByTestId('designer-tab').click(); await expect(page.getByTestId('condition-enabled')).toHaveCount(0); await expect(page.locator('.routing-readonly')).toContainText('条件节点')
  expect((await api(request, 'alice', `${base}/requests`)).find(view => view.request.id === low.request.id).request.definition.version).toBe(published.version)
  expect(latest.version).toBe(unconditional.version + 1); expect(errors).toEqual([]); await receipt(info, [legacy, low, high])
})

test('conditional routing: receiving: boolean condition includes rejected goods and skips clean receipts with saved explanation', async ({ page, request }, info) => {
  const base = '/scenarios/erp-receiving', suffix = randomUUID().slice(0, 8), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/scenarios.html'); await login(page); await open(page, 'receiving', 'designer')
  await page.getByTestId('select-step').first().click(); await page.getByTestId('condition-enabled').selectOption('conditional')
  const published = await mutation(page, `${base}/process`, () => page.getByTestId('publish').click())
  const conditionalId = published.nodes[1].id
  await page.getByTestId('new-tab').click(); await page.getByTestId('fill-receiving-sample').click(); await page.locator('#receiving-businessId').fill(`GRN-EX-${suffix}`); await page.locator('#receiving-title').fill(`Rejected goods ${suffix}`)
  const included = await mutation(page, `${base}/documents`, () => page.getByTestId('submit-receiving').click())
  expect(included.request.routing.stepIds).toContain(conditionalId); expect(included.request.routing.evaluations[0].predicates[0].actualValue).toBe('true')
  await page.getByTestId('new-tab').click(); await page.getByTestId('fill-receiving-sample').click(); await page.locator('#receiving-businessId').fill(`GRN-CLEAN-${suffix}`); await page.locator('#receiving-title').fill(`Clean receiving ${suffix}`)
  await page.locator('#receiving-lines-0-accepted').fill('80'); await page.locator('#receiving-lines-0-rejected').fill('0'); await page.locator('#receiving-lines-0-exceptionReason').fill('')
  const clean = await mutation(page, `${base}/documents`, () => page.getByTestId('submit-receiving').click())
  expect(clean.request.routing.stepIds).not.toContain(conditionalId); expect(clean.request.routing.evaluations[0].predicates[0].actualValue).toBe('false')
  await expect(page.locator('.sf-snapshot-flow > li.conditional-skipped')).toContainText('Condition not met'); await expect(page.locator('.routing-fact')).toContainText('Actual value: No lines with rejected goods'); await capture(page, info, 'receiving-clean-frozen')
  await language(page, 'zh'); await expect(page.locator('.routing-fact')).toContainText('实际值: 无不合格明细'); await capture(page, info, 'receiving-clean-zh', true)
  expect(errors).toEqual([]); await receipt(info, [included, clean])
})

test('conditional routing: contract: configure enum IN and ANY conditions, freeze standard/nonstandard routes, preserve Chinese mobile editor', async ({ page, request }, info) => {
  const base = '/scenarios/crm-contract', suffix = randomUUID().slice(0, 8), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/scenarios.html'); await login(page); await open(page, 'contract', 'designer')
  await page.getByTestId('select-step').nth(1).click(); await page.getByTestId('condition-enabled').selectOption('conditional')
  await page.getByTestId('condition-mode').selectOption('ANY'); await page.getByLabel('Condition 1 comparison', { exact: true }).selectOption('IN')
  await page.getByLabel('Condition 1 NONSTANDARD', { exact: true }).uncheck(); await expect(page.getByTestId('publish')).toBeDisabled()
  await page.getByLabel('Condition 1 NONSTANDARD', { exact: true }).check()
  const published = await mutation(page, `${base}/process`, () => page.getByTestId('publish').click())
  await capture(page, info, 'contract-in-any-editor'); await language(page, 'zh'); await capture(page, info, 'contract-in-any-editor-zh', true); await page.setViewportSize(DESKTOP); await language(page, 'en')
  const nonstandard = contractFixture({ businessId: `CON-NONSTD-${suffix}`, title: `Nonstandard contract ${suffix}` })
  await fill(page, 'contract', nonstandard)
  const included = await mutation(page, `${base}/documents`, () => page.getByTestId('submit-contract').click())
  expect(included.request.routing.stepIds).toEqual(['commercial-review', 'contract-review']); expect(included.request.routing.evaluations[0].predicates[0].actualValue).toBe('NONSTANDARD')
  const standard = contractFixture({ businessId: `CON-STD-${suffix}`, title: `Standard contract ${suffix}`, termsKind: 'STANDARD', deviationReason: '' })
  await fill(page, 'contract', standard)
  let skipped = await mutation(page, `${base}/documents`, () => page.getByTestId('submit-contract').click())
  expect(skipped.request.routing.stepIds).toEqual(['commercial-review']); expect(skipped.request.routing.evaluations[0].predicates[0].actualValue).toBe('STANDARD')
  await switchUser(page, 'bob', 'contract'); await select(page, standard.title); skipped = await approve(page, 'contract', skipped); expect(skipped.request.status).toBe('APPROVED')
  await page.getByTestId('handled-tab').click(); await select(page, standard.title); await expect(page.getByTestId('routing-progress')).toContainText('1 / 1'); await expect(page.locator('.routing-fact')).toContainText('Actual value: Standard terms'); await capture(page, info, 'contract-standard-complete')
  await language(page, 'zh'); await expect(page.locator('.routing-fact')).toContainText('实际值: 标准条款'); await capture(page, info, 'contract-standard-complete-zh', true)
  expect(published.nodes[2].runIf.mode).toBe('ANY'); expect(errors).toEqual([]); await receipt(info, [included, skipped])
})
