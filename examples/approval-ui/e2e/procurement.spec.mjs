import { test, expect } from '@playwright/test'

test.use({ locale: 'en-GB', timezoneId: 'UTC', reducedMotion: 'reduce', actionTimeout: 15_000 })
const reason = 'Synthetic procurement evaluation only. No order or payment. / 仅为合成采购审批演示，不下单、不付款。'

async function backend(request, user, path, data, key) {
  let response
  try {
    response = await request.fetch(`http://127.0.0.1:8080/api${path}`, {
      method: data === undefined ? 'GET' : 'POST', timeout: 15_000,
      headers: { Authorization: `Basic ${Buffer.from(`${user}:${process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`]}`).toString('base64')}`, 'X-Arcflow-Client': 'approval-demo', ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(data === undefined ? {} : { data }),
    })
  } catch { throw new Error(`Synthetic ${user} ${path} transport failed; authentication details omitted`) }
  expect(response.ok(), `${path}: HTTP ${response.status()}`).toBe(true)
  return response.json()
}
async function publish(request) {
  const current = await backend(request, 'alice', '/process')
  return backend(request, 'alice', '/process', { expectedVersion: current.version, definition: {
    schemaVersion: 2, id: 'leave-approval', version: current.version, name: 'Business review · 业务审批', nodes: [
      { id: 'start', type: 'start', name: 'Submit document · 提交单据', assigneeId: null },
      { id: 'procurement-review', type: 'approval', name: 'Budget review · 预算复核', assigneeId: 'bob' },
      { id: 'end', type: 'end', name: 'Completed · 完成', assigneeId: null },
    ],
  } })
}
async function login(page, user) {
  await page.goto('/')
  await page.getByLabel('Demo account').selectOption(user)
  try { await page.getByLabel('Password', { exact: true }).fill(process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`]) }
  catch { throw new Error('Disposable password entry failed; private input omitted') }
  await page.getByRole('button', { name: 'Enter workspace' }).click()
  await expect(page.locator('.workspace')).toBeVisible()
}
async function fillProcurement(page, title, reference) {
  await page.getByTestId('request-type').selectOption('procurement')
  await page.getByTestId('request-title').fill(title)
  await page.getByTestId('request-business-id').fill(reference)
  await page.getByTestId('request-item').fill('Ergonomic chair · 人体工学椅')
  await page.getByTestId('request-quantity').fill('3')
  await page.getByTestId('request-unit-price').fill('199.50')
  await page.getByTestId('request-currency').selectOption('CNY')
  await page.getByTestId('request-reason').fill(reason)
}
async function select(page, title) {
  await page.locator('.request-item').filter({ has: page.getByText(title, { exact: true }) }).click()
  await expect(page.locator('.detail h2')).toHaveText(title)
}
async function capture(page, testInfo, name, anchor) {
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  if (anchor) await anchor.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
  else await page.evaluate(() => scrollTo(0, 0))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow').toBe(true)
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: !anchor, animations: 'disabled' })
}

test('procurement: exact decimals, durable retry, immutable mixed documents, bilingual narrow UI and approval audit', async ({ page, request }, testInfo) => {
  test.setTimeout(180_000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const original = await publish(request)
  await login(page, 'alice')
  await fillProcurement(page, 'Office seating · 办公座椅', 'PO-UI-2026-001')
  await expect(page.getByTestId('procurement-total')).toContainText('598.50')

  // Explicit malformed/zero and JPY cases never reach the submission endpoint.
  let posts = 0
  const countPost = req => { if (req.method() === 'POST' && req.url().endsWith('/api/documents')) posts++ }
  page.on('request', countPost)
  for (const bad of ['0', '-1', '1.001', '1e2', '1,000']) {
    await page.getByTestId('request-unit-price').fill(bad)
    await page.getByTestId('submit-request').click()
    await expect(page.getByRole('alert')).toBeVisible()
    expect(posts).toBe(0)
  }
  await page.getByTestId('request-unit-price').fill('0.10')
  await expect(page.getByTestId('procurement-total')).toContainText('0.30')
  await page.getByTestId('request-currency').selectOption('JPY')
  await page.getByTestId('submit-request').click()
  await expect(page.getByRole('alert')).toBeVisible()
  expect(posts).toBe(0)
  await page.getByTestId('request-currency').selectOption('CNY')
  await page.getByTestId('request-unit-price').fill('199.50')
  await page.getByTestId('refresh').click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  for (let index = 0; index < 2; index++) {
    await page.getByTestId('inbox-tab').click()
    await page.getByTestId('requests-tab').click()
    await expect(page.getByTestId('request-business-id')).toHaveValue('PO-UI-2026-001')
    await expect(page.getByTestId('request-unit-price')).toHaveValue('199.50')
  }
  for (const locale of ['zh', 'en']) {
    await page.getByTestId('workspace-language').selectOption(locale)
    // Selecting a field and advancing with Tab is keyboard interaction with the real form.
    await page.getByTestId('request-unit-price').focus()
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('request-unit-price')).not.toBeFocused()
    expect(await page.evaluate(() => ['SELECT', 'INPUT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName))).toBe(true)
    await capture(page, testInfo, `procurement-form-${locale}-desktop`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  for (const locale of ['zh', 'en']) {
    await page.getByTestId('workspace-language').selectOption(locale)
    await capture(page, testInfo, `procurement-form-${locale}-390`, page.getByTestId('request-business-id'))
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByTestId('workspace-language').selectOption('en')

  // The backend really commits once. Only the first acknowledgement is lost;
  // no successful response or screenshot is fabricated.
  const attempts = []
  let committed
  await page.route('**/api/documents', async route => {
    attempts.push({ key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON() })
    if (attempts.length === 1) {
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      committed = await response.json()
      await route.abort('failed')
    } else await route.continue()
  })
  await page.getByTestId('submit-request').click()
  await expect(page.getByRole('alert')).toBeVisible()
  expect(committed.business.type).toBe('procurement')
  expect(committed.business.unitPrice).toBe(199.5)
  expect(committed.days).toBe(0)
  await publish(request)
  await page.getByTestId('refresh').click()
  await expect(page.getByTestId('refresh')).toBeEnabled()
  await expect(page.getByTestId('submission-template')).toContainText(`v${original.version}`)
  await page.getByTestId('submit-request').click()
  await expect(page.locator('.notice[role="status"]')).toContainText('Request submitted')
  expect(attempts).toHaveLength(2)
  expect(attempts[0].key).toBeTruthy()
  expect(attempts[1]).toEqual(attempts[0])
  await page.unroute('**/api/documents')
  page.off('request', countPost)
  const stored = (await backend(request, 'alice', '/requests')).filter(item => item.business?.businessId === 'PO-UI-2026-001')
  expect(stored).toHaveLength(1)
  expect(stored[0].history).toHaveLength(1)
  expect(stored[0].definition).toEqual(committed.definition)
  await expect(page.getByTestId('business-details')).toContainText('598.50')
  await expect(page.getByTestId('business-details').locator('input, textarea, select')).toHaveCount(0)

  // Existing leave authoring stays on the legacy route and mixed lists remain usable.
  await page.getByTestId('request-type').selectOption('leave')
  await page.getByTestId('request-title').fill('Mixed leave · 混合请假')
  await page.getByTestId('request-days').fill('2')
  await page.getByTestId('request-reason').fill('Synthetic leave regression / 合成请假回归')
  await page.getByTestId('submit-request').click()
  await expect(page.locator('.notice[role="status"]')).toContainText('Request submitted')
  for (let index = 0; index < 2; index++) {
    await page.getByTestId('process-tab').click()
    await page.getByTestId('requests-tab').click()
    await select(page, committed.title)
    await expect(page.getByTestId('business-details')).toContainText('598.50')
    await select(page, 'Mixed leave · 混合请假')
    await expect(page.locator('.detail')).toContainText('2 days')
  }

  // Only the current participant can decide; procurement fields stay immutable.
  await login(page, 'carol')
  await expect(page.locator('.request-item').filter({ hasText: committed.title })).toHaveCount(0)
  await login(page, 'bob')
  await page.getByTestId('inbox-tab').click()
  await select(page, committed.title)
  for (const locale of ['zh', 'en']) {
    await page.getByTestId('workspace-language').selectOption(locale)
    await capture(page, testInfo, `procurement-review-${locale}-desktop`)
    await page.setViewportSize({ width: 390, height: 844 })
    await capture(page, testInfo, `procurement-review-${locale}-390`, page.getByTestId('business-details'))
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  await page.getByTestId('workspace-language').selectOption('en')
  await page.getByTestId('decision-comment').fill('Synthetic budget checked · 合成预算已核对')
  await page.getByTestId('approve-decision').dblclick()
  await expect(page.locator('.notice[role="status"]')).toHaveText('Request approved.')
  await expect(page.getByTestId('approve-decision')).toHaveCount(0)
  await expect(page.locator('.timeline li')).toHaveCount(2)
  const approved = (await backend(request, 'alice', '/requests')).find(item => item.id === committed.id)
  expect(approved.business).toEqual(committed.business)
  expect(approved.history).toHaveLength(2)
  expect(approved.history[1].actorId).toBe('bob')
  for (const locale of ['zh', 'en']) {
    await page.getByTestId('workspace-language').selectOption(locale)
    await capture(page, testInfo, `procurement-approved-${locale}-desktop`)
  }
  expect(errors).toEqual([])
})

// One bounded fixture covers both real 25-row boxes. Each publication isolates
// membership from other journeys sharing the disposable suite backend.
test('member inbox pages preserve procurement, partial votes and later-stage overlap', async ({ page, request }) => {
  test.setTimeout(180_000)
  const current = await backend(request, 'alice', '/process')
  const definition = await backend(request, 'alice', '/process', {
    expectedVersion: current.version,
    definition: { ...current, schemaVersion: 3, name: 'Paged procurement review', nodes: [
      { id: 'start', type: 'start', name: 'Submit', assigneeId: null },
      { id: 'paged-group', type: 'parallelApproval', name: 'Budget group', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ALL' },
      { id: 'paged-final', type: 'approval', name: 'Final budget review', assigneeId: 'carol' },
      { id: 'end', type: 'end', name: 'Completed', assigneeId: null },
    ] },
  })
  const business = { type: 'procurement', businessId: `PO-PAGED-UI-${definition.version}`,
    title: `Paged procurement v${definition.version}`, reason, item: 'Synthetic adapter', quantity: 3, unitPrice: 0.10, currency: 'USD' }
  // Newest-first creation order deliberately places procurement beyond page one.
  const document = await backend(request, 'alice', '/documents', { business, processVersion: definition.version })
  const fillers = []
  for (let index = 1; index <= 26; index++) fillers.push(await backend(request, 'alice', '/requests', {
    title: `Paging leave v${definition.version} ${String(index).padStart(2, '0')}`, reason, days: 1, processVersion: definition.version,
  }))
  const expectedTitles = [...fillers].reverse().map(item => item.title).concat(document.title)
  const row = () => page.locator('.request-item').filter({ has: page.getByText(document.title, { exact: true }) })
  const rows = page.locator('.request-item strong')

  async function inboxPage(box, action, cursor = null) {
    const responsePromise = page.waitForResponse(response => {
      const url = new URL(response.url())
      return url.pathname === '/api/requests/inbox' && response.request().method() === 'GET'
        && url.searchParams.get('box') === box && url.searchParams.get('limit') === '25'
        && url.searchParams.get('processVersion') === String(definition.version)
        && url.searchParams.get('cursor') === cursor
    })
    await action()
    const response = await responsePromise
    expect(response.ok()).toBe(true)
    const result = await response.json()
    expect(result.items.length).toBeLessThanOrEqual(25)
    expect(result.items.every(item => item.processVersion === definition.version)).toBe(true)
    return result
  }
  async function filter(box) {
    await page.getByTestId(box === 'PENDING' ? 'inbox-tab' : 'handled-tab').click()
    await page.getByTestId('inbox-version').fill(String(definition.version))
    return inboxPage(box, () => page.getByTestId('inbox-filters').getByRole('button', { name: 'Apply filters', exact: true }).click())
  }
  async function more(box, first, titles) {
    expect(first.items).toHaveLength(25)
    expect(first.nextCursor).toBeTruthy()
    await expect(rows).toHaveText(first.items.map(item => item.title))
    await expect(row()).toHaveCount(0)
    const second = await inboxPage(box, () => page.getByTestId('inbox-more').click(), first.nextCursor)
    expect(second.nextCursor).toBeNull()
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(titles.length)
    await expect(rows).toHaveText(titles)
    await expect(page.getByTestId('inbox-more')).toHaveCount(0)
    return second
  }

  await login(page, 'carol')
  const first = await filter('PENDING')
  await more('PENDING', first, expectedTitles)
  // Refresh must discard the consumed cursor and reload exactly the first page.
  const restarted = await inboxPage('PENDING', () => page.getByTestId('refresh').click())
  await expect(page.getByTestId('refresh')).toBeEnabled()
  expect(restarted).toEqual(first)
  await more('PENDING', restarted, expectedTitles)
  await select(page, document.title)
  await expect(page.getByTestId('business-details')).toContainText('0.30')
  await expect(page.getByTestId('business-details').locator('input, textarea, select')).toHaveCount(0)
  expect(document.approverId).toBe('bob') // Carol is an eligible non-first member.
  await page.getByTestId('decision-comment').fill('Synthetic partial budget vote')
  await page.getByTestId('approve-decision').dblclick()
  await expect(page.locator('.notice[role="status"]')).toHaveText('Vote recorded. This group is still pending; awaiting Bob.')
  await expect(page.getByTestId('refresh')).toBeEnabled()
  await expect(page.getByTestId('approve-decision')).toHaveCount(0)
  const partial = (await backend(request, 'alice', '/requests')).find(item => item.id === document.id)
  expect(partial.status).toBe('PENDING')
  expect(partial.currentStepId).toBe('paged-group')
  expect(partial.business).toEqual(business)
  expect(partial.definition).toEqual(definition)
  expect(partial.history.slice(0, -1)).toEqual(document.history)
  expect(partial.history.filter(event => event.actorId === 'carol')).toHaveLength(1)
  const handled = await filter('HANDLED')
  expect(handled.items).toEqual([partial])
  await expect(rows).toHaveText([document.title])
  await expect(row().locator('.status')).toHaveText('pending')
  await select(page, document.title)
  await expect(page.getByTestId('approve-decision')).toHaveCount(0)

  // Actual votes, not terminal status, establish the handled collection. API
  // setup leaves every filler pending on Bob while growing handled past 25.
  for (const item of fillers) await backend(request, 'carol', `/requests/${item.id}/decisions`, {
    stepId: 'paged-group', decision: 'APPROVE', comment: 'Synthetic paging fixture vote',
  })
  const handledFirst = await inboxPage('HANDLED', () => page.getByTestId('refresh').click())
  await expect(page.getByTestId('refresh')).toBeEnabled()
  const handledSecond = await more('HANDLED', handledFirst, expectedTitles)
  expect(handledSecond.items.find(item => item.id === document.id)).toEqual(partial)
  await page.getByTestId('inbox-tab').click()
  await expect(rows).toHaveCount(0)
  await expect(page.getByTestId('inbox-more')).toHaveCount(0)

  // Bob completes ALL. Carol is now both a past voter and the next reviewer.
  const advanced = await backend(request, 'bob', `/requests/${document.id}/decisions`, {
    stepId: 'paged-group', decision: 'APPROVE', comment: 'Synthetic group completion',
  })
  expect(advanced.currentStepId).toBe('paged-final')
  const overlap = await inboxPage('PENDING', () => page.getByTestId('refresh').click())
  await expect(page.getByTestId('refresh')).toBeEnabled()
  expect(overlap.items).toEqual([advanced])
  await expect(rows).toHaveText([document.title])
  await page.getByTestId('handled-tab').click()
  await more('HANDLED', handledFirst, expectedTitles)
  await select(page, document.title)
  await expect(page.getByTestId('approve-decision')).toBeVisible()
  await page.getByTestId('inbox-tab').click()
  await select(page, document.title)
  await page.getByTestId('approve-decision').dblclick()
  await expect(page.locator('.notice[role="status"]')).toHaveText('Request approved.')
  await expect(page.getByTestId('refresh')).toBeEnabled()
  await expect(rows).toHaveCount(0)
  const approved = (await backend(request, 'alice', '/requests')).find(item => item.id === document.id)
  expect(approved.business).toEqual(document.business)
  expect(approved.definition).toEqual(document.definition)
  expect(approved.history.slice(0, -1)).toEqual(advanced.history)
  expect(approved.history.map(event => [event.actorId, event.stepId, event.action])).toEqual([
    ['alice', null, 'SUBMIT'], ['carol', 'paged-group', 'APPROVE'], ['bob', 'paged-group', 'APPROVE'], ['carol', 'paged-final', 'APPROVE'],
  ])

  // A real logout clears actor-scoped rows and filters; Bob's handled box must
  // contain only his one vote, not Carol's 26 synthetic filler votes.
  await page.getByTestId('sign-out').click()
  await expect(page.locator('.request-item')).toHaveCount(0)
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')
  await login(page, 'bob')
  const bobHandled = await filter('HANDLED')
  expect(bobHandled.items).toEqual([approved])
  expect(bobHandled.nextCursor).toBeNull()
  await select(page, document.title)
  await expect(page.getByTestId('business-details')).toContainText('0.30')
  await expect(page.getByTestId('approve-decision')).toHaveCount(0)
  await page.getByTestId('sign-out').click()
})
