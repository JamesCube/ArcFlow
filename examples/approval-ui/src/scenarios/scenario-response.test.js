import { describe, expect, it } from 'vitest'
import { validateScenarioView, validateScenarioDecision, validateScenarioList } from './scenario-response.js'
import { InvalidScenarioPayload } from './expense-document.js'
import { clone, viewFixture, decidedFixture } from './scenario-fixtures.js'

describe('saved expense response validation', () => {
  it('checks envelope, exact total, original business, actor, process and immutable routing', () => {
    const view = viewFixture(), item = view.request
    const expected = { actor: 'alice', payload: { business: clone(item.business), processVersion: 1 }, definition: clone(item.definition) }
    expect(validateScenarioView(view, expected)).toBe(view)
    expect(() => validateScenarioView(view, { ...expected, actor: 'bob' })).toThrow(InvalidScenarioPayload)
    const changed = clone(expected); changed.payload.business.lines[0].amount = '123.46'
    expect(() => validateScenarioView(view, changed)).toThrow(InvalidScenarioPayload)
    changed.payload.business = clone(item.business); changed.definition.nodes[1].assigneeId = 'carol'
    expect(() => validateScenarioView(view, changed)).toThrow(InvalidScenarioPayload)
  })
  const mutations = [
    view => { view.total = '150' }, view => { view.total = 150 }, view => { view.total = '150.01' },
    view => { view.extra = true }, view => { view.request.days = 1 }, view => { view.request.id = 'bad/id' },
    view => { view.request.title = 'Different title' }, view => { view.request.processId = 'leave-approval' },
    view => { view.request.processVersion = 2 }, view => { view.request.definition.id = 'leave-approval' },
    view => { view.request.definition.nodes[1].assigneeId = 'alice' }, view => { view.request.status = 'APPROVED' },
    view => { view.request.currentStepId = 'finance' }, view => { view.request.approverId = 'carol' },
    view => { view.request.createdAt = 'invalid' }, view => { view.request.updatedAt = '2026-10-08T00:00:00Z' },
    view => { view.request.decision = 'APPROVE' }, view => { view.request.comment = '' },
    view => { view.request.business.lines[0].amount = 123.45 }, view => { view.request.business.title = ' Client visit expenses ' },
    view => { view.request.history = [] }, view => { view.request.history[0].actorId = 'bob' },
    view => { view.request.history[0].action = 'APPROVE' }, view => { view.request.history[0].stepId = 'manager' },
    view => { view.request.history[0].comment = 'not blank' }, view => { view.request.history[0].extra = true },
  ]
  it.each(mutations.map((mutate, index) => [index, mutate]))('rejects forged, noncanonical or inconsistent saved view %i', (_, mutate) => {
    const view = viewFixture(); mutate(view)
    expect(() => validateScenarioView(view)).toThrow(InvalidScenarioPayload)
  })
  it('rejects duplicate list identities and malformed entries', () => {
    const view = viewFixture(); expect(validateScenarioList([view])).toEqual([view])
    for (const value of [null, {}, [view, clone(view)], [view, null], [view, { request: {} }]]) expect(() => validateScenarioList(value)).toThrow(InvalidScenarioPayload)
  })
  it('replays every reachable vote state for single, ALL and ANY two-stage snapshots', () => {
    const variants = [{ type: 'approval', assigneeId: 'bob' }, { type: 'approval', assigneeId: 'carol' }, { type: 'parallelApproval', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ALL' }, { type: 'parallelApproval', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ANY' }]
    let states = 0
    for (const first of variants) for (const second of variants) {
      const initial = viewFixture(), item = initial.request
      item.definition.schemaVersion = first.type === 'parallelApproval' || second.type === 'parallelApproval' ? 3 : 2
      item.definition.nodes.splice(1, 2, { id: 'manager', name: 'First review', ...first }, { id: 'finance', name: 'Second review', ...second })
      item.approverId = first.type === 'approval' ? first.assigneeId : first.assigneeIds[0]
      function visit(view) {
        expect(validateScenarioView(view)).toBe(view); states++
        if (view.request.status !== 'PENDING') return
        const current = view.request.definition.nodes.find(node => node.id === view.request.currentStepId)
        const members = current.type === 'approval' ? [current.assigneeId] : current.assigneeIds
        const votes = view.request.history.filter(event => event.stepId === current.id)
        for (const actor of members.filter(actor => !votes.some(event => event.actorId === actor))) for (const decision of ['APPROVE', 'REJECT']) {
          const next = decidedFixture(view, actor, decision)
          expect(validateScenarioDecision(next, view, actor, current.id, decision)).toBe(next)
          visit(next)
        }
      }
      visit(initial)
    }
    expect(states).toBeGreaterThan(250)
  })
})

describe('decision response binding', () => {
  it('accepts only an append-only history containing the submitted actor, step and outcome', () => {
    const before = viewFixture(), after = decidedFixture(before)
    expect(validateScenarioDecision(after, before, 'bob', 'manager', 'APPROVE')).toBe(after)
    for (const [actor, step, decision] of [['carol', 'manager', 'APPROVE'], ['bob', 'finance', 'APPROVE'], ['bob', 'manager', 'REJECT']]) expect(() => validateScenarioDecision(after, before, actor, step, decision)).toThrow(InvalidScenarioPayload)
    expect(() => validateScenarioDecision(before, before, 'bob', 'manager', 'APPROVE')).toThrow(InvalidScenarioPayload)
  })
  it('rejects cross-request response substitution, altered history, and immutable business changes', () => {
    const before = viewFixture()
    for (const mutate of [view => { view.request.id = 'other' }, view => { view.request.history[0].at = view.request.createdAt = '2026-10-07T08:00:00.000Z' }, view => { view.request.business.reason = view.request.reason = 'Changed' }, view => { view.request.definition.name = 'Other process' }]) {
      const after = decidedFixture(before); mutate(after)
      expect(() => validateScenarioDecision(after, before, 'bob', 'manager', 'APPROVE')).toThrow(InvalidScenarioPayload)
    }
  })
  it('rejects out-of-order, repeated, unauthorized or post-terminal votes', () => {
    const before = viewFixture(), after = decidedFixture(before)
    for (const mutate of [view => { view.request.history[1].actorId = 'alice' }, view => { view.request.history[1].stepId = 'finance' }, view => { view.request.history[1].at = '2026-10-06T00:00:00.000Z' }, view => { view.request.history.push(clone(view.request.history[1])) }]) {
      const invalid = clone(after); mutate(invalid); expect(() => validateScenarioView(invalid)).toThrow(InvalidScenarioPayload)
    }
    const rejected = decidedFixture(before, 'bob', 'REJECT'); rejected.request.history.push({ actorId: 'carol', stepId: 'finance', action: 'APPROVE', at: '2026-10-07T10:00:00.000Z', comment: '' })
    expect(() => validateScenarioView(rejected)).toThrow(InvalidScenarioPayload)
  })
})
