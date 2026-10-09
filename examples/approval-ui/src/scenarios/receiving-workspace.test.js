import { describe, expect, it, vi } from 'vitest'
import { createScenarioWorkspace } from './scenario-workspace.js'
import { clone, catalogFixture, people, receivingFixture, receivingProcessFixture, receivingViewFixture, decidedFixture, deferred } from './scenario-fixtures.js'
const BASE = '/scenarios/erp-receiving'
function setup({ items = [], identity = 'alice' } = {}) {
  const server = { items: clone(items), identity, process: receivingProcessFixture(), onPost: null }
  const api = { login: vi.fn(actor => { server.identity = actor }), logout: vi.fn(), request: vi.fn(async (path, options) => {
    if (options?.method === 'POST') return server.onPost(path, options)
    const routes = { '/me': people.find(person => person.id === server.identity), '/people': people, '/scenarios': catalogFixture(), [`${BASE}/process`]: server.process, [`${BASE}/requests`]: server.items }
    if (!(path in routes)) throw new Error(`Unexpected route: ${path}`)
    return clone(routes[path])
  }) }
  let id = 0; const workspace = createScenarioWorkspace(api, () => `receiving-key-${++id}`, 'erp-receiving')
  return { server, api, workspace, state: workspace.state, login: () => workspace.login(identity, 'synthetic-password'), posts: () => api.request.mock.calls.filter(([, options]) => options?.method === 'POST') }
}
describe('receiving actor-scoped namespace and retry lifecycle', () => {
  it('loads the isolated receiving process and suppresses invalid quantity submission', async () => {
    const c = setup(); await c.login(); expect(c.state.process.id).toBe('erp-receiving'); expect(c.state.form.type).toBe('receiving')
    const business = receivingFixture(); business.lines[0].received = '80.00000000000000001'; c.workspace.setForm(business); await c.workspace.submit()
    expect(c.state.error.operation).toBe('validation'); expect(c.posts()).toHaveLength(0)
  })
  it('retries unchanged ambiguous submissions with the same key, body and original process snapshot', async () => {
    const c = setup(); await c.login(); c.workspace.setForm(receivingFixture()); c.server.onPost = async () => { throw new TypeError('Network lost') }
    await c.workspace.submit(); const first = c.posts()[0][1]
    c.server.process.version = 2; c.server.process.name = 'New receiving route'; await c.workspace.refresh()
    expect(c.workspace.submissionDefinition().version).toBe(1)
    c.server.onPost = async () => receivingViewFixture(); await c.workspace.submit()
    expect(c.posts()[1][1]).toEqual(first); expect(c.state.notice).toBe('submitted'); expect(c.state.form.title).toBe(''); expect(c.state.items[0].request.definition.version).toBe(1)
  })
  it('gives normalized edits a new intent and refuses malformed acknowledgements without clearing the form', async () => {
    const c = setup(); await c.login(); c.workspace.setForm(receivingFixture()); c.server.onPost = async () => { const view = receivingViewFixture(); view.summary.quantities[0].received++; return view }
    await c.workspace.submit(); expect(c.state.uncertainSubmission).toBe(true); expect(c.state.form.title).toBe('Workshop supply delivery')
    c.workspace.setForm({ ...c.state.form, title: 'Changed receipt' }); await c.workspace.submit()
    expect(c.posts()[0][1].headers['Idempotency-Key']).not.toBe(c.posts()[1][1].headers['Idempotency-Key']); expect(c.state.notice).toBe('')
  })
  it('suppresses repeated mutation clicks and ignores late acknowledgements after identity change', async () => {
    const c = setup(); await c.login(); c.workspace.setForm(receivingFixture()); const pending = deferred(); c.server.onPost = () => pending.promise
    const attempt = c.workspace.submit(); await c.workspace.submit(); expect(c.posts()).toHaveLength(1)
    c.workspace.logout(); await c.workspace.login('carol', 'another-synthetic-password'); pending.resolve(receivingViewFixture()); await attempt
    expect(c.state.me.id).toBe('carol'); expect(c.state.items).toEqual([]); expect(c.state.form.title).toBe(''); expect(c.state.notice).toBe('')
  })
  it('preserves submitted snapshots when publishing a later process', async () => {
    const saved = receivingViewFixture(), c = setup({ items: [saved] }); await c.login(); c.state.draft.name = 'Updated receiving process'
    c.server.onPost = async (_, options) => ({ ...JSON.parse(options.body).definition, version: 2 }); await c.workspace.publish()
    expect(c.state.process.version).toBe(2); expect(c.state.items[0].request.definition).toEqual(saved.request.definition)
    expect(c.posts()[0][0]).toBe(`${BASE}/process`)
  })
  it('keeps Bob pending again only after Carol completes the ALL inspection stage', async () => {
    const start = receivingViewFixture(), c = setup({ identity: 'bob', items: [start] }); await c.login(); c.workspace.select(start.request.id)
    c.server.onPost = async () => decidedFixture(start, 'bob', 'APPROVE', ''); await c.workspace.decide('APPROVE')
    expect(c.workspace.canDecide(c.state.items[0])).toBe(false)
    c.server.items = [decidedFixture(JSON.parse(JSON.stringify(c.state.items[0])), 'carol')]; await c.workspace.refresh()
    expect(c.state.items[0].request.currentStepId).toBe('procurement-review'); expect(c.workspace.canDecide(c.state.items[0])).toBe(true)
    const before = JSON.parse(JSON.stringify(c.state.items[0])); c.server.onPost = async () => decidedFixture(before, 'bob', 'APPROVE', ''); await c.workspace.decide('APPROVE')
    expect(c.posts()[1][0]).toBe(`${BASE}/requests/receiving-1/decisions`); expect(JSON.parse(c.posts()[1][1].body).stepId).toBe('procurement-review'); expect(c.state.items[0].request.status).toBe('APPROVED')
  })
  it('ends receiving after an ALL rejection and retains immutable rejected quantities', async () => {
    const before = receivingViewFixture(), c = setup({ identity: 'carol', items: [before] }); await c.login(); c.workspace.select(before.request.id); c.state.comment = 'Quality failed'
    c.server.onPost = async () => decidedFixture(before, 'carol', 'REJECT', 'Quality failed'); await c.workspace.decide('REJECT')
    expect(c.state.items[0].request.status).toBe('REJECTED'); expect(c.workspace.canDecide(c.state.items[0])).toBe(false); expect(c.state.items[0].summary).toEqual(before.summary)
  })
  it('blocks mismatched decision acknowledgement and retains the original stage note', async () => {
    const before = receivingViewFixture(), c = setup({ identity: 'bob', items: [before] }); await c.login(); c.workspace.select(before.request.id); c.state.comment = 'My warehouse note'
    c.server.onPost = async () => decidedFixture(before, 'bob', 'APPROVE', 'Different note'); await c.workspace.decide('APPROVE')
    expect(c.state.error.cause.code).toBe('DECISION_COMMENT_MISMATCH'); expect(c.state.blockedDecisions).toContain(before.request.id)
    expect(c.workspace.retainedNotesFor(before.request.id)[0]).toEqual({ requestId: before.request.id, stepId: 'receiving-inspection', comment: 'My warehouse note' })
    c.workspace.logout(); expect(c.state.retainedNotes).toEqual({})
  })
})
