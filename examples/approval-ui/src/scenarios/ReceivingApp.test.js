import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, enableAutoUnmount, flushPromises } from '@vue/test-utils'
import ReceivingApp from './ReceivingApp.vue'
import { catalogFixture, clone, decidedFixture, deferred, people, receivingProcessFixture, receivingViewFixture } from './scenario-fixtures.js'
enableAutoUnmount(afterEach)
const BASE = '/scenarios/erp-receiving'
function setup({ items = [] } = {}) {
  const server = { identity: 'alice', items: clone(items), process: receivingProcessFixture(), onPost: null }
  const api = { login: vi.fn(user => { server.identity = user }), logout: vi.fn(), request: vi.fn(async (path, options) => {
    if (options?.method === 'POST') return server.onPost(path, options)
    return clone({ '/me': people.find(person => person.id === server.identity), '/people': people, '/scenarios': catalogFixture(), [`${BASE}/process`]: server.process, [`${BASE}/requests`]: server.items }[path])
  }) }
  const wrapper = mount(ReceivingApp, { attachTo: document.body, props: { api } })
  return { wrapper, server, api }
}
async function login(c, identity = 'alice') {
  await c.wrapper.find('.sf-login-form select').setValue(identity)
  await c.wrapper.find('input[type=password]').setValue('synthetic-test-password')
  await c.wrapper.find('.sf-login-form').trigger('submit'); await flushPromises()
}
const tab = (wrapper, id) => wrapper.find(`[data-testid=${id}-tab]`).trigger('click')
const sample = c => c.wrapper.find('[data-testid=fill-receiving-sample]').trigger('click')
const posts = c => c.api.request.mock.calls.filter(([, options]) => options?.method === 'POST')
describe('independent bilingual receiving desk', () => {
  it('opens the receiving form and accurately discloses the demo boundaries and fixed repeated reviewer', async () => {
    const c = setup(); await login(c)
    expect(c.wrapper.find('.rf-form').exists()).toBe(true); expect(c.wrapper.findAll('input[type=password]')).toHaveLength(0)
    expect(c.wrapper.text()).toContain('No real purchase order lookup'); expect(c.wrapper.text()).toContain('cumulative quantities across receipts')
    expect(c.wrapper.text()).toContain('Bob serves both warehouse inspection and procurement review')
    expect(c.wrapper.text()).toContain('No dynamic role assignment or separation-of-duties guarantee')
    expect(c.wrapper.find('[data-testid=process-name]').element.value).toBe('Receiving approval')
  })
  it('focuses invalid inputs and rejects unbalanced quantities without any POST', async () => {
    const c = setup(); await login(c); await c.wrapper.find('.rf-form').trigger('submit'); await flushPromises()
    expect(document.activeElement.id).toBe('receiving-businessId'); expect(posts(c)).toHaveLength(0)
    await sample(c); await c.wrapper.find('#receiving-lines-0-accepted').setValue('77'); await c.wrapper.find('.rf-form').trigger('submit'); await flushPromises()
    expect(c.wrapper.find('#receiving-lines-0-accepted').attributes('aria-invalid')).toBe('true')
    expect(document.activeElement.id).toBe('receiving-lines-0-accepted'); expect(posts(c)).toHaveLength(0)
    expect(c.wrapper.find('#receiving-lines-0-accepted-error').text()).toContain('Accepted plus rejected must equal received')
  })
  it('keeps decimal/exponent quantity input lossless and localizes the error', async () => {
    const c = setup(); await login(c); await sample(c); await c.wrapper.find('.sf-topbar select').setValue('zh')
    await c.wrapper.find('#receiving-lines-0-received').setValue('8e1'); await c.wrapper.find('.rf-form').trigger('submit'); await flushPromises()
    expect(c.wrapper.find('#receiving-lines-0-received').element.value).toBe('8e1'); expect(c.wrapper.find('#receiving-lines-0-received-error').text()).toContain('整数')
    expect(document.documentElement.lang).toBe('zh-CN'); expect(posts(c)).toHaveLength(0)
  })
  it('shows separate PCS and BOX sums, conditional exception requirement, and stable form values across navigation', async () => {
    const c = setup(); await login(c); await sample(c)
    expect(c.wrapper.find('[data-testid=receiving-summary]').text()).toContain('PCS'); expect(c.wrapper.find('[data-testid=receiving-summary]').text()).toContain('BOX')
    expect(c.wrapper.find('label[for=receiving-lines-0-exceptionReason]').text()).toBe('Exception reason (required)')
    expect(c.wrapper.find('label[for=receiving-lines-1-exceptionReason]').text()).toBe('Exception reason (optional)')
    expect(c.wrapper.find('#receiving-lines-0-exceptionReason').attributes('aria-required')).toBe('true')
    expect(c.wrapper.find('#receiving-lines-1-exceptionReason').attributes('aria-required')).toBe('false')
    await tab(c.wrapper, 'designer'); await tab(c.wrapper, 'new')
    expect(c.wrapper.find('#receiving-lines-0-received').element.value).toBe('80'); expect(c.wrapper.find('#receiving-lines-1-unit').element.value).toBe('BOX')
    await c.wrapper.find('#receiving-lines-0-ordered').setValue('79'); expect(c.wrapper.findAll('.rf-equation')[0].classes()).not.toContain('balanced')
    await c.wrapper.find('#receiving-lines-0-ordered').setValue('100')
    await c.wrapper.find('[data-testid=add-receiving-line]').trigger('click'); await flushPromises()
    expect(document.activeElement.id).toBe('receiving-lines-2-orderLineRef'); expect(c.wrapper.findAll('.rf-line-card')).toHaveLength(3)
    await c.wrapper.findAll('.sf-remove-line')[2].trigger('click'); expect(c.wrapper.findAll('.rf-line-card')).toHaveLength(2)
  })
  it('uses integer JSON and displays validated receiving snapshots after submission', async () => {
    const c = setup(); await login(c); await sample(c)
    c.server.onPost = async (_, options) => {
      const business = JSON.parse(options.body).business, view = receivingViewFixture({ business, title: business.title, reason: business.reason })
      expect(typeof business.lines[0].received).toBe('number'); return view
    }
    await c.wrapper.find('.rf-form').trigger('submit'); await flushPromises()
    expect(c.wrapper.find('[role=status]').text()).toContain('Receipt saved'); expect(c.wrapper.find('.sf-detail-header').text()).toContain('GOODS RECEIPT')
    expect(c.wrapper.find('[data-testid=receiving-saved-summary]').text()).toContain('PCS'); expect(c.wrapper.find('.sf-saved-lines').text()).toContain('Two bent brackets')
    expect(c.wrapper.findAll('.timeline li')).toHaveLength(1); expect(c.wrapper.find('[data-testid=approve-receiving]').exists()).toBe(false)
  })
  it('preserves retry explanation and suppresses repeated submit while the acknowledgement is pending', async () => {
    const c = setup(); await login(c); await sample(c); const pending = deferred(); c.server.onPost = () => pending.promise
    await c.wrapper.find('.rf-form').trigger('submit'); await c.wrapper.find('.rf-form').trigger('submit'); expect(posts(c)).toHaveLength(1)
    pending.reject(new TypeError('Lost response')); await flushPromises()
    expect(c.wrapper.find('[data-testid=submit-receiving]').text()).toContain('Retry original receipt')
    expect(c.wrapper.find('#receiving-lines-0-received').element.value).toBe('80'); expect(c.wrapper.find('[role=alert]').text()).toContain('original key and process version')
  })
  it('supports Carol ALL rejection, shows per-unit snapshots and read-only designer, then clears identity data', async () => {
    const before = receivingViewFixture(), c = setup({ items: [before] }); await login(c, 'carol')
    await c.wrapper.find('.sf-request-item').trigger('click'); expect(c.wrapper.find('[data-testid=reject-receiving]').exists()).toBe(true)
    await c.wrapper.find('#scenario-comment').setValue('Packaging failed inspection'); c.server.onPost = async () => decidedFixture(before, 'carol', 'REJECT', 'Packaging failed inspection')
    await c.wrapper.find('[data-testid=reject-receiving]').trigger('click'); await flushPromises()
    expect(c.wrapper.find('.sf-detail-header .sf-status').text()).toBe('Rejected'); expect(c.wrapper.find('[data-testid=approve-receiving]').exists()).toBe(false)
    expect(c.wrapper.find('.sf-snapshot-flow').text()).toContain('Not reached')
    await tab(c.wrapper, 'designer'); expect(c.wrapper.find('[data-testid=process-name]').exists()).toBe(false)
    await c.wrapper.find('[data-testid=receiving-logout]').trigger('click'); expect(c.wrapper.find('input[type=password]').element.value).toBe(''); expect(c.wrapper.find('.sf-request-detail').exists()).toBe(false)
    await login(c); expect(c.wrapper.find('#receiving-title').element.value).toBe('')
  })
  it('publishes a real ALL-to-ANY rule through the shared designer while preserving the old receiving snapshot', async () => {
    const before = receivingViewFixture(), c = setup({ items: [before] }); await login(c)
    await tab(c.wrapper, 'designer'); await c.wrapper.find('[data-step-id=receiving-inspection]').trigger('click')
    const mode = c.wrapper.find('[aria-label="Step 1 review mode"]')
    expect(mode.element.value).toBe('ALL'); await mode.setValue('ANY')
    expect(c.wrapper.find('.step-inspector .group-rule').text()).toContain('ANY: one approval completes this group.')
    c.server.onPost = async (path, options) => {
      expect(path).toBe(`${BASE}/process`)
      const body = JSON.parse(options.body)
      expect(body.expectedVersion).toBe(1); expect(body.definition.id).toBe('erp-receiving')
      expect(body.definition.nodes[1]).toMatchObject({ id: 'receiving-inspection', type: 'parallelApproval', assigneeIds: ['bob', 'carol'], completionMode: 'ANY' })
      expect(body.definition.nodes[2]).toMatchObject({ id: 'procurement-review', assigneeId: 'bob' })
      return { ...body.definition, version: 2 }
    }
    await c.wrapper.find('[data-testid=publish]').trigger('click'); await flushPromises()
    expect(c.wrapper.find('[role=status]').text()).toContain('Process v2 published')
    expect(c.wrapper.find('[aria-label="Step 1 review mode"]').element.value).toBe('ANY')
    await tab(c.wrapper, 'mine'); await c.wrapper.find('.sf-request-item').trigger('click')
    expect(c.wrapper.find('.sf-snapshot-flow .sf-group-rule').text()).toContain('ALL: everyone must approve')
    expect(c.wrapper.findAll('.sf-detail-section h3').find(heading => heading.text().includes('Approval snapshot')).text()).toContain('v1')
    expect(posts(c)).toHaveLength(1)
  })
  it('retains mismatched notes outside worklists and allows explicit dismissal', async () => {
    const before = receivingViewFixture(), c = setup({ items: [before] }); await login(c, 'bob'); await c.wrapper.find('.sf-request-item').trigger('click')
    await c.wrapper.find('#scenario-comment').setValue('My note'); c.server.onPost = async () => decidedFixture(before, 'bob', 'APPROVE', 'Other note')
    await c.wrapper.find('[data-testid=approve-receiving]').trigger('click'); await flushPromises()
    expect(c.wrapper.find('[data-testid=retained-notes-summary]').exists()).toBe(true)
    await c.wrapper.find('[data-testid=retained-notes-summary]').trigger('click'); expect(c.wrapper.find('.sf-retained-note textarea').element.value).toBe('My note')
    await c.wrapper.find('.sf-retained-note button').trigger('click'); expect(c.wrapper.find('[data-testid=retained-notes-summary]').exists()).toBe(false)
  })
})
