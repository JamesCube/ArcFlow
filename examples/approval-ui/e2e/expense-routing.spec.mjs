import { test, expect } from '@playwright/test'
import { randomUUID, createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { sourceProvenance } from './complex-evidence.mjs'
import { getScenarioHandler } from '../src/scenarios/scenario-registry.js'
const BASE = '/scenarios/oa-expense', handler = getScenarioHandler('oa-expense')
const DESKTOP = { width: 1440, height: 1000 }, MOBILE = { width: 390, height: 844 }
const captureEnabled = process.env.ARCFLOW_CAPTURE_EXPENSE_ROUTING === '1'
test.use({ locale: 'en-GB', timezoneId: 'UTC', reducedMotion: 'reduce', actionTimeout: 15000 })
async function api(request, user, path, data, key) {
  let response
  try { response = await request.fetch(`http://127.0.0.1:8080/api${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Basic ${Buffer.from(`${user}:${process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`]}`).toString('base64')}`, 'Content-Type': 'application/json', 'X-Arcflow-Client': 'approval-demo', ...(key ? { 'Idempotency-Key': key } : {}) }, ...(data === undefined ? {} : { data }) }) } catch { throw new Error('Expense routing transport failed; credential-bearing request details omitted') }
  expect(response.status()).toBe(data !== undefined && path.endsWith('/documents') ? 201 : 200)
  return response.json()
}
async function login(page, user = 'alice') {
  await page.getByLabel('Demo account').selectOption(user)
  try { await page.getByLabel('Password', { exact: true }).fill(process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`]) } catch { throw new Error('Unable to enter disposable credentials; private input omitted') }
  await page.getByRole('button', { name: 'Open scenario library' }).click(); await expect(page.locator('.sf-shell')).toBeVisible()
  await page.getByTestId('open-expense').click(); await expect(page.getByTestId('scenario-refresh')).toBeEnabled()
}
const language = (page, locale) => page.locator('.sf-topbar').getByLabel('Language / 语言').selectOption(locale)
async function switchUser(page, user) { await page.setViewportSize(DESKTOP); await language(page, 'en'); await page.getByTestId('scenario-logout').click(); await login(page, user) }
async function select(page, title, tab = 'mine') { await page.getByTestId(`${tab}-tab`).click(); await page.locator('.sf-request-item').filter({ has: page.getByText(title, { exact: true }) }).click(); await expect(page.locator('.sf-detail-header h2')).toHaveText(title) }
async function mutation(page, path, action) {
  const [response] = await Promise.all([page.waitForResponse(r => r.url().endsWith(`/api${path}`) && r.request().method() === 'POST'), action()])
  expect(response.ok(), `${path}: ${response.status()}`).toBe(true)
  const result = await response.json(); await expect(page.getByTestId('scenario-refresh')).toBeEnabled(); await expect(page.locator('.sf-alert')).toHaveCount(0); return result
}
function business(locale, kind, suffix) {
  const high = ['threshold', 'rejected'].includes(kind)
  const title = locale === 'zh' ? { legacy: '旧流程报销', low: '阈值以下报销', threshold: '恰好达到阈值', rejected: '凭证需补充', new: '新版规则报销' }[kind] : { legacy: 'Original expense route', low: 'Below-threshold expense', threshold: 'Exactly at threshold', rejected: 'Receipt clarification needed', new: 'New published expense rule' }[kind]
  return { type: 'expense', documentVersion: 1, businessId: `EXP-${kind}-${suffix}`, title, reason: locale === 'zh' ? '合成出差费用审核，仅演示明细精确求和与条件审批。' : 'Synthetic travel expense review to verify exact line totals and conditional approval.', costCenter: 'ENGINEERING', currency: 'CNY', lines: [
    { lineId: 'travel', spentOn: '2026-10-10', category: 'TRAVEL', description: locale === 'zh' ? '合成交通与住宿费用' : 'Synthetic travel and lodging expense', amount: high ? '9999.90' : '9999.89', receiptRef: `RECEIPT-A-${suffix}-${kind}` },
    { lineId: 'supplies', spentOn: '2026-10-10', category: 'OFFICE', description: locale === 'zh' ? '合成办公用品费用' : 'Synthetic office supply expense', amount: '0.10', receiptRef: `RECEIPT-B-${suffix}-${kind}` },
  ] }
}
async function fill(page, value) {
  await page.getByTestId('new-tab').click()
  for (const [field, value_] of Object.entries(value)) if (!['type', 'documentVersion', 'lines'].includes(field)) {
    const input = page.locator(`#expense-${field}`)
    if (await input.evaluate(element => element.tagName === 'SELECT')) await input.selectOption(value_); else await input.fill(value_)
  }
  while (await page.locator('.sf-line-card').count() < value.lines.length) await page.getByTestId('add-expense-line').click()
  for (const [index, line] of value.lines.entries()) for (const [field, value_] of Object.entries(line)) if (field !== 'lineId') {
    const input = page.locator(`#expense-lines-${index}-${field}`)
    if (await input.evaluate(element => element.tagName === 'SELECT')) await input.selectOption(value_); else await input.fill(value_)
  }
}
async function assertDisplayedState(page, state, locale, view) {
  const zh = locale === 'zh'
  if (!view) {
    if (state === 'expense-conditions') {
      await expect(page.locator('.routing-field')).toHaveText(zh ? '报销总额' : 'Expense total')
      await expect(page.getByLabel(zh ? '条件 1 金额阈值' : 'Condition 1 threshold', { exact: true })).toHaveValue('10000')
      await expect(page.getByLabel(zh ? '节点 1 审批方式' : 'Step 1 review mode', { exact: true })).toHaveValue('ALL')
    } else if (state === 'expense-wrong-currency') {
      await expect(page.locator('#expense-currency')).toHaveValue('USD')
      await expect(page.locator('.sf-alert')).toContainText(zh ? '单据币种与已发布金额条件不一致' : 'currency does not match')
      await expect(page.locator('.sf-mini-flow .conditional-skipped')).toHaveCount(0)
    }
    return
  }
  const item = view.request
  await expect(page.locator('.sf-detail-header h2')).toHaveText(item.title)
  await expect(page.locator('.sf-detail-header .sf-kicker')).toHaveText(item.business.businessId)
  await expect(page.locator('.sf-detail-header .sf-status')).toHaveText(({ PENDING: zh ? '审批中' : 'Pending', APPROVED: zh ? '已通过' : 'Approved', REJECTED: zh ? '已驳回' : 'Rejected' })[item.status])
  await expect(page.locator('.sf-detail-header > strong')).toHaveText(handler.money(view.total, item.business.currency))
  await expect(page.locator('.sf-detail-section h3').filter({ hasText: zh ? '审批流程快照' : 'Approval snapshot' }).locator('small')).toHaveText(`v${item.processVersion}`)
  await expect(page.locator('.timeline > li')).toHaveCount(item.history.length)
  if (item.currentStepId) await expect(page.locator('.sf-snapshot-flow > li.current > header > strong')).toHaveText(item.definition.nodes.find(node => node.id === item.currentStepId).name)
  else await expect(page.locator('.sf-snapshot-flow > li.current')).toHaveCount(0)
  if (!item.routing) {
    await expect(page.getByTestId('routing-progress')).toHaveCount(0)
    await expect(page.locator('[data-routing-evaluation]')).toHaveCount(0)
    await expect(page.locator('.sf-snapshot-flow > li.conditional-skipped')).toHaveCount(0)
    return
  }
  await expect(page.getByTestId('routing-progress')).toContainText(`/ ${item.routing.stepIds.length}`)
  await expect(page.locator('.sf-snapshot-flow > li.conditional-skipped')).toHaveCount(item.definition.nodes.length - 2 - item.routing.stepIds.length)
  await expect(page.locator('[data-routing-evaluation]')).toHaveCount(item.routing.evaluations.length)
  for (const evaluation of item.routing.evaluations) {
    const node = item.definition.nodes.find(node => node.id === evaluation.stepId), predicate = evaluation.predicates[0]
    const explanation = page.locator(`[data-routing-evaluation="${evaluation.stepId}"]`)
    await expect(explanation).toContainText(`${zh ? '报销总额' : 'Expense total'} ≥ CNY ${node.runIf.predicates[0].threshold}`)
    await expect(explanation.locator('.routing-fact')).toHaveText(`${zh ? '实际值' : 'Actual value'}: ${predicate.actualValue} · ${predicate.result ? (zh ? '满足' : 'Matched') : (zh ? '未满足' : 'Not matched')}`)
    await expect(explanation.locator(':scope > p')).toContainText(evaluation.result ? (zh ? '已纳入' : 'Included') : (zh ? '条件未满足，未纳入' : 'Condition not met · not included'))
  }
}
async function captures(page, info, state, locale, checkpoints, view = null) {
  if (view) checkpoints.push({ state, requestId: view.request.id, status: view.request.status, currentStepId: view.request.currentStepId, processVersion: view.request.processVersion, history: view.request.history })
  await language(page, locale)
  for (const mobile of [false, true]) {
    await page.setViewportSize(mobile ? MOBILE : DESKTOP)
    await expect(page.locator('input[type=password]')).toHaveCount(0)
    if (mobile && await page.locator('.designer-workbench').isVisible()) await page.locator('.mobile-designer-switch').getByRole('button', { name: /节点设置|Step settings/ }).click()
    await assertDisplayedState(page, state, locale, view)
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => { scrollTo({ top: 0, left: 0, behavior: 'instant' }); return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
    const layout = await page.evaluate(() => ({ inner: innerWidth, width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), origin: { x: scrollX, y: scrollY } }))
    expect(layout.width).toBeLessThanOrEqual(layout.inner); expect(layout.origin).toEqual({ x: 0, y: 0 })
    if (captureEnabled) {
      const stem = `${state}-${locale}-${mobile ? '390px' : 'desktop'}`, bytes = await page.screenshot({ fullPage: true, animations: 'disabled' })
      writeFileSync(info.outputPath(`${stem}.png`), bytes, { flag: 'wx' })
      writeFileSync(info.outputPath(`${stem}.json`), JSON.stringify({ ...await sourceProvenance(), state: stem, image: `${stem}.png`, imageSHA256: createHash('sha256').update(bytes).digest('hex'), viewport: page.viewportSize(), scrollOrigin: layout.origin, locale: await page.locator('.sf-shell').getAttribute('lang'), fullPage: true, capturedAt: new Date().toISOString(), requestId: view?.request.id ?? null, requestStatus: view?.request.status ?? null, currentStepId: view?.request.currentStepId ?? null, decisionCount: view ? view.request.history.filter(e => e.action !== 'SUBMIT').length : null }, null, 2), { flag: 'wx' })
    }
  }
  await page.setViewportSize(DESKTOP); await language(page, 'en')
}
async function vote(page, view, actor, comment, decision = 'APPROVE') {
  await page.locator('#scenario-comment').fill(comment)
  const after = await mutation(page, `${BASE}/requests/${view.request.id}/decisions`, () => page.getByTestId(`${decision === 'APPROVE' ? 'approve' : 'reject'}-expense`).click())
  expect(after.request.definition).toEqual(view.request.definition); expect(after.request.routing).toEqual(view.request.routing); expect(after.request.business).toEqual(view.request.business)
  expect(after.request.history).toHaveLength(view.request.history.length + 1)
  expect(after.request.history.at(-1)).toMatchObject({ actorId: actor, action: decision, stepId: view.request.currentStepId, comment })
  return after
}

for (const locale of ['en', 'zh']) test(`expense conditional routing: ${locale}: exact totals, decisions and frozen publication`, async ({ page, request }, info) => {
  test.setTimeout(240000)
  const suffix = randomUUID().slice(0, 8), checkpoints = [], errors = [], comment = locale === 'zh' ? '已核对合成费用与凭证。' : 'Reviewed the synthetic expense lines and receipts.'
  page.on('pageerror', error => errors.push(error.message))
  const initial = await api(request, 'alice', `${BASE}/process`)
  // Each language starts with an explicit legacy publication. The persistence
  // wrapper stays monotonic; a legacy definition still has its original shape.
  const baseline = { ...initial, schemaVersion: 2, nodes: [initial.nodes[0], { id: 'manager', type: 'approval', name: locale === 'zh' ? '大额费用复核' : 'High-value expense review', assigneeId: 'bob' }, { id: 'finance', type: 'approval', name: locale === 'zh' ? '财务凭证审核' : 'Finance receipt review', assigneeId: 'carol' }, initial.nodes.at(-1)] }
  const legacyProcess = await api(request, 'alice', `${BASE}/process`, { expectedVersion: initial.version, definition: baseline })
  const legacyBusiness = business(locale, 'legacy', suffix)
  const legacy = await api(request, 'alice', `${BASE}/documents`, handler.serialize({ business: legacyBusiness, processVersion: legacyProcess.version }), randomUUID())
  expect(legacy.request.routing).toBeUndefined()
  await page.goto('/scenarios.html'); await login(page)
  await page.getByTestId('designer-tab').click(); await page.getByTestId('process-name').fill(locale === 'zh' ? '按报销总额纳入大额复核' : 'Expense total review threshold')
  await page.getByTestId('select-step').first().click(); await page.getByTestId('condition-enabled').selectOption('conditional')
  await page.getByLabel('Condition 1 threshold', { exact: true }).fill('10000')
  await page.getByLabel('Step 1 review mode', { exact: true }).selectOption('ALL')
  await page.getByTestId('undo').click(); await expect(page.getByLabel('Step 1 review mode', { exact: true })).toHaveValue('SINGLE')
  await page.getByTestId('redo').click(); await expect(page.getByLabel('Condition 1 threshold', { exact: true })).toHaveValue('10000')
  const published = await mutation(page, `${BASE}/process`, () => page.getByTestId('publish').click())
  expect(published.schemaVersion).toBe(4); expect(published.nodes[1].runIf.predicates[0]).toEqual({ field: 'expense.totalAmount', operator: 'GTE', currency: 'CNY', threshold: 10000 })
  await captures(page, info, 'expense-conditions', locale, checkpoints)
  const lowBusiness = business(locale, 'low', suffix); await fill(page, lowBusiness)
  await expect(page.getByTestId('expense-total')).toHaveText('CNY 9,999.99'); await expect(page.getByTestId('route-preview')).toContainText('1 approval stage included')
  let posts = 0; page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith(`${BASE}/documents`)) posts++ })
  await page.locator('#expense-currency').selectOption('USD'); await page.getByTestId('submit-expense').click()
  await expect(page.locator('.sf-alert')).toContainText('currency does not match'); const currencyMismatchPosts = posts; expect(currencyMismatchPosts).toBe(0)
  await expect(page.locator('.sf-mini-flow .conditional-skipped')).toHaveCount(0)
  await captures(page, info, 'expense-wrong-currency', locale, checkpoints)
  await page.locator('#expense-currency').selectOption('CNY')
  let low = await mutation(page, `${BASE}/documents`, () => page.getByTestId('submit-expense').click())
  expect(low.request.routing.stepIds).toEqual(['finance']); expect(low.request.routing.evaluations[0].predicates[0].actualValue).toBe('CNY 9999.99')
  await expect(page.locator('.sf-snapshot-flow > li.conditional-skipped')).toContainText('Condition not met')
  await captures(page, info, 'expense-low-frozen', locale, checkpoints, low)
  await select(page, legacyBusiness.title); await expect(page.getByTestId('routing-progress')).toHaveCount(0)
  await captures(page, info, 'expense-legacy-frozen', locale, checkpoints, legacy)
  const highBusiness = business(locale, 'threshold', suffix); await fill(page, highBusiness)
  await expect(page.getByTestId('expense-total')).toHaveText('CNY 10,000.00'); await expect(page.getByTestId('route-preview')).toContainText('2 approval stages included')
  let high = await mutation(page, `${BASE}/documents`, () => page.getByTestId('submit-expense').click())
  expect(high.request.routing.stepIds).toEqual(['manager', 'finance']); expect(high.request.routing.evaluations[0].predicates[0].actualValue).toBe('CNY 10000')
  await captures(page, info, 'expense-threshold-entered', locale, checkpoints, high)
  const rejectedBusiness = business(locale, 'rejected', suffix); await fill(page, rejectedBusiness)
  let rejected = await mutation(page, `${BASE}/documents`, () => page.getByTestId('submit-expense').click())
  await switchUser(page, 'bob'); await page.getByTestId('review-tab').click()
  await expect(page.locator('.sf-request-item').filter({ hasText: lowBusiness.title })).toHaveCount(0)
  await select(page, highBusiness.title, 'review'); high = await vote(page, high, 'bob', comment)
  expect(high.request.currentStepId).toBe('manager'); await select(page, highBusiness.title, 'handled')
  await captures(page, info, 'expense-threshold-partial', locale, checkpoints, high)
  await select(page, rejectedBusiness.title, 'review'); rejected = await vote(page, rejected, 'bob', locale === 'zh' ? '凭证说明需要补充，暂不通过。' : 'Receipt description needs clarification before approval.', 'REJECT')
  expect(rejected.request.status).toBe('REJECTED'); await select(page, rejectedBusiness.title, 'handled')
  await captures(page, info, 'expense-rejected', locale, checkpoints, rejected)
  await switchUser(page, 'carol'); await select(page, highBusiness.title, 'review'); high = await vote(page, high, 'carol', comment)
  expect(high.request.currentStepId).toBe('finance'); await captures(page, info, 'expense-threshold-finance', locale, checkpoints, high)
  high = await vote(page, high, 'carol', comment); expect(high.request.status).toBe('APPROVED')
  await select(page, highBusiness.title, 'handled'); await captures(page, info, 'expense-threshold-approved', locale, checkpoints, high)
  await switchUser(page, 'alice'); await page.getByTestId('designer-tab').click()
  await page.getByTestId('select-step').first().click()
  await page.getByLabel('Condition 1 threshold', { exact: true }).fill('0')
  const later = await mutation(page, `${BASE}/process`, () => page.getByTestId('publish').click()); expect(later.version).toBe(published.version + 1)
  await select(page, lowBusiness.title); await expect(page.getByTestId('routing-progress')).toContainText('0 / 1')
  await captures(page, info, 'expense-low-after-publication', locale, checkpoints, low)
  const nextBusiness = business(locale, 'new', suffix); await fill(page, nextBusiness)
  await expect(page.getByTestId('route-preview')).toContainText('2 approval stages included')
  const next = await mutation(page, `${BASE}/documents`, () => page.getByTestId('submit-expense').click())
  expect(next.request.routing.stepIds).toEqual(['manager', 'finance']); expect(next.request.processVersion).toBe(later.version)
  await captures(page, info, 'expense-new-publication', locale, checkpoints, next)
  await switchUser(page, 'carol'); await select(page, lowBusiness.title, 'review'); low = await vote(page, low, 'carol', comment)
  expect(low.request.status).toBe('APPROVED'); expect(low.request.history).toHaveLength(2)
  await select(page, lowBusiness.title, 'handled'); await captures(page, info, 'expense-low-approved', locale, checkpoints, low)
  const stored = await api(request, 'alice', `${BASE}/requests`), views = [legacy, low, high, rejected, next]
  for (const view of views) expect(stored.find(item => item.request.id === view.request.id)).toEqual(view)
  expect(errors).toEqual([])
  if (captureEnabled) writeFileSync(info.outputPath('expense-routing-receipt.json'), JSON.stringify({ ...await sourceProvenance(), result: 'passed', realBackend: true, browser: 'Chromium', locale, versions: { legacy: legacyProcess.version, conditional: published.version, later: later.version }, currencyMismatchPosts, checkpoints, views }, null, 2), { flag: 'wx' })
})
