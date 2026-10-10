import { describe, expect, it, vi } from 'vitest'
import { createScenarioWorkspace } from './scenario-workspace.js'
import { catalogFixture, clone, decidedFixture, deferred, expenseFixture, people, processFixture, viewFixture } from './scenario-fixtures.js'
const BASE = '/scenarios/oa-expense'
function setup({ identity = 'alice', items = [], process = processFixture() } = {}) {
  const server = { identity, items: clone(items), process: clone(process), catalog: catalogFixture(), people: clone(people), onPost: null }
  const api = {
    login: vi.fn(user => { server.identity = user }), logout: vi.fn(),
    request: vi.fn(async (path, options) => {
      if (options?.method === 'POST') {
        if (server.onPost) return server.onPost(path, options)
        throw new Error(`Unexpected mutation ${path}`)
      }
      const routes = { '/me': server.people.find(person => person.id === server.identity), '/people': server.people, '/scenarios': server.catalog, [`${BASE}/process`]: server.process, [`${BASE}/requests`]: server.items }
      if (!(path in routes)) throw new Error(`Unexpected query ${path}`)
      return clone(routes[path])
    }),
  }
  let counter = 0
  const workspace = createScenarioWorkspace(api, () => `key-${++counter}`)
  return { workspace, api, server, state: workspace.state, login: () => workspace.login(identity, 'synthetic-test-password'), posts: () => api.request.mock.calls.filter(([, options]) => options?.method === 'POST') }
}
const prepare = context => context.workspace.setForm(expenseFixture())
const err = (message, status) => Object.assign(new Error(message), { status })

describe('scenario session and read isolation', () => {
  it('loads validated catalog, people, process and list in the dedicated namespace', async () => {
    const c = setup(); await c.login()
    expect(c.state.me.id).toBe('alice'); expect(c.state.catalog).toHaveLength(6); expect(c.state.process.id).toBe('oa-expense')
    expect(c.api.request.mock.calls.map(([path]) => path).sort()).toEqual(['/me', '/people', '/scenarios', `${BASE}/process`, `${BASE}/requests`].sort())
    expect(c.workspace.dirty()).toBe(false); expect(c.workspace.stale()).toBe(false)
  })
  it('rejects malformed login data and clears the credential transport', async () => {
    const c = setup(); c.server.catalog[0].formVersion = 99; await c.login()
    expect(c.state.me).toBeNull(); expect(c.state.error.operation).toBe('login'); expect(c.api.logout).toHaveBeenCalled()
  })
  it('suppresses repeated login and ignores reads completed after sign-out', async () => {
    const c = setup(), pending = deferred(); c.api.request.mockImplementationOnce(() => pending.promise)
    const first = c.login(); await c.login(); expect(c.api.login).toHaveBeenCalledTimes(1)
    c.workspace.logout(); pending.resolve(people[0]); await first
    expect(c.state.me).toBeNull(); expect(c.state.items).toEqual([]); expect(c.state.catalog).toEqual([]); expect(c.state.busy).toBe(false)
  })
  it('clears all previous-user drafts, decisions, form content, comments and pending intent', async () => {
    const c = setup({ items: [viewFixture()] }); await c.login(); prepare(c)
    c.state.comment = 'Private draft'; c.state.tab = 'review'; c.workspace.select('expense-1'); c.state.blockedDecisions = ['expense-1']
    c.workspace.logout()
    expect(c.state.me).toBeNull(); expect(c.state.form.title).toBe(''); expect(c.state.form.lines[0].amount).toBe('')
    expect(c.state.selectedId).toBeNull(); expect(c.state.items).toEqual([]); expect(c.state.comment).toBe(''); expect(c.state.blockedDecisions).toEqual([])
    expect(c.state.tab).toBe('catalog'); expect(c.state.draft).toBeNull()
  })
  it('preserves a dirty draft during refresh and marks its saved base stale', async () => {
    const c = setup(); await c.login(); c.state.draft.name = 'Unpublished local draft'
    c.server.process = processFixture({ version: 2, name: 'Changed elsewhere' }); await c.workspace.refresh()
    expect(c.state.process.version).toBe(2); expect(c.state.draft.name).toBe('Unpublished local draft'); expect(c.workspace.stale()).toBe(true)
    c.workspace.resetDraft(); expect(c.state.draft.name).toBe('Changed elsewhere'); expect(c.workspace.dirty()).toBe(false); expect(c.workspace.stale()).toBe(false)
  })
  it('rejects malformed refresh data without removing previously confirmed requests', async () => {
    const c = setup({ items: [viewFixture()] }); await c.login()
    c.server.items = [{ request: { id: 'fake' }, total: '0' }]; await c.workspace.refresh()
    expect(c.state.items.map(view => view.request.id)).toEqual(['expense-1']); expect(c.state.error.operation).toBe('refresh')
  })
  it('never regresses confirmed history when an older list arrives', async () => {
    const before = viewFixture(), after = decidedFixture(before), c = setup({ items: [after] }); await c.login()
    c.server.items = [before]; await c.workspace.refresh()
    expect(c.state.items[0].request.history).toHaveLength(2); expect(c.state.items[0].request.currentStepId).toBe('finance')
  })
  it('clears the former actor’s data before a direct identity switch that fails', async () => {
    const c = setup({ items: [viewFixture()] }); await c.login(); prepare(c); c.state.comment = 'Former actor note'
    c.api.request.mockRejectedValueOnce(err('Unauthorized', 401))
    await c.workspace.login('bob', 'different-test-password')
    expect(c.state.me).toBeNull(); expect(c.state.items).toEqual([]); expect(c.state.form.title).toBe('')
    expect(c.state.comment).toBe(''); expect(c.state.draft).toBeNull(); expect(c.state.uncertainSubmission).toBe(false)
  })
  it('invalidates the entire session after a protected-read 401', async () => {
    const c = setup({ items: [viewFixture()] }); await c.login(); prepare(c)
    c.api.request.mockRejectedValueOnce(err('Unauthorized', 401)); await c.workspace.refresh()
    expect(c.state.me).toBeNull(); expect(c.state.items).toEqual([]); expect(c.state.form.title).toBe(''); expect(c.state.error.cause.status).toBe(401)
  })
})

describe('scenario process version storage bounds', () => {
  it('rejects an initial process version outside the Java int domain', async () => {
    const c = setup({ process: processFixture({ version: 2147483648 }) }); await c.login()
    expect(c.state.me).toBeNull(); expect(c.state.process).toBeNull(); expect(c.state.error.operation).toBe('login')
  })
  it('preserves the current version when refresh exceeds the storage bound', async () => {
    const c = setup(); await c.login(); c.server.process.version = 2147483648
    await c.workspace.refresh(); expect(c.state.process.version).toBe(1); expect(c.state.error.operation).toBe('refresh')
  })
  it('rejects an overflowing publication acknowledgement even when its numeric increment matches', async () => {
    const c = setup({ process: processFixture({ version: 2147483647 }) }); await c.login(); c.state.draft.name = 'Last integer version'
    c.server.onPost = async (_, options) => ({ ...JSON.parse(options.body).definition, version: 2147483648 })
    await c.workspace.publish(); expect(c.state.notice).toBe(''); expect(c.state.conflict).toBe(true)
    expect(c.state.process.version).toBe(2147483647); expect(c.state.draft.name).toBe('Last integer version')
  })
})

describe('scenario process publication', () => {
  it('publishes only an Alice-owned changed definition with the dedicated process ID and pinned base', async () => {
    const c = setup(); await c.login(); c.state.draft.name = '  Expense review  '
    c.server.onPost = async (_, options) => ({ ...JSON.parse(options.body).definition, version: 2 })
    await c.workspace.publish()
    expect(c.posts()).toHaveLength(1); expect(c.posts()[0][0]).toBe(`${BASE}/process`)
    expect(JSON.parse(c.posts()[0][1].body)).toMatchObject({ expectedVersion: 1, definition: { id: 'oa-expense', name: 'Expense review', version: 1 } })
    expect(c.state.process.version).toBe(2); expect(c.state.notice).toBe('published'); expect(c.workspace.dirty()).toBe(false)
  })
  it('does not publish unchanged, invalid, wrong-process, stale or non-owner drafts', async () => {
    const c = setup(); await c.login(); await c.workspace.publish()
    c.state.draft.name = ' '; await c.workspace.publish(); c.state.draft.name = 'Changed'; c.state.draft.id = 'leave-approval'; await c.workspace.publish()
    c.state.draft.id = 'oa-expense'; c.state.conflict = true; await c.workspace.publish()
    c.state.conflict = false; c.state.me = people[1]; await c.workspace.publish()
    expect(c.posts()).toEqual([])
  })
  it('suppresses double publish and preserves the submitted draft on uncertain failure', async () => {
    const c = setup(), pending = deferred(); await c.login(); c.state.draft.name = 'Changed'; c.server.onPost = () => pending.promise
    const first = c.workspace.publish(); await c.workspace.publish(); expect(c.posts()).toHaveLength(1); expect(c.state.publishing).toBe(true)
    pending.reject(new TypeError('Network failed')); await first
    expect(c.state.draft.name).toBe('Changed'); expect(c.state.conflict).toBe(true); expect(c.state.process.version).toBe(1)
    expect(c.state.publishing).toBe(false); expect(c.state.notice).toBe('')
  })
  it('rejects a successful-looking publication for the other process', async () => {
    const c = setup(); await c.login(); c.state.draft.name = 'Changed'; c.server.onPost = async () => processFixture({ id: 'leave-approval', version: 2, name: 'Changed' })
    await c.workspace.publish(); expect(c.state.process.version).toBe(1); expect(c.state.notice).toBe(''); expect(c.state.error.operation).toBe('publish')
  })
})

describe('retryable exact-money submission intent', () => {
  it('does not send invalid forms or a form whose applicant is a routed reviewer', async () => {
    const c = setup(); await c.login(); await c.workspace.submit(); expect(c.posts()).toEqual([]); expect(c.state.attempted).toBe(true)
    prepare(c); c.state.me = people[1]; await c.workspace.submit()
    expect(c.posts()).toEqual([]); expect(c.state.error.operation).toBe('selfAssigned')
  })
  it('binds a real response to the form and clears it only after validation succeeds', async () => {
    const c = setup(); await c.login(); prepare(c); c.server.onPost = async () => viewFixture()
    await c.workspace.submit()
    expect(c.posts()).toHaveLength(1); expect(c.posts()[0][0]).toBe(`${BASE}/documents`)
    expect(c.posts()[0][1].headers['Idempotency-Key']).toMatch(/^key-/)
    expect(c.posts()[0][1].body).toContain('"amount":123.45'); expect(c.posts()[0][1].body).not.toContain('"amount":"')
    expect(c.state.items[0].request.id).toBe('expense-1'); expect(c.state.selectedId).toBe('expense-1'); expect(c.state.tab).toBe('mine')
    expect(c.state.form.title).toBe(''); expect(c.state.attempted).toBe(false); expect(c.state.notice).toBe('submitted')
  })
  it('suppresses double submission and protects pending fields against edits', async () => {
    const c = setup(), pending = deferred(); await c.login(); prepare(c); c.server.onPost = () => pending.promise
    const first = c.workspace.submit(); await c.workspace.submit(); c.workspace.setForm(expenseFixture({ title: 'Changed while sending' }))
    expect(c.posts()).toHaveLength(1); expect(c.state.form.title).toBe('Client visit expenses')
    pending.resolve(viewFixture()); await first; expect(c.state.notice).toBe('submitted')
  })
  it('keeps identical key, exact body and original route after uncertain outcome and a new publication', async () => {
    const c = setup(); await c.login(); prepare(c); c.server.onPost = async () => { throw new TypeError('Lost response') }
    await c.workspace.submit(); const original = c.posts()[0][1]
    expect(c.state.uncertainSubmission).toBe(true); expect(c.state.form.title).toBe('Client visit expenses')
    c.server.process = processFixture({ version: 2, name: 'Future routing' }); await c.workspace.refresh()
    expect(c.workspace.submissionDefinition().version).toBe(1)
    c.server.onPost = async () => viewFixture(); await c.workspace.submit()
    expect(c.posts()[1][1]).toEqual(original); expect(c.state.notice).toBe('submitted'); expect(c.state.uncertainSubmission).toBe(false)
  })
  it('preserves the form and retry key after malformed success, and invalidates the intent only on an edit', async () => {
    const c = setup(); await c.login(); prepare(c); c.server.onPost = async () => ({ ...viewFixture(), total: '150.01' })
    await c.workspace.submit(); const original = c.posts()[0][1].headers['Idempotency-Key']
    expect(c.state.items).toEqual([]); expect(c.state.notice).toBe(''); expect(c.state.uncertainSubmission).toBe(true)
    c.workspace.setForm(expenseFixture({ title: 'Edited claim' })); expect(c.state.uncertainSubmission).toBe(false)
    c.server.onPost = async () => { throw new TypeError('Still offline') }; await c.workspace.submit()
    expect(c.posts()[1][1].headers['Idempotency-Key']).not.toBe(original)
  })
  it('treats only the explicit stale-version rejection as proof no request was created', async () => {
    const c = setup(); await c.login(); prepare(c)
    c.server.onPost = async () => { throw err('The published process changed; reload before submitting', 409) }
    await c.workspace.submit(); const key = c.posts()[0][1].headers['Idempotency-Key']
    expect(c.state.rejectedVersion).toBe(true); expect(c.state.uncertainSubmission).toBe(false)
    await c.workspace.submit(); expect(c.posts()).toHaveLength(1)
    c.server.process = processFixture({ version: 2 }); await c.workspace.refresh(); expect(c.state.rejectedVersion).toBe(false)
    c.server.onPost = async () => { throw err('Other conflict', 409) }; await c.workspace.submit()
    expect(c.posts()[1][1].headers['Idempotency-Key']).not.toBe(key)
    expect(JSON.parse(c.posts()[1][1].body).processVersion).toBe(2); expect(c.state.uncertainSubmission).toBe(true)
  })
  it('discards a late creation response after logout', async () => {
    const c = setup(), pending = deferred(); await c.login(); prepare(c); c.server.onPost = () => pending.promise
    const submission = c.workspace.submit(); c.workspace.logout(); pending.resolve(viewFixture()); await submission
    expect(c.state.me).toBeNull(); expect(c.state.items).toEqual([]); expect(c.state.notice).toBe(''); expect(c.state.form.title).toBe('')
  })
})

describe('scenario decision race and recovery', () => {
  it('authorizes only a current unvoted participant and records its pinned step', async () => {
    const before = viewFixture(), c = setup({ identity: 'bob', items: [before] }); await c.login(); c.workspace.select('expense-1'); c.state.comment = '  Checked receipt  '
    expect(c.workspace.canDecide(c.state.items[0])).toBe(true)
    c.server.onPost = async () => decidedFixture(before, 'bob', 'APPROVE', 'Checked receipt'); await c.workspace.decide('APPROVE')
    expect(c.posts()[0][0]).toBe(`${BASE}/requests/expense-1/decisions`)
    expect(JSON.parse(c.posts()[0][1].body)).toEqual({ stepId: 'manager', decision: 'APPROVE', comment: 'Checked receipt' })
    expect(c.state.items[0].request.currentStepId).toBe('finance'); expect(c.workspace.canDecide(c.state.items[0])).toBe(false); expect(c.state.comment).toBe('')
  })
  it('does not send unauthorized, unsupported, overlong or duplicate pending decisions', async () => {
    const before = viewFixture(), c = setup({ identity: 'carol', items: [before] }); await c.login(); c.workspace.select('expense-1'); await c.workspace.decide('APPROVE'); expect(c.posts()).toEqual([])
    c.state.me = people[1]; await c.workspace.decide('DELETE'); c.state.comment = 'x'.repeat(2001); await c.workspace.decide('APPROVE'); expect(c.posts()).toEqual([])
    c.state.comment = ''; const pending = deferred(); c.server.onPost = () => pending.promise
    const first = c.workspace.decide('APPROVE'); await c.workspace.decide('APPROVE'); expect(c.posts()).toHaveLength(1)
    pending.resolve(decidedFixture(before)); await first
  })
  it('recovers a lost decision response from validated real list state without replaying the POST', async () => {
    const before = viewFixture(), after = decidedFixture(before, 'bob', 'APPROVE', 'Pending'), c = setup({ identity: 'bob', items: [before] }); await c.login(); c.workspace.select('expense-1'); c.state.comment = 'Pending'
    c.server.onPost = async () => { c.server.items = [after]; throw new TypeError('Lost response') }
    await c.workspace.decide('APPROVE')
    expect(c.posts()).toHaveLength(1); expect(c.state.items[0].request.currentStepId).toBe('finance'); expect(c.state.blockedDecisions).toEqual([]); expect(c.state.comment).toBe('')
    expect(c.state.error.operation).toBe('decision'); expect(c.state.notice).not.toBe('decided')
  })
  it('blocks repeat decisions until an explicit refresh confirms the unresolved request', async () => {
    const before = viewFixture(), c = setup({ identity: 'bob', items: [before] }); await c.login(); c.workspace.select('expense-1')
    c.server.onPost = async () => { c.server.items = []; throw new TypeError('Lost response') }
    await c.workspace.decide('APPROVE'); expect(c.state.blockedDecisions).toEqual(['expense-1']); expect(c.workspace.canDecide(c.state.items[0])).toBe(false)
    await c.workspace.decide('APPROVE'); expect(c.posts()).toHaveLength(1)
    c.server.items = [before]; await c.workspace.refresh(); expect(c.state.blockedDecisions).toEqual([]); expect(c.workspace.canDecide(c.state.items[0])).toBe(true)
  })
  it('keeps an uncertain decision blocked when recovery only returns older history', async () => {
    const before = viewFixture(), current = decidedFixture(before), c = setup({ identity: 'carol', items: [current] })
    await c.login(); c.workspace.select('expense-1')
    c.server.onPost = async () => { c.server.items = [before]; throw new TypeError('Lost second-stage response') }
    await c.workspace.decide('APPROVE')
    expect(c.state.items[0].request.history).toHaveLength(2); expect(c.state.items[0].request.currentStepId).toBe('finance')
    expect(c.state.blockedDecisions).toEqual(['expense-1']); expect(c.workspace.canDecide(c.state.items[0])).toBe(false)
    await c.workspace.refresh(); expect(c.state.blockedDecisions).toEqual(['expense-1'])
    c.server.items = [decidedFixture(current, 'carol')]; await c.workspace.refresh()
    expect(c.state.blockedDecisions).toEqual([]); expect(c.state.items[0].request.status).toBe('APPROVED')
  })
  it('clears the actor and private data if decision recovery itself returns 401', async () => {
    const c = setup({ identity: 'bob', items: [viewFixture()] }); await c.login(); c.workspace.select('expense-1'); c.state.comment = 'Private review note'
    c.server.onPost = async () => { c.api.request.mockRejectedValueOnce(err('Unauthorized', 401)); throw new TypeError('Lost response') }
    await c.workspace.decide('APPROVE')
    expect(c.state.me).toBeNull(); expect(c.state.items).toEqual([]); expect(c.state.comment).toBe('')
    expect(c.state.busy).toBe(false); expect(c.state.error.cause.status).toBe(401)
  })
  it('does not clear the newly selected request’s comment when an older decision completes', async () => {
    const before = viewFixture(), other = viewFixture({ id: 'expense-2' }), c = setup({ identity: 'bob', items: [before, other] }), pending = deferred()
    await c.login(); c.workspace.select('expense-1'); c.server.onPost = () => pending.promise
    const first = c.workspace.decide('APPROVE'); c.workspace.select('expense-2'); c.state.comment = 'Second request note'
    pending.resolve(decidedFixture(before)); await first
    expect(c.state.selectedId).toBe('expense-2'); expect(c.state.comment).toBe('Second request note')
  })
})

describe('expense conditional submission workspace', () => {
  const conditional = (threshold = 150.01, version = 1) => {
    const process = processFixture({ schemaVersion: 4, version })
    process.nodes[1].runIf = { mode: 'ALL', predicates: [{ field: 'expense.totalAmount', operator: 'GTE', currency: 'CNY', threshold }] }
    return process
  }
  it('blocks a mismatched currency before POST and permits correction without losing the form', async () => {
    const c = setup({ process: conditional() }); await c.login(); prepare(c)
    c.workspace.setForm({ ...c.state.form, currency: 'USD' }); await c.workspace.submit()
    expect(c.posts()).toHaveLength(0); expect(c.state.error.operation).toBe('routing')
    expect(c.state.error.cause.code).toBe('CURRENCY_MISMATCH'); expect(c.state.form.currency).toBe('USD')
    c.workspace.setForm({ ...c.state.form, currency: 'CNY' })
    c.server.onPost = async () => { throw new TypeError('Submission transport interrupted') }
    await c.workspace.submit(); expect(c.posts()).toHaveLength(1)
    expect(c.state.uncertainSubmission).toBe(true)
  })
  it('retains the original total condition and retry key across a newer publication', async () => {
    const process = conditional(), c = setup({ process }); await c.login(); prepare(c)
    const saved = viewFixture({ definition: clone(process), currentStepId: 'finance', approverId: 'carol', routing: { schemaVersion: 1, stepIds: ['finance'], evaluations: [{ stepId: 'manager', result: false, predicates: [{ field: 'expense.totalAmount', actualValue: 'CNY 150', result: false }] }] } })
    c.server.onPost = async () => { throw new TypeError('Response lost after save') }
    await c.workspace.submit(); const first = c.posts()[0][1]
    c.server.process = conditional(0, 2); await c.workspace.refresh()
    expect(c.state.process.version).toBe(2); expect(c.workspace.submissionDefinition()).toEqual(process)
    c.server.onPost = async () => clone(saved)
    await c.workspace.submit(); const retry = c.posts()[1][1]
    expect(retry.headers['Idempotency-Key']).toBe(first.headers['Idempotency-Key']); expect(retry.body).toBe(first.body)
    expect(c.state.items[0]).toEqual(saved); expect(c.state.uncertainSubmission).toBe(false)
    expect(c.workspace.submissionDefinition().version).toBe(2)
  })
})
