// DOM component tests with transport and native-session mocks. No browser or
// upstream RBAC claim: real native integration remains a separate smoke path.
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NativeApproval from '../src/views/arcflow/approval/index.vue'
import { getMe, getPeople, getProcess, getRequests, getInbox, decideRequest, submitDocument, submitRequest } from '@/api/arcflow/approval'
vi.mock('@/api/arcflow/approval', () => ({ getMe: vi.fn(), getPeople: vi.fn(), getProcess: vi.fn(), getRequests: vi.fn(), getInbox: vi.fn(), publishProcess: vi.fn(), submitRequest: vi.fn(), submitDocument: vi.fn(), decideRequest: vi.fn() }))
vi.mock('@/store/modules/user', () => ({ default: () => session }))
let session, wrappers
const at = '2026-10-07T01:00:00Z'
const definition = { schemaVersion: 3, id: 'leave-approval', version: 2, name: 'Leave', nodes: [
  { id: 'start', type: 'start', name: 'Start', assigneeId: null },
  { id: 'group', type: 'parallelApproval', name: 'Group', assigneeId: null, assigneeIds: ['101', '102'], completionMode: 'ALL' },
  { id: 'later', type: 'approval', name: 'Later', assigneeId: '102' },
  { id: 'end', type: 'end', name: 'End', assigneeId: null }
] }
const item = (id, extra = {}) => ({ id, title: `Request ${id}`, reason: 'Synthetic', days: 1, applicantId: '100', approverId: '101', status: 'PENDING', createdAt: at, updatedAt: at, decision: null, comment: null, processId: 'leave-approval', processVersion: 2, definition, currentStepId: 'group', history: [{ actorId: '100', action: 'SUBMIT', stepId: null, comment: '', at }], ...extra })
const voted = (id, extra = {}) => item(id, { decision: 'APPROVE', comment: '', history: [...item(id).history, { actorId: '102', action: 'APPROVE', stepId: 'group', comment: '', at }], ...extra })
const page = (items = [], nextCursor = null) => ({ data: { items, nextCursor } })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const container = defineComponent({ setup(_, { slots }) { return () => h('div', slots.default?.()) } })
const button = defineComponent({ props: ['disabled', 'loading'], emits: ['click'], setup(props, { slots, emit }) { return () => h('button', { disabled: props.disabled || props.loading, onClick: () => emit('click') }, slots.default?.()) } })
const table = defineComponent({ props: ['data', 'emptyText'], emits: ['row-click'], setup(props, { emit }) { return () => h('div', { 'data-testid': 'requests' }, props.data?.length ? props.data.map(row => h('button', { onClick: () => emit('row-click', row) }, row.title)) : props.emptyText) } })
const tabs = defineComponent({ props: ['modelValue'], emits: ['update:modelValue'], setup(_, { slots }) { return () => h('div', slots.default?.()) } })
// Element Plus controls its native value: emit the new model, wait for the
// parent to echo it, then restore the DOM from the prop before change/blur.
const input = defineComponent({ props: ['modelValue', 'disabled'], emits: ['change', 'update:modelValue'], setup(props, { attrs, emit }) {
  return () => h('input', { ...attrs, value: props.modelValue, disabled: props.disabled,
    onInput: async event => { const element = event.target; emit('update:modelValue', element.value); await nextTick(); element.value = String(props.modelValue ?? '') },
    onChange: async event => { const element = event.target; emit('change', element.value); await nextTick(); element.value = String(props.modelValue ?? '') }
  })
} })
const select = defineComponent({ props: ['modelValue', 'disabled'], emits: ['update:modelValue'], setup(props, { attrs, slots, emit }) { return () => h('select', { ...attrs, value: props.modelValue, disabled: props.disabled, onChange: event => emit('update:modelValue', event.target.value) }, slots.default?.()) } })
const option = defineComponent({ props: ['label', 'value'], setup(props) { return () => h('option', { value: props.value }, props.label) } })
const alert = defineComponent({ props: ['title'], setup(props) { return () => h('p', { role: 'alert' }, props.title) } })
const card = defineComponent({ setup(_, { slots }) { return () => h('section', [slots.header?.(), slots.default?.()]) } })
beforeEach(() => {
  vi.resetAllMocks(); session = reactive({ token: 'native-session-1' }); wrappers = []
  getMe.mockResolvedValue({ data: { id: '102', displayName: 'Non-first reviewer', canPublish: false } })
  getPeople.mockResolvedValue({ data: [{ id: '100' }, { id: '101' }, { id: '102' }] })
  getProcess.mockResolvedValue({ data: definition }); getRequests.mockResolvedValue({ data: [] }); getInbox.mockResolvedValue(page())
})
afterEach(() => wrappers.forEach(wrapper => wrapper.unmount()))
async function setup() {
  const stubs = Object.fromEntries(['ElRow', 'ElCol', 'ElForm', 'ElFormItem', 'ElDescriptions', 'ElDescriptionsItem', 'ElTag', 'ElTimeline', 'ElTimelineItem'].map(name => [name, container]))
  Object.assign(stubs, { ElButton: button, ElTable: table, ElTabs: tabs, ElTabPane: true, ElInput: input, ElInputNumber: input, ElSelect: select, ElOption: option, ElAlert: alert, ElCard: card, ElEmpty: true, ElTableColumn: true })
  const wrapper = mount(NativeApproval, { global: { stubs, directives: { hasPermi: () => {}, loading: () => {} } } })
  wrappers.push(wrapper); await flushPromises()
  return { wrapper, state: wrapper.vm.$.setupState }
}
const click = async (wrapper, label) => { const target = wrapper.findAll('button').find(button => button.text() === label); expect(target, label).toBeTruthy(); await target.trigger('click'); await flushPromises() }

describe('native paginated member inbox', () => {
  it('renders server pending independently from the legacy list and keeps applicant/history tabs intact', async () => {
    getRequests.mockResolvedValue({ data: [item('legacy-future', { currentStepId: 'later' }), item('my-own', { applicantId: '102' })] })
    getInbox.mockImplementation(query => Promise.resolve(page(query.box === 'PENDING' ? [item('non-first')] : [voted('handled')], query.box === 'PENDING' ? 'opaque-next' : null)))
    const { wrapper, state } = await setup()
    expect(getInbox.mock.calls.map(([query]) => query)).toEqual([{ box: 'PENDING', limit: 25 }, { box: 'HANDLED', limit: 25 }])
    expect(wrapper.get('[data-testid="requests"]').text()).toContain('my-own')
    state.tab = 'inbox'; await flushPromises()
    expect(wrapper.get('[data-testid="requests"]').text()).toBe('Request non-first')
    expect(wrapper.text()).toContain('已加载 1 条（非总数）')
    expect(wrapper.text()).toContain('加载更多')
    await click(wrapper, 'Request non-first'); expect(state.canDecide).toBe(true)
    state.tab = 'all'; await flushPromises()
    expect(wrapper.get('[data-testid="requests"]').text()).toContain('legacy-future')
    expect(state.selected).toBeUndefined()
    state.tab = 'handled'; await flushPromises()
    expect(wrapper.get('[data-testid="requests"]').text()).toBe('Request handled')
    expect(wrapper.text()).toContain('可能仍在审批中')
  })
  it('loads more once, renders independent counts and exhausted state, and refreshes without a cursor', async () => {
    const more = deferred()
    getInbox.mockImplementation(query => Promise.resolve(query.box === 'HANDLED' ? page() : query.cursor ? more.promise : page([item('first')], 'next+/=')))
    const { wrapper, state } = await setup(); state.tab = 'inbox'; await flushPromises()
    const pending = state.loadMore(); await state.loadMore()
    expect(getInbox).toHaveBeenCalledTimes(3)
    more.resolve(page([item('second')])); await pending; await flushPromises()
    expect(wrapper.text()).toContain('已加载 2 条（非总数）')
    expect(wrapper.text()).toContain('本次查询已全部加载')
    await click(wrapper, '刷新本列表')
    expect(getInbox.mock.calls.at(-1)[0]).toEqual({ box: 'PENDING', limit: 25 })
    expect(state.boxes.HANDLED.items).toHaveLength(0)
  })
  it('status/version filter controls clear selection, reset pagination and isolate the other box', async () => {
    getInbox.mockImplementation(query => Promise.resolve(page(query.box === 'HANDLED' ? [voted('handled')] : [item('pending')], query.box === 'PENDING' ? 'old' : null)))
    const { wrapper, state } = await setup(); state.tab = 'inbox'; await flushPromises(); state.select(state.visible[0])
    await wrapper.get('select[aria-label="筛选申请状态"]').setValue('PENDING'); await flushPromises()
    await wrapper.get('input[aria-label="筛选流程版本"]').setValue('2'); await flushPromises()
    expect(getInbox.mock.calls.at(-1)[0]).toEqual({ box: 'PENDING', limit: 25, status: 'PENDING', processVersion: 2 })
    expect(state.selected).toBeUndefined(); expect(state.boxes.HANDLED.items).toHaveLength(1)
    await wrapper.get('input[aria-label="筛选流程版本"]').setValue('0'); await flushPromises()
    expect(wrapper.text()).toContain('流程版本须为正整数')
    expect(state.boxes.PENDING.items).toHaveLength(0)
  })
  it('shows partial votes in handled, removes own pending vote and reloads both first pages', async () => {
    let decided = false
    getInbox.mockImplementation(query => Promise.resolve(page(query.box === 'PENDING' ? (decided ? [] : [item('vote')]) : (decided ? [voted('vote')] : []), !decided && query.box === 'PENDING' ? 'old-cursor' : null)))
    decideRequest.mockImplementation(() => { decided = true; return Promise.resolve({ data: voted('vote') }) })
    const { wrapper, state } = await setup(); state.tab = 'inbox'; await flushPromises(); await click(wrapper, 'Request vote'); await click(wrapper, '投同意票')
    expect(state.visible).toHaveLength(0); expect(state.selected.history).toHaveLength(2); expect(state.canDecide).toBe(false)
    expect(wrapper.text()).toContain('等待本组其他参与人')
    expect(getInbox.mock.calls.slice(-2).map(([query]) => query)).toEqual([{ box: 'PENDING', limit: 25 }, { box: 'HANDLED', limit: 25 }])
    state.tab = 'handled'; await flushPromises(); expect(wrapper.get('[data-testid="requests"]').text()).toContain('Request vote')
  })
  it('keeps the same actor in pending and handled when the next stage also needs their vote', async () => {
    let next = false
    const advanced = voted('repeat', { currentStepId: 'later', approverId: '102', history: [...voted('repeat').history, { actorId: '101', action: 'APPROVE', stepId: 'group', comment: '', at }] })
    getInbox.mockImplementation(query => Promise.resolve(page(next ? [advanced] : query.box === 'PENDING' ? [item('repeat')] : [])))
    decideRequest.mockImplementation(() => { next = true; return Promise.resolve({ data: advanced }) })
    const { state } = await setup(); state.tab = 'inbox'; state.select(state.visible[0]); await state.decide('APPROVE')
    expect(state.boxes.PENDING.items.map(item => item.id)).toEqual(['repeat'])
    expect(state.boxes.HANDLED.items.map(item => item.id)).toEqual(['repeat'])
    expect(state.canDecide).toBe(true); expect(state.selected.currentStepId).toBe('later')
    expect(state.comment).toBe('')
  })
  it('renders recoverable page errors without deriving fallback rows from legacy data', async () => {
    getRequests.mockResolvedValue({ data: [item('legacy')] })
    getInbox.mockImplementation(query => query.box === 'PENDING' ? Promise.reject(new Error('offline')) : Promise.resolve(page()))
    const { wrapper, state } = await setup(); state.tab = 'inbox'; await flushPromises()
    expect(wrapper.text()).toContain('列表加载失败')
    expect(wrapper.get('[data-testid="requests"]').text()).not.toContain('legacy')
    getInbox.mockResolvedValue(page([item('recovered')]))
    await click(wrapper, '重试本页'); expect(wrapper.get('[data-testid="requests"]').text()).toContain('recovered')
  })
  it('logout clears data immediately and late page/error/decision replies cannot restore it', async () => {
    getInbox.mockImplementation(query => Promise.resolve(page(query.box === 'PENDING' ? [item('old')] : [])))
    const { state } = await setup(); state.tab = 'inbox'; state.select(state.visible[0]); state.comment = 'Private draft'
    const decision = deferred(); decideRequest.mockReturnValueOnce(decision.promise)
    const write = state.decide('APPROVE')
    session.token = ''
    expect(state.me).toBeNull(); expect(state.requests).toEqual([]); expect(state.boxes.PENDING.items).toEqual([]); expect(state.comment).toBe('')
    decision.resolve({ data: voted('old') }); await write
    expect(state.selected).toBeUndefined(); expect(state.notice).toBe(''); expect(state.error).toContain('退出登录')
  })
  it('token switch and actor refresh reset each box and ignore responses from the old session', async () => {
    const slow = deferred()
    getInbox.mockImplementation(query => Promise.resolve(page(query.box === 'PENDING' ? [item('old')] : [])))
    const { state } = await setup(); state.tab = 'inbox'; state.filterInbox('processVersion', '2'); await flushPromises()
    getInbox.mockReturnValueOnce(slow.promise); const oldLoad = state.refreshInbox()
    const signal = getInbox.mock.calls.at(-1)[1]
    getMe.mockResolvedValue({ data: { id: '103', displayName: 'Other reviewer' } })
    getInbox.mockResolvedValue(page()); session.token = 'native-session-2'; await flushPromises()
    expect(signal.aborted).toBe(true); expect(state.me.id).toBe('103'); expect(state.boxes.PENDING.processVersion).toBe('')
    slow.resolve(page([item('late')])); await oldLoad
    expect(state.boxes.PENDING.items).toEqual([])
  })
  it('a newer inbox snapshot updates legacy rows and selecting them cannot restore a stale stage', async () => {
    getRequests.mockResolvedValue({ data: [item('shared')] })
    getInbox.mockImplementation(query => Promise.resolve(page(query.box === 'PENDING' ? [item('shared')] : [])))
    const { state } = await setup()
    const advanced = voted('shared', { currentStepId: 'later', approverId: '102', history: [...voted('shared').history, { actorId: '101', action: 'APPROVE', stepId: 'group', comment: '', at }] })
    getInbox.mockResolvedValue(page([advanced])); state.tab = 'handled'; await state.refreshInbox()
    state.tab = 'all'; state.select(state.visible[0])
    expect(state.selected.currentStepId).toBe('later')
    expect(state.selected.history).toHaveLength(3)
    expect(state.canDecide).toBe(true)
    // A later full legacy refresh may itself have an older read snapshot.
    getInbox.mockResolvedValue(page()); await state.refresh()
    state.select(state.visible[0]); expect(state.selected.currentStepId).toBe('later')
  })
  it('an explicit authentication failure from identity refresh clears cached legacy and inbox data', async () => {
    getRequests.mockResolvedValue({ data: [item('private')] })
    getInbox.mockImplementation(query => Promise.resolve(page(query.box === 'PENDING' ? [item('private')] : [])))
    const { state } = await setup(); state.tab = 'inbox'; state.select(state.visible[0])
    getMe.mockRejectedValueOnce({ response: { status: 401 } }); await state.refresh()
    expect(state.me).toBeNull(); expect(state.requests).toEqual([])
    expect(state.boxes.PENDING.items).toEqual([]); expect(state.selected).toBeUndefined()
    expect(state.refreshRequired).toBe(true); expect(state.busy).toBe(false)
  })
  it('unmount aborts initial native reads and inbox page loads', async () => {
    const identity = deferred(); getMe.mockReturnValueOnce(identity.promise)
    const { wrapper } = await setup(); const signal = getMe.mock.calls[0][0]; wrapper.unmount()
    expect(signal.aborted).toBe(true); identity.resolve({ data: { id: '102' } }); await flushPromises()
    expect(getInbox).not.toHaveBeenCalled()
  })
})

const procurementBusiness = { type: 'procurement', businessId: 'PO-NATIVE-INBOX', title: 'Adapters', reason: 'Synthetic only', item: 'USB-C adapter', quantity: 3, unitPrice: 0.1, currency: 'USD' }
const typed = (id, extra = {}) => item(id, { title: procurementBusiness.title, reason: procurementBusiness.reason, days: 0, business: { ...procurementBusiness }, ...extra })
const typedVote = id => typed(id, { decision: 'APPROVE', comment: '', history: voted(id).history })
const fillProcurement = state => Object.assign(state, { businessType: 'procurement', businessId: procurementBusiness.businessId, title: ' Adapters ', reason: ' Synthetic only ', item: ' USB-C adapter ', quantity: '3', unitPrice: '0.10', currency: 'USD' })

describe('integrated native typed documents and member inbox', () => {
  it('shows exact immutable procurement from server inbox without a legacy row and translates its controls', async () => {
    getInbox.mockImplementation(query => Promise.resolve(page(query.box === 'PENDING' ? [typed('purchase')] : [])))
    const { wrapper, state } = await setup(); state.tab = 'inbox'; await flushPromises()
    await click(wrapper, procurementBusiness.title)
    expect(state.requests).toEqual([])
    expect(state.selectedDocument.type).toBe('procurement')
    expect(state.canDecide).toBe(true)
    expect(wrapper.get('[data-testid="detail-total"]').text()).toBe('USD 0.30')
    expect(wrapper.get('[data-testid="business-detail"]').text()).not.toContain('天数')
    expect(wrapper.find('[data-testid="business-detail"] input').exists()).toBe(false)
    await wrapper.get('[data-testid="language-select"]').setValue('en')
    expect(wrapper.get('[data-testid="business-detail"]').attributes('aria-label')).toBe('Business document at submission')
    expect(wrapper.text()).toContain('Refresh this list')
    expect(wrapper.text()).toContain('1 loaded (not the total)')
    expect(wrapper.text()).toContain('All results for this query are loaded')
    expect(wrapper.text()).toContain('Vote approve')
    state.filterInbox('processVersion', '0'); await flushPromises()
    expect(wrapper.text()).toContain('Process version must be a positive whole number.')
  })

  it('moves a typed partial vote into handled and refuses stale overlapping snapshots without changing its business', async () => {
    const original = typed('partial-purchase'), confirmed = typedVote('partial-purchase')
    getRequests.mockResolvedValue({ data: [original] })
    // Deliberately slow/stale read models still return the pre-vote snapshot.
    getInbox.mockResolvedValue(page([original]))
    decideRequest.mockResolvedValue({ data: confirmed })
    const { wrapper, state } = await setup(); state.tab = 'inbox'; await flushPromises()
    await click(wrapper, procurementBusiness.title); await click(wrapper, '投同意票')
    expect(decideRequest).toHaveBeenCalledWith(original.id, { stepId: 'group', decision: 'APPROVE', comment: '' })
    expect(state.refreshRequired).toBe(false)
    expect(state.boxes.PENDING.items).toEqual([])
    expect(state.boxes.HANDLED.items).toEqual([confirmed])
    expect(state.selectedDocument.business).toEqual(procurementBusiness)
    expect(state.selected.history).toHaveLength(2)
    expect(state.canDecide).toBe(false)
    expect(wrapper.get('[data-testid="detail-total"]').text()).toBe('USD 0.30')
    state.tab = 'handled'; await flushPromises(); await click(wrapper, procurementBusiness.title)
    expect(state.selected.business).toEqual(procurementBusiness)
    await state.refresh(); state.tab = 'all'; await flushPromises(); state.select(state.visible[0])
    expect(state.selected.history).toHaveLength(2)
    expect(state.canDecide).toBe(false)
  })

  it('keeps a changed-business acknowledgement locked through page retry and partial full refresh', async () => {
    const original = typed('uncertain'), confirmed = typedVote('uncertain')
    getRequests.mockResolvedValue({ data: [original] })
    getInbox.mockImplementation(query => Promise.resolve(page(query.box === 'PENDING' ? [original] : [])))
    decideRequest.mockResolvedValueOnce({ data: { ...confirmed, business: { ...procurementBusiness, quantity: 4 } } })
    const { state } = await setup(); state.tab = 'inbox'; state.select(state.visible[0]); await state.decide('APPROVE')
    expect(state.refreshRequired).toBe(true)
    expect(state.selected.business).toEqual(procurementBusiness)
    await state.decide('APPROVE'); expect(decideRequest).toHaveBeenCalledTimes(1)
    await state.refreshInbox(); state.select(state.visible[0]); await state.decide('APPROVE')
    expect(state.refreshRequired).toBe(true); expect(decideRequest).toHaveBeenCalledTimes(1)
    getInbox.mockRejectedValueOnce(new Error('One inbox is still unavailable'))
    await state.refresh()
    expect(state.refreshRequired).toBe(true)
    await state.decide('APPROVE'); expect(decideRequest).toHaveBeenCalledTimes(1)
    await state.refresh()
    expect(state.refreshRequired).toBe(false)
    state.select(state.visible[0]); decideRequest.mockResolvedValueOnce({ data: confirmed }); await state.decide('APPROVE')
    expect(decideRequest).toHaveBeenCalledTimes(2)
    expect(state.selected.history).toHaveLength(2)
    expect(state.selected.business).toEqual(procurementBusiness)
  })

  it('rejects a later inbox page that rewrites a cached typed business or audit prefix', async () => {
    const original = typed('immutable')
    getRequests.mockResolvedValue({ data: [original] })
    getInbox.mockImplementation(query => Promise.resolve(page(query.box === 'PENDING' ? [original] : [])))
    const { state } = await setup(); state.tab = 'inbox'
    for (const corrupted of [
      { ...typedVote('immutable'), business: { ...procurementBusiness, unitPrice: 0.2 } },
      { ...typedVote('immutable'), history: [{ ...original.history[0], comment: 'Rewritten audit' }, typedVote('immutable').history[1]] }
    ]) {
      getInbox.mockResolvedValueOnce(page([corrupted])); await state.refreshInbox()
      expect(state.boxes.PENDING.error).toBeTruthy()
      expect(state.requests[0]).toEqual(original)
      expect(state.memberInbox.remember([original])[0]).toEqual(original)
    }
  })

  it('preserves procurement draft and retry intent across inbox navigation, filtering, locale and publication refresh', async () => {
    getMe.mockResolvedValue({ data: { id: '100', displayName: 'Applicant', canPublish: false } })
    submitDocument.mockRejectedValueOnce(new Error('Response lost'))
    const { wrapper, state } = await setup(); fillProcurement(state)
    await state.submit()
    const first = submitDocument.mock.calls[0]
    expect(first[0]).toEqual({ business: procurementBusiness, processVersion: 2 })
    expect(state.submissionAttempt.key).toBe(first[1])
    state.tab = 'inbox'; await flushPromises(); state.filterInbox('status', 'PENDING'); await flushPromises()
    await wrapper.get('[data-testid="language-select"]').setValue('en'); state.tab = 'handled'; state.tab = 'mine'; await flushPromises()
    expect(state.item).toBe(' USB-C adapter '); expect(state.unitPrice).toBe('0.10'); expect(state.total).toBe('0.30')
    getProcess.mockResolvedValue({ data: { ...definition, version: 3 } }); await state.refresh()
    expect(state.submissionProcess.version).toBe(2)
    submitDocument.mockResolvedValueOnce({ data: typed('created') }); await state.submit()
    expect(submitDocument.mock.calls[1]).toEqual(first)
    expect(submitRequest).not.toHaveBeenCalled()
    expect(state.selectedDocument.business).toEqual(procurementBusiness)
    expect(state.notice).toBe('Request submitted.')
    expect(state.businessId).toBe('')
  })

  it.each(['', 'replacement-session'])('clears all typed input and ignores a late submission on session change to %s', async token => {
    getMe.mockResolvedValue({ data: { id: '100', displayName: 'Applicant' } })
    const result = deferred(); submitDocument.mockReturnValueOnce(result.promise)
    const { state } = await setup(); fillProcurement(state)
    const submit = state.submit(); expect(submitDocument).toHaveBeenCalledTimes(1)
    session.token = token
    expect(state.businessType).toBe('leave'); expect(state.businessId).toBe(''); expect(state.item).toBe('')
    expect(state.unitPrice).toBe(''); expect(state.title).toBe(''); expect(state.reason).toBe('')
    expect(state.submissionAttempt).toBeNull()
    await flushPromises(); result.resolve({ data: typed('late-created') }); await submit
    expect(state.requests).toEqual([]); expect(state.selected).toBeUndefined()
    expect(state.boxes.PENDING.items).toEqual([]); expect(state.boxes.HANDLED.items).toEqual([])
  })

  it('does not reopen an old typed detail after navigating away during its decision', async () => {
    getInbox.mockResolvedValue(page([typed('old-detail')]))
    const result = deferred(); decideRequest.mockReturnValueOnce(result.promise)
    const { state } = await setup(); state.tab = 'inbox'; state.select(state.visible[0])
    const decision = state.decide('APPROVE'); state.tab = 'mine'
    result.resolve({ data: typedVote('old-detail') }); await decision
    expect(state.tab).toBe('mine'); expect(state.selected).toBeUndefined()
    expect(state.boxes.HANDLED.items[0].business).toEqual(procurementBusiness)
  })
})


describe('controlled native inbox version input', () => {
  const control = wrapper => wrapper.get('input[aria-label="筛选流程版本"]')
  async function type(wrapper, value) {
    const input = control(wrapper); input.element.value = value
    await input.trigger('input'); await nextTick()
    return input
  }
  it('echoes every input before blur, preserves loaded filters while editing, and fetches once on change', async () => {
    getInbox.mockImplementation(query => Promise.resolve(page(query.box === 'PENDING' ? [item('pending')] : [], query.box === 'PENDING' ? 'old-cursor' : null)))
    const { wrapper, state } = await setup(); state.tab = 'inbox'; await flushPromises()
    state.select(state.visible[0]); const before = getInbox.mock.calls.length
    await type(wrapper, '2'); expect(control(wrapper).element.value).toBe('2')
    await type(wrapper, '24'); expect(control(wrapper).element.value).toBe('24')
    expect(getInbox).toHaveBeenCalledTimes(before)
    expect(state.boxes.PENDING.processVersion).toBe('')
    expect(state.boxes.PENDING.nextCursor).toBe('old-cursor')
    expect(state.visible).toHaveLength(1); expect(state.selected.id).toBe('pending')
    await control(wrapper).trigger('change'); await flushPromises()
    expect(getInbox).toHaveBeenCalledTimes(before + 1)
    expect(getInbox.mock.calls.at(-1)[0]).toEqual({ box: 'PENDING', limit: 25, processVersion: 24 })
    expect(state.selected).toBeUndefined()
    expect(control(wrapper).element.value).toBe('24')
  })
  it('keeps pending and handled drafts independent and commits clearing only on change', async () => {
    const { wrapper, state } = await setup(); state.tab = 'inbox'; await flushPromises()
    const before = getInbox.mock.calls.length
    await type(wrapper, '12')
    state.tab = 'handled'; await flushPromises(); expect(control(wrapper).element.value).toBe('')
    await type(wrapper, '3'); await control(wrapper).trigger('change'); await flushPromises()
    expect(getInbox.mock.calls.at(-1)[0]).toEqual({ box: 'HANDLED', limit: 25, processVersion: 3 })
    state.tab = 'inbox'; await flushPromises(); expect(control(wrapper).element.value).toBe('12')
    expect(state.boxes.PENDING.processVersion).toBe('')
    expect(state.boxes.HANDLED.processVersion).toBe('3')
    expect(getInbox).toHaveBeenCalledTimes(before + 1)
    await control(wrapper).trigger('change'); await flushPromises()
    await type(wrapper, ''); expect(state.boxes.PENDING.processVersion).toBe('12')
    expect(getInbox).toHaveBeenCalledTimes(before + 2)
    await control(wrapper).trigger('change'); await flushPromises()
    expect(getInbox.mock.calls.at(-1)[0]).toEqual({ box: 'PENDING', limit: 25 })
    expect(state.boxes.HANDLED.processVersion).toBe('3')
    state.tab = 'handled'; await flushPromises(); expect(control(wrapper).element.value).toBe('3')
  })
  it.each(['', 'replacement-session'])('clears uncommitted version drafts on session replacement %s', async token => {
    const { wrapper, state } = await setup(); state.tab = 'inbox'; await flushPromises(); await type(wrapper, '12')
    state.tab = 'handled'; await flushPromises(); await type(wrapper, '3')
    session.token = token; await flushPromises()
    expect(control(wrapper).element.value).toBe('')
    state.tab = 'inbox'; await flushPromises(); expect(control(wrapper).element.value).toBe('')
    expect(state.boxes.PENDING.processVersion).toBe(''); expect(state.boxes.HANDLED.processVersion).toBe('')
  })
  it('clears both version drafts when a full refresh discovers another authenticated actor', async () => {
    const { wrapper, state } = await setup(); state.tab = 'inbox'; await flushPromises(); await type(wrapper, '12')
    state.tab = 'handled'; await flushPromises(); await type(wrapper, '3')
    getMe.mockResolvedValue({ data: { id: '103', displayName: 'Other reviewer' } })
    await state.refresh(); await flushPromises()
    expect(control(wrapper).element.value).toBe('')
    state.tab = 'inbox'; await flushPromises(); expect(control(wrapper).element.value).toBe('')
  })
})
