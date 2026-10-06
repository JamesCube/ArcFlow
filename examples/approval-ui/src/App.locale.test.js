import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { api } from './api'
vi.mock('./api', () => ({ api: { login: vi.fn(), logout: vi.fn(), request: vi.fn() } }))
const people = [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }, { id: 'carol', name: 'Carol' }]
const definition = { schemaVersion: 3, id: 'leave-approval', version: 2, name: 'Original process name', nodes: [
  { id: 'start', type: 'start', name: 'Original start', assigneeId: null },
  { id: 'team', type: 'parallelApproval', name: 'Original group', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ALL' },
  { id: 'end', type: 'end', name: 'Original end', assigneeId: null },
] }
const item = { id: 'request-1', title: 'Original title', reason: 'Original reason', days: 1, applicantId: 'alice', approverId: 'bob', currentStepId: 'team', status: 'PENDING', createdAt: '2026-10-05T01:00:00Z', updatedAt: '2026-10-05T01:00:00Z', decision: null, comment: null, processId: 'leave-approval', processVersion: 2, definition, history: [{ action: 'SUBMIT', stepId: null, actorId: 'alice', at: '2026-10-05T01:00:00Z', comment: '' }] }
const copy = value => structuredClone(value)
const wrappers = []
function setup(identity = 'bob', items = [item]) {
  const server = { definition: copy(definition), items: copy(items) }
  api.request.mockImplementation(async path => copy({ '/me': people.find(person => person.id === identity), '/people': people, '/process': server.definition, '/requests': server.items }[path]))
  const wrapper = mount(App); wrappers.push(wrapper); return { wrapper, server }
}
const field = (wrapper, id) => wrapper.find(`[data-testid="${id}"]`)
async function login(wrapper) { await wrapper.find('input[type=password]').setValue('test-only'); await wrapper.find('.login-form').trigger('submit'); await flushPromises() }
async function locale(wrapper, value) { await field(wrapper, 'workspace-language').setValue(value) }
const posts = () => api.request.mock.calls.filter(([, options]) => options?.method === 'POST')
beforeEach(() => vi.resetAllMocks())
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()) })

describe('one language throughout the workspace', () => {
  it('defaults to English and switches all login copy before authentication', async () => {
    const { wrapper } = setup()
    expect(wrapper.find('h2').text()).toBe('Choose your perspective')
    await locale(wrapper, 'zh')
    expect(wrapper.find('h2').text()).toBe('选择你的工作视角')
    expect(wrapper.find('button').text()).toBe('进入工作区 →')
    expect(wrapper.find('.login-shell').attributes('lang')).toBe('zh-CN')
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(wrapper.text()).toContain('本演示仅限本机使用')
    await login(wrapper)
    expect(wrapper.find('.page-heading h1').text()).toBe('请假审批')
    expect(wrapper.find('.designer-workbench').attributes('lang')).toBe('zh-CN')
    expect(wrapper.find('.new-request h2').text()).toBe('新建请假申请')
    expect(wrapper.find('.page-footer').text()).toContain('仅使用合成数据')
  })
  it('switches the whole workspace from its single global selector without changing saved data or making API calls', async () => {
    const { wrapper } = setup('alice'); await login(wrapper)
    await field(wrapper, 'process-tab').trigger('click')
    await field(wrapper, 'process-name').setValue('Unpublished title')
    const count = api.request.mock.calls.length
    expect(field(wrapper, 'designer-language').exists()).toBe(false)
    await locale(wrapper, 'zh')
    expect(wrapper.find('.designer-workbench').attributes('lang')).toBe('zh-CN')
    expect(wrapper.find('.page-heading h1').text()).toBe('流程设计器')
    expect(field(wrapper, 'publish').text()).toContain('发布流程')
    await locale(wrapper, 'en')
    expect(field(wrapper, 'workspace-language').element.value).toBe('en')
    expect(wrapper.find('.page-heading h1').text()).toBe('Process designer')
    expect(field(wrapper, 'process-name').element.value).toBe('Unpublished title')
    expect(api.request).toHaveBeenCalledTimes(count)
    expect(posts()).toHaveLength(0)
  })
  it('localizes runtime status, snapshots, activity, decisions and date formatting while preserving original content', async () => {
    const { wrapper } = setup(); await login(wrapper); await wrapper.find('.request-item').trigger('click')
    const originalDate = wrapper.find('.timeline small').text()
    await locale(wrapper, 'zh')
    expect(wrapper.find('.detail .status').text()).toBe('审批中')
    expect(field(wrapper, 'instance-snapshot').text()).toContain('提交时的审批顺序')
    expect(field(wrapper, 'instance-snapshot').text()).toContain('提交时保存的只读快照')
    expect(wrapper.find('.participant-votes').text()).toContain('Bob · 等待决定')
    expect(wrapper.find('.timeline').text()).toContain('已提交申请')
    expect(wrapper.find('.history-heading').text()).toBe('操作记录')
    expect(field(wrapper, 'approve-decision').text()).toBe('投同意票')
    expect(field(wrapper, 'reject-decision').text()).toBe('投拒绝票')
    expect(wrapper.find('.timeline small').text()).not.toBe(originalDate)
    expect(wrapper.find('.detail h2').text()).toBe('Original title')
    expect(wrapper.find('.detail-reason').text()).toBe('Original reason')
    expect(field(wrapper, 'instance-snapshot').text()).toContain('Original process name')
    expect(wrapper.find('dl').text()).toContain('1 天')
    expect(posts()).toHaveLength(0)
  })
  it('retranslates a recorded group vote and terminal outcome without replaying decisions', async () => {
    const { wrapper } = setup(); await login(wrapper); await wrapper.find('.request-item').trigger('click')
    const voted = { ...copy(item), history: [...copy(item.history), { action: 'APPROVE', stepId: 'team', actorId: 'bob', comment: 'Original decision', at: '2026-10-05T02:00:00Z' }] }
    api.request.mockResolvedValueOnce(voted)
    await wrapper.find('.decision-form').trigger('submit'); await flushPromises()
    expect(wrapper.find('[role=status]').text()).toBe('Vote recorded. This group is still pending; awaiting Carol.')
    await locale(wrapper, 'zh')
    expect(wrapper.find('[role=status]').text()).toBe('决定已记录。此节点仍在审批中，等待 Carol。')
    expect(wrapper.find('.participant-votes').text()).toContain('Bob · 已同意')
    expect(wrapper.find('.participant-votes').text()).toContain('Carol · 等待决定')
    expect(wrapper.find('.timeline').text()).toContain('投票已同意')
    expect(wrapper.find('.timeline').text()).toContain('Original decision')
    expect(posts()).toHaveLength(1)
    const { wrapper: finished } = setup('carol', [{ ...voted, status: 'APPROVED', currentStepId: null, history: [...voted.history, { action: 'APPROVE', stepId: 'team', actorId: 'carol', at: '2026-10-05T03:00:00Z' }] }])
    await login(finished); await finished.find('.request-item').trigger('click'); await locale(finished, 'zh')
    expect(finished.find('.detail .status').text()).toBe('已通过')
    expect(finished.find('.decision-form').exists()).toBe(false)
    expect(finished.find('.snapshot-steps [data-step-id="end"]').text()).toContain('已完成')
  })
  it('retranslates refresh notices and preserves local drafts when switching language', async () => {
    const { wrapper } = setup('alice'); await login(wrapper); await field(wrapper, 'process-tab').trigger('click')
    await field(wrapper, 'process-name').setValue('Keep draft')
    await field(wrapper, 'refresh').trigger('click'); await flushPromises()
    expect(wrapper.find('[role=status]').text()).toContain('Your local draft is preserved')
    await locale(wrapper, 'zh')
    expect(wrapper.find('[role=status]').text()).toBe('已更新申请和已发布流程，你的本地草稿已保留。')
    expect(field(wrapper, 'process-name').element.value).toBe('Keep draft')
    await field(wrapper, 'sign-out').trigger('click')
    expect(wrapper.find('h2').text()).toBe('选择你的工作视角')
    expect(wrapper.find('input[type=password]').element.value).toBe('')
  })
})

describe('task-first workspace hierarchy', () => {
  it('keeps a review decision before the long snapshot and activity trail', async () => {
    const { wrapper } = setup(); await login(wrapper); await wrapper.find('.request-item').trigger('click')
    const detail = wrapper.find('.detail').element
    const form = detail.querySelector('.decision-form')
    const snapshot = detail.querySelector('.instance-snapshot')
    expect(form.compareDocumentPosition(snapshot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(wrapper.findAll('.decision-form')).toHaveLength(1)
    expect(posts()).toHaveLength(0)
  })
  it('tracks the active page in both breadcrumb languages and keeps decorative icons hidden', async () => {
    const { wrapper } = setup('alice'); await login(wrapper)
    await field(wrapper, 'process-tab').trigger('click')
    expect(wrapper.find('.breadcrumb').text()).toContain('Process designer')
    await locale(wrapper, 'zh')
    expect(wrapper.find('.breadcrumb').text()).toContain('流程设计器')
    await field(wrapper, 'inbox-tab').trigger('click')
    expect(wrapper.find('.breadcrumb').text()).toContain('待你审批')
    wrapper.findAll('.ui-icon').forEach(icon => expect(icon.attributes('aria-hidden')).toBe('true'))
    expect(field(wrapper, 'undo').attributes('aria-label')).toBe('撤销')
  })
})

describe('localized recovery in real application states', () => {
  it('retranslates login errors and clears credentials on failure', async () => {
    const { wrapper } = setup(); api.request.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    await login(wrapper)
    expect(wrapper.find('[role=alert]').text()).toContain('Check the demo account')
    await locale(wrapper, 'zh')
    expect(wrapper.find('[role=alert]').text()).toContain('登录未通过')
    expect(wrapper.find('[role=alert]').text()).not.toContain('Unauthorized')
    expect(wrapper.find('.workspace').exists()).toBe(false)
    expect(wrapper.find('input[type=password]').element.value).toBe('')
    expect(api.logout).toHaveBeenCalledOnce()
  })
  it('shows translated validation and preserves data after an unknown refresh error', async () => {
    const { wrapper } = setup('alice'); await login(wrapper); await locale(wrapper, 'zh')
    await wrapper.find('.new-request').trigger('submit')
    expect(wrapper.find('[role=alert]').text()).toContain('1 至 365 之间的整数天数')
    expect(posts()).toHaveLength(0)
    api.request.mockRejectedValueOnce(Object.assign(new Error('Synthetic temporary outage'), { status: 503 }))
    await field(wrapper, 'refresh').trigger('click'); await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('当前仍显示上次加载的数据')
    expect(wrapper.find('[role=alert]').text()).toContain('服务返回信息（原文）：Synthetic temporary outage')
    expect(wrapper.find('.request-item').text()).toContain('Original title')
    await locale(wrapper, 'en')
    expect(wrapper.find('[role=alert]').text()).toContain('Server detail (original): Synthetic temporary outage')
  })
  it('localizes malformed process validation rather than rendering an unsafe workspace', async () => {
    const { wrapper, server } = setup(); server.definition.nodes[1].assigneeIds = ['bob', 'bob']
    await locale(wrapper, 'zh'); await login(wrapper)
    expect(wrapper.find('.workspace').exists()).toBe(false)
    expect(wrapper.find('[role=alert]').text()).toContain('流程模板无效')
    expect(wrapper.find('[role=alert]').text()).toContain('至少两位不同的参与人')
    expect(wrapper.find('[role=alert]').text()).not.toContain('distinct participants')
  })
})

describe('locale changes during mutations', () => {
  it('updates sign-in progress copy without starting another login', async () => {
    const { wrapper } = setup()
    let resolve
    api.request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    await wrapper.find('input[type=password]').setValue('test-only')
    await wrapper.find('.login-form').trigger('submit')
    expect(wrapper.find('.login-form button').text()).toBe('Signing in…')
    await locale(wrapper, 'zh')
    expect(wrapper.find('.login-form button').text()).toBe('正在登录…')
    expect(wrapper.find('.login-form button').attributes('disabled')).toBeDefined()
    expect(api.login).toHaveBeenCalledTimes(1)
    resolve(people[1]); await flushPromises()
    expect(wrapper.find('.page-heading h1').text()).toBe('请假审批')
  })
  it('updates pending submission and success copy without changing the payload', async () => {
    const { wrapper } = setup('alice', []); await login(wrapper)
    await field(wrapper, 'request-title').setValue('Original title')
    await field(wrapper, 'request-reason').setValue('Original reason')
    let resolve
    api.request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    await wrapper.find('.new-request').trigger('submit')
    expect(field(wrapper, 'submit-request').text()).toBe('Working…')
    await locale(wrapper, 'zh')
    expect(field(wrapper, 'submit-request').text()).toBe('处理中…')
    await wrapper.find('.new-request').trigger('submit')
    expect(posts()).toHaveLength(1)
    expect(JSON.parse(posts()[0][1].body)).toEqual({ title: 'Original title', reason: 'Original reason', days: 1, processVersion: 2 })
    resolve(copy(item)); await flushPromises()
    expect(wrapper.find('[role=status]').text()).toBe('申请已提交，Bob, Carol 现在可以审批第一个节点。')
    await locale(wrapper, 'en')
    expect(wrapper.find('[role=status]').text()).toBe('Request submitted. Bob, Carol can now review the first step.')
    expect(posts()).toHaveLength(1)
  })
  it('updates publication success and conflict recovery in the selected language', async () => {
    const { wrapper } = setup('alice'); await login(wrapper); await field(wrapper, 'process-tab').trigger('click')
    await field(wrapper, 'process-name').setValue('Published in English')
    api.request.mockResolvedValueOnce({ ...copy(definition), version: 3, name: 'Published in English' })
    await field(wrapper, 'publish').trigger('click'); await flushPromises(); await locale(wrapper, 'zh')
    expect(wrapper.find('[role=status]').text()).toContain('流程 v3 已发布')
    expect(field(wrapper, 'process-name').element.value).toBe('Published in English')
    await field(wrapper, 'process-name').setValue('Keep this draft')
    api.request.mockRejectedValueOnce(Object.assign(new Error('The published process changed; reload before publishing'), { status: 409 }))
    await field(wrapper, 'publish').trigger('click'); await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('你的草稿已保留')
    expect(wrapper.find('[role=alert]').text()).not.toContain('The published process changed')
    expect(field(wrapper, 'publish').attributes('disabled')).toBeDefined()
    expect(field(wrapper, 'process-name').element.value).toBe('Keep this draft')
    await locale(wrapper, 'en')
    expect(wrapper.find('[role=alert]').text()).toContain('Refresh to load the latest template, then reset')
    expect(posts()).toHaveLength(2)
  })
  it('clears completed action notices on navigation while preserving draft history', async () => {
    const { wrapper } = setup('alice'); await login(wrapper)
    await field(wrapper, 'refresh').trigger('click'); await flushPromises()
    expect(wrapper.find('[role=status]').text()).toContain('refreshed')
    await field(wrapper, 'process-tab').trigger('click')
    expect(wrapper.find('[role=status]').exists()).toBe(false)
    await field(wrapper, 'process-name').setValue('Keep my draft')
    await field(wrapper, 'requests-tab').trigger('click')
    await field(wrapper, 'process-tab').trigger('click')
    expect(field(wrapper, 'process-name').element.value).toBe('Keep my draft')
    expect(field(wrapper, 'undo').attributes('disabled')).toBeUndefined()
    expect(posts()).toHaveLength(0)
  })

})
