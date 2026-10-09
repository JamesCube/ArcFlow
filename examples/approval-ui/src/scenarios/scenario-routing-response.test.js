import { describe, expect, it } from 'vitest'
import { InvalidScenarioPayload } from './expense-document.js'
import { getScenarioHandler } from './scenario-registry.js'
import { clone, paymentViewFixture, receivingViewFixture, contractViewFixture, viewFixture, travelViewFixture, sealViewFixture } from './scenario-fixtures.js'
import { pendingParticipants, stepState } from '../process.js'

const paymentAtom = (operator = 'GTE', threshold = 6500) => ({ field: 'payment.netTotal', operator, currency: 'CNY', threshold })
const variants = [
  { type: 'approval', assigneeId: 'bob' },
  { type: 'approval', assigneeId: 'carol' },
  { type: 'parallelApproval', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ALL' },
  { type: 'parallelApproval', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ANY' },
]
const members = node => node.type === 'approval' ? [node.assigneeId] : node.assigneeIds
function paymentView(selected = true, first = variants[2], second = variants[3]) {
  const view = paymentViewFixture(), item = view.request
  item.definition.schemaVersion = 4
  item.definition.nodes.splice(1, 2,
    { id: 'payment-check', name: 'Conditional review', ...first, runIf: { mode: 'ALL', predicates: [paymentAtom(selected ? 'GTE' : 'GT'), paymentAtom('LT', 7000)] } },
    { id: 'payment-final', name: 'Unconditional review', ...second })
  item.routing = { schemaVersion: 1, stepIds: selected ? ['payment-check', 'payment-final'] : ['payment-final'], evaluations: [{ stepId: 'payment-check', result: selected, predicates: [
    { field: 'payment.netTotal', actualValue: 'CNY 6500', result: selected },
    { field: 'payment.netTotal', actualValue: 'CNY 6500', result: true },
  ] }] }
  item.currentStepId = item.routing.stepIds[0]
  item.approverId = members(item.definition.nodes.find(node => node.id === item.currentStepId))[0]
  return view
}
// Independent transition oracle. It consumes the manually declared selected
// IDs above, and never calls production routing or state derivation helpers.
function decide(original, actor, decision, comment = 'Reviewed') {
  const view = clone(original), item = view.request
  const steps = item.routing.stepIds.map(id => item.definition.nodes.find(node => node.id === id))
  const index = steps.findIndex(node => node.id === item.currentStepId), current = steps[index]
  const at = new Date(Date.parse(item.updatedAt) + 60_000).toISOString()
  item.history.push({ actorId: actor, stepId: current.id, action: decision, at, comment })
  item.updatedAt = at; item.decision = decision; item.comment = comment
  const votes = item.history.filter(event => event.stepId === current.id)
  const all = current.type === 'approval' || current.completionMode === 'ALL'
  const passed = all ? votes.length === members(current).length && votes.every(event => event.action === 'APPROVE') : votes.some(event => event.action === 'APPROVE')
  const failed = all ? votes.some(event => event.action === 'REJECT') : votes.length === members(current).length && votes.every(event => event.action === 'REJECT')
  if (failed || passed && index === steps.length - 1) {
    item.status = failed ? 'REJECTED' : 'APPROVED'; item.currentStepId = null; item.approverId = actor
  } else if (passed) {
    item.currentStepId = steps[index + 1].id; item.approverId = members(steps[index + 1])[0]
  } else item.approverId = members(current).find(member => !votes.some(event => event.actorId === member))
  return view
}
const payment = getScenarioHandler('erp-payment')

describe('strict conditional request response boundary', () => {
  it.each([true, false])('accepts a server snapshot with first condition selected=%s and binds the original submission', selected => {
    const view = paymentView(selected), item = view.request
    const expected = { actor: 'alice', payload: { business: clone(item.business), processVersion: item.processVersion }, definition: clone(item.definition) }
    expect(payment.validateView(view, expected)).toBe(view)
    expect(pendingParticipants(item)).toEqual(members(item.definition.nodes.find(node => node.id === item.currentStepId)))
    expected.definition.nodes[1].runIf.predicates[0].threshold = 6400
    expect(() => payment.validateView(view, expected)).toThrow(InvalidScenarioPayload)
  })
  it('accepts semantically identical object-key order without ignoring array order', () => {
    const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, nested]) => [key, reverseKeys(nested)])) : value
    const original = paymentView(), reordered = reverseKeys(original)
    expect(payment.validateView(reordered, { actor: 'alice', payload: { business: original.request.business, processVersion: 1 }, definition: original.request.definition })).toBe(reordered)
  })
  const mutations = [
    v => { delete v.request.routing }, v => { v.request.routing = null }, v => { v.request.routing = [] }, v => { v.request.routing = {} },
    v => { v.request.routing.extra = true }, v => { v.request.routing.schemaVersion = 2 }, v => { v.request.routing.schemaVersion = '1' },
    v => { v.request.routing.stepIds = [] }, v => { v.request.routing.stepIds = ['payment-final'] },
    v => { v.request.routing.stepIds.reverse() }, v => { v.request.routing.stepIds.push('payment-final') },
    v => { v.request.routing.stepIds.push('unknown') }, v => { v.request.routing.stepIds.unshift('start') }, v => { v.request.routing.stepIds.push('end') },
    v => { v.request.routing.stepIds = null }, v => { v.request.routing.stepIds[0] = 1 },
    v => { v.request.routing.evaluations = [] }, v => { v.request.routing.evaluations = null },
    v => { v.request.routing.evaluations.push(clone(v.request.routing.evaluations[0])) },
    v => { v.request.routing.evaluations.push({ stepId: 'payment-final', result: true, predicates: [] }) },
    v => { v.request.routing.evaluations[0].stepId = 'payment-final' }, v => { v.request.routing.evaluations[0].result = false },
    v => { v.request.routing.evaluations[0].result = 1 }, v => { v.request.routing.evaluations[0].extra = true },
    v => { v.request.routing.evaluations[0].predicates = [] }, v => { v.request.routing.evaluations[0].predicates = null },
    v => { v.request.routing.evaluations[0].predicates.pop() }, v => { v.request.routing.evaluations[0].predicates.push(clone(v.request.routing.evaluations[0].predicates[0])) },
    v => { v.request.routing.evaluations[0].predicates[0].actualValue = 'CNY 6500.00' },
    v => { v.request.routing.evaluations[0].predicates[0].actualValue = 'CNY 6,500' },
    v => { v.request.routing.evaluations[0].predicates[0].actualValue = '6500' },
    v => { v.request.routing.evaluations[0].predicates[0].actualValue = 6500 },
    v => { v.request.routing.evaluations[0].predicates[0].actualValue = 'USD 6500' },
    v => { v.request.routing.evaluations[0].predicates[0].field = 'receiving.hasRejectedLines' },
    v => { v.request.routing.evaluations[0].predicates[0].result = false },
    v => { v.request.routing.evaluations[0].predicates[0].result = 'true' },
    v => { v.request.routing.evaluations[0].predicates[0].extra = true },
    v => { delete v.request.routing.evaluations[0].predicates[0].result },
    v => { v.request.definition.nodes[1].runIf.predicates.forEach(p => { p.currency = 'USD' }) },
    v => { v.request.definition.nodes[1].runIf.predicates[0].threshold = 6501 },
    v => { v.request.definition.schemaVersion = 3; delete v.request.definition.nodes[1].runIf },
  ]
  it.each(mutations.map((mutate, index) => [index, mutate]))('rejects missing, extra, noncanonical or forged routing snapshot %i', (_, mutate) => {
    const view = paymentView(); mutate(view)
    expect(() => payment.validateView(view)).toThrow(InvalidScenarioPayload)
  })
  it('rejects forged inclusion of a skipped stage and any altered predicate evaluation order', () => {
    const included = paymentView(false); included.request.routing.stepIds.unshift('payment-check')
    expect(() => payment.validateView(included)).toThrow(InvalidScenarioPayload)
    const reordered = paymentView(false); reordered.request.routing.evaluations[0].predicates.reverse()
    expect(() => payment.validateView(reordered)).toThrow(InvalidScenarioPayload)
    const forgedTruth = paymentView(false)
    forgedTruth.request.routing.evaluations[0].result = true
    forgedTruth.request.routing.evaluations[0].predicates[0].result = true
    forgedTruth.request.routing.stepIds.unshift('payment-check')
    forgedTruth.request.currentStepId = 'payment-check'
    expect(() => payment.validateView(forgedTruth)).toThrow(InvalidScenarioPayload)
  })
  it('requires empty evaluations, including on an all-unconditional schema-4 snapshot', () => {
    const view = paymentView(); delete view.request.definition.nodes[1].runIf; view.request.routing.evaluations = []
    expect(payment.validateView(view)).toBe(view)
    delete view.request.routing
    expect(() => payment.validateView(view)).toThrow(InvalidScenarioPayload)
  })
  it.each([viewFixture, travelViewFixture, sealViewFixture, receivingViewFixture, paymentViewFixture, contractViewFixture])('forbids routing on every older scenario snapshot %#', factory => {
    const view = factory(), handler = getScenarioHandler(view.request.processId)
    expect(handler.validateView(view)).toBe(view)
    for (const routing of [null, {}, { schemaVersion: 1, stepIds: view.request.definition.nodes.slice(1, -1).map(node => node.id), evaluations: [] }]) {
      view.request.routing = routing
      expect(() => handler.validateView(view)).toThrow(InvalidScenarioPayload)
    }
  })
  it('retains the full-definition applicant ban even for a condition-false stage', () => {
    const view = paymentView(false, variants[0], variants[1]), item = view.request
    item.applicantId = item.history[0].actorId = 'bob'
    expect(() => payment.validateView(view)).toThrow(InvalidScenarioPayload)
  })
})

describe('conditional snapshot history replay', () => {
  it('replays every reachable single, ALL and ANY transition with selected and skipped first stages', () => {
    let states = 0
    for (const selected of [false, true]) for (const first of variants) for (const second of variants) {
      function visit(view) {
        expect(payment.validateView(view)).toBe(view); states++
        const item = view.request
        if (item.status !== 'PENDING') return
        const current = item.definition.nodes.find(node => node.id === item.currentStepId)
        const votes = item.history.filter(event => event.stepId === current.id)
        for (const actor of members(current).filter(actor => !votes.some(event => event.actorId === actor))) for (const action of ['APPROVE', 'REJECT']) {
          const next = decide(view, actor, action)
          expect(payment.validateDecision(next, view, actor, current.id, action, 'Reviewed')).toBe(next)
          visit(next)
        }
      }
      visit(paymentView(selected, first, second))
    }
    expect(states).toBe(352)
  })
  it('rejects a current or saved vote at a condition-false step and synthetic skipped events', () => {
    const original = paymentView(false, variants[0], variants[1])
    const wrongCurrent = clone(original); wrongCurrent.request.currentStepId = 'payment-check'; wrongCurrent.request.approverId = 'bob'
    expect(() => payment.validateView(wrongCurrent)).toThrow(InvalidScenarioPayload)
    for (const action of ['APPROVE', 'REJECT', 'CONDITION_SKIPPED', 'SKIP']) {
      const forged = decide(original, 'carol', 'APPROVE'); forged.request.history[1].stepId = 'payment-check'; forged.request.history[1].action = action
      expect(() => payment.validateView(forged)).toThrow(InvalidScenarioPayload)
    }
    const terminal = decide(original, 'carol', 'APPROVE')
    expect(terminal.request.status).toBe('APPROVED')
    expect(terminal.request.history).toHaveLength(2)
    expect(stepState(terminal.request, terminal.request.definition.nodes[1])).toBe('conditional-skipped')
  })
  it('skips first and last false conditions while completing only the unconditional middle step', () => {
    const view = paymentView(false, variants[0], variants[1]), item = view.request
    item.definition.nodes.splice(-1, 0, { id: 'last-check', type: 'approval', name: 'Conditional final check', assigneeId: 'bob', runIf: { mode: 'ALL', predicates: [paymentAtom('GT', 7000)] } })
    item.routing.evaluations.push({ stepId: 'last-check', result: false, predicates: [{ field: 'payment.netTotal', actualValue: 'CNY 6500', result: false }] })
    expect(payment.validateView(view)).toBe(view)
    const done = decide(view, 'carol', 'APPROVE')
    expect(payment.validateDecision(done, view, 'carol', 'payment-final', 'APPROVE')).toBe(done)
    expect(done.request.status).toBe('APPROVED')
    const reversed = clone(view); reversed.request.routing.evaluations.reverse()
    expect(() => payment.validateView(reversed)).toThrow(InvalidScenarioPayload)
  })
  it('keeps condition outcomes immutable across decisions and rejects changing the saved rule or document', () => {
    const original = paymentView(false, variants[0], variants[1])
    for (const mutate of [
      v => { v.request.routing.evaluations[0].result = true },
      v => { v.request.definition.nodes[1].runIf.predicates[0].threshold = 9000 },
      v => { v.request.business.reason = v.request.reason = 'Changed business' },
    ]) {
      const response = decide(original, 'carol', 'APPROVE'); mutate(response)
      expect(() => payment.validateDecision(response, original, 'carol', 'payment-final', 'APPROVE')).toThrow(InvalidScenarioPayload)
    }
  })
})

describe('receiving and contract response facts', () => {
  it.each([['receiving', receivingViewFixture, 'receiving.hasRejectedLines', { operator: 'EQ', expected: true }, 'true'], ['contract', contractViewFixture, 'contract.termsKind', { operator: 'IN', values: ['STANDARD', 'NONSTANDARD'] }, 'NONSTANDARD']])('validates canonical %s facts from the exact saved business', (_, factory, field, atom, actualValue) => {
    const view = factory(), item = view.request, handler = getScenarioHandler(item.processId), conditional = item.definition.nodes[1]
    item.definition.schemaVersion = 4
    conditional.runIf = { mode: 'ANY', predicates: [{ field, ...atom }] }
    item.routing = { schemaVersion: 1, stepIds: item.definition.nodes.slice(1, -1).map(node => node.id), evaluations: [{ stepId: conditional.id, result: true, predicates: [{ field, actualValue, result: true }] }] }
    expect(handler.validateView(view)).toBe(view)
    for (const badValue of [actualValue.toLowerCase() === actualValue ? actualValue.toUpperCase() : actualValue.toLowerCase(), ` ${actualValue}`, actualValue === 'true' ? true : ['NONSTANDARD'], 'unknown']) {
      const malformed = clone(view); malformed.request.routing.evaluations[0].predicates[0].actualValue = badValue
      expect(() => handler.validateView(malformed)).toThrow(InvalidScenarioPayload)
    }
  })
})
