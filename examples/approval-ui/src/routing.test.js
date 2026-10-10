import { describe, expect, it } from 'vitest'
import { cloneDefinition, participants, pendingParticipants, participantVotes, participantStateLabel, setApprovalMode, stepState, stepStateLabel, validateDefinition, validatePublicationResponse } from './process.js'
import { effectiveApprovalNodes, evaluateRouting, RoutingEvaluationError, routingThresholdCents, supportsRouting, validateRequestRouting } from './routing.js'
import { paymentFixture, receivingFixture, contractFixture, processFixture } from './scenarios/scenario-fixtures.js'

const payment = (operator = 'GTE', threshold = 6500, currency = 'CNY') => ({ field: 'payment.netTotal', operator, currency, threshold })
const receiving = expected => ({ field: 'receiving.hasRejectedLines', operator: 'EQ', expected })
const contract = (values = ['NONSTANDARD'], operator = 'EQ') => ({ field: 'contract.termsKind', operator, values })
const rule = (...predicates) => ({ mode: 'ALL', predicates })
function definition(id = 'erp-payment', condition = rule(payment())) {
  const result = processFixture({ schemaVersion: 4, id })
  result.nodes[1].runIf = condition
  return result
}
const valid = value => validateDefinition(value, value.id)
function request(condition = rule(payment('GT')), overrides = {}) {
  const draft = definition('erp-payment', condition), business = paymentFixture()
  return { definition: draft, business, routing: evaluateRouting(draft, business), currentStepId: 'finance', status: 'PENDING', history: [], ...overrides }
}

describe('conditional definition schema compatibility', () => {
  it.each(['oa-expense', 'erp-payment', 'erp-receiving', 'crm-contract'])('accepts schema 4 for the supported process %s, including all-unconditional routes', id => {
    expect(supportsRouting(id)).toBe(true)
    const d = processFixture({ id, schemaVersion: 4 })
    expect(valid(d)).toEqual([])
    expect(Object.hasOwn(d.nodes[1], 'runIf')).toBe(false)
  })
  it.each(['leave-approval', 'oa-travel', 'oa-seal-use', 'crm-quote', 'generic', '__proto__', '', null])('rejects schema 4 for unsupported process %j', id => {
    expect(supportsRouting(id)).toBe(false)
    expect(valid(processFixture({ id, schemaVersion: 4 })).length).toBeGreaterThan(0)
  })
  it.each([2, 3])('preserves schema %i wire shape and prohibits even null conditions', schemaVersion => {
    const d = processFixture({ schemaVersion }), before = JSON.stringify(d)
    expect(valid(d)).toEqual([])
    expect(evaluateRouting(d, null)).toBeNull()
    expect(JSON.stringify(d)).toBe(before)
    for (const runIf of [null, undefined, rule(payment())]) {
      d.nodes[1].runIf = runIf
      expect(valid(d).length).toBeGreaterThan(0)
    }
  })
  it('does not permit conditions on fixed boundaries or all approval steps', () => {
    for (const index of [0, 3]) {
      const d = definition(); d.nodes[index].runIf = rule(payment())
      expect(valid(d).join(' ')).toContain('Start and end nodes cannot have conditions')
    }
    const d = definition(); d.nodes[2].runIf = rule(payment())
    expect(valid(d).join(' ')).toContain('at least one unconditional')
  })
  it.each([null, undefined, [], {}, { mode: 'ALL' }, { predicates: [payment()] }, { mode: 'NOT', predicates: [payment()] }, { mode: 'all', predicates: [payment()] }, { mode: 'ALL', predicates: [] }, { mode: 'ALL', predicates: 'bad' }, { mode: 'ALL', predicates: [payment()], extra: true }, { mode: 'ANY', predicates: [rule(payment())] }, rule(...Array.from({ length: 9 }, () => payment())), { mode: 'ALL', predicates: Array(1) }])('rejects malformed, nested, empty, extra or oversized condition %j', condition => {
    const d = definition(); d.nodes[1].runIf = condition
    expect(valid(d).length).toBeGreaterThan(0)
  })
  it.each([null, 2, {}, { field: 'unknown' }, { ...payment(), extra: 1 }, { ...payment(), expected: true }, { ...payment(), values: ['STANDARD'] }, { ...payment(), operator: 'NE' }, { ...payment(), currency: 'BTC' }, { ...payment(), threshold: '6500' }, receiving(true), contract()])('rejects malformed or cross-family payment predicate %j', predicate => {
    expect(valid(definition('erp-payment', rule(predicate))).length).toBeGreaterThan(0)
  })
  it('limits total predicates across conditional stages to eight and enforces a single payment currency', () => {
    const d = definition('erp-payment', rule(...Array.from({ length: 4 }, () => payment())))
    d.nodes.splice(2, 0, { ...d.nodes[1], id: 'second', runIf: rule(...Array.from({ length: 4 }, () => payment())) })
    expect(valid(d)).toEqual([])
    d.nodes[2].runIf.predicates.push(payment())
    expect(valid(d).join(' ')).toContain('at most 8')
    d.nodes[2].runIf = rule(payment('EQ', 6500, 'USD'))
    expect(valid(d).join(' ')).toContain('same currency')
  })
  it('retains conditions and schema 4 through SINGLE, ALL and ANY conversion without mutating the original', () => {
    const original = definition(), serialized = JSON.stringify(original)
    let next = original
    for (const mode of ['ALL', 'ANY', 'SINGLE', 'ANY', 'SINGLE']) {
      next = setApprovalMode(next, 'manager', mode)
      expect(next.schemaVersion).toBe(4)
      expect(next.nodes[1].runIf).toEqual(original.nodes[1].runIf)
      expect(next.nodes[1].runIf).not.toBe(original.nodes[1].runIf)
      expect(valid(next)).toEqual([])
      expect(JSON.stringify(original)).toBe(serialized)
      expect(Object.hasOwn(next.nodes[2], 'runIf')).toBe(false)
      if (mode === 'SINGLE') expect(Object.keys(next.nodes[1])).toEqual(['id', 'type', 'name', 'assigneeId', 'runIf'])
    }
    delete next.nodes[1].runIf
    expect(setApprovalMode(next, 'manager', 'ALL').schemaVersion).toBe(4)
  })
})

describe('numeric threshold contract and exact decimal routing', () => {
  it.each([0, 0.01, 0.1, 0.29, 1, 1.01, 19999999999.99, 20000000000])('accepts decimal threshold %s without floating-point multiplication', threshold => {
    expect(valid(definition('erp-payment', rule(payment('EQ', threshold))))).toEqual([])
    expect(routingThresholdCents(threshold, 'CNY')).not.toBeNull()
  })
  it.each([-1, -0.01, NaN, Infinity, -Infinity, 0.001, 0.1 + 0.2, 20000000000.01, '1', '', true, null, undefined])('rejects invalid threshold %j', threshold => {
    expect(routingThresholdCents(threshold, 'CNY')).toBeNull()
    expect(valid(definition('erp-payment', rule({ ...payment('EQ'), threshold }))).length).toBeGreaterThan(0)
  })
  it.each(['CNY', 'USD', 'EUR', 'GBP', 'JPY'])('uses native %s without implicit currency conversion', currency => {
    const d = definition('erp-payment', rule(payment('EQ', 6500, currency)))
    expect(evaluateRouting(d, paymentFixture({ currency })).evaluations[0].predicates[0]).toEqual({ field: 'payment.netTotal', actualValue: `${currency} 6500`, result: true })
  })
  it('requires whole-yen thresholds', () => {
    expect(valid(definition('erp-payment', rule(payment('EQ', 6500, 'JPY'))))).toEqual([])
    expect(valid(definition('erp-payment', rule(payment('EQ', 6500.01, 'JPY')))).length).toBeGreaterThan(0)
  })
  it.each([['EQ', 6500, true], ['EQ', 6500.01, false], ['GT', 6500, false], ['GT', 6499.99, true], ['GTE', 6500, true], ['GTE', 6500.01, false], ['LT', 6500, false], ['LT', 6500.01, true], ['LTE', 6500, true], ['LTE', 6499.99, false]])('evaluates %s at %s precisely', (operator, threshold, expected) => {
    const result = evaluateRouting(definition('erp-payment', rule(payment(operator, threshold))), paymentFixture())
    expect(result.evaluations).toEqual([{ stepId: 'manager', result: expected, predicates: [{ field: 'payment.netTotal', actualValue: 'CNY 6500', result: expected }] }])
    expect(result.stepIds).toEqual(expected ? ['manager', 'finance'] : ['finance'])
  })
  it.each([['0.10', '0.20', '0.3', 0.3], ['0.01', '0.28', '0.29', 0.29], ['10000.00', '0.00', '10000', 10000]])('calculates exact net %s + %s with canonical money text', (first, second, text, threshold) => {
    const business = paymentFixture()
    business.lines.forEach((line, index) => Object.assign(line, { invoiceAmount: index && second === '0.00' ? '1' : index ? second : first, previouslySettledAmount: '0', allocationAmount: index && second === '0.00' ? '1' : index ? second : first, deductionAmount: index && second === '0.00' ? '1' : '0', deductionReason: index && second === '0.00' ? 'Complete deduction' : '' }))
    expect(evaluateRouting(definition('erp-payment', rule(payment('EQ', threshold))), business).evaluations[0].predicates[0]).toEqual({ field: 'payment.netTotal', actualValue: `CNY ${text}`, result: true })
  })
  it('supports the maximum twenty-billion total exactly', () => {
    const business = paymentFixture()
    business.lines = Array.from({ length: 20 }, (_, index) => ({ ...business.lines[0], lineId: `line-${index}`, invoiceRef: `invoice-${index}`, invoiceAmount: '1000000000', previouslySettledAmount: '0', allocationAmount: '1000000000', deductionAmount: '0', deductionReason: '' }))
    expect(evaluateRouting(definition('erp-payment', rule(payment('EQ', 20000000000))), business).evaluations[0].predicates[0]).toEqual({ field: 'payment.netTotal', actualValue: 'CNY 20000000000', result: true })
  })
  it.each(['ALL', 'ANY'])('rejects a currency mismatch rather than skipping a step in %s mode', mode => {
    const d = definition('erp-payment', { mode, predicates: [payment('GT', 9999999, 'USD'), payment('EQ', 6500, 'USD')] })
    expect(() => evaluateRouting(d, paymentFixture())).toThrow(RoutingEvaluationError)
    expect(() => evaluateRouting(d, paymentFixture())).toThrow(expect.objectContaining({ code: 'CURRENCY_MISMATCH', expectedCurrency: 'USD', actualCurrency: 'CNY', stepId: 'manager' }))
  })
})

describe('boolean and enum condition contracts', () => {
  it.each([true, false])('evaluates receiving rejected lines EQ %s', expected => {
    const d = definition('erp-receiving', rule(receiving(expected)))
    expect(valid(d)).toEqual([])
    const evaluated = evaluateRouting(d, receivingFixture())
    expect(evaluated.evaluations[0]).toEqual({ stepId: 'manager', result: expected, predicates: [{ field: 'receiving.hasRejectedLines', actualValue: 'true', result: expected }] })
    const business = receivingFixture(); business.lines.forEach(line => { line.accepted = line.received; line.rejected = 0 })
    expect(evaluateRouting(d, business).evaluations[0].predicates[0]).toEqual({ field: 'receiving.hasRejectedLines', actualValue: 'false', result: !expected })
  })
  it.each([{ ...receiving(true), expected: 'true' }, { ...receiving(false), expected: 0 }, { ...receiving(true), operator: 'IN' }, { ...receiving(true), currency: 'CNY' }, payment()])('rejects invalid receiving condition %j', predicate => {
    expect(valid(definition('erp-receiving', rule(predicate))).length).toBeGreaterThan(0)
  })
  it.each([['EQ', ['NONSTANDARD'], true], ['EQ', ['STANDARD'], false], ['IN', ['NONSTANDARD'], true], ['IN', ['STANDARD', 'NONSTANDARD'], true], ['IN', ['NONSTANDARD', 'STANDARD'], true]])('evaluates contract %s %j', (operator, values, expected) => {
    const d = definition('crm-contract', rule(contract(values, operator)))
    expect(valid(d)).toEqual([])
    expect(evaluateRouting(d, contractFixture()).evaluations[0].predicates[0]).toEqual({ field: 'contract.termsKind', actualValue: 'NONSTANDARD', result: expected })
  })
  it.each([contract([], 'IN'), contract(['STANDARD', 'NONSTANDARD']), contract(['STANDARD', 'STANDARD'], 'IN'), contract(['OTHER']), contract(['standard']), contract('STANDARD'), contract(Array(1)), { ...contract(), expected: true }, { ...contract(), operator: 'NE' }, payment()])('rejects invalid contract enum predicate %j', predicate => {
    expect(valid(definition('crm-contract', rule(predicate))).length).toBeGreaterThan(0)
  })
  it.each([['erp-payment', receivingFixture()], ['erp-receiving', contractFixture()], ['crm-contract', paymentFixture()]])('refuses business-family substitution for %s even with unconditional steps', (id, business) => {
    expect(() => evaluateRouting(processFixture({ id, schemaVersion: 4 }), business)).toThrow(expect.objectContaining({ code: 'INVALID_ROUTING_BUSINESS' }))
  })
  it('evaluates every atom and step in original order for ALL and ANY', () => {
    const d = definition('erp-payment', { mode: 'ANY', predicates: [payment('GT', 6500), payment('EQ', 6500), payment('LT', 6500)] })
    d.nodes.splice(2, 0, { ...d.nodes[1], id: 'second', runIf: { mode: 'ALL', predicates: [payment('GTE', 6500), payment('LT', 6500)] } })
    const routing = evaluateRouting(d, paymentFixture())
    expect(routing.stepIds).toEqual(['manager', 'finance'])
    expect(routing.evaluations.map(e => e.stepId)).toEqual(['manager', 'second'])
    expect(routing.evaluations.map(e => e.result)).toEqual([true, false])
    expect(routing.evaluations.map(e => e.predicates.map(p => p.result))).toEqual([[false, true, false], [true, false]])
  })
})

describe('saved routing and progress utilities', () => {
  it('requires schema-4 routing even for unconditional definitions, while old requests omit it entirely', () => {
    const definition = processFixture({ id: 'erp-payment', schemaVersion: 4 }), business = paymentFixture()
    const routing = evaluateRouting(definition, business)
    expect(routing).toEqual({ schemaVersion: 1, stepIds: ['manager', 'finance'], evaluations: [] })
    expect(validateRequestRouting({ definition, business, routing })).toBe(routing)
    expect(() => validateRequestRouting({ definition, business })).toThrow()
    expect(() => validateRequestRouting({ definition, business, routing: null })).toThrow()
    for (const schemaVersion of [2, 3]) {
      const old = { definition: processFixture({ schemaVersion }) }
      expect(validateRequestRouting(old)).toBeNull()
      expect(effectiveApprovalNodes(old).map(n => n.id)).toEqual(['manager', 'finance'])
      expect(() => validateRequestRouting({ ...old, routing: null })).toThrow()
      expect(() => validateRequestRouting({ ...old, routing })).toThrow()
    }
  })
  it('distinguishes condition skips from not-reached steps after rejection and exposes only selected reviewers', () => {
    const r = request()
    expect(effectiveApprovalNodes(r).map(node => node.id)).toEqual(['finance'])
    expect(stepState(r, r.definition.nodes[1])).toBe('conditional-skipped')
    expect(stepState(r, r.definition.nodes[2])).toBe('current')
    expect(pendingParticipants(r)).toEqual(['carol'])
    r.currentStepId = 'manager'
    expect(pendingParticipants(r)).toEqual([])
    r.status = 'REJECTED'; r.currentStepId = null
    expect(stepState(r, r.definition.nodes[1])).toBe('conditional-skipped')
    expect(stepState(r, r.definition.nodes[2])).toBe('skipped')
    expect(stepStateLabel('conditional-skipped')).toBe('Condition not met')
    expect(participantStateLabel('conditional-skipped')).toBe('Condition not met')
    expect(participantVotes(r, r.definition.nodes[1])[0].state).toBe('conditional-skipped')
  })
  it('retains partial ALL/ANY votes and repeated-person stage identity among selected steps', () => {
    const r = request(rule(payment('GTE')))
    r.definition = setApprovalMode(r.definition, 'manager', 'ALL')
    r.currentStepId = 'manager'
    r.history = [{ stepId: 'manager', actorId: 'bob', action: 'APPROVE' }]
    expect(pendingParticipants(r)).toEqual(['carol'])
    expect(stepState(r, r.definition.nodes[1])).toBe('current')
    r.history.push({ stepId: 'manager', actorId: 'carol', action: 'APPROVE' })
    r.currentStepId = 'finance'
    expect(pendingParticipants(r)).toEqual(participants(r.definition.nodes[2]))
    expect(stepState(r, r.definition.nodes[1])).toBe('approved')
  })
  it('never mutates a supplied process, business or routing snapshot', () => {
    const r = request(), before = JSON.stringify(r)
    expect(evaluateRouting(r.definition, r.business)).toEqual(r.routing)
    validateRequestRouting(r); effectiveApprovalNodes(r); pendingParticipants(r)
    expect(JSON.stringify(r)).toBe(before)
  })
})

describe('publication condition acknowledgement', () => {
  it('allows object key reordering but requires every condition value and predicate position', () => {
    const submitted = definition('erp-payment', rule(payment(), payment('LT', 7000)))
    const published = cloneDefinition(submitted); published.version++
    published.nodes[1].runIf = { predicates: published.nodes[1].runIf.predicates.map(p => ({ threshold: p.threshold, currency: p.currency, operator: p.operator, field: p.field })), mode: 'ALL' }
    expect(validatePublicationResponse(published, submitted, submitted.id)).toBe(published)
    for (const mutate of [d => { d.nodes[1].runIf.mode = 'ANY' }, d => { d.nodes[1].runIf.predicates[0].threshold++ }, d => { d.nodes[1].runIf.predicates[0].operator = 'GT' }, d => { d.nodes[1].runIf.predicates.reverse() }, d => { delete d.nodes[1].runIf }, d => { d.schemaVersion = 3 }]) {
      const changed = cloneDefinition(published); mutate(changed)
      expect(() => validatePublicationResponse(changed, submitted, submitted.id)).toThrow(expect.objectContaining({ name: 'InvalidPublicationResponseError' }))
    }
  })
  it('rejects changed receiving booleans and contract enum values', () => {
    for (const [id, condition, mutate] of [
      ['erp-receiving', rule(receiving(true)), p => { p.expected = false }],
      ['crm-contract', rule(contract()), p => { p.values = ['STANDARD'] }],
    ]) {
      const submitted = definition(id, condition), changed = cloneDefinition(submitted); changed.version++
      mutate(changed.nodes[1].runIf.predicates[0])
      expect(() => validatePublicationResponse(changed, submitted, id)).toThrow()
    }
  })
})
