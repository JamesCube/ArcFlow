// Exercise the actual native view's state machine with transport-only mocks.
// Native login/permissions and upstream interceptors remain real-smoke coverage.
import { shallowMount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NativeApproval from '../../ruoyi-vue3/frontend/src/views/arcflow/approval/index.vue'
import { getMe, getPeople, getProcess, getRequests, submitRequest } from '@/api/arcflow/approval'
vi.mock('@/api/arcflow/approval', () => ({ getMe: vi.fn(), getPeople: vi.fn(), getProcess: vi.fn(), getRequests: vi.fn(), publishProcess: vi.fn(), submitRequest: vi.fn(), decideRequest: vi.fn() }))
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
  getMe.mockResolvedValue({ data: { id: '100', displayName: 'Applicant', canPublish: false } })
  getPeople.mockResolvedValue({ data: [{ id: '100' }, { id: '101' }] })
  getProcess.mockResolvedValue({ data: definition })
  getRequests.mockResolvedValue({ data: [] })
})
async function setup() {
  const stubs = Object.fromEntries(['ElRow', 'ElCol', 'ElTabs', 'ElTabPane', 'ElAlert', 'ElButton', 'ElCard', 'ElTable', 'ElTableColumn', 'ElEmpty'].map(name => [name, true]))
  const wrapper = shallowMount(NativeApproval, { global: { directives: { hasPermi: () => {} }, stubs } })
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
