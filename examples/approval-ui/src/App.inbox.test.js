import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { api } from './api'
vi.mock('./api', () => ({ api: { login: vi.fn(), logout: vi.fn(), request: vi.fn() } }))
const definition = { schemaVersion: 3, id: 'leave-approval', version: 1, name: 'Leave', nodes: [
  { id: 'start', type: 'start', name: 'Start', assigneeId: null },
  { id: 'team', type: 'parallelApproval', name: 'Team', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ALL' },
  { id: 'again', type: 'approval', name: 'Follow-up', assigneeId: 'bob' },
  { id: 'end', type: 'end', name: 'End', assigneeId: null },
] }
const vote = (actorId, stepId = 'team') => ({ actorId, stepId, action: 'APPROVE', at: '2026-10-07T12:00:00Z', comment: '' })
const item = (id, overrides = {}) => ({ id, title: `Request ${id}`, reason: 'Synthetic leave', days: 1, applicantId: 'alice', approverId: 'bob', processId: 'leave-approval', processVersion: 1, definition, status: 'PENDING', currentStepId: 'team', history: [{ actorId: 'alice', action: 'SUBMIT', stepId: null, at: '2026-10-07T11:00:00Z' }], ...overrides })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const field = (wrapper, id) => wrapper.find(`[data-testid="${id}"]`)
const wrappers = []
function setup() {
  const server = { actor: 'bob', legacy: [item('legacy')], pending: { items: [item('p1')], nextCursor: null }, handled: { items: [], nextCursor: null }, route: null }
  api.request.mockImplementation(async (path, options) => {
    if (path.startsWith('/requests/inbox?')) return server.route ? server.route(new URLSearchParams(path.split('?')[1]), options) : structuredClone(server[new URLSearchParams(path.split('?')[1]).get('box').toLowerCase()])
    return structuredClone({ '/me': { id: server.actor, name: server.actor }, '/people': ['alice', 'bob', 'carol'].map(id => ({ id, name: id })), '/process': definition, '/requests': server.legacy }[path])
  })
  const wrapper = mount(App); wrappers.push(wrapper); return { wrapper, server }
}
async function login(wrapper) { await wrapper.find('input[type=password]').setValue('test-only'); await wrapper.find('.login-form').trigger('submit'); await flushPromises() }
async function tab(wrapper, id) { await field(wrapper, id).trigger('click'); await flushPromises() }
const calls = () => api.request.mock.calls.filter(([path]) => path.startsWith('/requests/inbox?'))
beforeEach(() => vi.resetAllMocks())
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))
describe('paginated member worklists', () => {
  it('uses server membership independently of the legacy list and preserves related request history', async () => {
    const { wrapper } = setup(); await login(wrapper)
    expect(calls()).toHaveLength(0); expect(wrapper.find('.request-item').text()).toContain('legacy')
    await tab(wrapper, 'inbox-tab')
    expect(wrapper.find('.request-item').text()).toContain('p1'); expect(wrapper.find('.request-list .count').text()).toBe('1 loaded')
    expect(wrapper.find('.workspace-summary').exists()).toBe(false)
    await wrapper.find('.request-item').trigger('click'); expect(wrapper.find('.detail h2').text()).toBe('Request p1')
    await tab(wrapper, 'requests-tab'); expect(wrapper.find('.request-item').text()).toContain('legacy')
  })
  it('keeps independent cursor progress when switching boxes and clearly labels handled pending work', async () => {
    const { wrapper, server } = setup(); const handled = item('h1', { history: [vote('bob')], currentStepId: 'again' })
    server.route = params => params.get('box') === 'HANDLED' ? { items: [handled], nextCursor: 'handled-next' } : params.has('cursor') ? { items: [item('p2')], nextCursor: null } : { items: [item('p1')], nextCursor: 'pending-next' }
    await login(wrapper); await tab(wrapper, 'inbox-tab'); await field(wrapper, 'inbox-more').trigger('click'); await flushPromises()
    expect(wrapper.findAll('.request-item')).toHaveLength(2)
    await tab(wrapper, 'handled-tab'); expect(wrapper.find('.request-item .status').text()).toBe('pending')
    expect(wrapper.text()).toContain('Some may still need other votes'); await tab(wrapper, 'inbox-tab')
    expect(wrapper.findAll('.request-item')).toHaveLength(2); expect(calls()).toHaveLength(3)
  })
  it('cancels stale filter requests and resets only that box to the first page', async () => {
    const { wrapper, server } = setup(); const old = deferred()
    server.route = params => params.get('status') ? { items: [], nextCursor: null } : old.promise
    await login(wrapper); await field(wrapper, 'inbox-tab').trigger('click'); await flushPromises()
    const signal = calls()[0][1].signal
    await field(wrapper, 'inbox-status').setValue('APPROVED'); await field(wrapper, 'inbox-version').setValue('2')
    await field(wrapper, 'inbox-filters').trigger('submit'); await flushPromises(); expect(signal.aborted).toBe(true)
    old.resolve({ items: [item('old')], nextCursor: 'old-cursor' }); await flushPromises()
    expect(wrapper.findAll('.request-item')).toHaveLength(0); expect(calls()[1][0]).toContain('status=APPROVED&processVersion=2')
    expect(calls()[1][0]).not.toContain('cursor=')
    await field(wrapper, 'workspace-language').setValue('zh')
    expect(wrapper.text()).toContain('已加载 0 条'); expect(wrapper.text()).toContain('此列表暂无符合条件的申请')
  })
  it('clears all actor data and ignores a late prior-session error after a new login', async () => {
    const { wrapper, server } = setup(); const old = deferred(); server.route = () => old.promise
    await login(wrapper); await field(wrapper, 'inbox-tab').trigger('click'); await flushPromises()
    const signal = calls()[0][1].signal
    await field(wrapper, 'sign-out').trigger('click'); expect(signal.aborted).toBe(true)
    server.actor = 'carol'; server.legacy = []; server.route = () => ({ items: [], nextCursor: null })
    await login(wrapper); await tab(wrapper, 'inbox-tab')
    old.reject(Object.assign(new Error('Expired old session'), { status: 401 })); await flushPromises()
    expect(wrapper.find('.workspace').exists()).toBe(true); expect(wrapper.find('.sidebar-bottom').text()).toContain('carol')
    expect(wrapper.findAll('.request-item')).toHaveLength(0); expect(wrapper.find('[role=alert]').exists()).toBe(false)
  })
  it.each([['partial', 'team', ['bob']], ['next step', 'again', ['bob', 'carol']]])('reconciles %s votes into handled with correct pending overlap', async (_, step, actors) => {
    const { wrapper, server } = setup(); await login(wrapper); await tab(wrapper, 'inbox-tab'); await wrapper.find('.request-item').trigger('click')
    const saved = item('p1', { currentStepId: step, history: [item('p1').history[0], ...actors.map(actor => vote(actor))] })
    api.request.mockImplementationOnce(async () => { server.pending = { items: step === 'again' ? [saved] : [], nextCursor: null }; server.handled = { items: [saved], nextCursor: null }; return structuredClone(saved) })
    await wrapper.find('.decision-form').trigger('submit'); await flushPromises()
    expect(wrapper.findAll('.request-item')).toHaveLength(step === 'again' ? 1 : 0)
    expect(wrapper.find('.decision-form').exists()).toBe(step === 'again')
    await tab(wrapper, 'handled-tab'); expect(wrapper.find('.request-item').text()).toContain('p1'); expect(wrapper.find('.request-item .status').text()).toBe('pending')
    expect(calls().slice(-2).every(([path]) => !path.includes('cursor='))).toBe(true)
  })
  it('keeps loaded rows on next-page failure and retries the same cursor', async () => {
    const { wrapper, server } = setup(); let fail = true
    server.route = params => !params.has('cursor') ? { items: [item('p1')], nextCursor: 'next' } : fail ? Promise.reject(new Error('Offline')) : { items: [item('p2')], nextCursor: null }
    await login(wrapper); await tab(wrapper, 'inbox-tab'); await field(wrapper, 'inbox-more').trigger('click'); await flushPromises()
    expect(wrapper.findAll('.request-item')).toHaveLength(1); expect(wrapper.find('[role=alert]').text()).toContain('Retry')
    fail = false; await field(wrapper, 'inbox-retry').trigger('click'); await flushPromises()
    expect(wrapper.findAll('.request-item')).toHaveLength(2); expect(calls().at(-1)[0]).toBe(calls().at(-2)[0])
  })
  it('removes signed-in data on an inbox authentication failure', async () => {
    const { wrapper, server } = setup(); server.route = () => Promise.reject(Object.assign(new Error('Authentication required'), { status: 401 }))
    await login(wrapper); await tab(wrapper, 'inbox-tab')
    expect(wrapper.find('.workspace').exists()).toBe(false); expect(wrapper.find('[role=alert]').text()).toContain('credentials were not accepted')
    expect(api.logout).toHaveBeenCalled()
  })
  it('recovers a losing ANY vote through legacy history when neither inbox contains it', async () => {
    const { wrapper, server } = setup()
    const anyDefinition = { ...definition, nodes: definition.nodes.map(node => node.id === 'team' ? { ...node, completionMode: 'ANY' } : node).filter(node => node.id !== 'again') }
    server.pending.items = [item('p1', { definition: anyDefinition })]
    await login(wrapper); await tab(wrapper, 'inbox-tab'); await wrapper.find('.request-item').trigger('click')
    const closed = item('p1', { definition: anyDefinition, status: 'APPROVED', currentStepId: null, history: [item('p1').history[0], vote('carol')] })
    server.legacy = [closed]; server.pending = { items: [], nextCursor: null }; server.handled = { items: [], nextCursor: null }
    api.request.mockRejectedValueOnce(Object.assign(new Error('Request is already terminal'), { status: 409 }))
    await wrapper.find('.decision-form').trigger('submit'); await flushPromises()
    expect(wrapper.find('.detail .status').text()).toBe('approved'); expect(wrapper.find('.decision-form').exists()).toBe(false)
    expect(wrapper.findAll('.request-item')).toHaveLength(0)
  })
  it('locks an uncertain decision if historical recovery fails, then unlocks only after refresh', async () => {
    const { wrapper, server } = setup(); await login(wrapper); await tab(wrapper, 'inbox-tab'); await wrapper.find('.request-item').trigger('click')
    api.request.mockRejectedValueOnce(new Error('Offline')).mockRejectedValueOnce(new Error('Still offline'))
    await wrapper.find('.decision-form').trigger('submit'); await flushPromises()
    expect(wrapper.find('.decision-form').exists()).toBe(false); expect(wrapper.text()).toContain('last result is still uncertain')
    server.legacy = [item('p1')]
    await field(wrapper, 'refresh').trigger('click'); await flushPromises()
    expect(wrapper.find('.detail h2').text()).toBe('Request p1')
    expect(wrapper.find('.decision-form').exists()).toBe(true)
  })
  it('keeps the new bilingual sign-in labels while discarding a signed-out second page', async () => {
    const { wrapper, server } = setup(); const pageTwo = deferred()
    expect(wrapper.find('.login-form h2').text()).toBe('Choose a demo account')
    server.route = params => params.has('cursor') ? pageTwo.promise : { items: [item('first')], nextCursor: 'copy-next' }
    await login(wrapper); await tab(wrapper, 'inbox-tab'); await field(wrapper, 'inbox-more').trigger('click'); await flushPromises()
    const signal = calls().at(-1)[1].signal, count = calls().length
    await field(wrapper, 'workspace-language').setValue('zh')
    expect(wrapper.find('.request-list .count').text()).toBe('已加载 1 条'); expect(calls()).toHaveLength(count)
    await field(wrapper, 'sign-out').trigger('click')
    expect(wrapper.find('.login-form h2').text()).toBe('选择示例账号'); expect(signal.aborted).toBe(true)
    server.actor = 'carol'; server.legacy = []; server.route = () => ({ items: [], nextCursor: null })
    await login(wrapper); await tab(wrapper, 'inbox-tab')
    pageTwo.resolve({ items: [item('stale-copy-page')], nextCursor: null }); await flushPromises()
    expect(wrapper.findAll('.request-item')).toHaveLength(0); expect(wrapper.find('.request-list .count').text()).toBe('已加载 0 条')
    expect(wrapper.find('.sidebar-bottom').text()).toContain('carol')
  })
  it('aborts paginated reads on unmount', async () => {
    const { wrapper, server } = setup(); const old = deferred(); server.route = () => old.promise
    await login(wrapper); await field(wrapper, 'inbox-tab').trigger('click'); await flushPromises()
    const signal = calls()[0][1].signal; wrapper.unmount(); wrappers.pop(); expect(signal.aborted).toBe(true)
    old.resolve({ items: [item('late')], nextCursor: null }); await flushPromises()
  })
})
