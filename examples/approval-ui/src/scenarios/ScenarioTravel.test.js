import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import ScenarioApp from './ScenarioApp.vue'
import ScenarioForm from './ScenarioForm.vue'
import { getScenarioHandler } from './scenario-registry.js'
import { catalogFixture, clone, decidedFixture, people, processFixture, travelFixture, travelProcessFixture, travelTemplateFixture, travelViewFixture, viewFixture } from './scenario-fixtures.js'
import { validateScenarioCatalog } from './scenario-template.js'
enableAutoUnmount(afterEach)
const BASE = '/scenarios/oa-travel'
function setup(identity = 'alice', items = []) {
  const server = { identity, items: clone(items), travel: travelProcessFixture(), expense: processFixture(), expenseItems: [], onPost: null }
  const api = { login: vi.fn(user => { server.identity = user }), logout: vi.fn(), request: vi.fn(async (path, options) => {
    if (options?.method === 'POST') return server.onPost(path, options)
    return clone({ '/me': people.find(person => person.id === server.identity), '/people': people, '/scenarios': catalogFixture(), [`${BASE}/process`]: server.travel, [`${BASE}/requests`]: server.items, '/scenarios/oa-expense/process': server.expense, '/scenarios/oa-expense/requests': server.expenseItems }[path])
  }) }
  return { wrapper: mount(ScenarioApp, { attachTo: document.body, props: { api } }), server, api }
}
async function login(c, user = 'alice') {
  await c.wrapper.find('.sf-login-form select').setValue(user)
  await c.wrapper.find('input[type=password]').setValue('synthetic-test-password')
  await c.wrapper.find('.sf-login-form').trigger('submit'); await flushPromises()
}
const tab = async (c, id) => { await c.wrapper.find(`[data-testid=${id}-tab]`).trigger('click'); await flushPromises() }
async function openTravel(c) { await c.wrapper.find('[data-testid=open-travel]').trigger('click'); await flushPromises() }
async function fill(c) {
  const business = travelFixture()
  for (const key of ['businessId', 'title', 'reason', 'destination', 'startDate', 'endDate', 'estimatedCost', 'purpose']) await c.wrapper.find(`#travel-${key}`).setValue(business[key])
}

describe('two distinct typed scenarios through one renderer', () => {
  it('opens a distinct Travel catalog card and form in the current session without line items', async () => {
    const c = setup(); await login(c)
    expect(c.wrapper.findAll('.sf-template-card')).toHaveLength(6)
    expect(c.wrapper.find('.sf-travel-art').text()).toContain('A clear itinerary')
    await openTravel(c)
    expect(c.api.login).toHaveBeenCalledTimes(1)
    expect(c.wrapper.find('.sf-page-title h1').text()).toBe('A clear plan before the trip.')
    expect(c.wrapper.findAll('.sf-line-card')).toHaveLength(0)
    expect(c.wrapper.find('[data-testid=add-expense-line]').exists()).toBe(false)
    expect(c.wrapper.find('#expense-title').exists()).toBe(false)
    expect(c.wrapper.find('[data-testid=submit-travel]').exists()).toBe(true)
    expect(c.wrapper.find('.sf-mini-flow').text()).toContain('Trip review')
    expect(c.wrapper.find('.sf-context-card').text()).toContain('does not book travel, reimburse expenses or issue a payment')
  })
  it('preserves both form drafts and independent designer drafts when using catalog cards', async () => {
    const c = setup(); await login(c)
    await c.wrapper.find('[data-testid=open-expense]').trigger('click')
    await c.wrapper.find('#expense-title').setValue('Unsent expense')
    await tab(c, 'designer'); await c.wrapper.find('[data-testid=process-name]').setValue('Local Expense process')
    await tab(c, 'catalog'); await openTravel(c); await fill(c)
    await tab(c, 'designer'); await c.wrapper.find('[data-testid=process-name]').setValue('Local Travel process')
    await tab(c, 'catalog'); await c.wrapper.find('[data-testid=open-expense]').trigger('click')
    // Returning through the catalog preserves this scope's designer tab.
    await tab(c, 'new')
    expect(c.wrapper.find('#expense-title').element.value).toBe('Unsent expense')
    await tab(c, 'designer'); expect(c.wrapper.find('[data-testid=process-name]').element.value).toBe('Local Expense process')
    expect(c.wrapper.find('[data-testid=undo]').attributes('disabled')).toBeUndefined()
    await c.wrapper.find('[data-testid=undo]').trigger('click')
    expect(c.wrapper.find('[data-testid=process-name]').element.value).toBe('Expense approval')
    await tab(c, 'catalog'); await openTravel(c); await tab(c, 'new')
    expect(c.wrapper.find('#travel-title').element.value).toBe(travelFixture().title)
    await tab(c, 'designer'); expect(c.wrapper.find('[data-testid=process-name]').element.value).toBe('Local Travel process')
    expect(c.wrapper.find('[data-testid=undo]').attributes('disabled')).toBeUndefined()
    await c.wrapper.find('[data-testid=undo]').trigger('click')
    expect(c.wrapper.find('[data-testid=process-name]').element.value).toBe('Business travel review')
    expect(c.api.login).toHaveBeenCalledTimes(1)
  })
  it('derives inclusive duration and exact estimated cost without accepting a duration field', async () => {
    const c = setup(); await login(c); await openTravel(c); await fill(c)
    expect(c.wrapper.find('[data-testid=travel-duration]').text()).toBe('3 days')
    expect(c.wrapper.find('[data-testid=travel-total]').text()).toBe('CNY 2,800.00')
    expect(c.wrapper.find('#travel-durationDays').exists()).toBe(false)
    await c.wrapper.find('#travel-endDate').setValue('2026-10-12')
    expect(c.wrapper.find('[data-testid=travel-duration]').text()).toBe('1 day')
    await c.wrapper.find('#travel-currency').setValue('JPY'); await c.wrapper.find('#travel-estimatedCost').setValue('2800')
    expect(c.wrapper.find('[data-testid=travel-total]').text()).toBe('JPY 2,800')
  })
  it('focuses invalid date ranges and provides bilingual validation without posting', async () => {
    const c = setup(); await login(c); await openTravel(c); await fill(c)
    await c.wrapper.find('#travel-endDate').setValue('2027-01-10')
    await c.wrapper.find('.sf-scenario-form').trigger('submit'); await flushPromises()
    expect(c.wrapper.find('#travel-endDate-error').text()).toContain('1–90 days')
    expect(document.activeElement.id).toBe('travel-endDate')
    await c.wrapper.find('.sf-topbar select').setValue('zh')
    expect(c.wrapper.find('#travel-endDate-error').text()).toContain('1–90 天')
    await c.wrapper.find('#travel-endDate').setValue('2026-10-14'); await c.wrapper.find('#travel-estimatedCost').setValue('1.001')
    await c.wrapper.find('.sf-scenario-form').trigger('submit'); await flushPromises()
    expect(c.wrapper.find('#travel-estimatedCost-error').text()).toContain('最多两位小数')
    expect(c.api.request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
  })
  it('uses Travel-specific bilingual reason guidance rather than reimbursement copy', async () => {
    const c = setup(); await login(c); await openTravel(c); await fill(c)
    await c.wrapper.find('#travel-reason').setValue('')
    await c.wrapper.find('.sf-scenario-form').trigger('submit'); await flushPromises()
    expect(c.wrapper.find('#travel-reason-error').text()).toBe('Enter a business justification, up to 2,000 characters.')
    await c.wrapper.find('.sf-topbar select').setValue('zh')
    expect(c.wrapper.find('#travel-reason-error').text()).toBe('请填写出差事由，最多 2,000 字。')
    expect(c.wrapper.find('#travel-reason-error').text()).not.toContain('报销')
  })
  it('submits typed numeric money to the Travel route and shows the saved itinerary', async () => {
    const c = setup(); await login(c); await openTravel(c); await fill(c)
    c.server.onPost = async (path, options) => {
      expect(path).toBe(`${BASE}/documents`)
      const body = JSON.parse(options.body)
      expect(body.business.estimatedCost).toBe(2800); expect(body.business).not.toHaveProperty('durationDays'); expect(body.business).not.toHaveProperty('lines')
      return travelViewFixture()
    }
    await c.wrapper.find('.sf-scenario-form').trigger('submit'); await flushPromises()
    expect(c.wrapper.find('[role=status]').text()).toContain('Travel request saved')
    expect(c.wrapper.find('.sf-detail-header h2').text()).toBe(travelFixture().title)
    expect(c.wrapper.find('.sf-detail-fields').text()).toContain('Shanghai')
    expect(c.wrapper.find('[data-testid=saved-travel-duration]').text()).toBe('3 days')
    expect(c.wrapper.find('.sf-saved-lines').exists()).toBe(false)
    expect(c.wrapper.find('.sf-request-item').text()).toContain('Shanghai · 3 days')
    await c.wrapper.find('.sf-topbar select').setValue('zh')
    expect(c.wrapper.find('[role=status]').text()).toContain('出差申请已保存')
  })
  it('uses Travel review controls and keeps original-step retained notes inside this scenario', async () => {
    const before = travelViewFixture(), c = setup('bob', [before]); await login(c, 'bob'); await openTravel(c); await tab(c, 'review')
    await c.wrapper.find('.sf-request-item').trigger('click'); await c.wrapper.find('#scenario-comment').setValue('Travel note')
    c.server.onPost = async path => { expect(path).toBe(`${BASE}/requests/travel-1/decisions`); return decidedFixture(before, 'bob', 'APPROVE', 'Different stored note') }
    await c.wrapper.find('[data-testid=approve-travel]').trigger('click'); await flushPromises()
    expect(c.wrapper.find('.sf-retained-note textarea').element.value).toBe('Travel note')
    expect(c.wrapper.find('[data-testid=approve-expense]').exists()).toBe(false)
    await tab(c, 'catalog'); await c.wrapper.find('[data-testid=open-expense]').trigger('click'); await tab(c, 'review')
    expect(c.wrapper.find('[data-testid=retained-notes-summary]').exists()).toBe(false)
    await tab(c, 'catalog'); await openTravel(c); await tab(c, 'retained'); await c.wrapper.find('.sf-request-item').trigger('click')
    expect(c.wrapper.find('.sf-retained-note textarea').element.value).toBe('Travel note')
  })
})

describe('rendered review navigation preserves scene-scoped work', () => {
  const chooseScenario = async (c, type) => {
    await tab(c, 'catalog')
    await c.wrapper.get(`[data-testid=open-${type}]`).trigger('click'); await flushPromises()
    await tab(c, 'review')
  }
  it.each(['en', 'zh'])('preserves both selected requests and typed comments through actual catalog switches in %s', async locale => {
    const expense = viewFixture(), travel = travelViewFixture(), c = setup('bob', [travel])
    c.server.expenseItems = [expense]
    await login(c, 'bob'); await c.wrapper.get('.sf-topbar select').setValue(locale)
    const notes = { expense: 'Expense draft / 报销审批草稿', travel: 'Travel draft / 出差审批草稿' }
    for (const type of ['expense', 'travel']) {
      await chooseScenario(c, type)
      await c.wrapper.get('.sf-request-item').trigger('click')
      await c.wrapper.get('#scenario-comment').setValue(notes[type])
    }
    for (const type of ['expense', 'travel', 'expense', 'travel']) {
      await chooseScenario(c, type)
      expect(c.wrapper.get('.sf-detail-header h2').text()).toBe(type === 'expense' ? expense.request.title : travel.request.title)
      expect(c.wrapper.get('.sf-request-item').attributes('aria-pressed')).toBe('true')
      expect(c.wrapper.get('#scenario-comment').element.value).toBe(notes[type])
      expect(c.wrapper.get(`[data-testid=approve-${type}]`).exists()).toBe(true)
      expect(c.wrapper.find(`[data-testid=approve-${type === 'expense' ? 'travel' : 'expense'}]`).exists()).toBe(false)
      // Re-selecting the same visible row is not an intent to discard its note.
      await c.wrapper.get('.sf-request-item').trigger('click')
      expect(c.wrapper.get('#scenario-comment').element.value).toBe(notes[type])
    }
    expect(c.api.login).toHaveBeenCalledTimes(1)
    expect(c.api.request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
  })
  it.each(['en', 'zh'].flatMap(locale => ['expense', 'travel'].map(type => [locale, type])))('hides an out-of-list selection without erasing its note in %s %s', async (locale, type) => {
    const fixture = type === 'expense' ? viewFixture : travelViewFixture
    const first = fixture(), other = fixture({ id: `${type}-other` }), handled = decidedFixture(fixture({ id: `${type}-handled` }), 'bob')
    const c = setup('bob', type === 'travel' ? [first, other, handled] : [])
    if (type === 'expense') c.server.expenseItems = [first, other, handled]
    await login(c, 'bob'); await c.wrapper.get('.sf-topbar select').setValue(locale); await chooseScenario(c, type)
    await c.wrapper.findAll('.sf-request-item')[0].trigger('click')
    const note = `${type} note / 保留的审批说明`
    await c.wrapper.get('#scenario-comment').setValue(note)
    for (const destination of ['mine', 'handled', 'new', 'designer']) {
      await tab(c, destination)
      expect(c.wrapper.find('.sf-request-detail').exists()).toBe(false)
      expect(c.wrapper.find('#scenario-comment').exists()).toBe(false)
      expect(c.wrapper.findAll('.sf-request-item[aria-pressed="true"]')).toHaveLength(0)
      await tab(c, 'review')
      expect(c.wrapper.get('.sf-request-item[aria-pressed="true"]').exists()).toBe(true)
      expect(c.wrapper.get('#scenario-comment').element.value).toBe(note)
    }
    // Explicitly choosing another request still clears the previous row's note.
    await c.wrapper.findAll('.sf-request-item')[1].trigger('click')
    expect(c.wrapper.get('#scenario-comment').element.value).toBe('')
    expect(c.wrapper.findAll('.sf-request-item')[0].attributes('aria-pressed')).toBe('false')
    expect(c.wrapper.findAll('.sf-request-item')[1].attributes('aria-pressed')).toBe('true')
    await tab(c, 'handled')
    expect(c.wrapper.find('.sf-request-detail').exists()).toBe(false)
    await c.wrapper.get('.sf-request-item').trigger('click')
    expect(c.wrapper.find('.sf-request-detail').exists()).toBe(true)
    expect(c.wrapper.find('#scenario-comment').exists()).toBe(false)
    await tab(c, 'review')
    expect(c.wrapper.find('.sf-request-detail').exists()).toBe(false)
    expect(c.wrapper.findAll('.sf-request-item[aria-pressed="true"]')).toHaveLength(0)
  })
})

describe('Travel metadata remains a compiled allow-list', () => {
  it.each([
    template => { template.lineItems = catalogFixture()[0].lineItems },
    template => { template.sections[1].fields[4].kind = 'number' },
    template => { template.sections[1].fields[0].path = 'durationDays' },
    template => { template.sections[1].fields[3].options[0].value = 'HOLIDAY' },
    template => { template.sections[1].fields[3].options.pop() },
    template => { template.sections[1].fields[3].options[1] = template.sections[1].fields[3].options[0] },
    template => { template.sections[1].fields[4].path = ['estimatedCost'] },
    template => { template.sections[1].fields.pop() },
  ])('rejects incompatible Travel metadata', mutate => { const catalog = catalogFixture(); mutate(catalog.find(template => template.id === 'oa-travel')); expect(() => validateScenarioCatalog(catalog)).toThrow() })
  it('renders all Travel fields from the validated metadata with the registered handler', () => {
    const handler = getScenarioHandler('oa-travel'), modelValue = travelFixture()
    const wrapper = mount(ScenarioForm, { props: { template: travelTemplateFixture(), handler, modelValue, locale: 'en', errors: [] } })
    expect(wrapper.findAll('.sf-field')).toHaveLength(10)
    expect(wrapper.find('#travel-destination').attributes('maxlength')).toBe('160')
    expect(wrapper.find('#travel-estimatedCost').attributes('inputmode')).toBe('decimal')
    expect(handler.lineKinds).toBeNull()
  })
})
