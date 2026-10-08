import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, enableAutoUnmount, flushPromises } from '@vue/test-utils'
import ScenarioApp from './ScenarioApp.vue'
import { catalogFixture, clone, decidedFixture, deferred, people, processFixture, viewFixture } from './scenario-fixtures.js'
enableAutoUnmount(afterEach)
const BASE = '/scenarios/oa-expense'
function setup({ identity = 'alice', items = [] } = {}) {
  const server = { identity, items: clone(items), process: processFixture(), catalog: catalogFixture(), onPost: null }
  const api = { login: vi.fn(user => { server.identity = user }), logout: vi.fn(), request: vi.fn(async (path, options) => {
    if (options?.method === 'POST') return server.onPost(path, options)
    return clone({ '/me': people.find(person => person.id === server.identity), '/people': people, '/scenarios': server.catalog, [`${BASE}/process`]: server.process, [`${BASE}/requests`]: server.items }[path])
  }) }
  const wrapper = mount(ScenarioApp, { attachTo: document.body, props: { api } })
  return { wrapper, server, api }
}
async function login(context, identity = 'alice') {
  await context.wrapper.find('.sf-login-form select').setValue(identity)
  await context.wrapper.find('input[type=password]').setValue('synthetic-test-password')
  await context.wrapper.find('.sf-login-form').trigger('submit'); await flushPromises()
}
const tab = (wrapper, id) => wrapper.find(`[data-testid=${id}-tab]`).trigger('click')
async function fillExpense(wrapper) {
  await wrapper.find('[data-testid=open-expense]').trigger('click')
  for (const [field, value] of Object.entries({ businessId: 'EXP-2026-001', title: 'Client visit expenses', reason: 'Synthetic expense fixture; no personal information.' })) await wrapper.find(`#expense-${field}`).setValue(value)
  for (const [field, value] of Object.entries({ spentOn: '2026-10-07', description: 'Train ticket', amount: '123.45', receiptRef: 'receipt-1' })) await wrapper.find(`#expense-lines-0-${field}`).setValue(value)
}

describe('dedicated expense scenario application', () => {
  it('loads a bilingual catalog and keeps login credentials only in the transport', async () => {
    const c = setup(); await login(c)
    expect(c.api.login).toHaveBeenCalledWith('alice', 'synthetic-test-password')
    expect(c.wrapper.find('.sf-shell').exists()).toBe(true); expect(c.wrapper.findAll('input[type=password]')).toHaveLength(0)
    expect(c.wrapper.find('.sf-template-info h2').text()).toBe('Expense reimbursement')
    await c.wrapper.find('.sf-topbar select').setValue('zh')
    expect(c.wrapper.find('.sf-shell').attributes('lang')).toBe('zh-CN'); expect(document.documentElement.lang).toBe('zh-CN')
    expect(c.wrapper.find('.sf-template-info h2').text()).toBe('费用报销')
    await c.wrapper.find('[data-testid=scenario-logout]').trigger('click')
    expect(c.wrapper.find('input[type=password]').element.value).toBe(''); expect(c.api.logout).toHaveBeenCalled()
  })
  it('focuses a useful field and does not POST an incomplete form', async () => {
    const c = setup(); await login(c); await c.wrapper.find('[data-testid=open-expense]').trigger('click')
    await c.wrapper.find('.sf-expense-form').trigger('submit'); await flushPromises()
    expect(c.wrapper.find('[role=alert]').text()).toContain('highlighted fields')
    expect(c.wrapper.find('#expense-businessId').attributes('aria-invalid')).toBe('true'); expect(document.activeElement.id).toBe('expense-businessId')
    expect(c.api.request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
  })
  it('preserves the draft across catalog navigation and localizes its numeric validation', async () => {
    const c = setup(); await login(c); await fillExpense(c.wrapper)
    await tab(c.wrapper, 'catalog'); await tab(c.wrapper, 'new')
    expect(c.wrapper.find('#expense-title').element.value).toBe('Client visit expenses')
    await c.wrapper.find('.sf-topbar select').setValue('zh'); await c.wrapper.find('#expense-lines-0-amount').setValue('1.001')
    await c.wrapper.find('.sf-expense-form').trigger('submit'); await flushPromises()
    expect(c.wrapper.find('#expense-lines-0-amount-error').text()).toContain('最多两位小数')
  })
  it('shows saved line details, total, route and immutable activity after validated submission', async () => {
    const c = setup(); await login(c); await fillExpense(c.wrapper)
    c.server.onPost = async (_, options) => {
      const business = JSON.parse(options.body).business, view = viewFixture({ business: { ...business, lines: business.lines.map(line => ({ ...line, amount: line.amount.toFixed(2) })) } })
      view.total = '123.45'; return view
    }
    await c.wrapper.find('.sf-expense-form').trigger('submit'); await flushPromises()
    expect(c.wrapper.find('[role=status]').text()).toContain('Expense request saved')
    expect(c.wrapper.find('.sf-request-detail h2').text()).toBe('Client visit expenses')
    expect(c.wrapper.find('.sf-saved-lines').text()).toContain('receipt-1')
    expect(c.wrapper.find('.sf-detail-header').text()).toContain('CNY 123.45')
    expect(c.wrapper.findAll('.timeline li')).toHaveLength(1)
    expect(c.wrapper.find('[data-testid=approve-expense]').exists()).toBe(false)
  })
  it('keeps the unsaved form and a precise retry explanation after an uncertain response', async () => {
    const c = setup(); await login(c); await fillExpense(c.wrapper); c.server.onPost = async () => { throw new TypeError('Lost response') }
    await c.wrapper.find('.sf-expense-form').trigger('submit'); await flushPromises()
    expect(c.wrapper.find('[role=alert]').text()).toContain('Submission was not confirmed')
    expect(c.wrapper.find('#expense-title').element.value).toBe('Client visit expenses')
    expect(c.wrapper.find('[data-testid=submit-expense]').text()).toContain('Retry original request')
    expect(c.wrapper.find('[role=status]').exists()).toBe(false)
  })
  it('shows current-review actions only to the correct participant and moves saved decisions into history', async () => {
    const before = viewFixture(), c = setup({ items: [before] }); await login(c, 'bob'); await tab(c.wrapper, 'review')
    await c.wrapper.find('.sf-request-item').trigger('click')
    expect(c.wrapper.find('[data-testid=approve-expense]').exists()).toBe(true)
    await c.wrapper.find('#scenario-comment').setValue('Receipt checked')
    c.server.onPost = async () => decidedFixture(before, 'bob', 'APPROVE', 'Receipt checked')
    await c.wrapper.find('[data-testid=approve-expense]').trigger('click'); await flushPromises()
    expect(c.wrapper.find('[data-testid=approve-expense]').exists()).toBe(false)
    await tab(c.wrapper, 'handled'); await c.wrapper.find('.sf-request-item').trigger('click')
    expect(c.wrapper.find('.timeline').text()).toContain('Receipt checked'); expect(c.wrapper.findAll('.timeline li')).toHaveLength(2)
  })
  it('accurately explains a mismatched comment without claiming automatic recovery', async () => {
    const before = viewFixture(), c = setup({ items: [before] }); await login(c, 'bob'); await tab(c.wrapper, 'review')
    await c.wrapper.find('.sf-request-item').trigger('click'); await c.wrapper.find('#scenario-comment').setValue('Original typed note')
    c.server.onPost = async () => decidedFixture(before, 'bob', 'APPROVE', 'Unexpected stored note')
    await c.wrapper.find('[data-testid=approve-expense]').trigger('click'); await flushPromises()
    expect(c.wrapper.find('[role=alert]').text()).toContain('Your typed note is retained')
    expect(c.wrapper.find('.sf-retained-note textarea').element.value).toBe('Original typed note')
    expect(c.wrapper.find('.sf-retained-note textarea').attributes('readonly')).toBeDefined()
    expect(c.wrapper.find('[role=alert]').text()).not.toContain('We checked')
    await c.wrapper.find('.sf-topbar select').setValue('zh')
    expect(c.wrapper.find('[role=alert]').text()).toContain('你填写的说明已保留')
    expect(c.wrapper.find('[role=alert]').text()).not.toContain('已尝试读取')
  })
  it('keeps a losing ANY reviewer’s original note reachable after ordinary worklists no longer include the request', async () => {
    const definition = processFixture({ schemaVersion: 3 })
    definition.nodes[1] = { id: 'manager', type: 'parallelApproval', name: 'Shared review', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ANY' }
    const before = viewFixture({ definition }), after = decidedFixture(before, 'carol', 'APPROVE', 'Carol completed the group')
    const c = setup({ items: [before] }); c.server.process = definition
    await login(c, 'bob'); await tab(c.wrapper, 'review'); await c.wrapper.find('.sf-request-item').trigger('click')
    await c.wrapper.find('#scenario-comment').setValue('Bob note that was not recorded')
    c.server.onPost = async () => { c.server.items = [after]; throw new TypeError('Lost response') }
    await c.wrapper.find('[data-testid=approve-expense]').trigger('click'); await flushPromises()
    expect(c.wrapper.findAll('.sf-request-item')).toHaveLength(0)
    await tab(c.wrapper, 'catalog')
    expect(c.wrapper.find('[data-testid=retained-tab]').exists()).toBe(true)
    await c.wrapper.find('[data-testid=retained-notes-summary]').trigger('click')
    expect(c.wrapper.find('.sf-detail-header h2').text()).toBe(before.request.title)
    expect(c.wrapper.find('.sf-retained-note textarea').element.value).toBe('Bob note that was not recorded')
    expect(c.wrapper.find('[data-testid=approve-expense]').exists()).toBe(false)
    await c.wrapper.find('.sf-retained-note button').trigger('click')
    expect(c.wrapper.find('[data-testid=retained-notes-summary]').exists()).toBe(false)
    expect(c.wrapper.find('[data-testid=retained-tab]').exists()).toBe(false)
  })
  it('binds the shared designer to oa-expense and makes it read-only for a reviewer', async () => {
    const c = setup(); await login(c, 'bob'); await tab(c.wrapper, 'designer')
    expect(c.wrapper.findComponent({ name: 'ProcessDesigner' }).props('expectedProcessId')).toBe('oa-expense')
    expect(c.wrapper.find('[data-testid=publish]').exists()).toBe(false)
    expect(c.wrapper.find('.designer-workbench').text()).toContain('Read-only')
  })
  it('clears the password on failed login without exposing a workspace', async () => {
    const c = setup(); c.api.request.mockRejectedValue(new Error('Unauthorized')); await login(c)
    expect(c.wrapper.find('.sf-shell').exists()).toBe(false); expect(c.wrapper.find('input[type=password]').element.value).toBe('')
    expect(c.wrapper.find('[role=alert]').text()).toContain('Sign-in could not be completed')
  })
  it('cancels the workspace lifecycle on unmount, suppressing stale login success', async () => {
    const c = setup(), pending = deferred(); c.api.request.mockImplementationOnce(() => pending.promise)
    await c.wrapper.find('input[type=password]').setValue('synthetic-test-password')
    await c.wrapper.find('.sf-login-form').trigger('submit'); c.wrapper.unmount(); pending.resolve(people[0]); await flushPromises()
    expect(c.api.logout).toHaveBeenCalled()
  })
})
