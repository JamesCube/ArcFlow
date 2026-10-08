import { test, expect } from '@playwright/test'

// Documentation captures, always from a disposable real backend. No mocked
// responses, rewritten pixels, auth traces, video or saved credentials.
test.skip(process.env.ARCFLOW_GALLERY !== '1', 'Dedicated fresh-backend documentation capture only')
test.use({ locale: 'en-GB', timezoneId: 'UTC', reducedMotion: 'reduce', actionTimeout: 15000 })
const stages = [
  { id: 'manager', type: 'approval', name: 'Manager review · 主管审批', assigneeId: 'bob' },
  { id: 'finance', type: 'approval', name: 'Final review · 复核确认', assigneeId: 'carol' },
]
async function api(request, actor, path, data) {
  let response
  try {
    response = await request.fetch(`http://127.0.0.1:8080/api${path}`, {
      method: data === undefined ? 'GET' : 'POST', timeout: 15000,
      headers: { Authorization: `Basic ${Buffer.from(`${actor}:${process.env[`APPROVAL_${actor.toUpperCase()}_PASSWORD`]}`).toString('base64')}`, 'X-Arcflow-Client': 'approval-demo' },
      ...(data === undefined ? {} : { data }),
    })
  } catch { throw new Error(`Gallery ${actor} ${path}: transport failed; private details omitted`) }
  expect(response.ok(), `${path}: HTTP ${response.status()}`).toBe(true)
  return response.json()
}
async function seed(request, name, nodes = stages) {
  const current = await api(request, 'alice', '/process')
  return api(request, 'alice', '/process', { expectedVersion: current.version, definition: {
    schemaVersion: nodes.some(n => n.type === 'parallelApproval') ? 3 : 2,
    id: 'leave-approval', version: current.version, name,
    nodes: [{ id: 'start', type: 'start', name: 'Submit', assigneeId: null }, ...nodes, { id: 'end', type: 'end', name: 'Completed', assigneeId: null }],
  } })
}
async function login(page, actor, crm = false) {
  await page.goto(crm ? '/quote-discount.html' : '/')
  if (crm) {
    await page.locator('#language').selectOption('en')
    await page.locator('#username').selectOption(actor)
  } else await page.getByLabel('Demo account').selectOption(actor)
  try { await (crm ? page.locator('#password') : page.getByLabel('Password', { exact: true })).fill(process.env[`APPROVAL_${actor.toUpperCase()}_PASSWORD`]) }
  catch { throw new Error('Disposable password entry failed; private details omitted') }
  await (crm ? page.locator('#login-form button') : page.getByRole('button', { name: 'Enter workspace' })).click()
  await expect(page.locator(crm ? '#workspace' : '.workspace')).toBeVisible()
  await expect(crm ? page.locator('#refresh') : page.getByTestId('refresh')).toBeEnabled()
}
async function capture(page, testInfo, name, crm = false) {
  for (const lang of ['zh', 'en']) {
    await (crm ? page.locator('#language') : page.getByTestId('workspace-language')).selectOption(lang)
    await expect(page.locator('input[type=password]:visible')).toHaveCount(0)
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => scrollTo(0, 0))
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow').toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${name}-${lang}.png`), fullPage: true, animations: 'disabled' })
  }
}
async function select(page, title, tab = 'requests') {
  await page.getByTestId(`${tab}-tab`).click()
  await page.locator('.request-item').filter({ has: page.getByText(title, { exact: true }) }).click()
  await expect(page.locator('.detail h2')).toHaveText(title)
}
async function mutation(page, path, action) {
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith(`/api${path}`) && r.request().method() === 'POST'), action(),
  ])
  expect(response.ok(), `UI ${path}: HTTP ${response.status()}`).toBe(true)
  const body = await response.json()
  await expect(page.getByTestId('refresh')).toBeEnabled()
  return body
}
async function leave(page, title) {
  await page.getByTestId('requests-tab').click()
  await page.getByTestId('request-type').selectOption('leave')
  await page.getByTestId('request-title').fill(title)
  await page.getByTestId('request-days').fill('3')
  await page.getByTestId('request-reason').fill('Handover prepared; team coverage confirmed. / 交接已完成，团队已确认工作安排。')
}
async function decide(page, item, decision, comment) {
  await page.getByTestId('decision-comment').fill(comment)
  return mutation(page, `/requests/${item.id}/decisions`, () => page.getByTestId(decision === 'APPROVE' ? 'approve-decision' : 'reject-decision').click())
}

test('gallery: designer configuration and staged OA ERP journeys', async ({ page, request }, info) => {
  test.skip(process.env.GALLERY_CRM_REJECT === '1')
  test.setTimeout(240000)
  await seed(request, 'Annual leave · 年假审批')
  await login(page, 'alice')
  await page.getByTestId('process-tab').click()
  await page.getByTestId('select-step').first().click()
  await capture(page, info, 'designer-01-sequential')
  await page.getByRole('button', { name: 'Insert approval before step 2', exact: true }).click()
  await page.getByLabel('Step 2 name', { exact: true }).fill('Team handover · 团队交接')
  await page.getByLabel('Step 2 review mode', { exact: true }).selectOption('ALL')
  await capture(page, info, 'designer-02-insert-all')
  await page.locator('.step-controls button').first().click()
  await expect(page.getByTestId('select-step').first()).toContainText('Team handover')
  await capture(page, info, 'designer-03-reorder')
  await page.getByTestId('undo').click()
  await expect(page.getByTestId('select-step').nth(1)).toContainText('Team handover')
  await expect(page.getByTestId('redo')).toBeEnabled()
  await capture(page, info, 'designer-04-undo')
  await page.getByLabel('Step 2 review mode', { exact: true }).selectOption('ANY')
  await expect(page.locator('.rule-callout')).toContainText('ANY')
  await capture(page, info, 'designer-05-any')
  await page.getByLabel('Step 2 participant Carol', { exact: true }).uncheck()
  await expect(page.getByTestId('publish')).toBeDisabled()
  await expect(page.locator('.validation-panel')).toBeVisible()
  await capture(page, info, 'designer-06-validation')
  await page.getByTestId('undo').click()
  const published = await mutation(page, '/process', () => page.getByTestId('publish').click())
  await expect(page.getByTestId('publish')).toBeDisabled()
  await expect(page.locator('.designer-state')).toContainText(`v${published.version}`)
  await capture(page, info, 'designer-07-published')

  const original = await seed(request, 'Annual leave · 年假审批')
  await login(page, 'alice')
  const title = 'Autumn break · 秋季年假'
  await leave(page, title)
  await capture(page, info, 'oa-01-form')
  let item = await mutation(page, '/requests', () => page.getByTestId('submit-request').click())
  expect(item.status).toBe('PENDING')
  await capture(page, info, 'oa-02-submitted')
  const next = await seed(request, 'New requests: team review · 新申请使用团队会签', [{ id: 'team', type: 'parallelApproval', name: 'Team review · 团队会签', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ALL' }])
  expect(next.version).toBeGreaterThan(original.version)
  await login(page, 'alice')
  await select(page, title)
  await expect(page.getByTestId('instance-snapshot')).toContainText(`v${original.version}`)
  expect((await api(request, 'alice', '/requests')).find(r => r.id === item.id).definition).toEqual(item.definition)
  await capture(page, info, 'designer-08-saved-version')
  await login(page, 'bob')
  await select(page, title, 'inbox')
  await page.getByTestId('decision-comment').fill('Handover checked. / 已确认交接。')
  await capture(page, info, 'oa-03-inbox')
  item = await decide(page, item, 'APPROVE', 'Handover checked. / 已确认交接。')
  expect(item.status).toBe('PENDING')
  await select(page, title, 'handled')
  await capture(page, info, 'oa-04-pending-next')
  await login(page, 'carol')
  await select(page, title, 'inbox')
  item = await decide(page, item, 'APPROVE', 'Leave recorded. / 已登记请假。')
  expect(item.status).toBe('APPROVED')
  await select(page, title, 'handled')
  await capture(page, info, 'oa-05-approved')
  await seed(request, 'Annual leave · 年假审批')
  await login(page, 'alice')
  await leave(page, 'Busy-week leave · 忙季休假')
  let rejected = await mutation(page, '/requests', () => page.getByTestId('submit-request').click())
  await login(page, 'bob')
  await select(page, rejected.title, 'inbox')
  rejected = await decide(page, rejected, 'REJECT', 'Please choose another date; coverage is unavailable. / 当前无人接替，请另选日期。')
  expect(rejected.status).toBe('REJECTED')
  await select(page, rejected.title, 'handled')
  await capture(page, info, 'oa-06-rejected')

  await seed(request, 'Purchase review · 采购审批')
  await login(page, 'alice')
  async function fillPurchase(title, reference) {
    await page.getByTestId('requests-tab').click()
    await page.getByTestId('request-type').selectOption('procurement')
    await page.getByTestId('request-title').fill(title)
    await page.getByTestId('request-business-id').fill(reference)
    await page.getByTestId('request-item').fill('Ergonomic chair · 人体工学椅')
    await page.getByTestId('request-quantity').fill('3')
    await page.getByTestId('request-unit-price').fill('199.50')
    await page.getByTestId('request-currency').selectOption('CNY')
    await page.getByTestId('request-reason').fill('Synthetic purchase request for the project workspace. No order or payment. / 项目工位的合成采购申请，不下单或付款。')
  }
  await fillPurchase('Office seating · 办公座椅', 'PO-GALLERY-001')
  await expect(page.getByTestId('procurement-total')).toContainText('598.50')
  await capture(page, info, 'erp-01-form')
  let purchase = await mutation(page, '/documents', () => page.getByTestId('submit-request').click())
  await capture(page, info, 'erp-02-submitted')
  await login(page, 'bob')
  await select(page, purchase.title, 'inbox')
  await expect(page.getByTestId('business-details')).toContainText('598.50')
  await page.getByTestId('decision-comment').fill('Quantity and unit price checked. / 已核对数量和单价。')
  await capture(page, info, 'erp-03-review')
  purchase = await decide(page, purchase, 'APPROVE', 'Quantity and unit price checked. / 已核对数量和单价。')
  expect(purchase.status).toBe('PENDING')
  await login(page, 'carol')
  await select(page, purchase.title, 'inbox')
  await capture(page, info, 'erp-04-final-review')
  purchase = await decide(page, purchase, 'APPROVE', 'Budget confirmed; approval only. / 已确认预算，仅记录审批。')
  expect(purchase.status).toBe('APPROVED')
  await select(page, purchase.title, 'handled')
  await capture(page, info, 'erp-05-approved')
  await login(page, 'alice')
  await fillPurchase('Extra seating · 追加座椅', 'PO-GALLERY-002')
  let declined = await mutation(page, '/documents', () => page.getByTestId('submit-request').click())
  await login(page, 'bob')
  await select(page, declined.title, 'inbox')
  declined = await decide(page, declined, 'REJECT', 'Use existing stock before purchasing. / 请先使用现有库存。')
  expect(declined.status).toBe('REJECTED')
  await select(page, declined.title, 'handled')
  await capture(page, info, 'erp-06-rejected')
})

test('gallery: isolated CRM quote journey', async ({ page, request }, info) => {
  test.setTimeout(120000)
  const rejected = process.env.GALLERY_CRM_REJECT === '1'
  await login(page, 'alice', true)
  await page.locator('#title').fill('Equipment quote · 设备报价')
  await page.locator('#reason').fill('Synthetic ten-unit quotation; no customer message or CRM writeback. / 十套设备的合成报价，不通知客户或回写 CRM。')
  await page.locator('#requested').fill('850.00')
  await expect(page.locator('#preview')).toContainText('8500.00')
  if (!rejected) await capture(page, info, 'crm-01-form', true)
  await page.locator('#quote-form button').click()
  await expect(page.locator('#requests .record')).toHaveCount(1)
  if (!rejected) await capture(page, info, 'crm-02-submitted', true)
  await login(page, 'bob', true)
  let record = page.locator('#requests .record')
  await record.locator('textarea').fill(rejected ? 'Discount exceeds this case budget. / 本案例折扣超出预算。' : 'Discount checked against the source quote. / 已核对源报价和折扣。')
  if (!rejected) await capture(page, info, 'crm-03-manager-review', true)
  await page.locator('#language').selectOption('en')
  await record.locator('textarea').fill(rejected ? 'Discount exceeds this case budget. / 本案例折扣超出预算。' : 'Discount checked against the source quote. / 已核对源报价和折扣。')
  await record.getByRole('button', { name: rejected ? 'Reject' : 'Approve', exact: true }).click()
  await expect(page.locator('#message')).toHaveText('Your review is saved.')
  await expect(record.locator('.status')).toHaveText(rejected ? 'Rejected' : 'Pending')
  if (rejected) {
    const saved = (await api(request, 'bob', '/crm/requests'))[0].request
    expect(saved.status).toBe('REJECTED')
    expect(saved.history.at(-1).comment).toContain('Discount exceeds this case budget.')
    await capture(page, info, 'crm-06-rejected', true)
    return
  }
  await login(page, 'carol', true)
  record = page.locator('#requests .record')
  await expect(record).toContainText('finance')
  const partial = (await api(request, 'carol', '/crm/requests'))[0].request
  expect(partial.currentStepId).toBe('finance')
  expect(partial.history.map(event => event.actorId)).toEqual(['alice', 'bob'])
  expect(partial.history.at(-1).comment).toContain('Discount checked against the source quote.')
  await record.locator('textarea').fill('Amount checked; approval only. / 已核对金额，仅记录审批。')
  await capture(page, info, 'crm-04-finance-review', true)
  await page.locator('#language').selectOption('en')
  await record.locator('textarea').fill('Amount checked; approval only. / 已核对金额，仅记录审批。')
  await record.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(record.locator('.status')).toHaveText('Approved')
  await expect(record.locator('button')).toHaveCount(0)
  const approved = (await api(request, 'carol', '/crm/requests'))[0].request
  expect(approved.status).toBe('APPROVED')
  expect(approved.history.map(event => [event.actorId, event.action])).toEqual([['alice', 'SUBMIT'], ['bob', 'APPROVE'], ['carol', 'APPROVE']])
  await capture(page, info, 'crm-05-approved', true)
})
