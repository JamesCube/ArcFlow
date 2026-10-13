import { test, expect } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { sourceProvenance } from './complex-evidence.mjs'
import { readRenderedGraphState, assertRenderedGraphState, readGraphCanvasState } from './graph-rendered-state.mjs'
import { persistedBusinessGraph, restartBusinessGraph } from './graph-business-restart.mjs'

const DESKTOP = {width: 1440, height: 1000}, MOBILE = {width: 390, height: 844}, NARROW = {width: 320, height: 844}
const cases = [
  {key: 'travel', ui: 'travel', type: 'travel', edge: 'highCost', fork: 'travelFork', join: 'travelJoin', first: 'operations', second: 'finance'},
  {key: 'receiving', ui: 'receiving', type: 'receiving', edge: 'hasExceptions', fork: 'receivingFork', join: 'receivingJoin', first: 'qualityReview', second: 'purchasingReview'},
  {key: 'quote', ui: 'quoteDiscount', type: 'quoteDiscount', edge: 'discounted', fork: 'quoteFork', join: 'quoteJoin', first: 'commercial', second: 'finance'},
]
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
test.use({locale: 'en-GB', timezoneId: 'UTC', reducedMotion: 'reduce', actionTimeout: 15000})
const root = (page, scenario) => page.locator(`[data-testid="graph-workspace"][data-scenario="${scenario.ui}"]`)
const base = scenario => `/graphs/${scenario.key}`
async function api(request, user, path, {method = 'GET', data, key, status = 200} = {}) {
  let response
  try {
    response = await request.fetch(`http://127.0.0.1:8080/api${path}`, {method,
      headers: {Authorization: `Basic ${Buffer.from(`${user}:${process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`]}`).toString('base64')}`,
        'Content-Type': 'application/json', 'X-Arcflow-Client': 'approval-demo', ...(key ? {'Idempotency-Key': key} : {})},
      ...(data === undefined ? {} : {data})})
  } catch { throw new Error('Business graph HTTP transport failed; private request details omitted') }
  expect(response.status(), `${method} ${path}`).toBe(status)
  return response.json()
}
async function login(page, user) {
  await page.goto('/')
  await page.getByLabel('Demo account').selectOption(user)
  try { await page.getByLabel('Password', {exact: true}).fill(process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`]) }
  catch { throw new Error('Unable to enter disposable credentials; private input omitted') }
  await page.getByRole('button', {name: 'Enter workspace →'}).click()
  await expect(page.getByTestId('process-tab')).toBeVisible()
}
async function choose(page, scenario, mode = 'requests') {
  if (mode === 'designer') { await page.getByTestId('process-tab').click(); await page.getByTestId('graph-mode').click() }
  else await page.getByTestId('graph-requests-tab').click()
  await page.getByTestId('graph-scenario').selectOption(scenario.ui)
  const view = root(page, scenario)
  await expect(view).toBeVisible()
  await expect(view.getByTestId('graph-refresh')).toBeEnabled()
  await expect(view.getByTestId(mode === 'designer' ? 'graph-process-name' : 'graph-new-request')).toBeVisible()
  return view
}
async function mutation(page, scenario, path, action, method = 'POST') {
  const [response] = await Promise.all([page.waitForResponse(r => r.url().endsWith(`/api${path}`) && r.request().method() === method), action()])
  expect(response.ok(), `${method} ${path}: ${response.status()}`).toBe(true)
  const value = await response.json()
  await expect(root(page, scenario).getByTestId('graph-refresh')).toBeEnabled()
  return value
}
async function select(page, scenario, id) {
  const view = await choose(page, scenario)
  await view.getByTestId('graph-refresh').click()
  await expect(view.getByTestId('graph-refresh')).toBeEnabled()
  await view.getByTestId(`graph-request-${id}`).click()
  await expect(view.getByTestId('graph-runtime')).toHaveAttribute('data-request-id', id)
  return view
}
async function fill(page, scenario, tag, {high = true, quoteIndex = 0} = {}) {
  const view = root(page, scenario)
  if (scenario.key === 'travel') {
    const values = {businessId: `TRIP-${tag}`, title: `Travel graph ${tag}`, reason: 'Synthetic travel budget review', destination: 'Hangzhou',
      startDate: '2026-11-10', endDate: '2026-11-13', estimatedCost: high ? '10000.00' : '9999.99'}
    for (const [field, value] of Object.entries(values)) await view.getByTestId(`graph-travel-${field}`).fill(value)
    await view.getByTestId('graph-travel-currency').selectOption('CNY')
    await view.getByTestId('graph-travel-purpose').selectOption('PROJECT_DELIVERY')
    await view.getByTestId('graph-travel-costCenter').selectOption('ENGINEERING')
  } else if (scenario.key === 'receiving') {
    const values = {businessId: `RECEIPT-${tag}`, title: `Receiving graph ${tag}`, reason: 'Synthetic receipt reconciliation', purchaseOrderRef: `PO-${tag}`, receivedOn: '2026-11-10'}
    for (const [field, value] of Object.entries(values)) await view.getByTestId(`graph-receiving-${field}`).fill(value)
    await view.getByTestId('graph-receiving-warehouse').selectOption('EAST')
    const line = {orderLineRef: `PO-LINE-${tag}`, description: 'Synthetic equipment', ordered: '10', received: '10', accepted: high ? '9' : '10', rejected: high ? '1' : '0', exceptionReason: high ? 'One damaged item' : ''}
    for (const [field, value] of Object.entries(line)) await view.getByTestId(`graph-receiving-0-${field}`).fill(value)
    await view.getByTestId('graph-receiving-0-unit').selectOption('PCS')
  } else {
    const businessId = ['Q-DEMO-001', 'Q-GRAPH-002', 'Q-GRAPH-003'][quoteIndex]
    await view.getByTestId('graph-quote-source').selectOption(JSON.stringify([businessId, 1]))
    await view.getByTestId('graph-quote-title').fill(`Quote graph ${tag}`)
    await view.getByTestId('graph-quote-reason').fill('Synthetic negotiated quote discount')
    await view.getByTestId('graph-quote-requestedUnitPrice').fill(high ? '800.00' : '800.01')
    await expect(view.getByTestId('graph-quote-businessId')).toContainText(businessId)
  }
}
async function capture(page, info, scenario, state, {instance = null, definition = null} = {}) {
  const view = root(page, scenario)
  for (const locale of ['en', 'zh']) for (const viewport of (state === 'properties' ? [NARROW] : [DESKTOP, MOBILE, NARROW])) {
    await page.getByTestId('workspace-language').selectOption(locale)
    await page.setViewportSize(viewport)
    if (state === 'designer' && await view.locator('.gf-mobile-switch').isVisible()) await view.locator('.gf-mobile-switch button').first().click()
    if (state === 'properties') {
      await view.locator('.gf-mobile-switch button').last().click()
      await expect(view.getByTestId('graph-properties')).toBeVisible()
      await expect(view.getByTestId('graph-field-0')).toBeVisible()
      await expect(view.getByTestId('graph-branch-name')).toHaveValue(definition.edges.find(edge => edge.id === scenario.edge).label)
    }
    await expect(view.locator('.gf-alert')).toHaveCount(0)
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => { scrollTo({top: 0, left: 0, behavior: 'instant'}); return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
    const layout = await page.evaluate(() => ({width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, x: scrollX, y: scrollY}))
    expect(layout.document).toBeLessThanOrEqual(layout.width)
    expect(layout.body).toBeLessThanOrEqual(layout.width)
    await view.locator('.gf-canvas').evaluateAll(elements => { for (const element of elements) { element.scrollTop = 0; element.scrollLeft = 0 } })
    const canvases = await view.evaluate(readGraphCanvasState)
    let renderedState = null
    if (instance) renderedState = assertRenderedGraphState(await view.getByTestId('graph-runtime').evaluate(readRenderedGraphState), instance)
    const visible = await view.evaluate(element => ({scenario: element.dataset.scenario, definitionId: element.dataset.definitionId,
      processName: element.querySelector('[data-testid="graph-process-name"]')?.value || null,
      fields: Array.from(element.querySelectorAll('[data-testid]')).filter(el => el.matches('input,select,textarea') && el.getBoundingClientRect().width > 0)
        .map(el => { const bounds = el.getBoundingClientRect(); return {testid: el.dataset.testid, value: el.value, disabled: el.disabled, bounds: {left: bounds.left, right: bounds.right}} })}))
    expect(visible.scenario).toBe(scenario.ui)
    if (state === 'designer') {
      expect(visible.processName).toBe(definition.name)
      expect(canvases.length).toBeGreaterThan(0)
      for (const canvas of canvases) { expect(canvas.nodeHorizontalClipping).toEqual([]); expect(canvas.fullyVisibleNodeIds).toEqual(canvas.allNodeIds) }
    }
    const name = `graph-business-${scenario.key}-${state}-${locale}-${viewport.width === 1440 ? 'desktop' : `${viewport.width}px`}`
    const bytes = await page.screenshot({fullPage: true, animations: 'disabled'})
    if (instance) expect(assertRenderedGraphState(await view.getByTestId('graph-runtime').evaluate(readRenderedGraphState), instance)).toEqual(renderedState)
    writeFileSync(info.outputPath(`${name}.png`), bytes)
    writeFileSync(info.outputPath(`${name}.json`), JSON.stringify({schemaVersion: 1, ...await sourceProvenance(), scenario: scenario.key, businessType: scenario.type,
      state, locale, viewport, fullPage: true, image: `${name}.png`, imageSHA256: hash(bytes), capturedAt: new Date().toISOString(),
      layout, visible, canvases, renderedState, definition, request: instance}, null, 2))
  }
  await page.setViewportSize(DESKTOP)
  await page.getByTestId('workspace-language').selectOption('en')
}
async function vote(page, scenario, instance, nodeId, decision = 'APPROVE') {
  const view = await select(page, scenario, instance.id)
  const task = instance.tasks.find(value => value.nodeId === nodeId)
  await view.getByTestId(`graph-comment-${nodeId}`).fill('Reviewed synthetic business data')
  return mutation(page, scenario, `${base(scenario)}/requests/${instance.id}/tasks/${encodeURIComponent(task.id)}/decision`,
    () => view.getByTestId(`graph-${decision === 'APPROVE' ? 'approve' : 'reject'}-${nodeId}`).click())
}
async function complete(pages, scenario, instance) {
  let current = instance
  for (let count = 0; current.status === 'PENDING' && count < 16; count++) {
    const task = current.tasks.find(value => value.status === 'ACTIVE')
    expect(task).toBeTruthy()
    const actor = task.participants.find(value => !task.votes.some(vote => vote.actorId === value))
    current = await vote(pages[actor], scenario, current, task.nodeId)
  }
  expect(current.status).toBe('APPROVED')
  return current
}
async function submit(page, scenario, tag, options) {
  const view = await choose(page, scenario)
  await view.getByTestId('graph-new-request').click()
  await fill(page, scenario, tag, options)
  return mutation(page, scenario, `${base(scenario)}/requests`, () => view.getByTestId('graph-submit').click())
}


// Deliberately lose a response only after the real server commits. The UI must
// preserve the original request across an unrelated workspace switch.
async function loseCommittedResponse(page, scenario, path, initialAction, retryAction) {
  const url = `**/api${path}`, attempts = []
  let lost = false, committed
  const handler = async route => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts.push({key: route.request().headers()['idempotency-key'], body: route.request().postData()})
    if (lost) return route.continue()
    lost = true
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    committed = await response.json()
    await route.abort('failed')
  }
  await page.route(url, handler)
  try {
    await initialAction()
    await expect(root(page, scenario).locator('.gf-alert')).toBeVisible()
    await page.getByTestId('graph-scenario').selectOption('payment')
    await choose(page, scenario)
    const restored = await mutation(page, scenario, path, retryAction)
    expect(restored).toEqual(committed)
    expect(attempts).toHaveLength(2)
    expect(attempts[0]).toEqual(attempts[1])
    expect(attempts[0].key).toBeTruthy()
    return {instance: restored, attempts}
  } finally { await page.unroute(url, handler) }
}

for (const scenario of cases) test(`business graph: ${scenario.key} authors and executes source-bound domain data across restart`, async ({page, browser, request}, info) => {
  test.setTimeout(360000)
  const tag = randomUUID().slice(0, 8), errors = [], checkpoints = []
  page.on('pageerror', error => errors.push(error.message))
  await login(page, 'alice')
  let view = await choose(page, scenario, 'designer')
  const initial = await api(request, 'alice', `${base(scenario)}/workspace`)
  expect(initial.definition.id).toBe(`${scenario.key}-graph`)
  const name = `${scenario.key} graph acceptance ${tag}`
  await view.getByTestId('graph-process-name').fill(name)
  await page.getByTestId('graph-scenario').selectOption('payment')
  await page.getByTestId('graph-scenario').selectOption(scenario.ui)
  await expect(view.getByTestId('graph-process-name')).toHaveValue(name)
  await view.getByTestId(`graph-branch-${scenario.edge}`).click()
  await view.getByTestId('graph-branch-name').fill(`Business exception route ${tag}`)
  if (scenario.key !== 'receiving') await view.getByTestId('graph-threshold-0').fill(scenario.key === 'quote' ? '20' : '10000')
  await mutation(page, scenario, `${base(scenario)}/draft`, () => view.getByTestId('graph-save').click(), 'PUT')
  const published = await mutation(page, scenario, `${base(scenario)}/publish`, () => view.getByTestId('graph-publish').click())
  expect(published.version).toBe(initial.definition.version + 1)
  await capture(page, info, scenario, 'designer', {definition: published})
  await view.getByTestId(`graph-branch-${scenario.edge}`).click()
  await capture(page, info, scenario, 'properties', {definition: published})
  checkpoints.push('scenario-bound-ui-author-save-publish-and-unsaved-switch')
  await view.getByTestId('graph-preview-toggle').click()
  await fill(page, scenario, `preview-${tag}`)
  const highPreview = await mutation(page, scenario, `${base(scenario)}/preview`, () => view.getByTestId('graph-preview').click())
  expect(highPreview.routes[0].selectedEdgeId).toBe(scenario.edge)
  await fill(page, scenario, `preview-${tag}`, {high: false})
  const lowPreview = await mutation(page, scenario, `${base(scenario)}/preview`, () => view.getByTestId('graph-preview').click())
  expect(lowPreview.routes[0].selectedEdgeId).toBe('otherwise')
  expect((await api(request, 'alice', `${base(scenario)}/requests`)).length).toBe(0)
  checkpoints.push('server-derived-high-default-preview-without-write')
  await fill(page, scenario, `high-${tag}`)
  await view.getByTestId('graph-preview-toggle').click()
  view = await choose(page, scenario)
  await view.getByTestId('graph-new-request').click()
  await capture(page, info, scenario, 'form')
  let submissionRecovery = null, decisionRecovery = null
  const high = scenario.key === 'travel'
    ? (submissionRecovery = await loseCommittedResponse(page, scenario, `${base(scenario)}/requests`,
        () => view.getByTestId('graph-submit').click(), () => view.getByTestId('graph-submit').click())).instance
    : await mutation(page, scenario, `${base(scenario)}/requests`, () => view.getByTestId('graph-submit').click())
  if (submissionRecovery) checkpoints.push('committed-submission-retry-keeps-scenario-body-and-key')
  expect(high.business.type).toBe(scenario.type)
  expect(high.routes[0].selectedEdgeId).toBe(scenario.edge)
  expect(high.definition).toEqual(published)
  // Later publication cannot change this already submitted business snapshot.
  view = await choose(page, scenario, 'designer')
  await view.getByTestId('graph-process-name').fill(`${name} next`)
  await mutation(page, scenario, `${base(scenario)}/draft`, () => view.getByTestId('graph-save').click(), 'PUT')
  const next = await mutation(page, scenario, `${base(scenario)}/publish`, () => view.getByTestId('graph-publish').click())
  const contexts = await Promise.all(['bob', 'carol'].map(() => browser.newContext({baseURL: 'http://localhost:5173', viewport: DESKTOP, locale: 'en-GB'})))
  const bob = await contexts[0].newPage(), carol = await contexts[1].newPage(), pages = {alice: page, bob, carol}
  for (const reviewer of [bob, carol]) reviewer.on('pageerror', error => errors.push(error.message))
  await Promise.all([login(bob, 'bob'), login(carol, 'carol')])
  let current = high
  if (scenario.key === 'travel') current = await vote(bob, scenario, current, 'manager')
  expect(current.tasks.filter(task => task.status === 'ACTIVE').map(task => task.nodeId).sort()).toEqual([scenario.first, scenario.second].sort())
  if (scenario.key === 'travel') {
    const reviewer = await select(bob, scenario, current.id)
    const task = current.tasks.find(item => item.nodeId === scenario.first)
    await reviewer.getByTestId(`graph-comment-${scenario.first}`).fill('Reviewed synthetic business data')
    decisionRecovery = await loseCommittedResponse(bob, scenario,
      `${base(scenario)}/requests/${current.id}/tasks/${encodeURIComponent(task.id)}/decision`,
      () => reviewer.getByTestId(`graph-approve-${scenario.first}`).click(),
      () => reviewer.getByTestId(`graph-retry-${scenario.first}`).click())
    current = decisionRecovery.instance
    expect(current.commands.filter(command => command.id === decisionRecovery.attempts[0].key)).toHaveLength(1)
    checkpoints.push('committed-decision-retry-keeps-scenario-body-and-key')
  } else current = await vote(bob, scenario, current, scenario.first)
  expect(current.forks[0].arrivedBranchIds).toHaveLength(1)
  expect(current.forks[0].fired).toBe(false)
  const beforeRestart = current, restart = await restartBusinessGraph(scenario.key, current, await sourceProvenance())
  await bob.reload(); await login(bob, 'bob'); await select(bob, scenario, high.id)
  const restored = await api(request, 'bob', `${base(scenario)}/requests/${high.id}`)
  expect(restored).toEqual(beforeRestart)
  expect(restored.definition).toEqual(published)
  restart.renderedAfterReload = assertRenderedGraphState(await root(bob, scenario).getByTestId('graph-runtime').evaluate(readRenderedGraphState), restored)
  await capture(bob, info, scenario, 'waiting-join', {instance: restored})
  checkpoints.push('real-child-jvm-restart-at-partial-join-preserves-frozen-business')
  current = await vote(carol, scenario, restored, scenario.second)
  if (scenario.key === 'quote') current = await vote(carol, scenario, current, 'final')
  expect(current.status).toBe('APPROVED')
  expect(current.business).toEqual(high.business)
  expect(current.routes).toEqual(high.routes)
  expect(current.definition).toEqual(published)
  restart.persistedAfterDecision = await persistedBusinessGraph(scenario.key, current)
  expect(restart.persistedAfterDecision.fileSHA256).not.toBe(restart.persistedBefore.fileSHA256)
  await select(carol, scenario, current.id)
  await capture(carol, info, scenario, 'approved', {instance: current})
  const approved = current
  checkpoints.push('independent-business-review-tasks-join-once-and-approve')
  // Refresh/relogin after restart through normal UI, then submit a different source identity.
  await page.reload(); await login(page, 'alice')
  let ordinary = await submit(page, scenario, `ordinary-${tag}`, {high: false, quoteIndex: 1})
  expect(ordinary.definition.version).toBe(next.version)
  expect(ordinary.routes[0].selectedEdgeId).toBe('otherwise')
  expect(ordinary.forks).toHaveLength(0)
  ordinary = await complete(pages, scenario, ordinary)
  await select(bob, scenario, ordinary.id)
  await capture(bob, info, scenario, 'default-approved', {instance: ordinary})
  if (scenario.key !== 'quote') await api(request, 'carol', `${base(scenario)}/requests/${ordinary.id}`, {status: 403})
  checkpoints.push('ordinary-default-route-and-unselected-reviewer-isolation')
  let rejected = await submit(page, scenario, `rejected-${tag}`, {high: true, quoteIndex: 2})
  if (scenario.key === 'travel') rejected = await vote(bob, scenario, rejected, 'manager')
  rejected = await vote(bob, scenario, rejected, scenario.first, 'REJECT')
  expect(rejected.status).toBe('REJECTED')
  expect(rejected.tasks.find(task => task.nodeId === scenario.second).status).toBe('CANCELLED')
  expect(rejected.forks[0].fired).toBe(false)
  await capture(bob, info, scenario, 'rejected', {instance: rejected})
  checkpoints.push('terminal-rejection-cancels-parallel-business-sibling')
  expect(errors).toEqual([])
  writeFileSync(info.outputPath(`graph-business-${scenario.key}-journey.json`), JSON.stringify({schemaVersion: 1, ...await sourceProvenance(), scenario: scenario.key,
    businessType: scenario.type, checkpoints, highPreview, lowPreview, approved, ordinary, rejected, restart, submissionRecovery, decisionRecovery, browserErrors: errors}, null, 2))
  await Promise.all(contexts.map(context => context.close()))
})
