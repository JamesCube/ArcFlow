// Exercise the actual native view's state machine with transport-only mocks.
// Native login/permissions and upstream interceptors remain real-smoke coverage.
import { shallowMount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NativeApproval from '../../ruoyi-vue3/frontend/src/views/arcflow/approval/index.vue'
import { getInbox, getMe, getPeople, getProcess, getRequests, submitRequest, submitDocument, decideRequest, publishProcess } from '@/api/arcflow/approval'
vi.mock('@/api/arcflow/approval', () => ({ getInbox: vi.fn(), getMe: vi.fn(), getPeople: vi.fn(), getProcess: vi.fn(), getRequests: vi.fn(), publishProcess: vi.fn(), submitRequest: vi.fn(), submitDocument: vi.fn(), decideRequest: vi.fn() }))
const definition = { schemaVersion: 2, id: 'leave-approval', version: 1, name: 'Leave', nodes: [
  { id: 'start', type: 'start', name: 'Start', assigneeId: null },
  { id: 'review', type: 'approval', name: 'Review', assigneeId: '101' },
  { id: 'end', type: 'end', name: 'End', assigneeId: null }
] }
const at = '2026-10-05T01:00:00Z'
const result = { id: 'native-r1', title: 'Leave', reason: 'Rest', days: 2, applicantId: '100', approverId: '101', status: 'PENDING', createdAt: at, updatedAt: at, decision: null, comment: null, processId: 'leave-approval', processVersion: 1, definition, currentStepId: 'review', history: [{ action: 'SUBMIT', actorId: '100', stepId: null, comment: '', at }] }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
beforeEach(() => {
  vi.resetAllMocks()
  getInbox.mockResolvedValue({ data: { items: [], nextCursor: null } })
  getMe.mockResolvedValue({ data: { id: '100', displayName: 'Applicant', canPublish: false } })
  getPeople.mockResolvedValue({ data: [{ id: '100' }, { id: '101' }] })
  getProcess.mockResolvedValue({ data: definition })
  getRequests.mockResolvedValue({ data: [] })
})
async function setup({ render = false, permissions = ['arcflow:request:read', 'arcflow:request:submit', 'arcflow:request:decide'] } = {}) {
  const stubs = Object.fromEntries(['ElRow', 'ElCol', 'ElTabs', 'ElTabPane', 'ElAlert', 'ElButton', 'ElCard', 'ElTable', 'ElTableColumn', 'ElEmpty', 'ElForm', 'ElFormItem', 'ElInput', 'ElInputNumber', 'ElSelect', 'ElOption', 'ElDescriptions', 'ElDescriptionsItem', 'ElTag', 'ElTimeline', 'ElTimelineItem'].map(name => [name, true]))
  if (render) stubs.ElTable = { template: '<div class="table-stub" />' }
  const wrapper = shallowMount(NativeApproval, { global: { directives: { hasPermi: { mounted(element, binding) { if (!binding.value.some(permission => permissions.includes(permission))) element.remove() } }, loading: () => {} }, stubs, renderStubDefaultSlot: render } })
  await flushPromises()
  const state = wrapper.vm.$.setupState
  state.title = ' Leave '; state.reason = ' Rest '; state.days = 2
  return { wrapper, state }
}
describe('native submission retry state', () => {
  it.each([
    ['partial', { id: 'native-r1' }], ['unknown status', { ...result, status: 'UNKNOWN' }],
    ['malformed history', { ...result, history: [null] }], ['malformed definition', { ...result, definition: null }],
    ['wrong identity', { ...result, applicantId: '102' }], ['wrong fields', { ...result, days: 3 }],
  ])('preserves retry identity and input after %s success payload', async (_, data) => {
    const { state } = await setup()
    submitRequest.mockResolvedValueOnce({ data }); await state.submit()
    const first = submitRequest.mock.calls[0]
    expect(state.title).toBe(' Leave ')
    expect(state.requests).toHaveLength(0)
    await state.refresh()
    submitRequest.mockResolvedValueOnce({ data: result }); await state.submit()
    expect(submitRequest.mock.calls[1]).toEqual(first)
    expect(state.requests).toHaveLength(1)
  })
  it('suppresses double clicks and retains the exact key/payload through failure and publication refresh', async () => {
    const { state } = await setup()
    const pending = deferred(); submitRequest.mockReturnValueOnce(pending.promise)
    const first = state.submit(); await state.submit()
    expect(submitRequest).toHaveBeenCalledTimes(1)
    const args = submitRequest.mock.calls[0]
    expect(args[0]).toEqual({ title: 'Leave', reason: 'Rest', days: 2, processVersion: 1 })
    expect(args[1]).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
    pending.reject(new Error('Response lost')); await first
    expect(state.refreshRequired).toBe(true)
    getProcess.mockResolvedValue({ data: { ...definition, version: 2, nodes: [definition.nodes[0], { ...definition.nodes[1], assigneeId: '100' }, definition.nodes[2]] } })
    getRequests.mockResolvedValue({ data: [result] })
    await state.refresh()
    expect(state.selfAssigned).toBe(false)
    expect(state.submissionProcess.version).toBe(1)
    submitRequest.mockResolvedValueOnce({ data: { ...result, status: 'APPROVED', currentStepId: null, decision: 'APPROVE', comment: '', history: [...result.history, { action: 'APPROVE', actorId: '101', stepId: 'review', comment: '', at }] } })
    await state.submit()
    expect(submitRequest.mock.calls[1]).toEqual(args)
    expect(state.requests).toHaveLength(1)
    expect(state.notice).toBe('申请已通过。')
    expect(state.submissionProcess.version).toBe(2)
  })
  it('retains malformed successful replies and generic conflicts, but edits get a new key', async () => {
    const { state } = await setup()
    submitRequest.mockResolvedValueOnce({ data: null }); await state.submit()
    const first = submitRequest.mock.calls[0]
    await state.refresh()
    submitRequest.mockRejectedValueOnce({ response: { status: 409, data: { msg: 'Idempotency-Key was already used for a different submission' } } })
    await state.submit()
    expect(submitRequest.mock.calls[1]).toEqual(first)
    await state.refresh()
    state.reason = 'Changed'
    submitRequest.mockResolvedValueOnce({ data: { ...result, reason: 'Changed' } }); await state.submit()
    expect(submitRequest.mock.calls[2][1]).not.toBe(first[1])
    expect(submitRequest.mock.calls[2][0].reason).toBe('Changed')
  })
  it('recovers from proven-uncreated stale version only after explicit successful refresh', async () => {
    const { state } = await setup()
    submitRequest.mockRejectedValueOnce({ response: { status: 409, data: { code: 409, msg: 'The published process changed; reload before submitting' } } })
    await state.submit()
    const first = submitRequest.mock.calls[0]
    expect(state.submissionProcess.version).toBe(1)
    getProcess.mockResolvedValue({ data: { ...definition, version: 2 } })
    await state.refresh()
    submitRequest.mockResolvedValueOnce({ data: { ...result, processVersion: 2, definition: { ...definition, version: 2 } } }); await state.submit()
    expect(state.title).toBe('')
    expect(submitRequest.mock.calls[1][0].processVersion).toBe(2)
    expect(submitRequest.mock.calls[1][1]).not.toBe(first[1])
  })
  it('rotates intent when a refreshed authenticated identity changes', async () => {
    const { state } = await setup()
    submitRequest.mockRejectedValueOnce(new Error('Offline')); await state.submit()
    const key = submitRequest.mock.calls[0][1]
    getMe.mockResolvedValue({ data: { id: '102', displayName: 'Other applicant' } })
    await state.refresh()
    submitRequest.mockResolvedValueOnce({ data: { ...result, applicantId: '102', history: [{ ...result.history[0], actorId: '102' }] } }); await state.submit()
    expect(submitRequest.mock.calls[1][1]).not.toBe(key)
  })
})

const procurementBusiness = { type: 'procurement', businessId: 'PO-NATIVE-001', title: 'Adapters', reason: 'Synthetic only', item: 'USB-C adapter', quantity: 3, unitPrice: 0.1, currency: 'USD' }
const procurementResult = { ...result, id: 'native-procurement', title: procurementBusiness.title, reason: procurementBusiness.reason, days: 0, business: procurementBusiness }
async function procurement(options) {
  const mounted = await setup(options)
  Object.assign(mounted.state, { businessType: 'procurement', businessId: 'PO-NATIVE-001', title: ' Adapters ', reason: ' Synthetic only ', item: ' USB-C adapter ', quantity: '3', unitPrice: '0.10', currency: 'USD' })
  await flushPromises()
  return mounted
}

describe('native typed procurement authoring', () => {
  it('uses the additive native document route, exact normalized intent and immutable typed detail', async () => {
    const { state } = await procurement()
    expect(state.total).toBe('0.30')
    expect(state.fieldErrors).toEqual([])
    submitDocument.mockResolvedValueOnce({ data: procurementResult })
    await state.submit()
    expect(submitRequest).not.toHaveBeenCalled()
    expect(submitDocument).toHaveBeenCalledTimes(1)
    const [payload, key] = submitDocument.mock.calls[0]
    expect(payload).toEqual({ business: procurementBusiness, processVersion: 1 })
    expect(Object.isFrozen(payload)).toBe(true)
    expect(Object.isFrozen(payload.business)).toBe(true)
    expect(key).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
    expect(state.requests).toEqual([procurementResult])
    expect(state.selectedDocument).toEqual({ type: 'procurement', business: procurementBusiness })
    expect(state.businessTotal(state.selectedDocument.business)).toBe('USD 0.30')
    expect(state.summary(procurementResult)).toBe('USD 0.30')
    state.item = 'Different draft item'; state.unitPrice = '999.99'
    expect(state.selectedDocument.business).toEqual(procurementBusiness)
    expect(state.notice).toBe('申请已提交。')
    state.locale = 'en'
    expect(state.notice).toBe('Request submitted.')
    expect(state.t.type).toBe('Document type')
  })
  it.each([
    ['businessId', ' space', 'businessId'], ['businessId', 'PO@bad', 'businessId'], ['businessId', 'a'.repeat(129), 'businessId'],
    ['title', '', 'title'], ['title', 'x'.repeat(121), 'title'], ['reason', '', 'reason'], ['reason', 'x'.repeat(2001), 'reason'],
    ['item', ' ', 'item'], ['item', 'x'.repeat(241), 'item'],
    ['quantity', '0', 'quantity'], ['quantity', '100001', 'quantity'], ['quantity', '1.5', 'quantity'], ['quantity', '1e2', 'quantity'],
    ['unitPrice', '0', 'unitPrice'], ['unitPrice', '-1', 'unitPrice'], ['unitPrice', '0.001', 'unitPrice'], ['unitPrice', '1000000000.01', 'unitPrice'], ['unitPrice', '1e2', 'unitPrice'],
    ['currency', 'AUD', 'currency'], ['businessType', 'unknown', 'type'],
  ])('rejects invalid %s=%s locally without reserving a key', async (field, value, expected) => {
    const { state } = await procurement()
    state[field] = value
    await state.submit()
    expect(state.fieldErrors).toContain(expected)
    expect(state.fieldError(expected)).toBeTruthy()
    expect(submitDocument).not.toHaveBeenCalled()
    expect(submitRequest).not.toHaveBeenCalled()
    expect(state.submissionAttempt).toBeNull()
    state.locale = 'en'
    expect(state.fieldError(expected)).toBe(state.t.errors[expected])
  })
  it('calculates decimal and maximum totals without binary-floating rounding, with JPY whole-amount rules', async () => {
    const { state } = await procurement()
    state.quantity = '100000'; state.unitPrice = '999999999.99'
    expect(state.money(state.total, state.currency)).toBe('USD 99,999,999,999,000.00')
    state.unitPrice = '1000000000'
    expect(state.money(state.total, state.currency)).toBe('USD 100,000,000,000,000.00')
    state.currency = 'JPY'; state.quantity = '3'; state.unitPrice = '2.00'
    expect(state.fieldErrors).toEqual([])
    expect(state.money(state.total, state.currency)).toBe('JPY 6')
    state.unitPrice = '2.10'
    expect(state.fieldErrors).toContain('unitPrice')
    expect(state.total).toBeNull()
    await state.submit()
    expect(submitDocument).not.toHaveBeenCalled()
  })
  it('preserves a draft through type, locale and workspace navigation without misrouting leave', async () => {
    const { state } = await procurement()
    state.tab = 'process'; state.locale = 'en'; state.tab = 'mine'; state.businessType = 'leave'
    expect(state.submissionFields()).toEqual({ title: ' Adapters ', reason: ' Synthetic only ', days: 2 })
    state.businessType = 'procurement'
    expect(state.unitPrice).toBe('0.10')
    expect(state.businessId).toBe('PO-NATIVE-001')
    expect(state.submissionFields().business.currency).toBe('USD')
    expect(submitDocument).not.toHaveBeenCalled()
  })
})

describe('native typed response and retry boundary', () => {
  it.each([
    ['missing business', (({ business, ...legacy }) => legacy)(procurementResult)],
    ['null business', { ...procurementResult, business: null }],
    ['unknown type', { ...procurementResult, business: { ...procurementBusiness, type: 'invoice' } }],
    ['wrong type', { ...procurementResult, days: 2, business: { type: 'leave', businessId: procurementBusiness.businessId, title: procurementBusiness.title, reason: procurementBusiness.reason, days: 2 } }],
    ['wrong reference', { ...procurementResult, business: { ...procurementBusiness, businessId: 'OTHER' } }],
    ['wrong price', { ...procurementResult, business: { ...procurementBusiness, unitPrice: 0.11 } }],
    ['numeric string', { ...procurementResult, business: { ...procurementBusiness, unitPrice: '0.10' } }],
    ['wrong projection', { ...procurementResult, days: 2 }],
    ['unknown field', { ...procurementResult, business: { ...procurementBusiness, paid: true } }],
    ['malformed history', { ...procurementResult, history: [null] }],
    ['wrong applicant', { ...procurementResult, applicantId: '102' }],
  ])('retains original typed input, endpoint and key after %s', async (_, malformed) => {
    const { state } = await procurement()
    submitDocument.mockResolvedValueOnce({ data: malformed })
    await state.submit()
    const first = submitDocument.mock.calls[0]
    expect(state.refreshRequired).toBe(true)
    expect(state.businessId).toBe('PO-NATIVE-001')
    expect(state.item).toBe(' USB-C adapter ')
    expect(state.unitPrice).toBe('0.10')
    expect(state.requests).toEqual([])
    await state.refresh()
    submitDocument.mockResolvedValueOnce({ data: procurementResult })
    await state.submit()
    expect(submitDocument.mock.calls[1]).toEqual(first)
    expect(submitRequest).not.toHaveBeenCalled()
    expect(state.requests).toHaveLength(1)
  })
  it('suppresses double submission and retries the original typed version after publication and approval', async () => {
    const { state } = await procurement()
    const pending = deferred(); submitDocument.mockReturnValueOnce(pending.promise)
    const first = state.submit(); await state.submit()
    expect(submitDocument).toHaveBeenCalledTimes(1)
    const args = submitDocument.mock.calls[0]
    pending.reject(new Error('Response lost')); await first
    getProcess.mockResolvedValue({ data: { ...definition, version: 2, nodes: [definition.nodes[0], { ...definition.nodes[1], assigneeId: '100' }, definition.nodes[2]] } })
    await state.refresh()
    state.locale = 'en'
    expect(state.selfAssigned).toBe(false)
    expect(state.submissionProcess.version).toBe(1)
    const approved = { ...procurementResult, status: 'APPROVED', currentStepId: null, decision: 'APPROVE', comment: '', history: [...result.history, { action: 'APPROVE', actorId: '101', stepId: 'review', comment: '', at }] }
    submitDocument.mockResolvedValueOnce({ data: approved })
    await state.submit()
    expect(submitDocument.mock.calls[1]).toEqual(args)
    expect(state.notice).toBe('Request approved.')
    expect(state.selectedDocument.business).toEqual(procurementBusiness)
    expect(state.submissionProcess.version).toBe(2)
  })
  it('keeps generic conflicts, rotates edited typed intent, and never reuses a procurement key for leave', async () => {
    const { state } = await procurement()
    submitDocument.mockRejectedValueOnce({ response: { status: 409, data: { msg: 'Idempotency-Key was already used for a different submission' } } })
    await state.submit()
    const first = submitDocument.mock.calls[0]
    await state.refresh(); state.item = 'Another synthetic item'
    submitDocument.mockRejectedValueOnce(new Error('Offline')); await state.submit()
    expect(submitDocument.mock.calls[1][1]).not.toBe(first[1])
    const second = submitDocument.mock.calls[1]
    await state.refresh(); state.businessType = 'leave'
    submitRequest.mockRejectedValueOnce(new Error('Offline')); await state.submit()
    expect(submitRequest.mock.calls[0][1]).not.toBe(second[1])
    expect(submitRequest.mock.calls[0][0]).toEqual({ title: 'Adapters', reason: 'Synthetic only', days: 2, processVersion: 1 })
  })
  it('clears only a proven-uncreated typed stale-version attempt after successful refresh', async () => {
    const { state } = await procurement()
    submitDocument.mockRejectedValueOnce({ response: { status: 409, data: { msg: 'The published process changed; reload before submitting' } } })
    await state.submit()
    const first = submitDocument.mock.calls[0]
    getRequests.mockRejectedValueOnce(new Error('Offline')); await state.refresh()
    expect(state.submissionAttempt.key).toBe(first[1])
    getProcess.mockResolvedValue({ data: { ...definition, version: 2 } })
    await state.refresh()
    submitDocument.mockResolvedValueOnce({ data: { ...procurementResult, processVersion: 2, definition: { ...definition, version: 2 } } })
    await state.submit()
    expect(submitDocument.mock.calls[1][0].processVersion).toBe(2)
    expect(submitDocument.mock.calls[1][1]).not.toBe(first[1])
    expect(state.requests).toHaveLength(1)
  })
})

describe('native typed display and permissions', () => {
  it('renders translated immutable procurement fields without a zero-day leave detail', async () => {
    const { wrapper, state } = await procurement({ render: true })
    state.requests = [procurementResult]; state.selectedId = procurementResult.id
    await flushPromises()
    expect(wrapper.get('[data-testid="detail-total"]').text()).toBe('USD 0.30')
    expect(wrapper.get('[data-testid="business-detail"]').text()).toContain('USB-C adapter')
    expect(wrapper.get('[data-testid="business-detail"]').text()).not.toContain('天数')
    expect(wrapper.find('[data-testid="business-detail"] input').exists()).toBe(false)
    state.locale = 'en'; await flushPromises()
    expect(wrapper.get('[data-testid="business-detail"]').attributes('aria-label')).toBe('Business document at submission')
    expect(state.status('APPROVED')).toBe('Approved')
    wrapper.unmount()
  })
  it.each([
    { ...procurementResult, business: null },
    { ...procurementResult, business: { ...procurementBusiness, type: 'unknown' } },
    { ...procurementResult, business: { ...procurementBusiness, quantity: '3' } },
    { ...procurementResult, days: 3 },
  ])('does not treat malformed typed rows as legacy leave or allow a vote', async malformed => {
    const { state } = await setup()
    state.me = { id: '101', canPublish: false }
    state.requests = [malformed]; state.selectedId = malformed.id
    expect(state.selectedDocument.type).toBe('invalid')
    expect(state.summary(malformed)).toBe('单据数据无效')
    expect(state.canDecide).toBe(false)
    await state.decide('APPROVE')
    expect(decideRequest).not.toHaveBeenCalled()
  })
  it('distinguishes typed and legacy leave without inventing a business reference', async () => {
    const { state } = await setup()
    expect(state.documentView(result)).toEqual({ type: 'leave', business: null })
    const business = { type: 'leave', businessId: 'LV-1', title: result.title, reason: result.reason, days: result.days }
    expect(state.documentView({ ...result, business })).toEqual({ type: 'leave', business })
    expect(state.summary(result)).toBe('2 天数')
  })
  it('retains RuoYi permission directives for both typed authoring and decisions', async () => {
    const { wrapper, state } = await setup({ render: true, permissions: ['arcflow:request:read'] })
    expect(wrapper.find('[data-testid="business-type"]').exists()).toBe(false)
    state.me = { id: '101', canPublish: false }
    state.requests = [procurementResult]; state.selectedId = procurementResult.id
    await flushPromises()
    expect(state.canDecide).toBe(true) // Assignment alone does not grant native RBAC.
    expect(wrapper.find('.decision').exists()).toBe(false)
    state.tab = 'process'; await flushPromises()
    state.draft.name = 'Unauthorized change'; await state.publish()
    expect(publishProcess).not.toHaveBeenCalled()
    expect(wrapper.find('.node-actions').exists()).toBe(false)
    wrapper.unmount()
  })
  it('blocks procurement when the current applicant is a process participant', async () => {
    const { state } = await procurement()
    state.me = { id: '101', canPublish: false }
    expect(state.selfAssigned).toBe(true)
    await state.submit()
    expect(submitDocument).not.toHaveBeenCalled()
  })
})

describe('native malformed list and decision recovery', () => {
  it.each([
    { ...procurementResult, history: [null] },
    { ...procurementResult, currentStepId: 'missing' },
    { ...procurementResult, status: 'APPROVED', currentStepId: null },
    { ...procurementResult, definition: { ...definition, nodes: null } },
  ])('rejects malformed typed lifecycle before worklist, snapshot or vote rendering', async malformed => {
    const { wrapper, state } = await setup({ render: true })
    state.me = { id: '101', canPublish: false }
    state.requests = [malformed]; state.selectedId = malformed.id
    await flushPromises()
    expect(state.selectedDocument.type).toBe('invalid')
    state.memberInbox.setIdentity('101')
    getInbox.mockResolvedValueOnce({ data: { items: [malformed], nextCursor: null } })
    await state.memberInbox.load('PENDING', { restart: true })
    expect(state.boxes.PENDING.items).toEqual([])
    expect(wrapper.find('.snapshot').exists()).toBe(false)
    expect(wrapper.find('.decision').exists()).toBe(false)
    expect(state.canDecide).toBe(false)
    wrapper.unmount()
  })
  it('keeps a valid typed snapshot and blocks repeated decisions when a response changes its business', async () => {
    const { state } = await setup()
    state.me = { id: '101', canPublish: false }
    state.requests = [procurementResult]; state.selectedId = procurementResult.id; state.comment = ' Verified synthetic item '
    const approved = { ...procurementResult, status: 'APPROVED', currentStepId: null, decision: 'APPROVE', comment: 'Verified synthetic item', history: [...result.history, { action: 'APPROVE', actorId: '101', stepId: 'review', comment: 'Verified synthetic item', at }] }
    decideRequest.mockResolvedValueOnce({ data: { ...approved, business: { ...procurementBusiness, item: 'Unexpected replacement' } } })
    await state.decide('APPROVE')
    expect(state.refreshRequired).toBe(true)
    expect(state.requests).toEqual([procurementResult])
    expect(state.comment).toBe(' Verified synthetic item ')
    await state.decide('APPROVE')
    expect(decideRequest).toHaveBeenCalledTimes(1)
    getMe.mockResolvedValue({ data: { id: '101', canPublish: false } })
    getRequests.mockResolvedValue({ data: [procurementResult] }); await state.refresh()
    decideRequest.mockResolvedValueOnce({ data: approved }); await state.decide('APPROVE')
    expect(state.requests).toEqual([approved])
    expect(state.notice).toBe('申请已通过。')
  })
})

describe('native decision acknowledgement proof', () => {
  it.each([
    ['unchanged pending', procurementResult],
    ['opposite vote', { ...procurementResult, status: 'REJECTED', currentStepId: null, decision: 'REJECT', comment: '', history: [...result.history, { action: 'REJECT', actorId: '101', stepId: 'review', comment: '', at }] }],
    ['different request', { ...procurementResult, id: 'other-native', status: 'APPROVED', currentStepId: null, decision: 'APPROVE', comment: '', history: [...result.history, { action: 'APPROVE', actorId: '101', stepId: 'review', comment: '', at }] }],
    ['rewritten creation', { ...procurementResult, createdAt: '2026-10-05T00:00:00Z', status: 'APPROVED', currentStepId: null, decision: 'APPROVE', comment: '', history: [{ ...result.history[0], at: '2026-10-05T00:00:00Z' }, { action: 'APPROVE', actorId: '101', stepId: 'review', comment: '', at }] }],
  ])('requires the requested vote and unchanged identity, rejecting %s', async (_, response) => {
    const { state } = await setup()
    state.me = { id: '101', canPublish: false }; state.requests = [procurementResult]; state.selectedId = procurementResult.id
    decideRequest.mockResolvedValueOnce({ data: response }); await state.decide('APPROVE')
    expect(state.refreshRequired).toBe(true)
    expect(state.notice).toBe('')
    expect(state.requests).toEqual([procurementResult])
    await state.decide('APPROVE')
    expect(decideRequest).toHaveBeenCalledTimes(1)
  })
})
