import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { api } from './api'
import { pendingParticipants } from './process'
import { InvalidApprovalPayloadError } from './business-document'
vi.mock('./api', () => ({ api: { login: vi.fn(), logout: vi.fn(), request: vi.fn() } }))

const people = [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }, { id: 'carol', name: 'Carol' }]
const definition = { schemaVersion: 2, id: 'leave-approval', version: 1, name: 'Shared routing', nodes: [
  { id: 'start', type: 'start', name: 'Submitted', assigneeId: null },
  { id: 'review', type: 'approval', name: 'Review', assigneeId: 'bob' },
  { id: 'end', type: 'end', name: 'Complete', assigneeId: null },
] }
const business = { type: 'procurement', businessId: 'PO-001', title: 'Office chairs', reason: 'Team expansion', item: 'Ergonomic chair', quantity: 3, unitPrice: 199.5, currency: 'CNY' }
const at = '2026-10-06T01:00:00Z'
const document = { id: 'p1', title: business.title, reason: business.reason, days: 0, business, applicantId: 'alice', approverId: 'bob', status: 'PENDING', createdAt: at, updatedAt: at, decision: null, comment: null, processId: definition.id, processVersion: 1, definition, currentStepId: 'review', history: [{ action: 'SUBMIT', actorId: 'alice', stepId: null, comment: '', at }] }
const clone = value => structuredClone(value)
const wrappers = []
function setup(identity = 'alice', items = []) {
  const server = { items: clone(items), definition: clone(definition) }
  api.request.mockImplementation(async path => {
    if (path.startsWith('/requests/inbox?')) {
      const params = new URLSearchParams(path.split('?')[1])
      if (server.inboxPage) return server.inboxPage(params)
      return clone({ items: server.items.filter(item => params.get('box') === 'PENDING'
        ? pendingParticipants(item).includes(identity)
        : item.history.some(event => event.actorId === identity && ['APPROVE', 'REJECT'].includes(event.action))), nextCursor: null })
    }
    return clone({ '/me': people.find(person => person.id === identity), '/people': people, '/process': server.definition, '/requests': server.items }[path])
  })
  const wrapper = mount(App, { attachTo: window.document.body }); wrappers.push(wrapper)
  return { wrapper, server }
}
const field = (wrapper, id) => wrapper.find(`[data-testid="${id}"]`)
const posts = () => api.request.mock.calls.filter(([, options]) => options?.method === 'POST')
async function login(wrapper) { await wrapper.find('input[type=password]').setValue('synthetic-test-only'); await wrapper.find('.login-form').trigger('submit'); await flushPromises() }
async function fill(wrapper) {
  await field(wrapper, 'request-type').setValue('procurement')
  for (const [id, value] of [['request-title', business.title], ['request-reason', business.reason], ['request-business-id', business.businessId], ['request-item', business.item], ['request-quantity', '3'], ['request-unit-price', '199.50']]) await field(wrapper, id).setValue(value)
}
async function submit(wrapper) { await wrapper.find('.new-request').trigger('submit'); await flushPromises() }
const approved = () => {
  const event = { action: 'APPROVE', actorId: 'bob', stepId: 'review', comment: 'Checked', at: '2026-10-06T02:00:00Z' }
  return { ...clone(document), status: 'APPROVED', currentStepId: null, decision: 'APPROVE', comment: event.comment, updatedAt: event.at, history: [...clone(document.history), event] }
}
beforeEach(() => vi.resetAllMocks())
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()) })

describe('explicit bilingual procurement authoring', () => {
  it.each([[null], [[]], [{ id: 'bad', status: null }], [{ status: 'PENDING' }]].map(items => [items]))('fails closed before rendering a malformed request collection %j', async items => {
    const { wrapper } = setup('alice', items); await login(wrapper)
    expect(wrapper.find('.workspace').exists()).toBe(false)
    expect(wrapper.find('[role=alert]').exists()).toBe(true)
    expect(posts()).toHaveLength(0)
  })
  it('retains the last good typed detail but locks it when refresh returns a malformed row', async () => {
    const { wrapper, server } = setup('bob', [document]); await login(wrapper); await wrapper.find('.request-item').trigger('click')
    server.items = [null]
    await field(wrapper, 'refresh').trigger('click'); await flushPromises()
    expect(field(wrapper, 'business-details').text()).toContain('Ergonomic chair')
    expect(field(wrapper, 'approve-decision').exists()).toBe(false)
    expect(wrapper.find('[role=alert]').exists()).toBe(true)
  })

  it('defaults to legacy leave then sends only the typed procurement contract with an exact total', async () => {
    const { wrapper } = setup(); await login(wrapper)
    expect(field(wrapper, 'request-type').element.value).toBe('leave')
    expect(wrapper.find('.page-heading h1').text()).toBe('Business approvals')
    await fill(wrapper)
    expect(field(wrapper, 'request-days').exists()).toBe(false)
    expect(field(wrapper, 'procurement-total').text()).toBe('CNY 598.50')
    api.request.mockResolvedValueOnce(clone(document)); await submit(wrapper)
    expect(posts()).toHaveLength(1)
    const [path, options] = posts()[0]
    expect(path).toBe('/documents')
    expect(options.headers['Idempotency-Key']).toBeTruthy()
    expect(JSON.parse(options.body)).toEqual({ business, processVersion: 1 })
    expect(field(wrapper, 'request-title').element.value).toBe('')
    const details = field(wrapper, 'business-details')
    expect(details.text()).toContain('PO-001')
    expect(details.text()).toContain('CNY 598.50')
    expect(details.findAll('input,select,textarea')).toHaveLength(0)
    expect(wrapper.find('.request-item').text()).toContain('Procurement · CNY 598.50')
    expect(wrapper.find('.detail').text()).not.toContain('0 days')
  })
  it('keeps exact string inputs and translates field guidance, computed total and immutable business copy', async () => {
    const { wrapper } = setup(); await login(wrapper); await fill(wrapper)
    await field(wrapper, 'request-unit-price').setValue('0.10')
    expect(field(wrapper, 'request-unit-price').attributes('type')).toBe('text')
    expect(field(wrapper, 'request-unit-price').attributes('inputmode')).toBe('decimal')
    expect(field(wrapper, 'request-quantity').attributes('inputmode')).toBe('numeric')
    expect(field(wrapper, 'procurement-total').text()).toBe('CNY 0.30')
    await field(wrapper, 'workspace-language').setValue('zh')
    expect(wrapper.find('.page-heading h1').text()).toBe('业务审批')
    expect(wrapper.find('.new-request h2').text()).toBe('新建采购申请')
    expect(wrapper.find('.new-request').text()).toContain('不进行汇率换算或付款')
    expect(field(wrapper, 'request-unit-price').element.value).toBe('0.10')
    expect(field(wrapper, 'request-title').element.value).toBe(business.title)
    expect(posts()).toHaveLength(0)
    await field(wrapper, 'request-currency').setValue('JPY')
    expect(field(wrapper, 'procurement-total').text()).toBe('—')
    await submit(wrapper)
    expect(wrapper.find('[role=alert]').text()).toContain('请检查标出的采购字段')
    expect(wrapper.find('#unit-price-help').text()).toContain('JPY')
    await field(wrapper, 'request-unit-price').setValue('199')
    expect(field(wrapper, 'procurement-total').text()).toBe('JPY 597')
  })
  it.each(['', '0', '-1', '1.001', '1e2', '1,000', '1000000000.01'])('never sends malformed price %j and focuses a labeled invalid input', async value => {
    const { wrapper } = setup(); await login(wrapper); await fill(wrapper)
    await field(wrapper, 'request-unit-price').setValue(value); await submit(wrapper)
    expect(posts()).toHaveLength(0)
    expect(wrapper.find('[role=alert]').text()).toContain('Check the highlighted procurement fields')
    expect(field(wrapper, 'request-unit-price').attributes('aria-invalid')).toBe('true')
    expect(field(wrapper, 'request-unit-price').attributes('aria-describedby')).toBe('unit-price-help')
    expect(window.document.activeElement).toBe(field(wrapper, 'request-unit-price').element)
    expect(field(wrapper, 'procurement-total').text()).toBe('—')
  })
  it.each([['request-business-id', 'PO 001'], ['request-business-id', ''], ['request-item', ' '], ['request-quantity', '1.5'], ['request-quantity', '100001']])('rejects invalid %s value %j without a POST', async (id, value) => {
    const { wrapper } = setup(); await login(wrapper); await fill(wrapper)
    await field(wrapper, id).setValue(value); await submit(wrapper)
    expect(posts()).toHaveLength(0)
    expect(field(wrapper, id).attributes('aria-invalid')).toBe('true')
  })
  it('shows the exact maximum total and preserves fields when navigating or switching locale', async () => {
    const { wrapper } = setup(); await login(wrapper); await fill(wrapper)
    await field(wrapper, 'request-quantity').setValue('100000'); await field(wrapper, 'request-unit-price').setValue('999999999.99')
    expect(field(wrapper, 'procurement-total').text()).toBe('CNY 99,999,999,999,000.00')
    await field(wrapper, 'process-tab').trigger('click'); await field(wrapper, 'requests-tab').trigger('click'); await field(wrapper, 'workspace-language').setValue('zh')
    expect(field(wrapper, 'request-unit-price').element.value).toBe('999999999.99')
    expect(field(wrapper, 'request-type').element.value).toBe('procurement')
  })
})

describe('uncertain typed submission retry and immutable details', () => {
  it.each([{ business: null }, { business: { ...business, quantity: '3' } }, { business: { ...business, extra: true } }, { business: { ...business, item: 'Other' } }, { days: 1 }, { extra: true }])('retains original key and version after malformed success %j', async changes => {
    const { wrapper, server } = setup(); await login(wrapper); await fill(wrapper)
    api.request.mockResolvedValueOnce({ ...clone(document), ...changes }); await submit(wrapper)
    expect(wrapper.find('[role=alert]').text()).toContain('couldn’t confirm')
    expect(field(wrapper, 'request-business-id').element.value).toBe('PO-001')
    expect(wrapper.findAll('.request-item')).toHaveLength(0)
    const first = posts()[0][1]
    server.definition = { ...clone(definition), version: 2, name: 'New publication' }
    await field(wrapper, 'refresh').trigger('click'); await flushPromises()
    expect(field(wrapper, 'submission-template').text()).toContain('Shared routing · v1')
    await field(wrapper, 'workspace-language').setValue('zh')
    api.request.mockResolvedValueOnce(clone(document)); await submit(wrapper)
    expect(posts()[1][1].headers['Idempotency-Key']).toBe(first.headers['Idempotency-Key'])
    expect(posts()[1][1].body).toBe(first.body)
    expect(wrapper.findAll('.request-item')).toHaveLength(1)
  })
  it('suppresses repeated in-flight submissions, disables type edits and ignores a late result after logout', async () => {
    const { wrapper } = setup(); await login(wrapper); await fill(wrapper)
    let resolve
    api.request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    await wrapper.find('.new-request').trigger('submit'); await wrapper.find('.new-request').trigger('submit')
    expect(posts()).toHaveLength(1)
    expect(field(wrapper, 'request-type').attributes('disabled')).toBeDefined()
    expect(field(wrapper, 'request-unit-price').attributes('disabled')).toBeDefined()
    await field(wrapper, 'sign-out').trigger('click')
    resolve(clone(document)); await flushPromises()
    expect(wrapper.find('.workspace').exists()).toBe(false)
    await login(wrapper)
    expect(field(wrapper, 'request-type').element.value).toBe('leave')
    expect(wrapper.findAll('.request-item')).toHaveLength(0)
  })
  it('creates a new key for a normalized business edit or switching back to legacy leave', async () => {
    const { wrapper } = setup(); await login(wrapper); await fill(wrapper)
    api.request.mockRejectedValueOnce(new TypeError('Failed to fetch')); await submit(wrapper)
    const first = posts()[0][1].headers['Idempotency-Key']
    await field(wrapper, 'request-item').setValue('Desk')
    api.request.mockRejectedValueOnce(new TypeError('Failed to fetch')); await submit(wrapper)
    expect(posts()[1][1].headers['Idempotency-Key']).not.toBe(first)
    await field(wrapper, 'request-type').setValue('leave')
    await field(wrapper, 'request-title').setValue('Annual leave'); await field(wrapper, 'request-reason').setValue('Rest')
    api.request.mockRejectedValueOnce(new TypeError('Failed to fetch')); await submit(wrapper)
    expect(posts()[2][0]).toBe('/requests')
    expect(JSON.parse(posts()[2][1].body)).toEqual({ title: 'Annual leave', reason: 'Rest', days: 1, processVersion: 1 })
    expect(posts()[2][1].headers['Idempotency-Key']).not.toBe(posts()[1][1].headers['Idempotency-Key'])
  })
  it('renders legacy, typed leave and procurement together while malformed typed rows cannot be approved', async () => {
    const leave = { ...clone(document), id: 'l1', title: 'Annual leave', reason: 'Rest', days: 2 }; delete leave.business
    const typedLeave = { ...leave, id: 'l2', business: { type: 'leave', businessId: 'L-001', title: leave.title, reason: leave.reason, days: 2 } }
    const bad = { ...clone(document), id: 'bad', business: null }
    const { wrapper } = setup('bob', [leave, typedLeave, document, bad]); await login(wrapper)
    const rows = wrapper.findAll('.request-item')
    expect(rows[0].text()).toContain('Leave · 2 days')
    expect(rows[2].text()).toContain('Procurement · CNY 598.50')
    await rows[1].trigger('click'); expect(field(wrapper, 'business-details').text()).toContain('L-001')
    await rows[2].trigger('click'); expect(field(wrapper, 'approve-decision').exists()).toBe(true)
    await rows[3].trigger('click')
    expect(field(wrapper, 'business-details').text()).toContain('invalid or unsupported')
    expect(field(wrapper, 'approve-decision').exists()).toBe(false)
    expect(wrapper.find('.detail').text()).not.toContain('0 days')
  })
  it('blocks stale decision controls on a mutated business response until a valid refresh', async () => {
    const { wrapper, server } = setup('bob', [document]); await login(wrapper); await wrapper.find('.request-item').trigger('click')
    const mutated = approved(); mutated.business.item = 'Unapproved replacement'
    api.request.mockResolvedValueOnce(mutated)
    await wrapper.find('.decision-form').trigger('submit'); await flushPromises()
    expect(field(wrapper, 'business-details').text()).toContain('Ergonomic chair')
    expect(field(wrapper, 'business-details').text()).not.toContain('Unapproved replacement')
    expect(field(wrapper, 'approve-decision').exists()).toBe(false)
    expect(wrapper.find('.detail').text()).toContain('Refresh to load the saved state')
    server.items = [approved()]
    await field(wrapper, 'refresh').trigger('click'); await flushPromises()
    expect(wrapper.find('.detail .status').text()).toBe('approved')
    expect(field(wrapper, 'business-details').text()).toContain('CNY 598.50')
    expect(posts()).toHaveLength(1)
  })
  it.each(['unchanged', 'different-id'])('does not confirm a valid-looking %s decision response', async scenario => {
    const { wrapper } = setup('bob', [document]); await login(wrapper); await wrapper.find('.request-item').trigger('click')
    await field(wrapper, 'decision-comment').setValue('My requested comment')
    const returned = scenario === 'unchanged' ? clone(document) : approved()
    if (scenario === 'different-id') { returned.id = 'other'; returned.history.at(-1).comment = 'My requested comment'; returned.comment = 'My requested comment' }
    api.request.mockResolvedValueOnce(returned)
    await wrapper.find('.decision-form').trigger('submit'); await flushPromises()
    expect(wrapper.find('.detail .status').text()).toBe('pending')
    expect(field(wrapper, 'approve-decision').exists()).toBe(false)
    expect(wrapper.find('[role=alert]').text()).toContain('couldn’t confirm')
    expect(wrapper.find('[role=status]').exists()).toBe(false)
  })
  it('accepts a same-action replay with its original saved comment', async () => {
    const { wrapper } = setup('bob', [document]); await login(wrapper); await wrapper.find('.request-item').trigger('click')
    await field(wrapper, 'decision-comment').setValue('Edited retry comment')
    api.request.mockResolvedValueOnce(approved())
    await wrapper.find('.decision-form').trigger('submit'); await flushPromises()
    expect(wrapper.find('.detail .status').text()).toBe('approved')
    expect(wrapper.find('.timeline').text()).toContain('Checked')
    expect(wrapper.find('.timeline').text()).not.toContain('Edited retry comment')
  })
  it('keeps every uncertain typed decision locked across row switching and parser/transport failures', async () => {
    const second = { ...clone(document), id: 'p2', title: 'Second', business: { ...business, title: 'Second' } }
    const { wrapper } = setup('bob', [document, second]); await login(wrapper)
    for (let index = 0; index < 2; index++) {
      await wrapper.findAll('.request-item')[index].trigger('click')
      api.request.mockRejectedValueOnce(new Error('Invalid approval response'))
      await wrapper.find('.decision-form').trigger('submit'); await flushPromises()
      expect(field(wrapper, 'approve-decision').exists()).toBe(false)
    }
    await wrapper.findAll('.request-item')[0].trigger('click')
    expect(field(wrapper, 'approve-decision').exists()).toBe(false)
    expect(posts()).toHaveLength(2)
  })
  it('blocks stale typed details after raw list parsing fails and restores controls only on a valid refresh', async () => {
    const { wrapper } = setup('bob', [document]); await login(wrapper); await wrapper.find('.request-item').trigger('click')
    expect(field(wrapper, 'approve-decision').exists()).toBe(true)
    api.request.mockRejectedValueOnce(new InvalidApprovalPayloadError())
    await field(wrapper, 'refresh').trigger('click'); await flushPromises()
    expect(field(wrapper, 'business-details').text()).toContain('Ergonomic chair')
    expect(field(wrapper, 'approve-decision').exists()).toBe(false)
    await field(wrapper, 'refresh').trigger('click'); await flushPromises()
    expect(field(wrapper, 'approve-decision').exists()).toBe(true)
    expect(posts()).toHaveLength(0)
  })
  it('uses saved business facts after a new publication and locale change', async () => {
    const { wrapper, server } = setup('bob', [document]); await login(wrapper); await wrapper.find('.request-item').trigger('click')
    server.definition = { ...clone(definition), version: 2, name: 'New routing' }
    await field(wrapper, 'refresh').trigger('click'); await flushPromises(); await field(wrapper, 'workspace-language').setValue('zh')
    expect(field(wrapper, 'business-details').text()).toContain('提交时保存的只读快照')
    expect(field(wrapper, 'business-details').text()).toContain('CNY 598.50')
    expect(field(wrapper, 'instance-snapshot').text()).toContain('Shared routing · v1')
    expect(field(wrapper, 'instance-snapshot').text()).not.toContain('New routing')
  })
})


describe('typed procurement across member inbox pages', () => {
  it('shows bilingual immutable procurement facts in a bounded inbox without losing authoring state', async () => {
    const { wrapper } = setup('bob', [document]); await login(wrapper)
    await field(wrapper, 'request-type').setValue('procurement')
    await field(wrapper, 'request-title').setValue('Unsubmitted draft')
    await field(wrapper, 'inbox-tab').trigger('click'); await flushPromises()
    expect(wrapper.find('.request-list .count').text()).toBe('1 loaded')
    expect(wrapper.find('.request-item').text()).toContain('Procurement · CNY 598.50')
    expect(wrapper.find('.request-item').text()).not.toContain('0 days')
    await wrapper.find('.request-item').trigger('click')
    await field(wrapper, 'workspace-language').setValue('zh')
    expect(field(wrapper, 'business-details').text()).toContain('业务单号')
    expect(field(wrapper, 'business-details').text()).toContain('CNY 598.50')
    expect(field(wrapper, 'business-details').findAll('input,select,textarea')).toHaveLength(0)
    await field(wrapper, 'requests-tab').trigger('click')
    expect(field(wrapper, 'request-title').element.value).toBe('Unsubmitted draft')
    expect(field(wrapper, 'request-type').element.value).toBe('procurement')
  })
  it('rejects an entire continuation when a cached immutable business snapshot is rewritten', async () => {
    const { wrapper, server } = setup('bob', [document])
    const second = { ...clone(document), id: 'p2' }
    const changed = { ...clone(document), business: { ...business, quantity: 4 } }
    server.inboxPage = params => params.has('cursor')
      ? { items: [second, changed], nextCursor: null }
      : { items: [clone(document)], nextCursor: 'continue' }
    await login(wrapper); await field(wrapper, 'inbox-tab').trigger('click'); await flushPromises()
    await wrapper.find('.request-item').trigger('click')
    await field(wrapper, 'inbox-more').trigger('click'); await flushPromises()
    expect(wrapper.findAll('.request-item')).toHaveLength(1)
    expect(field(wrapper, 'business-details').text()).toContain('CNY 598.50')
    expect(field(wrapper, 'approve-decision').exists()).toBe(false)
    expect(wrapper.find('[role=alert]').exists()).toBe(true)
    expect(posts()).toHaveLength(0)
  })
  it('keeps a confirmed procurement vote when an older continuation resolves afterward', async () => {
    const { wrapper, server } = setup('bob', [document])
    let resolve
    const old = new Promise(done => { resolve = done })
    server.inboxPage = params => params.has('cursor') ? old : { items: [clone(document)], nextCursor: 'continue' }
    await login(wrapper); await field(wrapper, 'inbox-tab').trigger('click'); await flushPromises()
    await wrapper.find('.request-item').trigger('click')
    await field(wrapper, 'inbox-more').trigger('click'); await flushPromises()
    const signal = api.request.mock.calls.at(-1)[1].signal
    api.request.mockImplementationOnce(async () => {
      server.items = [approved()]; server.inboxPage = null
      return approved()
    })
    await wrapper.find('.decision-form').trigger('submit'); await flushPromises()
    expect(signal.aborted).toBe(true)
    resolve({ items: [clone(document)], nextCursor: 'stale' }); await flushPromises()
    expect(wrapper.find('.detail .status').text()).toBe('approved')
    expect(field(wrapper, 'business-details').text()).toContain('CNY 598.50')
    expect(field(wrapper, 'approve-decision').exists()).toBe(false)
    await field(wrapper, 'handled-tab').trigger('click'); await flushPromises()
    expect(wrapper.find('.request-item').text()).toContain('Procurement · CNY 598.50')
    expect(posts()).toHaveLength(1)
  })
})

describe('audit: switching away from an unresolved submission', () => {
  it('reuses the same procurement key after switching to leave and returning without editing', async () => {
    const { wrapper } = setup(); await login(wrapper); await fill(wrapper)
    api.request.mockRejectedValueOnce(new TypeError('Lost acknowledgement after commit')); await submit(wrapper)
    const first = posts()[0][1]
    await field(wrapper, 'request-type').setValue('leave')
    await field(wrapper, 'request-type').setValue('procurement')
    api.request.mockRejectedValueOnce(new TypeError('Retry acknowledgement unavailable')); await submit(wrapper)
    expect(posts()[1][1].body).toBe(first.body)
    expect(posts()[1][1].headers['Idempotency-Key']).toBe(first.headers['Idempotency-Key'])
  })
})

describe('independent document drafts and unresolved retries', () => {
  async function failSubmit(wrapper) { api.request.mockRejectedValueOnce(new TypeError('Lost acknowledgement')); await submit(wrapper); return posts().at(-1)[1] }
  async function leaveDraft(wrapper) {
    await field(wrapper, 'request-type').setValue('leave')
    await field(wrapper, 'request-title').setValue('Annual leave'); await field(wrapper, 'request-reason').setValue('Rest'); await field(wrapper, 'request-days').setValue('4')
  }
  it('keeps distinct text, keys and original versions for both forms across publication refresh', async () => {
    const { wrapper, server } = setup(); await login(wrapper); await fill(wrapper)
    const procurementAttempt = await failSubmit(wrapper)
    await leaveDraft(wrapper); const leaveAttempt = await failSubmit(wrapper)
    expect(leaveAttempt.headers['Idempotency-Key']).not.toBe(procurementAttempt.headers['Idempotency-Key'])
    server.definition = { ...clone(definition), version: 2, nodes: definition.nodes.map(node => node.type === 'approval' ? { ...node, assigneeId: 'alice' } : node) }
    await field(wrapper, 'refresh').trigger('click'); await flushPromises()
    await field(wrapper, 'workspace-language').setValue('zh')
    expect(await failSubmit(wrapper)).toEqual(leaveAttempt)
    await field(wrapper, 'request-type').setValue('procurement')
    expect(field(wrapper, 'request-title').element.value).toBe(business.title)
    expect(field(wrapper, 'request-reason').element.value).toBe(business.reason)
    expect(field(wrapper, 'submission-template').text()).toContain('v1')
    expect(await failSubmit(wrapper)).toEqual(procurementAttempt)
    await field(wrapper, 'request-type').setValue('leave')
    expect(field(wrapper, 'request-title').element.value).toBe('Annual leave')
    expect(field(wrapper, 'request-days').element.value).toBe('4')
  })
  it('successful procurement clears only its form and retains the other draft and retry', async () => {
    const { wrapper } = setup(); await login(wrapper); await leaveDraft(wrapper)
    const leaveAttempt = await failSubmit(wrapper)
    await fill(wrapper); api.request.mockResolvedValueOnce(clone(document)); await submit(wrapper)
    expect(field(wrapper, 'request-title').element.value).toBe('')
    expect(field(wrapper, 'request-business-id').element.value).toBe('')
    await field(wrapper, 'request-type').setValue('leave')
    expect(field(wrapper, 'request-title').element.value).toBe('Annual leave')
    expect(field(wrapper, 'request-days').element.value).toBe('4')
    expect(await failSubmit(wrapper)).toEqual(leaveAttempt)
  })
  it('sign-out clears both hidden and visible drafts and retry keys', async () => {
    const { wrapper } = setup(); await login(wrapper); await fill(wrapper)
    const procurementAttempt = await failSubmit(wrapper)
    await leaveDraft(wrapper); const leaveAttempt = await failSubmit(wrapper)
    await field(wrapper, 'sign-out').trigger('click'); await login(wrapper)
    expect(field(wrapper, 'request-title').element.value).toBe('')
    expect(field(wrapper, 'request-reason').element.value).toBe('')
    expect(field(wrapper, 'request-days').element.value).toBe('1')
    await field(wrapper, 'request-type').setValue('procurement')
    expect(field(wrapper, 'request-title').element.value).toBe('')
    expect(field(wrapper, 'request-business-id').element.value).toBe('')
    await fill(wrapper); expect((await failSubmit(wrapper)).headers['Idempotency-Key']).not.toBe(procurementAttempt.headers['Idempotency-Key'])
    await leaveDraft(wrapper); expect((await failSubmit(wrapper)).headers['Idempotency-Key']).not.toBe(leaveAttempt.headers['Idempotency-Key'])
  })
  it('refresh clears a hidden proven-uncreated version conflict without dropping another uncertain retry', async () => {
    const { wrapper, server } = setup(); await login(wrapper); await fill(wrapper)
    api.request.mockRejectedValueOnce({ status: 409, message: 'The published process changed; reload before submitting' }); await submit(wrapper)
    const rejectedAttempt = posts().at(-1)[1]
    await leaveDraft(wrapper); const leaveAttempt = await failSubmit(wrapper)
    server.definition = { ...clone(definition), version: 2 }
    await field(wrapper, 'refresh').trigger('click'); await flushPromises()
    expect(await failSubmit(wrapper)).toEqual(leaveAttempt)
    await field(wrapper, 'request-type').setValue('procurement')
    const next = await failSubmit(wrapper)
    expect(next.headers['Idempotency-Key']).not.toBe(rejectedAttempt.headers['Idempotency-Key'])
    expect(JSON.parse(next.body).processVersion).toBe(2)
  })
})

describe('independent review: symmetric standalone slot transitions', () => {
  async function uncertain(wrapper) { api.request.mockRejectedValueOnce(new TypeError('Lost acknowledgement')); await submit(wrapper); return posts().at(-1)[1] }
  async function leave(wrapper) { await field(wrapper, 'request-type').setValue('leave'); await field(wrapper, 'request-title').setValue(' Different leave '); await field(wrapper, 'request-reason').setValue(' Rest '); await field(wrapper, 'request-days').setValue('4') }
  it('successfully submitting leave preserves procurement input, key and original version', async () => {
    const { wrapper, server } = setup(); await login(wrapper); await fill(wrapper)
    const procurementAttempt = await uncertain(wrapper)
    await leave(wrapper); await uncertain(wrapper)
    server.definition = { ...clone(definition), version: 2 }
    await field(wrapper, 'refresh').trigger('click'); await flushPromises()
    const { business: ignored, ...legacy } = clone(document)
    api.request.mockResolvedValueOnce({ ...legacy, id: 'l1', title: 'Different leave', reason: 'Rest', days: 4 })
    await submit(wrapper)
    expect(field(wrapper, 'request-title').element.value).toBe(''); expect(field(wrapper, 'request-days').element.value).toBe('1')
    await field(wrapper, 'request-type').setValue('procurement')
    expect(field(wrapper, 'request-title').element.value).toBe(business.title)
    expect(field(wrapper, 'request-unit-price').element.value).toBe('199.50')
    expect(field(wrapper, 'submission-template').text()).toContain('v1')
    expect(await uncertain(wrapper)).toEqual(procurementAttempt)
  })
  it('retains different text/keys during synchronous switches, but rotates just an edited active slot', async () => {
    const { wrapper } = setup(); await login(wrapper); await fill(wrapper)
    const procurementAttempt = await uncertain(wrapper)
    await leave(wrapper); const leaveAttempt = await uncertain(wrapper)
    const state = wrapper.vm.$.setupState
    for (let i = 0; i < 100; i++) {
      state.requestType = 'procurement'; expect(state.title).toBe(business.title); expect(state.reason).toBe(business.reason)
      expect(state.submissionAttempt.key).toBe(procurementAttempt.headers['Idempotency-Key'])
      state.requestType = 'leave'; expect(state.title).toBe(' Different leave '); expect(state.reason).toBe(' Rest ')
      expect(state.submissionAttempt.key).toBe(leaveAttempt.headers['Idempotency-Key'])
    }
    state.reason = 'Rest'; state.title = 'Different leave'
    expect(await uncertain(wrapper)).toEqual(leaveAttempt)
    state.reason = 'New reason'
    const edited = await uncertain(wrapper)
    expect(edited.headers['Idempotency-Key']).not.toBe(leaveAttempt.headers['Idempotency-Key'])
    state.requestType = 'procurement'
    expect(await uncertain(wrapper)).toEqual(procurementAttempt)
  })
})
