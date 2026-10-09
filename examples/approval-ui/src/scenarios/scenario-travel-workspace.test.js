import { describe, expect, it, vi } from 'vitest'
import { createScenarioWorkspace } from './scenario-workspace.js'
import {
  catalogFixture, clone, decidedFixture, deferred, expenseFixture, people,
  processFixture, travelFixture, travelProcessFixture, travelViewFixture, viewFixture,
} from './scenario-fixtures.js'

const EXPENSE = 'oa-expense', TRAVEL = 'oa-travel'
const scenarios = [
  { id: EXPENSE, other: TRAVEL, form: expenseFixture, process: processFixture, view: viewFixture, step: 'manager', next: 'finance' },
  { id: TRAVEL, other: EXPENSE, form: travelFixture, process: travelProcessFixture, view: travelViewFixture, step: 'tripReview', next: 'budget' },
]
const specFor = id => scenarios.find(spec => spec.id === id)
const base = id => `/scenarios/${id}`
const networkError = () => new TypeError('Synthetic lost response')

// The fake service deliberately keeps its two collections separate. Assertions
// inspect the actual transport routes, rather than calling production codecs or
// validators to construct expected responses.
function setup({ identity = 'alice', sameId = false } = {}) {
  const server = {
    identity, catalog: catalogFixture(), onRead: null, onPost: null,
    scopes: Object.fromEntries(scenarios.map(spec => [spec.id, {
      process: spec.process(), items: [spec.view(sameId ? { id: 'shared-1' } : {})],
    }])),
  }
  const api = {
    login: vi.fn(user => { server.identity = user }), logout: vi.fn(),
    request: vi.fn(async (path, options) => {
      if (options?.method === 'POST') {
        if (server.onPost) return server.onPost(path, options)
        throw new Error(`Unexpected mutation ${path}`)
      }
      if (server.onRead) {
        const response = server.onRead(path)
        if (response !== undefined) return response
      }
      if (path === '/me') return clone(people.find(person => person.id === server.identity))
      if (path === '/people') return clone(people)
      if (path === '/scenarios') return clone(server.catalog)
      for (const spec of scenarios) {
        if (path === `${base(spec.id)}/process`) return clone(server.scopes[spec.id].process)
        if (path === `${base(spec.id)}/requests`) return clone(server.scopes[spec.id].items)
      }
      throw new Error(`Unexpected query ${path}`)
    }),
  }
  let key = 0
  const workspace = createScenarioWorkspace(api, () => `independent-key-${++key}`)
  return {
    api, server, workspace, state: workspace.state,
    login: () => workspace.login(identity, 'synthetic-test-password'),
    posts: () => api.request.mock.calls.filter(([, options]) => options?.method === 'POST'),
  }
}
async function initialize(c, id = EXPENSE) {
  await c.login()
  await c.workspace.selectScenario(TRAVEL)
  await c.workspace.selectScenario(id)
}
const snapshot = state => JSON.parse(JSON.stringify(state))
function markCurrentScope(c, spec) {
  c.workspace.setForm(spec.form({ title: `Unsaved ${spec.id}` }))
  c.state.draft.name = `Local designer ${spec.id}`
  c.workspace.select(c.state.items[0].request.id)
  c.state.comment = `Private comment ${spec.id}`
  c.state.notice = `Selected ${spec.id}`
}
function expectPrivateWorkCleared(c, spec) {
  expect(c.state.activeScenarioId).toBe(spec.id)
  expect(c.state.form.title).toBe('')
  expect(c.state.form.type).toBe(spec.id === TRAVEL ? 'travel' : 'expense')
  expect(c.state.comment).toBe('')
  expect(c.state.selectedId).toBeNull()
  expect(c.state.retainedNotes).toEqual({})
  expect(c.state.blockedDecisions).toEqual([])
  expect(c.state.uncertainSubmission).toBe(false)
  expect(c.state.rejectedVersion).toBe(false)
  expect(c.state.busy).toBe(false)
  expect(c.state.publishing).toBe(false)
  expect(c.state.conflict).toBe(false)
  expect(c.workspace.dirty()).toBe(false)
}

describe('Travel and Expense share one authenticated session', () => {
  it('loads Travel lazily once, preserves the selected-state facade, and never logs in again when switching', async () => {
    const c = setup(), facade = c.state
    await c.login()
    expect(c.api.request.mock.calls.map(([path]) => path)).not.toContain(`${base(TRAVEL)}/process`)
    const logoutCount = c.api.logout.mock.calls.length
    await c.workspace.selectScenario(TRAVEL, 'designer')
    expect(c.state).toBe(facade)
    expect(c.state).toMatchObject({ activeScenarioId: TRAVEL, tab: 'designer', me: { id: 'alice' }, process: { id: TRAVEL } })
    expect(c.state.items[0].request.business.type).toBe('travel')
    await c.workspace.selectScenario(EXPENSE, 'review')
    await c.workspace.selectScenario(TRAVEL, 'mine')
    expect(c.state.tab).toBe('mine')
    expect(c.api.login).toHaveBeenCalledTimes(1)
    expect(c.api.logout).toHaveBeenCalledTimes(logoutCount)
    expect(c.api.request.mock.calls.filter(([path]) => path === `${base(TRAVEL)}/process`)).toHaveLength(1)
    expect(c.api.request.mock.calls.filter(([path]) => path === `${base(TRAVEL)}/requests`)).toHaveLength(1)
  })

  it('keeps independently edited forms, comments, selection, designer bases and version conflicts', async () => {
    const c = setup()
    await initialize(c)
    markCurrentScope(c, scenarios[0])
    c.server.scopes[EXPENSE].process = processFixture({ version: 2, name: 'Expense published elsewhere' })
    await c.workspace.refresh()
    expect(c.workspace.stale()).toBe(true)
    const expense = snapshot(c.state)
    await c.workspace.selectScenario(TRAVEL, 'designer')
    expect(c.workspace.stale()).toBe(false)
    markCurrentScope(c, scenarios[1])
    c.server.onPost = async (_, options) => ({ ...JSON.parse(options.body).definition, version: 2 })
    await c.workspace.publish()
    expect(c.posts().map(([path]) => path)).toEqual([`${base(TRAVEL)}/process`])
    expect(c.state.process).toMatchObject({ id: TRAVEL, version: 2, name: 'Local designer oa-travel' })
    expect(c.workspace.dirty()).toBe(false)
    await c.workspace.selectScenario(EXPENSE, expense.tab)
    expect(snapshot(c.state)).toEqual({ ...expense, activeScenarioId: EXPENSE })
    expect(c.state.draft.version).toBe(1)
    expect(c.workspace.stale()).toBe(true)
    c.workspace.resetDraft()
    expect(c.state.draft.name).toBe('Expense published elsewhere')
    await c.workspace.selectScenario(TRAVEL)
    expect(c.state.form.title).toBe('Unsaved oa-travel')
    expect(c.state.comment).toBe('Private comment oa-travel')
    expect(c.state.selectedId).toBe('travel-1')
    expect(c.state.process.version).toBe(2)
    expect(c.workspace.stale()).toBe(false)
  })

  it('refuses catalog-absent or unknown scenarios without replacing the current scope', async () => {
    const c = setup()
    c.server.catalog = c.server.catalog.filter(template => template.id === EXPENSE)
    await c.login()
    const before = snapshot(c.state), reads = c.api.request.mock.calls.length
    await c.workspace.selectScenario(TRAVEL)
    await expect(c.workspace.selectScenario('unknown-scenario')).rejects.toThrow('Unsupported scenario template')
    expect(snapshot(c.state)).toEqual(before)
    expect(c.api.request).toHaveBeenCalledTimes(reads)
  })

  it.each(['success', 'failure'])('isolates a late first Travel load after switching back to Expense: %s', async outcome => {
    const c = setup(), pending = deferred()
    await c.login()
    c.server.onRead = path => path === `${base(TRAVEL)}/process` ? pending.promise : undefined
    const loading = c.workspace.selectScenario(TRAVEL, 'review')
    expect(c.state.busy).toBe(true)
    await c.workspace.selectScenario(EXPENSE)
    markCurrentScope(c, scenarios[0])
    const selected = snapshot(c.state)
    if (outcome === 'success') pending.resolve(travelProcessFixture())
    else pending.reject(networkError())
    await loading
    expect(snapshot(c.state)).toEqual(selected)
    c.server.onRead = null
    await c.workspace.selectScenario(TRAVEL)
    expect(c.state.loaded).toBe(true)
    expect(c.state.process.id).toBe(TRAVEL)
    expect(c.state.form.title).toBe('')
    expect(c.api.login).toHaveBeenCalledTimes(1)
  })
})

describe.each(scenarios)('$id isolated writes and retries', spec => {
  it('retains its own exact retry key, wire body and original process across switching and a publication refresh', async () => {
    const c = setup(), other = specFor(spec.other)
    await initialize(c, spec.id)
    c.workspace.setForm(spec.form())
    c.server.onPost = async () => { throw networkError() }
    await c.workspace.submit()
    const original = c.posts()[0]
    expect(c.state.uncertainSubmission).toBe(true)
    await c.workspace.selectScenario(spec.other)
    c.workspace.setForm(other.form())
    await c.workspace.submit()
    const otherAttempt = c.posts()[1]
    expect(otherAttempt[1].headers['Idempotency-Key']).not.toBe(original[1].headers['Idempotency-Key'])
    c.server.scopes[spec.id].process = spec.process({ version: 2, name: 'Newly published route' })
    c.server.scopes[spec.other].process = other.process({ version: 3, name: 'Other published route' })
    await c.workspace.refresh()
    expect(c.workspace.submissionDefinition()).toEqual(other.process())
    await c.workspace.selectScenario(spec.id)
    await c.workspace.refresh()
    expect(c.state.process.version).toBe(2)
    expect(c.workspace.submissionDefinition()).toEqual(spec.process())
    c.server.onPost = async path => {
      if (path === `${base(spec.id)}/documents`) return spec.view()
      if (path === `${base(spec.other)}/documents`) return other.view()
      throw new Error(`Unexpected mutation ${path}`)
    }
    await c.workspace.submit()
    expect(c.posts()[2]).toEqual(original)
    expect(c.state.notice).toBe('submitted')
    expect(c.state.items[0].request.processVersion).toBe(1)
    expect(c.workspace.submissionDefinition().version).toBe(2)
    await c.workspace.selectScenario(spec.other)
    expect(c.state.uncertainSubmission).toBe(true)
    expect(c.workspace.submissionDefinition().version).toBe(1)
    await c.workspace.submit()
    expect(c.posts()[3]).toEqual(otherAttempt)
    expect(c.state.notice).toBe('submitted')
    expect(c.api.login).toHaveBeenCalledTimes(1)
  })

  it('does not invalidate the other scenario’s pending intent when its own form changes', async () => {
    const c = setup(), other = specFor(spec.other)
    await initialize(c, spec.id)
    c.server.onPost = async () => { throw networkError() }
    c.workspace.setForm(spec.form())
    await c.workspace.submit()
    const firstKey = c.posts()[0][1].headers['Idempotency-Key']
    await c.workspace.selectScenario(spec.other)
    c.workspace.setForm(other.form())
    await c.workspace.submit()
    const otherAttempt = c.posts()[1]
    await c.workspace.selectScenario(spec.id)
    c.workspace.setForm(spec.form({ title: 'Changed business intent' }))
    await c.workspace.submit()
    expect(c.posts()[2][1].headers['Idempotency-Key']).not.toBe(firstKey)
    await c.workspace.selectScenario(spec.other)
    await c.workspace.submit()
    expect(c.posts()[3]).toEqual(otherAttempt)
  })

  it('keeps an explicit process-version rejection and its refresh gate local to this scenario', async () => {
    const c = setup(), other = specFor(spec.other)
    await initialize(c, spec.id)
    c.workspace.setForm(spec.form())
    c.server.onPost = async () => { throw Object.assign(new Error('The published process changed; reload before submitting'), { status: 409 }) }
    await c.workspace.submit()
    expect(c.state.rejectedVersion).toBe(true)
    const rejected = c.posts()[0]
    await c.workspace.selectScenario(spec.other)
    c.workspace.setForm(other.form())
    c.server.onPost = async () => other.view()
    await c.workspace.submit()
    expect(c.state.notice).toBe('submitted')
    await c.workspace.refresh()
    await c.workspace.selectScenario(spec.id)
    expect(c.state.rejectedVersion).toBe(true)
    await c.workspace.submit()
    expect(c.posts()).toHaveLength(2)
    c.server.scopes[spec.id].process = spec.process({ version: 2 })
    await c.workspace.refresh()
    c.server.onPost = async () => { throw networkError() }
    await c.workspace.submit()
    expect(c.posts()[2][1].headers['Idempotency-Key']).not.toBe(rejected[1].headers['Idempotency-Key'])
    expect(JSON.parse(c.posts()[2][1].body).processVersion).toBe(2)
  })

  it.each(['list', 'process', 'document', 'publication'])('rejects a valid other-scenario %s response without accepting its data', async kind => {
    const c = setup(), other = specFor(spec.other)
    await initialize(c, spec.id)
    const beforeItems = snapshot(c.state.items), beforeProcess = snapshot(c.state.process)
    if (kind === 'list') {
      c.server.scopes[spec.id].items = [other.view()]
      await c.workspace.refresh()
    } else if (kind === 'process') {
      c.server.scopes[spec.id].process = other.process()
      await c.workspace.refresh()
    } else if (kind === 'document') {
      c.workspace.setForm(spec.form())
      c.server.onPost = async () => other.view()
      await c.workspace.submit()
      expect(c.state.form).toEqual(spec.form())
      expect(c.state.uncertainSubmission).toBe(true)
    } else {
      c.state.draft.name = 'Unpublished local edit'
      c.server.onPost = async () => other.process({ version: 2, name: 'Unpublished local edit' })
      await c.workspace.publish()
      expect(c.state.draft.name).toBe('Unpublished local edit')
      expect(c.state.conflict).toBe(true)
    }
    expect(c.state.error).not.toBeNull()
    expect(c.state.notice).toBe('')
    expect(snapshot(c.state.items)).toEqual(beforeItems)
    expect(snapshot(c.state.process)).toEqual(beforeProcess)
    await c.workspace.selectScenario(spec.other)
    expect(c.state.error).toBeNull()
    expect(c.state.items).toEqual([other.view()])
  })
})

// Each operation is begun in one scope and settled after another scope has
// become active. Deferred responses exercise the original closure, including
// the decision-recovery GET that runs only after a failed POST.
function beginOperation(c, spec, operation, pending) {
  if (operation === 'read') {
    c.server.onRead = path => path === `${base(spec.id)}/process` ? pending.promise : undefined
    return { running: c.workspace.refresh(), response: spec.process({ version: 2, name: 'Fresh published process' }) }
  }
  c.server.onPost = () => pending.promise
  if (operation === 'submit') {
    c.workspace.setForm(spec.form())
    return { running: c.workspace.submit(), response: spec.view() }
  }
  if (operation === 'publish') {
    c.state.draft.name = 'Independent publication'
    return { running: c.workspace.publish(), response: spec.process({ version: 2, name: 'Independent publication' }) }
  }
  const original = clone(c.server.scopes[spec.id].items[0])
  c.workspace.select(original.request.id)
  c.state.comment = '  Original scenario note  '
  return { running: c.workspace.decide('APPROVE'), response: decidedFixture(original, 'bob', 'APPROVE', 'Original scenario note') }
}
const operations = ['read', 'submit', 'publish', 'decision']
const outcomes = ['success', 'failure']

describe.each(scenarios)('$id asynchronous response isolation', spec => {
  it.each(operations.flatMap(operation => outcomes.map(outcome => [operation, outcome])))('keeps a late %s %s in the originating workspace', async (operation, outcome) => {
    const c = setup({ identity: operation === 'decision' ? 'bob' : 'alice', sameId: true }), pending = deferred()
    await initialize(c, spec.id)
    const { running, response } = beginOperation(c, spec, operation, pending)
    expect(c.state.busy).toBe(true)
    const callsAtSwitch = c.api.request.mock.calls.length
    await c.workspace.selectScenario(spec.other, 'review')
    markCurrentScope(c, specFor(spec.other))
    const selected = snapshot(c.state)
    if (outcome === 'success') pending.resolve(response)
    else pending.reject(networkError())
    await running
    expect(snapshot(c.state)).toEqual(selected)
    const latePaths = c.api.request.mock.calls.slice(callsAtSwitch).map(([path]) => path)
    expect(latePaths).toEqual(operation === 'decision' && outcome === 'failure' ? [`${base(spec.id)}/requests`] : [])
    await c.workspace.selectScenario(spec.id)
    expect(c.state.busy).toBe(false)
    if (outcome === 'failure') {
      expect(c.state.error.operation).toBe(operation === 'read' ? 'refresh' : operation)
      if (operation === 'submit') expect(c.state.uncertainSubmission).toBe(true)
      if (operation === 'publish') expect(c.state.conflict).toBe(true)
      if (operation === 'decision') expect(c.workspace.retainedNotesFor('shared-1')).toEqual([{ requestId: 'shared-1', stepId: spec.step, comment: '  Original scenario note  ' }])
    } else {
      expect(c.state.error).toBeNull()
      if (operation === 'read' || operation === 'publish') expect(c.state.process.version).toBe(2)
      if (operation === 'submit') expect(c.state.notice).toBe('submitted')
      if (operation === 'decision') {
        expect(c.state.items[0].request.currentStepId).toBe(spec.next)
        expect(c.state.comment).toBe('')
      }
    }
    expect(c.api.login).toHaveBeenCalledTimes(1)
  })

  it.each(['matching vote', 'different vote', 'wrong scenario', 'failed read'])('keeps delayed decision recovery local after switching: %s', async outcome => {
    const c = setup({ identity: 'bob', sameId: true }), pending = deferred(), recoveryStarted = deferred()
    await initialize(c, spec.id)
    const original = clone(c.server.scopes[spec.id].items[0])
    c.workspace.select('shared-1')
    c.state.comment = '  Recover this original note  '
    c.server.onPost = async () => { throw networkError() }
    c.server.onRead = path => {
      if (path === `${base(spec.id)}/requests`) {
        recoveryStarted.resolve()
        return pending.promise
      }
    }
    const recovering = c.workspace.decide('APPROVE')
    await recoveryStarted.promise
    expect(c.state.busy).toBe(true)
    expect(c.state.blockedDecisions).toEqual(['shared-1'])
    await c.workspace.selectScenario(spec.other, 'review')
    markCurrentScope(c, specFor(spec.other))
    const selected = snapshot(c.state), callCount = c.api.request.mock.calls.length
    if (outcome === 'matching vote') pending.resolve([decidedFixture(original, 'bob', 'APPROVE', 'Recover this original note')])
    else if (outcome === 'different vote') pending.resolve([decidedFixture(original, 'bob', 'REJECT', 'Another tab rejected this')])
    else if (outcome === 'wrong scenario') pending.resolve([specFor(spec.other).view({ id: 'shared-1' })])
    else pending.reject(networkError())
    await recovering
    expect(snapshot(c.state)).toEqual(selected)
    expect(c.api.request).toHaveBeenCalledTimes(callCount)
    expect(c.posts()[0][0]).toBe(`${base(spec.id)}/requests/shared-1/decisions`)
    await c.workspace.selectScenario(spec.id)
    expect(c.state.error.operation).toBe('decision')
    expect(c.state.busy).toBe(false)
    if (outcome === 'matching vote') {
      expect(c.state.items[0].request.currentStepId).toBe(spec.next)
      expect(c.state.blockedDecisions).toEqual([])
      expect(c.workspace.retainedNotesFor('shared-1')).toEqual([])
      expect(c.state.comment).toBe('')
    } else {
      expect(c.state.blockedDecisions).toEqual(['shared-1'])
      expect(c.workspace.retainedNotesFor('shared-1')).toEqual([{ requestId: 'shared-1', stepId: spec.step, comment: '  Recover this original note  ' }])
      if (outcome === 'different vote') {
        expect(c.state.items[0].request.status).toBe('REJECTED')
        expect(c.state.error.cause.code).toBe('DECISION_RECOVERY_MISMATCH')
        expect(c.state.comment).toBe('')
      } else {
        expect(c.state.items).toEqual([original])
        expect(c.state.comment).toBe('  Recover this original note  ')
      }
    }
  })

  it('treats a current-session 401 in the inactive scope as expiry of the shared session', async () => {
    const c = setup(), pending = deferred()
    await initialize(c, spec.id)
    markCurrentScope(c, spec)
    const { running } = beginOperation(c, spec, 'read', pending)
    await c.workspace.selectScenario(spec.other)
    markCurrentScope(c, specFor(spec.other))
    const logoutCount = c.api.logout.mock.calls.length
    pending.reject(Object.assign(new Error('Session expired'), { status: 401 }))
    await running
    expect(c.state.me).toBeNull()
    expect(c.state.catalog).toEqual([])
    expect(c.state.items).toEqual([])
    expect(c.state.process).toBeNull()
    expect(c.state.comment).toBe('')
    expect(c.state.form.title).toBe('')
    expect(c.api.logout).toHaveBeenCalledTimes(logoutCount + 1)
    c.server.onRead = null
    await c.login()
    for (const scope of scenarios) {
      await c.workspace.selectScenario(scope.id)
      expectPrivateWorkCleared(c, scope)
    }
  })

  it.each(operations.flatMap(operation => outcomes.map(outcome => [operation, outcome])))('ignores a %s %s from a logged-out generation even after another login', async (operation, outcome) => {
    const c = setup({ identity: operation === 'decision' ? 'bob' : 'alice' }), pending = deferred()
    await initialize(c, spec.id)
    const other = specFor(spec.other)
    await c.workspace.selectScenario(spec.other)
    markCurrentScope(c, other)
    c.state.retainedNotes = { old: { requestId: 'private-old', stepId: 'old', comment: 'Previous user note' } }
    c.state.blockedDecisions = ['private-old']
    c.state.uncertainSubmission = true
    await c.workspace.selectScenario(spec.id)
    const { running, response } = beginOperation(c, spec, operation, pending)
    c.workspace.logout()
    expect(c.state.me).toBeNull()
    expect(c.state.items).toEqual([])
    expect(c.state.process).toBeNull()
    expect(c.state.draft).toBeNull()
    expect(c.state.catalog).toEqual([])
    expect(c.state.people).toEqual([])
    c.server.onRead = null
    c.server.onPost = null
    await c.login()
    await c.workspace.selectScenario(spec.other)
    const currentSession = snapshot(c.state), callCount = c.api.request.mock.calls.length
    if (outcome === 'success') pending.resolve(response)
    else pending.reject(Object.assign(networkError(), { status: 401 }))
    await running
    expect(snapshot(c.state)).toEqual(currentSession)
    expect(c.api.request).toHaveBeenCalledTimes(callCount)
    expect(c.state.me.id).toBe(operation === 'decision' ? 'bob' : 'alice')
    for (const scope of scenarios) {
      await c.workspace.selectScenario(scope.id)
      expectPrivateWorkCleared(c, scope)
      expect(c.state.process.version).toBe(1)
      expect(c.state.items).toEqual(c.server.scopes[scope.id].items)
      expect(c.state.error).toBeNull()
    }
  })
})

describe('same identifiers still belong to independent scenarios', () => {
  it('allows concurrent submissions with independent busy flags, keys, routes and same-ID records', async () => {
    const c = setup({ sameId: true }), expense = deferred(), travel = deferred()
    await initialize(c)
    c.server.onPost = path => path === `${base(EXPENSE)}/documents` ? expense.promise : travel.promise
    c.workspace.setForm(expenseFixture())
    const submittingExpense = c.workspace.submit()
    await c.workspace.selectScenario(TRAVEL)
    expect(c.state.busy).toBe(false)
    c.workspace.setForm(travelFixture())
    const submittingTravel = c.workspace.submit()
    expect(c.posts().map(([path]) => path)).toEqual([`${base(EXPENSE)}/documents`, `${base(TRAVEL)}/documents`])
    expect(new Set(c.posts().map(([, options]) => options.headers['Idempotency-Key'])).size).toBe(2)
    expense.resolve(viewFixture({ id: 'shared-1' }))
    await submittingExpense
    expect(c.state.busy).toBe(true)
    expect(c.state.notice).toBe('')
    expect(c.state.form).toEqual(travelFixture())
    travel.resolve(travelViewFixture({ id: 'shared-1' }))
    await submittingTravel
    for (const spec of scenarios) {
      await c.workspace.selectScenario(spec.id)
      expect(c.state.items).toEqual([spec.view({ id: 'shared-1' })])
      // A response arriving after newer navigation saves its scoped record but
      // must not select a row or replace the user's newer destination.
      expect(c.state.selectedId).toBe(spec.id === TRAVEL ? 'shared-1' : null)
      expect(c.state.form.title).toBe('')
      expect(c.state.notice).toBe('submitted')
      expect(c.state.busy).toBe(false)
    }
  })

  it('isolates retained notes and blocked decisions even when request and step IDs both collide', async () => {
    const c = setup({ identity: 'bob', sameId: true })
    const travelProcess = travelProcessFixture()
    travelProcess.nodes[1].id = 'manager'
    travelProcess.nodes[2].id = 'finance'
    c.server.scopes[TRAVEL].process = travelProcess
    c.server.scopes[TRAVEL].items = [travelViewFixture({ id: 'shared-1', definition: travelProcess, currentStepId: 'manager' })]
    await initialize(c)
    for (const spec of scenarios) {
      await c.workspace.selectScenario(spec.id)
      c.workspace.select('shared-1')
      c.state.comment = `Typed note for ${spec.id}`
      const original = clone(c.server.scopes[spec.id].items[0])
      c.server.onPost = async () => decidedFixture(original, 'bob', 'APPROVE', 'Different acknowledged note')
      await c.workspace.decide('APPROVE')
      expect(c.state.error.cause.code).toBe('DECISION_COMMENT_MISMATCH')
      expect(c.state.blockedDecisions).toEqual(['shared-1'])
      expect(c.workspace.retainedNotesFor('shared-1')).toEqual([{ requestId: 'shared-1', stepId: 'manager', comment: `Typed note for ${spec.id}` }])
    }
    await c.workspace.selectScenario(EXPENSE)
    c.workspace.dismissRetainedNote('shared-1', 'manager')
    expect(c.workspace.retainedNotesFor('shared-1')).toEqual([])
    await c.workspace.refresh()
    expect(c.state.blockedDecisions).toEqual([])
    await c.workspace.selectScenario(TRAVEL)
    expect(c.state.blockedDecisions).toEqual(['shared-1'])
    expect(c.workspace.retainedNotesFor('shared-1')[0].comment).toBe('Typed note for oa-travel')
    expect(c.state.comment).toBe('Typed note for oa-travel')
    expect(c.state.items[0].request.business.type).toBe('travel')
  })
})
