import { describe, expect, it } from 'vitest'
import { getScenarioHandler } from './scenario-registry.js'
import { clone, decidedFixture, viewFixture } from './scenario-fixtures.js'
import { InvalidScenarioPayload } from './expense-document.js'
import { parseScenarioJson } from './scenario-api.js'

const handler = getScenarioHandler('oa-expense')
function routed(selected = true) {
  const view = viewFixture(), item = view.request
  item.definition.schemaVersion = 4
  item.definition.nodes[1].runIf = { mode: 'ALL', predicates: [{ field: 'expense.totalAmount', operator: selected ? 'GTE' : 'GT', currency: 'CNY', threshold: 150 }] }
  item.routing = { schemaVersion: 1, stepIds: selected ? ['manager', 'finance'] : ['finance'], evaluations: [{ stepId: 'manager', result: selected, predicates: [{ field: 'expense.totalAmount', actualValue: 'CNY 150', result: selected }] }] }
  item.currentStepId = selected ? 'manager' : 'finance'; item.approverId = selected ? 'bob' : 'carol'
  return view
}

describe('expense frozen routing response boundary', () => {
  it.each([true, false])('accepts only the expected saved definition, document and derived route; selected=%s', selected => {
    const view = routed(selected), item = view.request
    const expected = { actor: 'alice', payload: { business: clone(item.business), processVersion: item.processVersion }, definition: clone(item.definition) }
    expect(handler.validateView(view, expected)).toBe(view)
    expected.definition.nodes[1].runIf.predicates[0].threshold = 100
    expect(() => handler.validateView(view, expected)).toThrow(InvalidScenarioPayload)
  })
  it.each([
    v => { delete v.request.routing }, v => { v.request.routing = null }, v => { v.request.routing.extra = true },
    v => { v.request.routing.stepIds.reverse() }, v => { v.request.routing.stepIds.push('finance') }, v => { v.request.routing.stepIds = ['finance'] },
    v => { v.request.routing.evaluations = [] }, v => { v.request.routing.evaluations[0].result = false },
    v => { v.request.routing.evaluations[0].predicates[0].actualValue = 'CNY 150.00' },
    v => { v.request.routing.evaluations[0].predicates[0].actualValue = 'CNY 151' },
    v => { v.request.routing.evaluations[0].predicates[0].actualValue = 'USD 150' },
    v => { v.request.routing.evaluations[0].predicates[0].field = 'payment.netTotal' },
    v => { v.request.routing.evaluations[0].predicates[0].result = 'true' },
    v => { v.request.routing.evaluations[0].predicates[0].result = false },
    v => { v.request.routing.evaluations[0].predicates[0].extra = 1 },
    v => { v.request.definition.nodes[1].runIf.predicates[0].currency = 'USD' },
    v => { v.request.definition.nodes[1].runIf.predicates[0].threshold = 151 },
    v => { v.request.business.lines[0].amount = '123.46'; v.total = '150.01' },
    v => { v.total = '149.99' }, v => { v.request.business.totalAmount = '150.00' },
  ])('rejects forged, missing or extra expense evidence %#', mutate => {
    const view = routed(); mutate(view)
    expect(() => handler.validateView(view)).toThrow(InvalidScenarioPayload)
  })
  it('rejects current and history entries at condition-false steps', () => {
    const view = routed(false), bad = clone(view)
    bad.request.currentStepId = 'manager'; bad.request.approverId = 'bob'
    expect(() => handler.validateView(bad)).toThrow(InvalidScenarioPayload)
    const approved = decidedFixture(view, 'carol')
    expect(handler.validateDecision(approved, view, 'carol', 'finance', 'APPROVE', 'Reviewed')).toBe(approved)
    expect(approved.request.status).toBe('APPROVED'); expect(approved.request.history).toHaveLength(2)
    for (const action of ['APPROVE', 'REJECT', 'SKIP', 'CONDITION_SKIPPED']) {
      const bad = clone(approved); bad.request.history[1].stepId = 'manager'; bad.request.history[1].action = action
      expect(() => handler.validateView(bad)).toThrow(InvalidScenarioPayload)
    }
  })
  it('retains frozen route and definition through both approval and rejection', () => {
    for (const selected of [true, false]) for (const decision of ['APPROVE', 'REJECT']) {
      const before = routed(selected), actor = selected ? 'bob' : 'carol', step = before.request.currentStepId
      const after = decidedFixture(before, actor, decision)
      expect(handler.validateDecision(after, before, actor, step, decision, 'Reviewed')).toBe(after)
      after.request.definition.nodes[1].runIf.predicates[0].threshold = 0
      expect(() => handler.validateDecision(after, before, actor, step, decision, 'Reviewed')).toThrow(InvalidScenarioPayload)
    }
  })
  it('preserves schema 2/3 shape and requires an explicit route for unconditional schema 4', () => {
    for (const schemaVersion of [2, 3]) {
      const view = viewFixture(); view.request.definition.schemaVersion = schemaVersion
      expect(handler.validateView(view)).toBe(view)
      view.request.routing = { schemaVersion: 1, stepIds: ['manager', 'finance'], evaluations: [] }
      expect(() => handler.validateView(view)).toThrow(InvalidScenarioPayload)
    }
    const view = routed(); delete view.request.definition.nodes[1].runIf; view.request.routing.evaluations = []
    expect(handler.validateView(view)).toBe(view)
    delete view.request.routing; expect(() => handler.validateView(view)).toThrow(InvalidScenarioPayload)
  })
  it.each(['0.001', '1.0000000000000001', '20000000000.01', '2.0000000000000000001e10', '"150"', 'null'])('rejects a lossy expense threshold lexeme %s before rounding', token => {
    expect(() => parseScenarioJson(`{"field":"expense.totalAmount","operator":"GTE","currency":"CNY","threshold":${token}}`)).toThrow(InvalidScenarioPayload)
  })
})
