import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { validatePublicationResponse as standaloneAcknowledgement } from './process'
import { validatePublicationResponse as nativeAcknowledgement } from '../../ruoyi-vue3/frontend/src/views/arcflow/approval/process'
import NativeApproval from '../../ruoyi-vue3/frontend/src/views/arcflow/approval/index.vue'
import { api } from './api'
import { getInbox, getMe, getPeople, getProcess, getRequests, publishProcess } from '@/api/arcflow/approval'
vi.mock('./api', () => ({ api: { login: vi.fn(), logout: vi.fn(), request: vi.fn() } }))
vi.mock('@/api/arcflow/approval', () => ({ getInbox: vi.fn(), getMe: vi.fn(), getPeople: vi.fn(), getProcess: vi.fn(), getRequests: vi.fn(), publishProcess: vi.fn(), submitRequest: vi.fn(), submitDocument: vi.fn(), decideRequest: vi.fn() }))
const definition = { schemaVersion: 2, id: 'leave-approval', version: 1, name: 'Original process', nodes: [
  { id: 'start', type: 'start', name: 'Start', assigneeId: null },
  { id: 'review', type: 'approval', name: 'Review', assigneeId: 'bob' },
  { id: 'end', type: 'end', name: 'End', assigneeId: null },
] }
const clone = value => JSON.parse(JSON.stringify(value))
const people = [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }, { id: 'carol', name: 'Carol' }]
const wrappers = []
beforeEach(() => {
  vi.resetAllMocks()
  getInbox.mockResolvedValue({ data: { items: [], nextCursor: null } })
  getMe.mockResolvedValue({ data: { id: 'alice', displayName: 'Alice', canPublish: true } })
  getPeople.mockResolvedValue({ data: people })
  getProcess.mockResolvedValue({ data: clone(definition) })
  getRequests.mockResolvedValue({ data: [] })
  api.request.mockImplementation(async path => clone({ '/me': people[0], '/people': people, '/process': definition, '/requests': [] }[path]))
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()) })
async function standalone() {
  const wrapper = mount(App); wrappers.push(wrapper)
  await wrapper.find('input[type=password]').setValue('test-only')
  await wrapper.find('.login-form').trigger('submit'); await flushPromises()
  await wrapper.find('[data-testid="process-tab"]').trigger('click')
  return { wrapper, state: wrapper.vm.$.setupState }
}
async function native() {
  const stubs = Object.fromEntries(['ElRow', 'ElCol', 'ElTabs', 'ElTabPane', 'ElAlert', 'ElButton', 'ElCard', 'ElTable', 'ElTableColumn', 'ElEmpty', 'ElForm', 'ElFormItem', 'ElInput', 'ElInputNumber', 'ElSelect', 'ElOption', 'ElDescriptions', 'ElDescriptionsItem', 'ElTag', 'ElTimeline', 'ElTimelineItem'].map(name => [name, true]))
  const wrapper = shallowMount(NativeApproval, { global: { stubs, directives: { hasPermi: () => {}, loading: () => {} } } }); wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, state: wrapper.vm.$.setupState }
}
describe('publication acknowledgement consistency audit', () => {
  it('standalone must preserve draft and history when POST responds with unchanged old definition', async () => {
    const { wrapper, state } = await standalone()
    await wrapper.get('[data-testid="process-name"]').setValue('My unsaved process')
    api.request.mockResolvedValueOnce(clone(definition))
    await state.publish(); await flushPromises()
    expect(state.draft.name).toBe('My unsaved process')
    expect(state.draftDirty).toBe(true)
    expect(state.noticeText).not.toContain('published')
    expect(state.staleDraft).toBe(true)
    expect(wrapper.get('[data-testid="undo"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-testid="undo"]').trigger('click')
    expect(state.draft.name).toBe('Original process')
  })
  it('native must preserve draft when POST success body is null', async () => {
    const { state } = await native()
    state.draft.name = 'My unsaved process'
    publishProcess.mockResolvedValueOnce({ data: null })
    await state.publish(); await flushPromises()
    expect(state.draft?.name).toBe('My unsaved process')
    expect(state.process).toEqual(definition)
    expect(state.refreshRequired).toBe(true)
  })
  it('native must preserve configured ANY when success returns a different valid group mode', async () => {
    const { state } = await native()
    state.changeMode('review', 'ANY')
    state.draft.nodes[1].assigneeIds = ['bob', 'carol']
    const reply = clone(state.draft); reply.version = 2; reply.nodes[1].completionMode = 'ALL'
    publishProcess.mockResolvedValueOnce({ data: reply })
    await state.publish(); await flushPromises()
    expect(state.draft.nodes[1].completionMode).toBe('ANY')
    expect(state.noticeKey).not.toBe('publishedNotice')
    expect(state.refreshRequired).toBe(true)
  })
})

const group = () => ({ ...clone(definition), schemaVersion: 3, nodes: [
  definition.nodes[0],
  { id: 'review', type: 'parallelApproval', name: 'Team review', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ANY' },
  { id: 'final', type: 'approval', name: 'Final review', assigneeId: 'carol' },
  definition.nodes[2],
] })
const reorderKeys = value => Array.isArray(value) ? value.map(reorderKeys) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorderKeys(item)])) : value
const changes = [
  ['null', () => null],
  ['unchanged version', value => ({ ...value, version: 1 })],
  ['skipped version', value => ({ ...value, version: 3 })],
  ['wrong process', value => ({ ...value, id: 'other-process' })],
  ['changed title', value => ({ ...value, name: 'Unexpected title' })],
  ['changed mode', value => { value.nodes[1].completionMode = 'ALL'; return value }],
  ['participant order', value => { value.nodes[1].assigneeIds.reverse(); return value }],
  ['changed assignee', value => { value.nodes[2].assigneeId = 'bob'; return value }],
  ['stage order', value => { [value.nodes[1], value.nodes[2]] = [value.nodes[2], value.nodes[1]]; return value }],
  ['missing stage', value => { value.nodes.splice(2, 1); return value }],
  ['unknown property', value => ({ ...value, unsupported: true })],
  ['missing node field', value => { delete value.nodes[1].assigneeId; return value }],
]
for (const [name, validate] of [['standalone', standaloneAcknowledgement], ['native', nativeAcknowledgement]]) {
  describe(`${name} publication acknowledgement contract`, () => {
    it.each(changes)('rejects %s without mutating the submitted draft', (_, alter) => {
      const proposed = group(), before = clone(proposed)
      const acknowledgement = alter({ ...clone(proposed), version: 2 })
      expect(() => validate(acknowledgement, proposed, people)).toThrow('did not confirm')
      expect(proposed).toEqual(before)
    })
    it('accepts server object-key reordering while retaining ordered stages and members', () => {
      const proposed = group(), acknowledgement = reorderKeys({ ...clone(proposed), version: 2 })
      expect(validate(acknowledgement, proposed, people)).toBe(acknowledgement)
    })
    it('accepts a schema-3 sequential process after conversion back from a group', () => {
      const proposed = { ...clone(definition), schemaVersion: 3 }, acknowledgement = { ...clone(proposed), version: 2 }
      expect(validate(acknowledgement, proposed, people)).toBe(acknowledgement)
    })
  })
}

describe('valid publication still clears draft history once', () => {
  it('standalone commits the matching new version and clears undo', async () => {
    const { wrapper, state } = await standalone()
    await wrapper.get('[data-testid="process-name"]').setValue(' My new process ')
    api.request.mockResolvedValueOnce(reorderKeys({ ...clone(definition), name: 'My new process', version: 2 }))
    await state.publish(); await flushPromises()
    expect(state.process.version).toBe(2)
    expect(state.draftDirty).toBe(false)
    expect(state.noticeText).toContain('Template v2 published')
    expect(wrapper.get('[data-testid="undo"]').attributes('disabled')).toBeDefined()
  })
  it('native acknowledges trimmed node names, ordered ANY and next version', async () => {
    const { state } = await native()
    state.draft = group(); state.draft.name = ' My process '; state.draft.nodes[1].name = ' My group '
    publishProcess.mockImplementationOnce(async ({ definition: submitted }) => ({ data: reorderKeys({ ...clone(submitted), version: 2 }) }))
    await state.publish(); await flushPromises()
    expect(state.process.name).toBe('My process')
    expect(state.process.nodes[1].name).toBe('My group')
    expect(state.process.nodes[1].completionMode).toBe('ANY')
    expect(state.dirty).toBe(false)
    expect(state.noticeKey).toBe('publishedNotice')
    expect(state.refreshRequired).toBe(false)
  })
})
