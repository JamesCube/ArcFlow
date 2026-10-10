import { test, expect } from '@playwright/test'
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { businessFor, processNames, comments } from './conditional-fixtures.mjs'
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
  while (await page.locator(prefix === 'receiving' ? '.rf-line-card' : '.xf-line-card').count() < business.lines.length) await page.getByTestId(`add-${prefix}-line`).click()
  for (const [index, line] of business.lines.entries()) for (const [field, value] of Object.entries(line)) if (field !== 'lineId') {
    const input = page.locator(`#${prefix}-lines-${index}-${field}`)
    if (await input.evaluate(element => element.tagName === 'SELECT')) await input.selectOption(String(value)); else await input.fill(String(value))
  }
}
async function capture(page, info, name, mobile = false, view = null) {
  await page.setViewportSize(mobile ? MOBILE : DESKTOP)
  await expect(page.locator('input[type=password]')).toHaveCount(0)
  await expect(page.locator('.sf-shell')).toBeVisible()
  if (mobile && await page.locator('.designer-workbench').isVisible()) await page.locator('.mobile-designer-switch').getByRole('button', { name: /节点设置|Step settings/ }).click()
  await page.evaluate(() => document.fonts.ready)
  // Full-page screenshots retain sticky elements at the current scroll offset.
  // Return to the real page origin rather than moving/hiding any DOM content.
  await page.evaluate(() => { scrollTo({ top: 0, left: 0, behavior: 'instant' }); return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
  const layout = await page.evaluate(() => ({ inner: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, origin: { x: scrollX, y: scrollY } }))
  expect(layout.document).toBeLessThanOrEqual(layout.inner); expect(layout.body).toBeLessThanOrEqual(layout.inner); expect(layout.origin).toEqual({ x: 0, y: 0 })
  const stem = `${name}${mobile ? '-390px' : '-desktop'}`, bytes = await page.screenshot({ fullPage: true, animations: 'disabled' })
  writeFileSync(info.outputPath(`${stem}.png`), bytes, { flag: 'wx' })
  writeFileSync(info.outputPath(`${stem}.json`), JSON.stringify({ ...await sourceProvenance(), state: stem, image: `${stem}.png`, imageSHA256: createHash('sha256').update(bytes).digest('hex'), viewport: page.viewportSize(), scrollOrigin: layout.origin, locale: await page.locator('.sf-shell').getAttribute('lang'), fullPage: true, capturedAt: new Date().toISOString(), requestId: view?.request.id ?? null, requestStatus: view?.request.status ?? null, currentStepId: view?.request.currentStepId ?? null, decisionCount: view ? view.request.history.filter(event => event.action !== 'SUBMIT').length : null }, null, 2), { flag: 'wx' })
}
async function receipt(info, views, locale, checkpoints) {
  const jar = process.env.ARCFLOW_TEST_BACKEND_JAR
  writeFileSync(info.outputPath('routing-receipt.json'), JSON.stringify({ ...await sourceProvenance(), result: 'passed', browser: 'Chromium', realBackend: true, locale, checkpoints, backendSha256: jar ? createHash('sha256').update(readFileSync(jar)).digest('hex') : null, requests: views.map(view => ({ id: view.request.id, processId: view.request.processId, processVersion: view.request.processVersion, title: view.request.title, businessId: view.request.business.businessId, definition: view.request.definition, routing: view.request.routing, status: view.request.status, currentStepId: view.request.currentStepId, history: view.request.history })) }, null, 2))
}
async function vote(page, prefix, view, actor, comment, decision = 'APPROVE') {
  await page.locator('#scenario-comment').fill(comment)
  const updated = await mutation(page, `/scenarios/${view.request.processId}/requests/${view.request.id}/decisions`, () => page.getByTestId(`${decision === 'APPROVE' ? 'approve' : 'reject'}-${prefix}`).click())
  expect(updated.request.definition).toEqual(view.request.definition); expect(updated.request.routing).toEqual(view.request.routing); expect(updated.request.business).toEqual(view.request.business)
  expect(updated.request.history).toHaveLength(view.request.history.length + 1)
  expect(updated.request.history.at(-1)).toMatchObject({ actorId: actor, action: decision, stepId: view.request.currentStepId, comment })
  return updated
}
async function captures(page, info, name, locale, checkpoints, view = null) {
  await language(page, locale)
  if (view) {
    await expect(page.locator('.sf-detail-header h2')).toHaveText(view.request.title)
    const fact = view.request.routing.evaluations[0].predicates[0].actualValue
    const labels = { true: ['Has lines with rejected goods', '有不合格明细'], false: ['No lines with rejected goods', '无不合格明细'], STANDARD: ['Standard terms', '标准条款'], NONSTANDARD: ['Nonstandard terms', '非标准条款'] }
    const value = labels[fact]?.[locale === 'zh' ? 1 : 0] || fact
    await expect(page.locator('.routing-fact')).toContainText(`${locale === 'zh' ? '实际值' : 'Actual value'}: ${value}`)
    checkpoints.push({ state: name, requestId: view.request.id, status: view.request.status, currentStepId: view.request.currentStepId, history: view.request.history })
  }
  for (const mobile of [false, true]) await capture(page, info, `${name}-${locale}`, mobile, view)
  await page.setViewportSize(DESKTOP); await language(page, 'en')
}
async function labelProcess(page, prefix, locale) {
  const [name, ...steps] = processNames[prefix][locale]
  await page.getByTestId('process-name').fill(name)
  for (const [index, step] of steps.entries()) {
    await page.getByTestId('select-step').nth(index).click()
    await page.getByLabel(`Step ${index + 1} name`, { exact: true }).fill(step)
  }
}
async function handled(page, title) { await page.getByTestId('handled-tab').click(); await select(page, title) }
const decisions = view => view.request.history.filter(event => event.action !== 'SUBMIT')
function completed(view, count) { expect(view.request.status).toBe('APPROVED'); expect(view.request.currentStepId).toBeNull(); expect(decisions(view)).toHaveLength(count) }

for (const locale of ['en', 'zh']) {
test(`conditional routing: payment ${locale}: frozen low/high routes with individual ALL and ANY decisions`, async ({ page, request }, info) => {
  test.setTimeout(240000)
  const base = '/scenarios/erp-payment', suffix = randomUUID().slice(0, 8), errors = [], checkpoints = []
  page.on('pageerror', error => errors.push(error.message))
  const initial = await api(request, 'alice', `${base}/process`), handler = getScenarioHandler('erp-payment')
  const legacyBusiness = businessFor('payment', locale, 'old', suffix)
  const legacy = await api(request, 'alice', `${base}/documents`, handler.serialize({ business: legacyBusiness, processVersion: initial.version }), randomUUID())
  if (locale === 'en') expect(legacy.request.routing).toBeUndefined()
  await page.goto('/scenarios.html'); await login(page); await open(page, 'payment', 'designer'); await labelProcess(page, 'payment', locale)
  await page.getByTestId('select-step').first().click(); await page.getByTestId('condition-enabled').selectOption('conditional')
  await page.getByLabel('Condition 1 threshold', { exact: true }).fill('10000')
  await page.getByLabel('Step 1 review mode', { exact: true }).selectOption('SINGLE')
  await page.getByLabel('Step 1 review mode', { exact: true }).selectOption('ALL')
  await page.getByTestId('undo').click(); await expect(page.getByLabel('Step 1 review mode', { exact: true })).toHaveValue('SINGLE')
  await page.getByTestId('redo').click(); await expect(page.getByLabel('Condition 1 threshold', { exact: true })).toHaveValue('10000')
  const published = await mutation(page, `${base}/process`, () => page.getByTestId('publish').click())
  expect(published.schemaVersion).toBe(4); expect(published.nodes[1].runIf.predicates[0].threshold).toBe(10000)
  await captures(page, info, 'payment-conditions', locale, checkpoints)
  const business = businessFor('payment', locale, 'low', suffix)
  await fill(page, 'payment', business); await expect(page.getByTestId('route-preview')).toContainText('1 approval stage included')
  let documentPosts = 0; page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith(`${base}/documents`)) documentPosts++ })
  await page.locator('#payment-currency').selectOption('USD'); await page.getByTestId('submit-payment').click()
  await expect(page.locator('.sf-alert')).toContainText('currency does not match'); expect(documentPosts).toBe(0)
  await page.locator('#payment-currency').selectOption('CNY')
  let low = await mutation(page, `${base}/documents`, () => page.getByTestId('submit-payment').click())
  expect(low.request.routing.stepIds).toEqual(['payment-final']); expect(low.request.routing.evaluations[0].predicates[0].actualValue).toBe('CNY 6500')
  await expect(page.locator('.sf-snapshot-flow > li.conditional-skipped')).toContainText('Condition not met')
  await captures(page, info, 'payment-low-frozen', locale, checkpoints, low)
  await page.getByTestId('designer-tab').click(); await page.getByTestId('condition-enabled').selectOption('always')
  const unconditional = await mutation(page, `${base}/process`, () => page.getByTestId('publish').click()); expect(unconditional.schemaVersion).toBe(4); expect(unconditional.nodes.every(node => !Object.hasOwn(node, 'runIf'))).toBe(true)
  await page.getByTestId('mine-tab').click(); await select(page, business.title); await expect(page.getByTestId('routing-progress')).toContainText('0 / 1')
  await select(page, legacyBusiness.title); if (locale === 'en') await expect(page.getByTestId('routing-progress')).toHaveCount(0)
  await page.getByTestId('designer-tab').click(); await page.getByTestId('condition-enabled').selectOption('conditional')
  const latest = await mutation(page, `${base}/process`, () => page.getByTestId('publish').click())
  const highBusiness = businessFor('payment', locale, 'high', suffix)
  await fill(page, 'payment', highBusiness); await expect(page.getByTestId('route-preview')).toContainText('2 approval stages included')
  let high = await mutation(page, `${base}/documents`, () => page.getByTestId('submit-payment').click())
  expect(high.request.routing.stepIds).toEqual(['payment-check', 'payment-final']); expect(high.request.routing.evaluations[0].predicates[0].actualValue).toBe('CNY 10000')
  await switchUser(page, 'bob', 'payment'); await select(page, highBusiness.title)
  await captures(page, info, 'payment-high-entered', locale, checkpoints, high)
  high = await vote(page, 'payment', high, 'bob', comments.paymentFirst[locale]); expect(high.request.currentStepId).toBe('payment-check'); expect(high.request.status).toBe('PENDING')
  await handled(page, highBusiness.title); await expect(page.locator('.sf-snapshot-flow > li.current .sf-vote').filter({ hasText: 'Approved' })).toHaveCount(1)
  await captures(page, info, 'payment-high-partial', locale, checkpoints, high)
  await switchUser(page, 'carol', 'payment'); await select(page, highBusiness.title)
  high = await vote(page, 'payment', high, 'carol', comments.paymentSecond[locale]); expect(high.request.currentStepId).toBe('payment-final'); expect(high.request.status).toBe('PENDING')
  await captures(page, info, 'payment-high-final-review', locale, checkpoints, high)
  high = await vote(page, 'payment', high, 'carol', comments.paymentFinal[locale]); completed(high, 3)
  await handled(page, highBusiness.title); await captures(page, info, 'payment-high-complete', locale, checkpoints, high)
  await switchUser(page, 'bob', 'payment'); await select(page, business.title)
  low = await vote(page, 'payment', low, 'bob', comments.paymentFinal[locale]); completed(low, 1)
  await handled(page, business.title); await captures(page, info, 'payment-low-complete', locale, checkpoints, low)
  await page.getByTestId('designer-tab').click(); await language(page, locale); await expect(page.getByTestId('condition-enabled')).toHaveCount(0); await expect(page.locator('.routing-readonly')).toContainText(locale === 'zh' ? '条件节点' : 'Conditional step')
  const stored = await api(request, 'alice', `${base}/requests`)
  expect(stored.find(view => view.request.id === low.request.id)).toEqual(low)
  expect(stored.find(view => view.request.id === high.request.id)).toEqual(high)
  expect(stored.find(view => view.request.id === legacy.request.id)).toEqual(legacy)
  expect(low.request.definition.version).toBe(published.version); expect(latest.version).toBe(unconditional.version + 1)
  expect(errors).toEqual([]); await receipt(info, [legacy, low, high], locale, checkpoints)
})

test(`conditional routing: receiving ${locale}: conditional ALL entry, partial votes, acceptance, rejection and clean completion`, async ({ page, request }, info) => {
  test.setTimeout(240000)
  const base = '/scenarios/erp-receiving', suffix = randomUUID().slice(0, 8), errors = [], checkpoints = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/scenarios.html'); await login(page); await open(page, 'receiving', 'designer'); await labelProcess(page, 'receiving', locale)
  await page.getByTestId('select-step').first().click(); await expect(page.getByLabel('Step 1 review mode', { exact: true })).toHaveValue('ALL')
  await page.getByTestId('condition-enabled').selectOption('conditional')
  const published = await mutation(page, `${base}/process`, () => page.getByTestId('publish').click())
  const conditionalId = published.nodes[1].id
  expect(published.nodes[1]).toMatchObject({ type: 'parallelApproval', assigneeIds: ['bob', 'carol'], completionMode: 'ALL' })
  await captures(page, info, 'receiving-conditions', locale, checkpoints)
  const exceptionalBusiness = businessFor('receiving', locale, 'exception', suffix)
  await fill(page, 'receiving', exceptionalBusiness)
  let included = await mutation(page, `${base}/documents`, () => page.getByTestId('submit-receiving').click())
  expect(included.request.routing.stepIds).toEqual(['receiving-inspection', 'procurement-review']); expect(included.request.routing.evaluations[0].predicates[0].actualValue).toBe('true')
  const rejectedBusiness = businessFor('receiving', locale, 'rejected', suffix)
  await fill(page, 'receiving', rejectedBusiness)
  let rejected = await mutation(page, `${base}/documents`, () => page.getByTestId('submit-receiving').click())
  const cleanBusiness = businessFor('receiving', locale, 'clean', suffix)
  await fill(page, 'receiving', cleanBusiness)
  let clean = await mutation(page, `${base}/documents`, () => page.getByTestId('submit-receiving').click())
  expect(clean.request.routing.stepIds).toEqual(['procurement-review']); expect(clean.request.routing.stepIds).not.toContain(conditionalId); expect(clean.request.routing.evaluations[0].predicates[0].actualValue).toBe('false')
  await expect(page.locator('.sf-snapshot-flow > li.conditional-skipped')).toContainText('Condition not met'); await expect(page.locator('.routing-fact')).toContainText('Actual value: No lines with rejected goods')
  await captures(page, info, 'receiving-clean-frozen', locale, checkpoints, clean)
  await switchUser(page, 'bob', 'receiving'); await select(page, exceptionalBusiness.title)
  await captures(page, info, 'receiving-exception-entered', locale, checkpoints, included)
  included = await vote(page, 'receiving', included, 'bob', comments.receivingFirst[locale]); expect(included.request.currentStepId).toBe(conditionalId); expect(included.request.status).toBe('PENDING')
  await handled(page, exceptionalBusiness.title); await expect(page.locator('.sf-snapshot-flow > li.current .sf-vote').filter({ hasText: 'Approved' })).toHaveCount(1)
  await captures(page, info, 'receiving-exception-partial', locale, checkpoints, included)
  await switchUser(page, 'carol', 'receiving'); await select(page, exceptionalBusiness.title)
  included = await vote(page, 'receiving', included, 'carol', comments.receivingSecond[locale]); expect(included.request.currentStepId).toBe('procurement-review'); expect(included.request.status).toBe('PENDING')
  await handled(page, exceptionalBusiness.title); await captures(page, info, 'receiving-procurement-review', locale, checkpoints, included)
  await switchUser(page, 'bob', 'receiving'); await select(page, exceptionalBusiness.title)
  included = await vote(page, 'receiving', included, 'bob', comments.receivingFinal[locale]); completed(included, 3)
  await handled(page, exceptionalBusiness.title); await captures(page, info, 'receiving-exception-approved', locale, checkpoints, included)
  await page.getByTestId('review-tab').click(); await select(page, rejectedBusiness.title)
  rejected = await vote(page, 'receiving', rejected, 'bob', comments.receivingReject[locale], 'REJECT'); expect(rejected.request.status).toBe('REJECTED'); expect(rejected.request.currentStepId).toBeNull(); expect(decisions(rejected)).toHaveLength(1)
  await handled(page, rejectedBusiness.title); await expect(page.locator('.sf-snapshot-flow > li.skipped')).toContainText(processNames.receiving[locale][2]); await expect(page.getByTestId('approve-receiving')).toHaveCount(0)
  await captures(page, info, 'receiving-exception-rejected', locale, checkpoints, rejected)
  await page.getByTestId('review-tab').click(); await select(page, cleanBusiness.title)
  clean = await vote(page, 'receiving', clean, 'bob', comments.receivingClean[locale]); completed(clean, 1)
  await handled(page, cleanBusiness.title); await captures(page, info, 'receiving-clean-approved', locale, checkpoints, clean)
  const stored = await api(request, 'alice', `${base}/requests`)
  for (const view of [included, rejected, clean]) expect(stored.find(item => item.request.id === view.request.id)).toEqual(view)
  expect(errors).toEqual([]); await receipt(info, [included, rejected, clean], locale, checkpoints)
})

test(`conditional routing: contract ${locale}: nonstandard IN condition, ALL entry, partial votes and final approval`, async ({ page, request }, info) => {
  test.setTimeout(240000)
  const base = '/scenarios/crm-contract', suffix = randomUUID().slice(0, 8), errors = [], checkpoints = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/scenarios.html'); await login(page); await open(page, 'contract', 'designer'); await labelProcess(page, 'contract', locale)
  await page.getByTestId('select-step').nth(1).click(); await page.getByTestId('condition-enabled').selectOption('conditional')
  await page.getByTestId('condition-mode').selectOption('ANY'); await page.getByLabel('Condition 1 comparison', { exact: true }).selectOption('IN')
  await page.getByLabel('Condition 1 NONSTANDARD', { exact: true }).uncheck(); await expect(page.getByTestId('publish')).toBeDisabled()
  await page.getByLabel('Condition 1 NONSTANDARD', { exact: true }).check()
  const published = await mutation(page, `${base}/process`, () => page.getByTestId('publish').click())
  expect(published.nodes[2].completionMode).toBe('ALL'); expect(published.nodes[2].runIf.mode).toBe('ANY')
  await captures(page, info, 'contract-conditions', locale, checkpoints)
  const nonstandard = businessFor('contract', locale, 'nonstandard', suffix)
  await fill(page, 'contract', nonstandard)
  let included = await mutation(page, `${base}/documents`, () => page.getByTestId('submit-contract').click())
  expect(included.request.routing.stepIds).toEqual(['commercial-review', 'contract-review']); expect(included.request.routing.evaluations[0].predicates[0].actualValue).toBe('NONSTANDARD')
  const standard = businessFor('contract', locale, 'standard', suffix)
  await fill(page, 'contract', standard)
  let skipped = await mutation(page, `${base}/documents`, () => page.getByTestId('submit-contract').click())
  expect(skipped.request.routing.stepIds).toEqual(['commercial-review']); expect(skipped.request.routing.evaluations[0].predicates[0].actualValue).toBe('STANDARD')
  await switchUser(page, 'bob', 'contract'); await select(page, nonstandard.title)
  included = await vote(page, 'contract', included, 'bob', comments.contractCommercial[locale]); expect(included.request.currentStepId).toBe('contract-review'); expect(included.request.status).toBe('PENDING')
  await captures(page, info, 'contract-nonstandard-entered', locale, checkpoints, included)
  included = await vote(page, 'contract', included, 'bob', comments.contractFirst[locale]); expect(included.request.currentStepId).toBe('contract-review'); expect(included.request.status).toBe('PENDING')
  await handled(page, nonstandard.title); await expect(page.locator('.sf-snapshot-flow > li.current .sf-vote').filter({ hasText: 'Approved' })).toHaveCount(1)
  await captures(page, info, 'contract-nonstandard-partial', locale, checkpoints, included)
  await switchUser(page, 'carol', 'contract'); await select(page, nonstandard.title)
  included = await vote(page, 'contract', included, 'carol', comments.contractSecond[locale]); completed(included, 3)
  await handled(page, nonstandard.title); await captures(page, info, 'contract-nonstandard-approved', locale, checkpoints, included)
  await switchUser(page, 'bob', 'contract'); await select(page, standard.title)
  skipped = await vote(page, 'contract', skipped, 'bob', comments.contractCommercial[locale]); completed(skipped, 1)
  await handled(page, standard.title); await expect(page.getByTestId('routing-progress')).toContainText('1 / 1'); await expect(page.locator('.routing-fact')).toContainText('Actual value: Standard terms')
  await captures(page, info, 'contract-standard-approved', locale, checkpoints, skipped)
  const stored = await api(request, 'alice', `${base}/requests`)
  for (const view of [included, skipped]) expect(stored.find(item => item.request.id === view.request.id)).toEqual(view)
  expect(errors).toEqual([]); await receipt(info, [included, skipped], locale, checkpoints)
})
}
