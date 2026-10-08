import { describe, expect, it, vi } from 'vitest'
import { createMemberInbox, INBOX_LIMIT } from './member-inbox'
const definition = { schemaVersion: 3, id: 'leave-approval', version: 1, nodes: [
  { id: 'start', type: 'start' }, { id: 'team', type: 'parallelApproval', assigneeIds: ['bob', 'carol'], completionMode: 'ALL' },
  { id: 'again', type: 'approval', assigneeId: 'bob' }, { id: 'end', type: 'end' },
] }
const item = (id = 'r1', overrides = {}) => ({ id, definition, processVersion: 1, status: 'PENDING', currentStepId: 'team', history: [{ actorId: 'alice', action: 'SUBMIT' }], ...overrides })
const vote = actorId => ({ actorId, action: 'APPROVE', stepId: 'team' })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
function setup() { const request = vi.fn(); const inbox = createMemberInbox(request); inbox.setActor('bob'); return { request, inbox } }
describe('actor-scoped member inbox', () => {
  it('requests a bounded page without an actor parameter and follows opaque cursors independently', async () => {
    const { request, inbox } = setup()
    request.mockResolvedValueOnce({ items: [item()], nextCursor: 'opaque:/+==' })
    await inbox.load('PENDING')
    request.mockResolvedValueOnce({ items: [item('h', { history: [vote('bob')], currentStepId: 'again' })], nextCursor: 'handled-cursor' })
    await inbox.load('HANDLED')
    request.mockResolvedValueOnce({ items: [item('r2')], nextCursor: null }); await inbox.load('PENDING', true)
    const params = new URLSearchParams(request.mock.calls[2][0].split('?')[1])
    expect(Object.fromEntries(params)).toEqual({ box: 'PENDING', limit: String(INBOX_LIMIT), cursor: 'opaque:/+==' })
    expect(inbox.items('PENDING').map(i => i.id)).toEqual(['r1', 'r2'])
    expect(inbox.state.HANDLED.nextCursor).toBe('handled-cursor')
    await inbox.load('PENDING', true); expect(request).toHaveBeenCalledTimes(3)
  })
  it('suppresses duplicate loads and preserves the cursor and items on a failed next page', async () => {
    const { request, inbox } = setup(); const wait = deferred()
    request.mockResolvedValueOnce({ items: [item()], nextCursor: 'next' }); await inbox.load('PENDING')
    request.mockReturnValueOnce(wait.promise); const loading = inbox.load('PENDING', true); await inbox.load('PENDING', true)
    expect(request).toHaveBeenCalledTimes(2); wait.reject(new Error('Offline')); await loading
    expect(inbox.items('PENDING')).toHaveLength(1); expect(inbox.state.PENDING.nextCursor).toBe('next')
    expect(inbox.state.PENDING.error.message).toBe('Offline')
    request.mockResolvedValueOnce({ items: [item('r2')], nextCursor: null }); await inbox.load('PENDING', true)
    expect(inbox.items('PENDING')).toHaveLength(2); expect(inbox.state.PENDING.error).toBeNull()
  })
  it('aborts and ignores a prior actor response even when the transport ignores abort', async () => {
    const { request, inbox } = setup(); const wait = deferred(); request.mockReturnValueOnce(wait.promise)
    const loading = inbox.load('PENDING'); const signal = request.mock.calls[0][1].signal
    inbox.setActor('carol'); expect(signal.aborted).toBe(true)
    wait.resolve({ items: [item()], nextCursor: 'foreign' }); await loading
    expect(inbox.state.entities).toEqual({}); expect(inbox.state.PENDING.loaded).toBe(false)
    expect(inbox.state.PENDING.nextCursor).toBeNull(); expect(inbox.state.PENDING.error).toBeNull()
  })
  it('resets only the filtered box and discards stale filter replies', async () => {
    const { request, inbox } = setup(); const old = deferred(); request.mockReturnValueOnce(old.promise)
    const loading = inbox.load('HANDLED'); const signal = request.mock.calls[0][1].signal
    inbox.state.PENDING.nextCursor = 'keep-pending'
    request.mockResolvedValueOnce({ items: [], nextCursor: null })
    expect(inbox.setFilters('HANDLED', { status: 'APPROVED', processVersion: '2' })).toBe(true)
    expect(signal.aborted).toBe(true)
    old.resolve({ items: [item('old', { history: [vote('bob')] })], nextCursor: 'old' }); await loading; await tick()
    expect(inbox.state.HANDLED.ids).toEqual([]); expect(inbox.state.PENDING.nextCursor).toBe('keep-pending')
    expect(request.mock.calls[1][0]).toContain('status=APPROVED&processVersion=2')
    inbox.setActor('bob'); expect(inbox.state.HANDLED.status).toBe(''); expect(inbox.state.HANDLED.processVersion).toBe('')
  })
  it.each(['0', '-1', '1.5', '1e2', '9007199254740992', '2147483648'])('rejects invalid version %s without changing a page', version => {
    const { request, inbox } = setup(); inbox.state.PENDING.nextCursor = 'keep'
    expect(inbox.setFilters('PENDING', { processVersion: version })).toBe(false)
    expect(inbox.state.PENDING.nextCursor).toBe('keep'); expect(request).not.toHaveBeenCalled()
  })
  it('keeps partial votes and later-stage overlap consistent across out-of-order boxes', async () => {
    const { request, inbox } = setup(); const stale = deferred(); request.mockReturnValueOnce(stale.promise)
    const pending = inbox.load('PENDING')
    const partial = item('r1', { history: [{ action: 'SUBMIT', actorId: 'alice' }, vote('bob')] })
    request.mockResolvedValueOnce({ items: [partial], nextCursor: null }); await inbox.load('HANDLED')
    stale.resolve({ items: [item()], nextCursor: null }); await pending
    expect(inbox.items('PENDING')).toEqual([]); expect(inbox.items('HANDLED')[0].history).toHaveLength(2)
    const next = { ...partial, currentStepId: 'again', history: [...partial.history, vote('carol')] }
    inbox.remember(next); expect(inbox.items('PENDING')[0].currentStepId).toBe('again')
    expect(inbox.items('HANDLED')[0].currentStepId).toBe('again')
    inbox.remember(item()); expect(inbox.state.entities.r1.history).toHaveLength(3)
  })
  it('deduplicates live-page overlap without regressing a newer snapshot', async () => {
    const { request, inbox } = setup(); const next = item('r1', { history: [...item().history, vote('bob'), vote('carol')], currentStepId: 'again' })
    request.mockResolvedValueOnce({ items: [next], nextCursor: 'next' }); await inbox.load('PENDING')
    request.mockResolvedValueOnce({ items: [item(), item('r2')], nextCursor: null }); await inbox.load('PENDING', true)
    expect(inbox.items('PENDING').map(i => i.id)).toEqual(['r1', 'r2'])
    expect(inbox.items('PENDING')[0].currentStepId).toBe('again')
  })
  it.each([null, { items: [], nextCursor: 'loop' }, { items: [item(), item()], nextCursor: null }, { items: [item('bad', { history: null })], nextCursor: null }, { items: [item('bad', { currentStepId: 'end' })], nextCursor: null }])('rejects malformed or foreign membership before changing cached data', async response => {
    const { request, inbox } = setup(); request.mockResolvedValue(response); await inbox.load('PENDING')
    expect(inbox.state.PENDING.error).toBeTruthy(); expect(inbox.state.entities).toEqual({})
  })
  it('refresh invalidates both cursors and aborts all earlier pages', async () => {
    const { request, inbox } = setup(); const wait = deferred(); request.mockReturnValueOnce(wait.promise)
    const loading = inbox.load('PENDING'); const signal = request.mock.calls[0][1].signal
    request.mockResolvedValue({ items: [], nextCursor: null }); await inbox.refresh()
    expect(signal.aborted).toBe(true); wait.reject(new Error('Old error')); await loading
    expect(inbox.state.PENDING.error).toBeNull(); expect(inbox.state.HANDLED.loaded).toBe(true)
  })
})
