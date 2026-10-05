import { test, expect } from '@playwright/test'

// The configured single worker owns one disposable real backend. Run this file in
// its own Playwright invocation for a clean gallery, rather than capturing other
// journeys' synthetic requests. No route fulfillment, mocked success, auth images,
// traces, videos or storage state are saved here. Explicit progress logs omit
// credentials, and API/password-entry failures are sanitized before reporting.
const ACTION_TIMEOUT = 15_000
test.use({
  locale: 'en-GB', timezoneId: 'UTC', reducedMotion: 'reduce',
  actionTimeout: ACTION_TIMEOUT, navigationTimeout: ACTION_TIMEOUT,
})

const DESKTOP = { width: 1440, height: 1000 }
const MOBILE = { width: 390, height: 844 }
const leaveName = 'Annual leave · 年假审批'
const sequentialSteps = [
  { id: 'manager-review', type: 'approval', name: 'Manager review · 主管审批', assigneeId: 'bob' },
  { id: 'hr-review', type: 'approval', name: 'HR review · 人事复核', assigneeId: 'carol' },
]
const reason = 'Release handover is ready; the team has confirmed coverage. / 发布交接已完成，团队已确认工作安排。'

function definition(name, stages) {
  return {
    schemaVersion: stages.some(node => node.type === 'parallelApproval') ? 3 : 2,
    id: 'leave-approval', version: 1, name,
    nodes: [
      { id: 'start', type: 'start', name: 'Submit leave', assigneeId: null },
      ...stages,
      { id: 'end', type: 'end', name: 'Completed', assigneeId: null },
    ],
  }
}

async function sceneStep(name, action) {
  // Progress markers contain only authored scene descriptions, never form values,
  // credentials, headers, response bodies, or browser console/network messages.
  console.log(`[visual showcase] ${name}`)
  return test.step(name, action)
}

async function backend(request, user, path, data) {
  const password = process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`]
  if (!password) throw new Error(`Missing disposable ${user} password configuration`)
  let response
  try {
    response = await request.fetch(`http://127.0.0.1:8080/api${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      timeout: ACTION_TIMEOUT,
      headers: {
        Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
        'X-Arcflow-Client': 'approval-demo',
      },
      ...(data === undefined ? {} : { data }),
    })
  } catch {
    // Playwright transport errors can include request headers. Never propagate
    // their message, cause, or call log into this credential-free summary.
    throw new Error(`${user} ${data === undefined ? 'GET' : 'POST'} ${path}: transport failed or exceeded ${ACTION_TIMEOUT}ms; private request details omitted`)
  }
  // Do not print request headers or response bodies on an API failure.
  expect(response.ok(), `${user} ${data === undefined ? 'GET' : 'POST'} ${path}: HTTP ${response.status()}`).toBe(true)
  return response.json()
}

async function seedTemplate(request, blueprint) {
  const current = await backend(request, 'alice', '/process')
  return backend(request, 'alice', '/process', {
    expectedVersion: current.version,
    definition: { ...blueprint, version: current.version },
  })
}

async function openWorkspace(page, user = 'alice') {
  // A fresh navigation intentionally discards in-memory credentials and drafts.
  // All screenshots happen only after this form has gone away.
  await sceneStep(`Open a fresh ${user} login`, () => page.goto('/'))
  await sceneStep(`Select the ${user} demo account`, async () => {
    // A wrapping <label> also contains the <select> option text. Exact label text
    // therefore cannot match 'Demo account'; use the same locator as the proven
    // functional journeys, while Playwright still requires a unique match.
    await page.getByLabel('Demo account').selectOption(user)
  })
  await sceneStep(`Authenticate ${user} and verify the workspace`, async () => {
    try {
      await page.getByLabel('Password', { exact: true }).fill(process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`])
    } catch {
      // Locator fill errors can echo the supplied value in their call log.
      throw new Error(`Could not enter the disposable ${user} password; private input details omitted`)
    }
    await page.getByRole('button', { name: 'Enter workspace', exact: false }).click()
    await expect(page.locator('.workspace')).toBeVisible()
    await expect(page.getByTestId('workspace-language')).toHaveValue('en')
  })
}

async function language(page, locale) {
  await sceneStep(`Switch workspace and designer to ${locale}`, async () => {
    await page.getByTestId('workspace-language').selectOption(locale)
    await expect(page.getByTestId('workspace-language')).toHaveValue(locale)
    // v-show preserves this control when the requests or inbox tab is selected.
    await expect(page.locator('.designer-workbench')).toHaveAttribute('lang', locale === 'zh' ? 'zh-CN' : 'en')
  })
}

async function showDesigner(page, locale = 'en') {
  await language(page, locale)
  await page.getByTestId('process-tab').click()
  await expect(page.locator('.designer-workbench')).toBeVisible()
}

async function stage(page, index = 0) {
  await page.getByTestId('select-step').nth(index).click()
}

async function requests(page) {
  await page.getByTestId('requests-tab').click()
}

async function selectRequest(page, title) {
  await page.locator('.request-item').filter({ has: page.getByText(title, { exact: true }) }).click()
  await expect(page.locator('.detail h2')).toHaveText(title)
}

async function fillLeave(page, title, days = 3) {
  await requests(page)
  await page.getByTestId('request-title').fill(title)
  await page.getByTestId('request-days').fill(String(days))
  await page.getByTestId('request-reason').fill(reason)
}

async function uiMutation(page, path, action) {
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith(`/api${path}`) && response.request().method() === 'POST', { timeout: ACTION_TIMEOUT }),
    action(),
  ])
  expect(response.ok(), `Workspace POST ${path}: HTTP ${response.status()}`).toBe(true)
  const item = await response.json()
  await expect(page.getByTestId('refresh')).toBeEnabled()
  return item
}

async function submitLeave(page, title, days = 3) {
  await fillLeave(page, title, days)
  return uiMutation(page, '/requests', () => page.getByTestId('submit-request').click())
}

async function publish(page) {
  await expect(page.getByTestId('publish')).toBeEnabled()
  const published = await uiMutation(page, '/process', () => page.getByTestId('publish').click())
  await expect(page.getByTestId('publish')).toBeDisabled()
  return published
}

async function decide(page, item, comment) {
  await page.getByTestId('decision-comment').fill(comment)
  return uiMutation(page, `/requests/${item.id}/decisions`, () => page.getByTestId('approve-decision').click())
}

async function noHorizontalOverflow(page) {
  const sizes = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }))
  expect(sizes.document, 'Document fits the viewport without horizontal scrolling').toBeLessThanOrEqual(sizes.viewport)
  expect(sizes.body, 'Body fits the viewport without horizontal scrolling').toBeLessThanOrEqual(sizes.viewport)
}

async function readableControl(locator, { minHeight = 36, minFont = 14 } = {}) {
  await expect(locator).toBeVisible()
  const box = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right, height: rect.height, font: parseFloat(getComputedStyle(element).fontSize), viewport: innerWidth }
  })
  expect(box.left, 'Control starts within viewport').toBeGreaterThanOrEqual(0)
  expect(box.right, 'Control ends within viewport').toBeLessThanOrEqual(box.viewport)
  expect(box.height, 'Control has a usable touch height').toBeGreaterThanOrEqual(minHeight)
  expect(box.font, 'Control text remains readable').toBeGreaterThanOrEqual(minFont)
}

async function capture(page, testInfo, name, { mobile = false, anchor } = {}) {
  await sceneStep(`Capture ${name}`, async () => {
    await expect(page.locator('.workspace')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    await page.evaluate(() => document.fonts.ready)
    if (anchor) await anchor.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
    else await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
    // Let layout and the reduced-motion scroll settle, without hiding real UI.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await noHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: !mobile, animations: 'disabled' })
  })
}

async function captureDesignerLocales(page, testInfo, prefix, mode) {
  for (const locale of ['zh', 'en']) {
    await language(page, locale)
    await expect(page.locator('.step-inspector')).toContainText(locale === 'zh' ? '节点设置' : 'Step settings')
    await expect(page.locator('.rule-callout')).toContainText(mode)
    await capture(page, testInfo, `${prefix}-${locale}-desktop`)
  }
}

test('visual showcase: bilingual leave design, applicant, ALL votes, ANY result and mobile controls', async ({ page, request }, testInfo) => {
  test.setTimeout(180_000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize(DESKTOP)
  // This file owns a disposable backend in its isolated Playwright invocation.
  // There is no shared template to restore, and no cleanup API call to mask a
  // primary browser error after Playwright closes the request context.
  await sceneStep('Recreate the original three-step workbench scene for an honest comparison', async () => {
    await sceneStep('Seed the original two-stage real process', () => seedTemplate(request, definition('Parallel synthetic review', [
      { id: 'team-group', type: 'parallelApproval', name: 'Team group', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ANY' },
      { id: 'final-review', type: 'approval', name: 'Final review', assigneeId: 'carol' },
    ])))
    await openWorkspace(page)
    await sceneStep('Open the Chinese designer', () => showDesigner(page, 'zh'))
    await sceneStep('Insert and configure the first ANY approval stage', async () => {
      await page.getByRole('button', { name: '在节点 1 前插入审批节点', exact: true }).click()
      await page.getByLabel('节点 1 名称', { exact: true }).fill('跨团队协同审批')
      await page.getByLabel('节点 1 审批方式', { exact: true }).selectOption('ANY')
    })
    await sceneStep('Verify invalid membership and undo restore the publishable draft', async () => {
      await page.getByLabel('节点 1 参与人 Carol', { exact: true }).uncheck()
      await expect(page.getByTestId('publish')).toBeDisabled()
      await page.getByTestId('undo').click()
      await expect(page.getByLabel('节点 1 参与人 Carol', { exact: true })).toBeChecked()
      await expect(page.getByTestId('select-step')).toHaveCount(3)
      await expect(page.getByTestId('process-name')).toHaveValue('Parallel synthetic review')
      await expect(page.getByTestId('publish')).toBeEnabled()
    })
    await capture(page, testInfo, '01-same-scene-three-step-any-zh-desktop')
  })

  let sequentialRequest
  await sceneStep('Show a real named sequential leave process and the applicant form in both languages', async () => {
    await seedTemplate(request, definition(leaveName, sequentialSteps))
    await openWorkspace(page)
    await showDesigner(page)
    await stage(page)
    for (const locale of ['zh', 'en']) {
      await language(page, locale)
      await expect(page.getByTestId('select-step').first()).toContainText('Manager review · 主管审批')
      await expect(page.getByTestId('select-step').last()).toContainText('HR review · 人事复核')
      await capture(page, testInfo, `02-sequential-leave-designer-${locale}-desktop`)
    }
    await page.setViewportSize({ width: 1024, height: 1000 })
    await capture(page, testInfo, '02-tablet-sequential-designer-en-1024')
    await page.setViewportSize(DESKTOP)
    await fillLeave(page, 'Autumn break · 秋季年假', 3)
    for (const locale of ['zh', 'en']) {
      await language(page, locale)
      await expect(page.locator('.new-request h2')).toHaveText(locale === 'zh' ? '新建请假申请' : 'New leave request')
      await expect(page.getByTestId('request-title')).toHaveValue('Autumn break · 秋季年假')
      await capture(page, testInfo, `03-applicant-new-leave-form-${locale}-desktop`)
    }
    sequentialRequest = await uiMutation(page, '/requests', () => page.getByTestId('submit-request').click())
    expect(sequentialRequest.status).toBe('PENDING')
    expect(sequentialRequest.currentStepId).toBe('manager-review')
    for (const locale of ['zh', 'en']) {
      await language(page, locale)
      await expect(page.getByTestId('instance-snapshot')).toContainText(leaveName)
      await capture(page, testInfo, `04-applicant-submitted-leave-${locale}-desktop`)
    }
    // Real backend decisions close this example before the focused group inbox.
    sequentialRequest = await backend(request, 'bob', `/requests/${sequentialRequest.id}/decisions`, {
      stepId: 'manager-review', decision: 'APPROVE', comment: 'Handover checked. / 已确认交接。',
    })
    sequentialRequest = await backend(request, 'carol', `/requests/${sequentialRequest.id}/decisions`, {
      stepId: 'hr-review', decision: 'APPROVE', comment: 'Leave record confirmed. / 已确认请假记录。',
    })
    expect(sequentialRequest.status).toBe('APPROVED')
  })

  let allRequest
  await sceneStep('Publish ALL in the real editor and capture mobile flow, inspector and Bob review', async () => {
    await showDesigner(page)
    await stage(page)
    await page.getByTestId('process-name').fill('Team leave · 团队休假会签')
    await page.getByLabel('Step 1 name', { exact: true }).fill('Handover review · 交接确认')
    await page.getByLabel('Step 1 review mode', { exact: true }).selectOption('ALL')
    await captureDesignerLocales(page, testInfo, '05-all-group-designer', 'ALL')
    await publish(page)

    await page.setViewportSize(MOBILE)
    for (const locale of ['zh', 'en']) {
      await language(page, locale)
      const switcher = page.locator('.mobile-designer-switch')
      await switcher.getByRole('button').first().click()
      await expect(page.locator('.designer-canvas')).toBeVisible()
      await expect(page.locator('.step-inspector')).not.toBeVisible()
      await readableControl(page.locator('.insert-step').first(), { minHeight: 44, minFont: 18 })
      await readableControl(page.getByTestId('add-step'), { minHeight: 44, minFont: 12 })
      await capture(page, testInfo, `06-mobile-all-workspace-${locale}-390`, { mobile: true })
      await capture(page, testInfo, `06-mobile-all-designer-flow-${locale}-390`, { mobile: true, anchor: switcher })
      await stage(page)
      await expect(page.locator('.step-inspector')).toBeVisible()
      await expect(page.locator('.designer-canvas')).not.toBeVisible()
      const name = page.getByLabel(locale === 'zh' ? '节点 1 名称' : 'Step 1 name', { exact: true })
      const mode = page.getByLabel(locale === 'zh' ? '节点 1 审批方式' : 'Step 1 review mode', { exact: true })
      await readableControl(name, { minHeight: 44, minFont: 16 })
      await readableControl(mode, { minHeight: 44, minFont: 16 })
      await readableControl(page.locator('.step-controls button').first(), { minHeight: 44, minFont: 12 })
      await capture(page, testInfo, `07-mobile-all-designer-inspector-${locale}-390`, { mobile: true, anchor: page.locator('.mobile-designer-switch') })
    }
    await page.setViewportSize(DESKTOP)
    await language(page, 'en')
    allRequest = await submitLeave(page, 'Winter leave · 冬季休假', 2)
    expect(allRequest.definition.nodes[1].completionMode).toBe('ALL')
    const savedSequential = (await backend(request, 'alice', '/requests')).find(item => item.id === sequentialRequest.id)
    expect(savedSequential.definition).toEqual(sequentialRequest.definition)

    await openWorkspace(page, 'bob')
    await page.getByTestId('inbox-tab').click()
    await selectRequest(page, allRequest.title)
    await page.getByTestId('decision-comment').fill('My handover is ready. / 我的交接已完成。')
    await page.setViewportSize(MOBILE)
    for (const locale of ['zh', 'en']) {
      await language(page, locale)
      await readableControl(page.getByTestId('decision-comment'), { minHeight: 44, minFont: 16 })
      await readableControl(page.getByTestId('approve-decision'), { minHeight: 44, minFont: 15 })
      await readableControl(page.getByTestId('reject-decision'), { minHeight: 44, minFont: 15 })
      await capture(page, testInfo, `08-mobile-bob-review-controls-${locale}-390`, { mobile: true, anchor: page.locator('.decision-form') })
    }
    await page.setViewportSize(DESKTOP)
    await language(page, 'en')
    allRequest = await decide(page, allRequest, 'My handover is ready. / 我的交接已完成。')
    expect(allRequest.status).toBe('PENDING')
    expect(allRequest.currentStepId).toBe('manager-review')
    for (const locale of ['zh', 'en']) {
      await language(page, locale)
      await expect(page.locator('.participant-vote[data-participant="bob"]')).toContainText(locale === 'zh' ? '已同意' : 'Approved')
      await expect(page.locator('.participant-vote[data-participant="carol"]')).toContainText(locale === 'zh' ? '等待决定' : 'Awaiting vote')
      await expect(page.getByTestId('approve-decision')).toHaveCount(0)
      await capture(page, testInfo, `09-bob-partial-all-awaiting-carol-${locale}-desktop`)
    }
  })

  let anyRequest
  await sceneStep('Publish ANY, record real decisions, and retain a read-only completed snapshot', async () => {
    await openWorkspace(page)
    await showDesigner(page)
    await stage(page)
    await page.getByTestId('process-name').fill('Flexible leave · 休假协同确认')
    await page.getByLabel('Step 1 name', { exact: true }).fill('Cover review · 工作安排确认')
    await page.getByLabel('Step 1 review mode', { exact: true }).selectOption('ANY')
    await captureDesignerLocales(page, testInfo, '10-any-group-designer', 'ANY')
    await publish(page)
    anyRequest = await submitLeave(page, 'Long weekend · 周末连休', 1)
    expect(anyRequest.definition.nodes[1].completionMode).toBe('ANY')

    await openWorkspace(page, 'bob')
    await page.getByTestId('inbox-tab').click()
    await selectRequest(page, anyRequest.title)
    anyRequest = await decide(page, anyRequest, 'Coverage confirmed; I can take over. / 已确认工作安排，我可以接手。')
    expect(anyRequest.status).toBe('PENDING')
    expect(anyRequest.currentStepId).toBe('hr-review')
    await expect(page.locator('.participant-vote[data-participant="carol"]')).toContainText('Not required')
    await openWorkspace(page, 'carol')
    await page.getByTestId('inbox-tab').click()
    await selectRequest(page, anyRequest.title)
    anyRequest = await decide(page, anyRequest, 'Leave recorded. Enjoy the break. / 请假已登记。')
    expect(anyRequest.status).toBe('APPROVED')
    expect(anyRequest.history).toHaveLength(3)

    // A subsequent real publication changes future requests only. No screenshot
    // text or saved request data is rewritten to manufacture this result.
    const nextTemplate = await seedTemplate(request, definition(leaveName, sequentialSteps))
    await openWorkspace(page)
    await selectRequest(page, anyRequest.title)
    for (const locale of ['zh', 'en']) {
      await language(page, locale)
      await expect(page.getByTestId('submission-template')).toContainText(`v${nextTemplate.version}`)
      await expect(page.getByTestId('instance-snapshot')).toContainText(`v${anyRequest.processVersion}`)
      await expect(page.getByTestId('instance-snapshot')).toContainText('ANY · Bob + Carol')
      await expect(page.locator('.participant-vote[data-participant="carol"]')).toContainText(locale === 'zh' ? '无需决定' : 'Not required')
      await expect(page.locator('.history-heading')).toHaveText(locale === 'zh' ? '操作记录' : 'Activity')
      await expect(page.locator('.timeline li')).toHaveCount(3)
      await expect(page.getByTestId('approve-decision')).toHaveCount(0)
      await capture(page, testInfo, `11-any-approved-readonly-snapshot-activity-${locale}-desktop`)
    }
    await page.setViewportSize(MOBILE)
    for (const locale of ['zh', 'en']) {
      await language(page, locale)
      await capture(page, testInfo, `12-mobile-any-saved-snapshot-${locale}-390`, { mobile: true, anchor: page.getByTestId('instance-snapshot') })
      await capture(page, testInfo, `13-mobile-any-completed-activity-${locale}-390`, { mobile: true, anchor: page.locator('.history-heading') })
    }
    const saved = await backend(request, 'alice', '/requests')
    expect(saved.find(item => item.id === anyRequest.id).definition).toEqual(anyRequest.definition)
    expect(saved.find(item => item.id === allRequest.id).definition).toEqual(allRequest.definition)
    expect(saved.find(item => item.id === allRequest.id).status).toBe('PENDING')
  })
  expect(errors).toEqual([])
})
