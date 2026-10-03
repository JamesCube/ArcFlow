import { test, expect } from '@playwright/test'

async function login(page, user) {
  await page.getByLabel('Demo account').selectOption(user)
  await page.getByLabel('Password', { exact: true }).fill(process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`])
  await page.getByRole('button', { name: 'Enter workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Leave approvals', exact: true })).toBeVisible()
}
async function switchUser(page, user) {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await login(page, user)
}
async function submit(page, title) {
  await page.getByLabel('Title', { exact: true }).fill(title)
  await page.getByLabel('Days', { exact: true }).fill('2')
  await page.getByLabel('Reason', { exact: true }).fill('Synthetic browser QA example. No personal information.')
  await page.getByRole('button', { name: 'Submit request', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Request submitted')
}
async function select(page, title) {
  await page.getByRole('button').filter({ has: page.getByText(title, { exact: true }) }).click()
}
async function screenshot(page, testInfo, name) {
  // Only authenticated workspace views, never the password form or network logs.
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true })
}

test('first run: single approval, designer, sequential approvals, replay guard, reload and errors', async ({ page }, testInfo) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await login(page, 'alice')
  await expect(page.getByTestId('submission-template')).toContainText('v1')
  await submit(page, 'First-run single approval')
  await expect(page.getByRole('button', { name: 'Approve request', exact: true })).toHaveCount(0)
  await switchUser(page, 'bob')
  await select(page, 'First-run single approval')
  await page.getByRole('button', { name: 'Approve request', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Request approved.')

  await switchUser(page, 'alice')
  await page.getByTestId('process-tab').click()
  await page.getByTestId('process-name').fill('Two-step synthetic leave approval')
  await page.getByLabel('Step 1 name', { exact: true }).fill('Team review')
  await page.getByTestId('add-step').click()
  await page.getByLabel('Step 2 name', { exact: true }).fill('Final review')
  await page.getByLabel('Step 2 approver', { exact: true }).selectOption('carol')
  await page.getByRole('button', { name: 'Move step 2 up', exact: true }).click()
  await expect(page.getByLabel('Step 1 name', { exact: true })).toHaveValue('Final review')
  await page.getByRole('button', { name: 'Move step 1 down', exact: true }).click()
  await expect(page.getByLabel('Step 1 name', { exact: true })).toHaveValue('Team review')
  // Invalid drafts cannot publish; reset returns to the loaded persisted version.
  await page.getByLabel('Step 2 name', { exact: true }).fill(' ')
  await expect(page.getByTestId('publish')).toBeDisabled()
  await page.getByLabel('Step 2 name', { exact: true }).fill('Final review')
  await page.getByTestId('publish').dblclick()
  await expect(page.getByRole('status')).toContainText('Template v2 published')
  await expect(page.getByTestId('publish')).toBeDisabled()
  await screenshot(page, testInfo, '01-published-designer')
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /Requests/ }).click()
  await submit(page, 'Sequential approval example')
  await screenshot(page, testInfo, '02-applicant-submission')

  // Carol is a participant but cannot act before Bob.
  await switchUser(page, 'carol')
  await select(page, 'Sequential approval example')
  await expect(page.getByRole('button', { name: /^Approve/ })).toHaveCount(0)
  await page.getByTestId('process-tab').click()
  await expect(page.getByTestId('publish')).toHaveCount(0)
  await expect(page.getByText('Read-only template', { exact: true })).toBeVisible()
  await switchUser(page, 'bob')
  await select(page, 'Sequential approval example')
  let decisions = 0
  await page.route('**/api/requests/*/decisions', async route => {
    decisions++
    await new Promise(resolve => setTimeout(resolve, 300))
    await route.continue()
  })
  await page.getByRole('button', { name: 'Approve step', exact: true }).dblclick()
  await expect(page.getByRole('status')).toContainText('still pending')
  expect(decisions).toBe(1)
  await expect(page.locator('.timeline li').filter({ hasText: 'Team review · approved' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: /^Approve/ })).toHaveCount(0)
  await page.unroute('**/api/requests/*/decisions')
  await switchUser(page, 'carol')
  await select(page, 'Sequential approval example')
  await page.getByRole('button', { name: 'Approve request', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Request approved.')
  await screenshot(page, testInfo, '03-completed-history')

  // Reload intentionally clears in-memory credentials; persisted work survives login.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Choose your perspective' })).toBeVisible()
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')
  await login(page, 'alice')
  await select(page, 'Sequential approval example')
  await expect(page.locator('.detail > .card-heading .status')).toHaveText('approved')
  await expect(page.locator('.timeline li')).toHaveCount(3)

  // Publishing a new version must not rewrite the selected request snapshot.
  await page.getByTestId('process-tab').click()
  await page.getByRole('button', { name: 'Move step 2 up', exact: true }).click()
  await page.getByTestId('publish').click()
  await expect(page.getByRole('status')).toContainText('Template v3 published')
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /Requests/ }).click()
  await expect(page.getByTestId('instance-snapshot')).toContainText('v2')
  await expect(page.getByTestId('submission-template')).toContainText('v3')
  await submit(page, 'Rejection example')
  await switchUser(page, 'carol')
  await select(page, 'Rejection example')
  await page.getByRole('button', { name: 'Reject request', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Request rejected.')
  await expect(page.getByRole('button', { name: /^Approve/ })).toHaveCount(0)

  // Visible recoverable network error: leave existing data in place, allow refresh.
  await page.route('**/api/requests', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic temporary outage' }) }))
  await page.getByTestId('refresh').click()
  await expect(page.getByRole('alert')).toContainText('Synthetic temporary outage')
  await page.unroute('**/api/requests')
  await page.getByTestId('refresh').click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('refreshed')
  await expect(page.locator('.detail > .card-heading .status')).toHaveText('rejected')
  expect(errors).toEqual([])
})
