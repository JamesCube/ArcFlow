import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import ScenarioApp from './ScenarioApp.vue'
import { createScenarioWorkspace } from './scenario-workspace.js'
import { catalogFixture, clone, decidedFixture, deferred, expenseFixture, people, processFixture, sealFixture, sealProcessFixture, sealViewFixture, viewFixture } from './scenario-fixtures.js'
enableAutoUnmount(afterEach)
const EXPENSE = 'oa-expense', SEAL = 'oa-seal-use'
function setup() {
  const server = { identity: 'alice', catalog: catalogFixture(), onPost: null,
    [EXPENSE]: { process: processFixture(), items: [viewFixture()] },
    [SEAL]: { process: sealProcessFixture(), items: [sealViewFixture()] },
  }
  const api = { login: vi.fn(id => { server.identity = id }), logout: vi.fn(), request: vi.fn(async (path, options) => {
    if (options?.method === 'POST') return server.onPost(path, options)
    const [_, root, id, resource] = path.split('/')
    if (root === 'scenarios' && id) return clone(server[id][resource === 'process' ? 'process' : 'items'])
    return clone({ '/me': people.find(p => p.id === server.identity), '/people': people, '/scenarios': server.catalog }[path])
  }) }
  let keys = 0
  const workspace = createScenarioWorkspace(api, () => `seal-test-${++keys}`)
  return { workspace, s: workspace.state, server, api, posts: () => api.request.mock.calls.filter(([, options]) => options?.method === 'POST') }
}
const draft = overrides => sealFixture({ copyCount: '2', ...overrides })
const open = async (w, id) => { w.state.tab = 'catalog'; await w.activate(id) }
describe('independent Expense and Seal workspaces', () => {
  it('keeps both raw forms, drafts, review selection, notes and original retry version across real catalog switches', async () => {
    const c = setup(), w = c.workspace; await w.login('alice', 'synthetic')
    await w.activate(EXPENSE); w.setForm(expenseFixture()); c.s.draft.name = 'Expense local'
    c.s.tab = 'mine'; w.select('expense-1'); c.s.comment = 'Expense note'
    await open(w, SEAL); w.setForm(draft()); c.s.draft.name = 'Seal local'
    c.server.onPost = async () => { throw new TypeError('Lost seal response') }; await w.submit()
    const first = c.posts()[0][1]; c.s.tab = 'mine'; w.select('seal-1'); c.s.comment = 'Seal note'
    c.server[SEAL].process = sealProcessFixture({ version: 2 }); await w.refresh()
    await open(w, EXPENSE)
    expect(c.s.form).toEqual(expenseFixture()); expect(c.s.draft.name).toBe('Expense local'); expect(c.s.comment).toBe('Expense note'); expect(c.s.selectedId).toBe('expense-1')
    await open(w, SEAL)
    expect(c.s.comment).toBe('Seal note'); expect(c.s.selectedId).toBe('seal-1'); expect(c.s.draft.name).toBe('Seal local')
    expect(w.submissionDefinition().version).toBe(1); expect(c.s.form.copyCount).toBe('2')
    await w.submit(); expect(c.posts()[1][1]).toEqual(first)
    expect(JSON.parse(first.body).business.copyCount).toBe(2); expect(first.body).not.toMatch(/amount|currency|lines/)
    w.setForm(draft({ copyCount: ' 02 ' })); await w.submit(); expect(c.posts()[2][1]).toEqual(first)
    w.setForm(draft({ documentRef: 'DEMO-DOC-002' })); await w.submit()
    expect(c.posts()[3][1].headers['Idempotency-Key']).not.toBe(first.headers['Idempotency-Key'])
    expect(JSON.parse(c.posts()[3][1].body).processVersion).toBe(2)
  })
  it('suppresses repeats within a scope, isolates concurrent scopes and late success never changes newer navigation', async () => {
    const c = setup(), w = c.workspace, pending = deferred(); await w.login('alice', 'synthetic'); await w.activate(SEAL); w.setForm(draft())
    c.server.onPost = () => pending.promise; const sending = w.submit(); await w.submit(); expect(c.posts()).toHaveLength(1)
    w.setForm(draft({ copyCount: '3' })); expect(c.s.form.copyCount).toBe('2')
    await open(w, EXPENSE); w.setForm(expenseFixture({ title: 'Unrelated expense draft' })); c.s.tab = 'designer'
    pending.resolve(sealViewFixture()); await sending
    expect(c.s.activeId).toBe(EXPENSE); expect(c.s.tab).toBe('designer'); expect(c.s.form.title).toBe('Unrelated expense draft')
    expect(c.s.notice).not.toBe('submitted'); expect(c.s.scopes[SEAL].notice).toBe('submitted'); expect(c.s.scopes[SEAL].form.title).toBe('')
    await open(w, SEAL); expect(c.s.items).toHaveLength(1); expect(c.s.busy).toBe(false)
  })
  it('does not navigate away from a newer Catalog view when submission completes', async () => {
    const c = setup(), w = c.workspace, pending = deferred(); await w.login('alice', 'synthetic'); await w.activate(SEAL); w.setForm(draft())
    c.server.onPost = () => pending.promise; const sending = w.submit(); c.s.tab = 'catalog'
    pending.resolve(sealViewFixture()); await sending
    expect(c.s.tab).toBe('catalog'); expect(c.s.selectedId).toBeNull()
  })
  it('late refresh applies only to its original scope; logout invalidates every pending operation and private note', async () => {
    const c = setup(), w = c.workspace, pending = deferred(); await w.login('alice', 'synthetic'); await w.activate(SEAL)
    c.api.request.mockImplementationOnce(() => pending.promise); const refreshing = w.refresh()
    await open(w, EXPENSE); c.s.comment = 'Expense private'; pending.resolve(sealProcessFixture({ version: 2 })); await refreshing
    expect(c.s.process.id).toBe(EXPENSE); expect(c.s.process.version).toBe(1); expect(c.s.scopes[SEAL].process.version).toBe(2)
    await open(w, SEAL); w.setForm(draft()); c.s.comment = 'Seal private'; const post = deferred(); c.server.onPost = () => post.promise
    const sending = w.submit(); w.logout(); post.resolve(sealViewFixture()); await sending
    expect(c.s.me).toBeNull(); expect(c.s.catalog).toEqual([])
    for (const scope of Object.values(c.s.scopes)) { expect(scope.form.title).toBe(''); expect(scope.comment).toBe(''); expect(scope.items).toEqual([]); expect(scope.process).toBeNull(); expect(scope.busy).toBe(false) }
  })
  it('unauthorized response from an inactive scope invalidates the whole session', async () => {
    const c = setup(), w = c.workspace, pending = deferred(); await w.login('alice', 'synthetic'); await w.activate(SEAL)
    c.api.request.mockImplementationOnce(() => pending.promise); const refreshing = w.refresh(); await open(w, EXPENSE)
    pending.reject(Object.assign(new Error('Unauthorized'), { status: 401 })); await refreshing
    expect(c.s.me).toBeNull(); expect(c.s.scopes[SEAL].items).toEqual([]); expect(c.s.error.cause.status).toBe(401)
  })
  it('retains unconfirmed Seal notes in the original step while another scope remains untouched', async () => {
    const c = setup(), w = c.workspace; await w.login('bob', 'synthetic'); await w.activate(SEAL); c.s.tab = 'review'; w.select('seal-1'); c.s.comment = 'Original seal review note'
    c.server.onPost = async () => decidedFixture(sealViewFixture(), 'bob', 'APPROVE', 'Wrong saved note')
    await w.decide('APPROVE'); expect(c.s.error.cause.code).toBe('DECISION_COMMENT_MISMATCH')
    await open(w, EXPENSE); c.s.tab = 'review'; w.select('expense-1'); c.s.comment = 'Expense note'
    expect(w.retainedNotesFor('expense-1')).toEqual([])
    await open(w, SEAL); expect(c.s.selectedId).toBe('seal-1'); expect(c.s.comment).toBe('Original seal review note')
    expect(w.retainedNotesFor('seal-1')).toEqual([{ requestId: 'seal-1', stepId: 'documentReview', comment: 'Original seal review note' }]); expect(w.canDecide(c.s.items[0])).toBe(false)
  })
  it('rejects another scenario process and nonnull totals without destroying the valid Seal state', async () => {
    const c = setup(), w = c.workspace; await w.login('alice', 'synthetic'); await w.activate(SEAL)
    c.server[SEAL].process = processFixture(); await w.refresh(); expect(c.s.error.operation).toBe('refresh'); expect(c.s.process.id).toBe(SEAL)
    c.server[SEAL].process = sealProcessFixture(); c.server[SEAL].items = [{ ...sealViewFixture(), total: '0' }]; await w.refresh()
    expect(c.s.items[0].total).toBeNull(); w.setForm(draft()); c.server.onPost = async () => ({ ...sealViewFixture(), total: 0 }); await w.submit()
    expect(c.s.form.title).toBe(draft().title); expect(c.s.uncertainSubmission).toBe(true)
  })
})
async function mounted(identity = 'alice') {
  const c = setup(), wrapper = mount(ScenarioApp, { attachTo: document.body, props: { api: c.api } })
  await wrapper.find('.sf-login-form select').setValue(identity); await wrapper.find('input[type=password]').setValue('synthetic')
  await wrapper.find('.sf-login-form').trigger('submit'); await flushPromises()
  return { ...c, wrapper }
}
const click = async (wrapper, testid) => { await wrapper.find(`[data-testid=${testid}]`).trigger('click'); await flushPromises() }
const openCard = async (wrapper, type) => { await click(wrapper, 'catalog-tab'); await click(wrapper, `open-${type}`) }
const visibleDesigner = wrapper => wrapper.findAll('.designer-workbench').find(designer => designer.isVisible())
describe('mounted real Catalog switching', () => {
  it('shows a distinct nonmonetary Seal card and preserves raw fields and independent designer undo', async () => {
    const { wrapper } = await mounted()
    expect(wrapper.findAll('.sf-template-card')).toHaveLength(2)
    const card = wrapper.findAll('.sf-template-card')[1]; expect(card.text()).toContain('1–100 copies'); expect(card.text()).not.toContain('1,280.50')
    await click(wrapper, 'open-expense'); await wrapper.find('#expense-title').setValue('Expense draft')
    await click(wrapper, 'designer-tab'); await visibleDesigner(wrapper).find('[data-testid=process-name]').setValue('Expense local flow')
    await openCard(wrapper, 'seal'); await wrapper.find('#seal-documentRef').setValue('DEMO-DOC-ABC'); await wrapper.find('#seal-copyCount').setValue('1e2')
    await wrapper.find('form.sf-expense-form').trigger('submit'); await flushPromises(); expect(wrapper.find('#seal-copyCount').element.value).toBe('1e2')
    await click(wrapper, 'designer-tab'); await visibleDesigner(wrapper).find('[data-testid=process-name]').setValue('Seal local flow')
    await visibleDesigner(wrapper).find('[data-select-id=sealReview]').trigger('click')
    await openCard(wrapper, 'expense'); expect(visibleDesigner(wrapper).find('[data-testid=process-name]').element.value).toBe('Expense local flow')
    await visibleDesigner(wrapper).find('[data-testid=undo]').trigger('click'); expect(visibleDesigner(wrapper).find('[data-testid=process-name]').element.value).toBe('Expense approval')
    await click(wrapper, 'new-tab'); expect(wrapper.find('#expense-title').element.value).toBe('Expense draft')
    await openCard(wrapper, 'seal'); expect(visibleDesigner(wrapper).find('[data-testid=process-name]').element.value).toBe('Seal local flow')
    expect(visibleDesigner(wrapper).find('[data-select-id=sealReview]').attributes('aria-pressed')).toBe('true')
    await visibleDesigner(wrapper).find('[data-testid=undo]').trigger('click'); expect(visibleDesigner(wrapper).find('[data-testid=process-name]').element.value).toBe('Seal-use review')
    await click(wrapper, 'new-tab'); expect(wrapper.find('#seal-documentRef').element.value).toBe('DEMO-DOC-ABC'); expect(wrapper.find('#seal-copyCount').element.value).toBe('1e2')
    await wrapper.find('.sf-topbar select').setValue('zh'); expect(wrapper.find('#seal-reason-error').text()).toContain('用途说明')
  })
  it('retries the original mounted Seal payload/key/version after Catalog switching and a newer process refresh', async () => {
    const { wrapper, server, api } = await mounted()
    await click(wrapper, 'open-seal')
    for (const [key, value] of Object.entries(draft())) {
      const field = wrapper.find(`#seal-${key}`); if (field.exists()) await field.setValue(value)
    }
    server.onPost = async () => { throw new TypeError('Synthetic lost response') }
    await wrapper.find('form.sf-expense-form').trigger('submit'); await flushPromises()
    const posts = () => api.request.mock.calls.filter(([, options]) => options?.method === 'POST')
    const first = posts()[0][1]
    expect(wrapper.find('[data-testid=submit-seal]').text()).toContain('Retry original request')
    await openCard(wrapper, 'expense'); await wrapper.find('#expense-title').setValue('Separate expense draft')
    server[SEAL].process = sealProcessFixture({ version: 2, name: 'Changed process' })
    await openCard(wrapper, 'seal'); await click(wrapper, 'scenario-refresh')
    expect(wrapper.find('.sf-context-note').text()).toContain('v1')
    await wrapper.find('#seal-copyCount').setValue(' 02 ')
    await wrapper.find('form.sf-expense-form').trigger('submit'); await flushPromises()
    expect(posts()).toHaveLength(2); expect(posts()[1][1]).toEqual(first)
    expect(JSON.parse(posts()[1][1].body).processVersion).toBe(1)
    await wrapper.find('#seal-documentRef').setValue('DEMO-NEW-INTENT')
    await wrapper.find('form.sf-expense-form').trigger('submit'); await flushPromises()
    expect(posts()[2][1].headers['Idempotency-Key']).not.toBe(first.headers['Idempotency-Key'])
    expect(JSON.parse(posts()[2][1].body).processVersion).toBe(2)
    await openCard(wrapper, 'expense'); expect(wrapper.find('#expense-title').element.value).toBe('Separate expense draft')
  })
  it('keeps every inspector label and error ID unique and bound to the active designer across Catalog switches', async () => {
    const { wrapper } = await mounted()
    await click(wrapper, 'open-expense'); await click(wrapper, 'designer-tab')
    await visibleDesigner(wrapper).find('[aria-label="Step 1 name"]').setValue('')
    await visibleDesigner(wrapper).find('[aria-label="Step 1 review mode"]').setValue('ALL')
    await visibleDesigner(wrapper).find('[aria-label="Step 1 participant Carol"]').setValue(false)
    const expenseNameId = visibleDesigner(wrapper).find('[aria-label="Step 1 name"]').attributes('aria-describedby')
    const expenseMemberId = visibleDesigner(wrapper).find('.participant-picker').attributes('aria-describedby')
    expect(document.getElementById(expenseNameId).textContent).toContain('Give approval step 1 a name')
    await openCard(wrapper, 'seal'); await click(wrapper, 'designer-tab')
    await visibleDesigner(wrapper).find('[aria-label="Step 1 name"]').setValue('bad\u0001name')
    await visibleDesigner(wrapper).find('[aria-label="Step 1 review mode"]').setValue('ANY')
    const active = visibleDesigner(wrapper)
    const assertOwnVisibleTarget = (control, attribute) => {
      const id = control.attributes(attribute), target = document.getElementById(id)
      expect(target).not.toBeNull(); expect(active.element.contains(target)).toBe(true)
      expect(wrapper.find(`[id="${id}"]`).isVisible()).toBe(true)
      expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1)
      return { id, target }
    }
    assertOwnVisibleTarget(active.find('.step-inspector'), 'aria-labelledby')
    const ownName = assertOwnVisibleTarget(active.find('[aria-label="Step 1 name"]'), 'aria-describedby')
    expect(ownName.id).not.toBe(expenseNameId); expect(ownName.target.textContent).toContain('control characters')
    const help = assertOwnVisibleTarget(active.find('.participant-picker'), 'aria-describedby')
    expect(help.id).toContain('participant-help')
    await active.find('[aria-label="Step 1 participant Bob"]').setValue(false)
    const members = assertOwnVisibleTarget(active.find('.participant-picker'), 'aria-describedby')
    expect(members.id).not.toBe(expenseMemberId); expect(members.id).toContain('step-members-error')
    const ids = wrapper.findAll('[id]').map(element => element.attributes('id'))
    expect(new Set(ids).size).toBe(ids.length)
    await openCard(wrapper, 'expense')
    expect(visibleDesigner(wrapper).find('[aria-label="Step 1 name"]').attributes('aria-describedby')).toBe(expenseNameId)
    expect(wrapper.find(`[id="${expenseNameId}"]`).isVisible()).toBe(true)
    expect(wrapper.find(`[id="${ownName.id}"]`).isVisible()).toBe(false)
  })
  it('keeps current selection and a review note through Catalog and restores localized Seal detail', async () => {
    const { wrapper } = await mounted('bob'); await click(wrapper, 'open-seal'); await click(wrapper, 'review-tab'); await wrapper.find('.sf-request-item').trigger('click')
    await wrapper.find('#scenario-comment').setValue('Seal draft comment')
    expect(wrapper.find('[data-testid=approve-seal]').exists()).toBe(true)
    await openCard(wrapper, 'expense'); await click(wrapper, 'review-tab'); await wrapper.find('.sf-request-item').trigger('click'); await wrapper.find('#scenario-comment').setValue('Expense draft comment')
    await openCard(wrapper, 'seal'); expect(wrapper.find('#scenario-comment').element.value).toBe('Seal draft comment')
    expect(wrapper.find('.sf-detail-header').text()).toContain('2 copies'); expect(wrapper.find('.sf-request-item').attributes('aria-pressed')).toBe('true')
    await wrapper.find('.sf-topbar select').setValue('zh'); expect(wrapper.find('.sf-detail-header').text()).toContain('2 份')
    await click(wrapper, 'scenario-logout'); expect(wrapper.find('.sf-shell').exists()).toBe(false)
  })
})
