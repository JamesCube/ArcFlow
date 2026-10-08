import { test, expect } from '@playwright/test'

test.use({ locale: 'en-GB', timezoneId: 'UTC', reducedMotion: 'reduce', actionTimeout: 15_000 })
const title = 'Synthetic equipment quote · 合成设备报价'
const reason = 'Synthetic discount request for ten equipment sets. No customer message or CRM writeback. / 十套设备的合成报价，不发送客户通知或回写 CRM。'

async function backend(request, actor, path, data, expected = 200) {
  let response
  try {
    response = await request.fetch(`http://127.0.0.1:8080/api${path}`, {
      method: data === undefined ? 'GET' : 'POST', timeout: 15_000,
      headers: { Authorization: `Basic ${Buffer.from(`${actor}:${process.env[`APPROVAL_${actor.toUpperCase()}_PASSWORD`]}`).toString('base64')}`, 'X-Arcflow-Client': 'approval-demo' },
      ...(data === undefined ? {} : { data }),
    })
  } catch { throw new Error(`Synthetic ${actor} ${path} transport failed; authentication details omitted`) }
  expect(response.status(), `${path} response status`).toBe(expected)
  return response.json()
}
async function login(page, actor, { navigate = true } = {}) {
  if (navigate) await page.goto('/quote-discount.html')
  await page.locator('#language').selectOption('en')
  await page.locator('#username').selectOption(actor)
  try { await page.locator('#password').fill(process.env[`APPROVAL_${actor.toUpperCase()}_PASSWORD`]) }
  catch { throw new Error('Disposable password entry failed; private input omitted') }
  await page.locator('#login-form button').click()
  await expect(page.locator('#workspace')).toBeVisible()
  await expect(page.locator('#refresh')).toBeEnabled()
  await expect(page.locator('#password')).toHaveValue('')
}
async function logout(page) {
  await page.locator('#logout').click()
  await expect(page.locator('#login-panel')).toBeVisible()
  await expect(page.locator('#workspace')).toBeHidden()
  await expect(page.locator('#requests .record')).toHaveCount(0)
}
async function capture(page, testInfo, name) {
  await expect(page.locator('#workspace')).toBeVisible()
  await expect(page.locator('#password')).toBeHidden()
  await expect(page.locator('#password')).toHaveValue('')
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => scrollTo(0, 0))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow').toBe(true)
  const bytes = await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' })
  expect(bytes.subarray(1, 4).toString()).toBe('PNG')
  expect(bytes.readUInt32BE(16)).toBe(page.viewportSize().width)
}
function bodyFor(quote) {
  return { business: { type: 'quoteDiscount', businessId: quote.businessId, title, reason, customerRef: quote.customerRef,
    quoteRevision: quote.revision, item: quote.item, quantity: quote.quantity, listUnitPrice: quote.listUnitPrice,
    requestedUnitPrice: 850, currency: quote.currency, validUntil: quote.validUntil }, processVersion: 1 }
}
async function readRecord(page) {
  const record = page.locator('#requests .record').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
  await expect(record).toHaveCount(1)
  await expect(record).toContainText('Q-DEMO-001')
  await expect(record).toContainText('CNY 8500.00')
  await expect(record).toContainText('CNY 1500.00')
  await expect(record).toContainText('15%')
  await expect(record).toContainText('2099-12-31')
  return record
}

test('crm quote: real source checks, lost acknowledgement, immutable revision, two human steps, history recovery and bilingual screenshots', async ({ page, request }, testInfo) => {
  test.setTimeout(240_000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const quote = (await backend(request, 'alice', '/crm/quotes'))[0]
  const input = bodyFor(quote)
  expect(quote.businessId).toBe('Q-DEMO-001')
  expect(quote.revision).toBe(1)
  expect(await backend(request, 'alice', '/crm/requests')).toEqual([])
  // The actual host rejects tampering, generic-entry bypass and a non-owner. No responses are fabricated.
  await backend(request, 'bob', '/crm/documents', input, 403)
  await backend(request, 'alice', '/crm/documents', { ...input, business: { ...input.business, customerRef: 'OTHER-CUSTOMER' } }, 409)
  await backend(request, 'alice', '/crm/documents', { ...input, business: { ...input.business, listUnitPrice: 1100 } }, 409)
  await backend(request, 'alice', '/crm/documents', { ...input, business: { ...input.business, quoteRevision: 2 } }, 404)
  await backend(request, 'alice', '/documents', input, 400)

  await login(page, 'alice')
  await expect(page.locator('#quote-details')).toContainText('CUSTOMER-DEMO-A')
  await expect(page.locator('#process-steps')).toContainText('bob')
  await expect(page.locator('#process-steps')).toContainText('carol')
  await page.locator('#title').fill(title)
  await page.locator('#reason').fill(reason)
  let posts = 0
  const observe = req => { if (req.method() === 'POST' && req.url().endsWith('/api/crm/documents')) posts++ }
  page.on('request', observe)
  for (const invalid of ['0', '-1', '850.001', '1e2', '1000']) {
    await page.locator('#requested').fill(invalid)
    await page.locator('#quote-form button').click()
    await expect(page.locator('#message')).not.toBeEmpty()
    expect(posts).toBe(0)
  }
  await page.locator('#requested').fill('850.00')
  await expect(page.locator('#preview')).toContainText('CNY 8500.00')
  await expect(page.locator('#preview')).toContainText('CNY 1500.00')
  await page.locator('#requested').focus()
  await page.keyboard.press('Tab')
  await expect(page.locator('#quote-form button')).toBeFocused()
  for (const language of ['zh', 'en']) {
    await page.locator('#language').selectOption(language)
    await capture(page, testInfo, `crm-form-${language}-desktop`)
  }
  await page.locator('#language').selectOption('en')

  // Commit to the real backend, then drop only its first acknowledgement.
  // The refresh and retry must find the same durable quote revision binding.
  let committed
  const attempts = []
  await page.route('**/api/crm/documents', async route => {
    attempts.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] })
    if (attempts.length === 1) {
      const response = await route.fetch()
      expect(response.status()).toBe(201)
      committed = await response.json()
      await route.abort('failed')
    } else await route.continue()
  })
  await page.locator('#quote-form button').click()
  await expect(page.locator('#message')).toContainText('could not be confirmed')
  await readRecord(page)
  expect(committed.request.business.type).toBe('quoteDiscount')
  expect(committed.request.processId).toBe('quote-discount')
  expect(committed.request.business.quoteRevision).toBe(1)
  expect(committed.request.history).toHaveLength(1)
  expect(committed.requestedTotal).toBe('8500.00')
  await page.locator('#quote-form button').click()
  await expect(page.locator('#message')).toHaveText('Request saved.')
  expect(attempts).toHaveLength(2)
  expect(attempts[1]).toEqual(attempts[0])
  expect(attempts[0].key).toBeUndefined()
  await page.unroute('**/api/crm/documents')
  const id = committed.request.id
  expect(await backend(request, 'alice', '/crm/requests')).toEqual([committed])
  expect((await backend(request, 'bob', '/requests/inbox?box=PENDING')).items.some(row => row.id === id)).toBe(false)
  await backend(request, 'alice', `/crm/requests/${id}/decisions`, { stepId: 'salesManager', decision: 'APPROVE', comment: 'Applicant cannot approve' }, 403)
  await backend(request, 'carol', `/crm/requests/${id}/decisions`, { stepId: 'finance', decision: 'APPROVE', comment: 'Future step cannot act early' }, 409)

  // Refresh drops in-memory auth, but the server-side quote binding survives.
  await page.reload()
  await expect(page.locator('#login-panel')).toBeVisible()
  await login(page, 'alice', { navigate: false })
  await readRecord(page)
  await page.locator('#title').fill(title)
  await page.locator('#reason').fill(reason)
  await page.locator('#requested').fill('800.00')
  await page.locator('#quote-form button').click()
  await expect(page.locator('#message')).toContainText('changed')
  expect((await backend(request, 'alice', '/crm/requests'))[0].request.business.requestedUnitPrice).toBe(850)
  await page.locator('#requested').fill('850.00')
  await page.locator('#quote-form button').click()
  await expect(page.locator('#message')).toHaveText('Request saved.')
  expect((await backend(request, 'alice', '/crm/requests'))[0].request.id).toBe(id)
  await logout(page)

  await login(page, 'carol')
  await readRecord(page)
  await expect(page.locator('#requests button')).toHaveCount(0)
  await logout(page)
  await login(page, 'bob')
  let record = await readRecord(page)
  await expect(record.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
  await expect(page.locator('#create-panel')).toBeHidden()
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    for (const language of ['zh', 'en']) {
      await page.locator('#language').selectOption(language)
      await capture(page, testInfo, `crm-review-${language}-${viewport.width === 390 ? '390' : 'desktop'}`)
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.locator('#language').selectOption('en')

  // A failed real list reload must remove stale decision controls. It cannot fabricate saved state.
  await page.route('**/api/crm/requests', route => route.abort('failed'))
  await page.locator('#refresh').click()
  await expect(page.locator('#message')).toContainText('could not be loaded')
  await expect(page.locator('#requests button')).toHaveCount(0)
  await page.unroute('**/api/crm/requests')
  await page.locator('#refresh').click()
  record = await readRecord(page)
  await expect(page.locator('#refresh')).toBeEnabled()
  await record.locator('textarea').fill('Synthetic sales manager review / 合成销售经理审核')
  await record.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.locator('#message')).toHaveText('Your review is saved.')
  await expect(page.locator('#requests button')).toHaveCount(0)
  const partial = (await backend(request, 'bob', '/crm/requests'))[0]
  expect(partial.request.status).toBe('PENDING')
  expect(partial.request.currentStepId).toBe('finance')
  expect(partial.request.business).toEqual(committed.request.business)
  expect(partial.request.history.map(event => event.actorId)).toEqual(['alice', 'bob'])
  expect((await backend(request, 'bob', '/requests/inbox?box=HANDLED')).items.some(row => row.id === id)).toBe(false)
  await logout(page)

  await login(page, 'carol')
  record = await readRecord(page)
  await record.locator('textarea').fill('Synthetic finance review / 合成财务复核')
  await record.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.locator('#message')).toHaveText('Your review is saved.')
  record = await readRecord(page)
  await expect(record.locator('.status')).toHaveText('Approved')
  await expect(record.locator('button')).toHaveCount(0)
  const approved = (await backend(request, 'carol', '/crm/requests'))[0]
  expect(approved.request.business).toEqual(committed.request.business)
  expect(approved.request.history.map(event => [event.actorId, event.action])).toEqual([['alice', 'SUBMIT'], ['bob', 'APPROVE'], ['carol', 'APPROVE']])
  expect(approved.requestedTotal).toBe('8500.00')
  expect(await backend(request, 'alice', '/crm/documents', input, 201)).toEqual(approved)
  await backend(request, 'carol', `/crm/requests/${id}/decisions`, { stepId: 'finance', decision: 'REJECT', comment: 'Opposite retry' }, 409)
  for (const language of ['zh', 'en']) {
    await page.locator('#language').selectOption(language)
    await capture(page, testInfo, `crm-approved-${language}-desktop`)
  }

  // Navigation must not preserve usable Basic credentials or an authorized snapshot in history.
  await page.goto('/')
  await page.goBack()
  await expect(page.locator('#login-panel')).toBeVisible()
  await expect(page.locator('#workspace')).toBeHidden()
  await expect(page.locator('#requests .record')).toHaveCount(0)
  await login(page, 'alice', { navigate: false })
  await page.setViewportSize({ width: 390, height: 844 })
  await readRecord(page)
  await expect(page.locator('#quote-form')).toBeHidden()
  await expect(page.locator('.mobile-only')).toContainText('Small screens support viewing and review')
  await logout(page)
  expect(await page.evaluate(() => localStorage.length)).toBe(0)
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0)
  expect(errors).toEqual([])
  page.removeListener('request', observe)
})
