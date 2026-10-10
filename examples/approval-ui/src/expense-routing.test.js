import { describe, expect, it } from 'vitest'
import { evaluateRouting, validateRequestRouting, effectiveApprovalNodes } from './routing.js'
import { cloneDefinition, pendingParticipants, setApprovalMode, stepState, validateDefinition, validatePublicationResponse } from './process.js'
import { expenseFixture, processFixture } from './scenarios/scenario-fixtures.js'

export const expenseAtom = (operator = 'GTE', threshold = 150, currency = 'CNY') => ({ field: 'expense.totalAmount', operator, currency, threshold })
const rule = (...predicates) => ({ mode: 'ALL', predicates })
const definition = (condition = rule(expenseAtom())) => {
  const value = processFixture({ schemaVersion: 4 })
  value.nodes[1].runIf = condition
  return value
}

describe('expense total conditions', () => {
  it.each([['EQ', 150, true], ['EQ', 150.01, false], ['GT', 150, false], ['GT', 149.99, true], ['GTE', 150, true], ['GTE', 150.01, false], ['LT', 150, false], ['LT', 150.01, true], ['LTE', 150, true], ['LTE', 149.99, false]])('compares the exact derived total %s %s', (operator, threshold, result) => {
    const d = definition(rule(expenseAtom(operator, threshold)))
    expect(validateDefinition(d, 'oa-expense')).toEqual([])
    expect(evaluateRouting(d, expenseFixture())).toEqual({ schemaVersion: 1, stepIds: result ? ['manager', 'finance'] : ['finance'], evaluations: [{ stepId: 'manager', result, predicates: [{ field: 'expense.totalAmount', actualValue: 'CNY 150', result }] }] })
  })
  it.each([['0.10', '0.20', 0.3, '0.3'], ['0.01', '0.28', 0.29, '0.29'], ['999999999.99', '0.01', 1000000000, '1000000000']])('sums %s + %s exactly from expense lines', (first, second, threshold, actual) => {
    const business = expenseFixture(); business.lines[0].amount = first; business.lines[1].amount = second
    const before = JSON.stringify(business)
    expect(evaluateRouting(definition(rule(expenseAtom('EQ', threshold))), business).evaluations[0].predicates[0]).toEqual({ field: 'expense.totalAmount', actualValue: `CNY ${actual}`, result: true })
    expect(JSON.stringify(business)).toBe(before)
  })
  it.each(['CNY', 'USD', 'EUR', 'GBP', 'JPY'])('handles the maximum 20-line %s total without rounding or currency conversion', currency => {
    const business = expenseFixture({ currency })
    business.lines = Array.from({ length: 20 }, (_, index) => ({ ...business.lines[0], lineId: `line-${index}`, receiptRef: `receipt-${index}`, amount: '1000000000' }))
    expect(evaluateRouting(definition(rule(expenseAtom('EQ', 20000000000, currency))), business).evaluations[0].predicates[0]).toEqual({ field: 'expense.totalAmount', actualValue: `${currency} 20000000000`, result: true })
  })
  it('supports zero thresholds and exact whole-yen expense facts', () => {
    const business = expenseFixture({ currency: 'JPY' }); business.lines[0].amount = '100'; business.lines[1].amount = '50.00'
    expect(evaluateRouting(definition(rule(expenseAtom('GT', 0, 'JPY'))), business).stepIds).toEqual(['manager', 'finance'])
    expect(evaluateRouting(definition(rule(expenseAtom('EQ', 150, 'JPY'))), business).evaluations[0].predicates[0].actualValue).toBe('JPY 150')
    expect(validateDefinition(definition(rule(expenseAtom('EQ', 150.01, 'JPY'))), 'oa-expense')).not.toEqual([])
    business.lines[0].amount = '100.01'
    expect(() => evaluateRouting(definition(rule(expenseAtom('EQ', 150, 'JPY'))), business)).toThrow(expect.objectContaining({ code: 'INVALID_ROUTING_BUSINESS' }))
  })
  it.each([-1, 20000000000.01, 0.001, 0.1 + 0.2, NaN, Infinity, -Infinity, '150', null, undefined])('rejects an invalid expense threshold %j', threshold => {
    expect(validateDefinition(definition(rule({ ...expenseAtom('EQ'), threshold })), 'oa-expense')).not.toEqual([])
  })
  it.each(['ALL', 'ANY'])('does not short circuit or silently skip mismatched money in %s', mode => {
    const d = definition({ mode, predicates: [expenseAtom('LT', 0, 'USD'), expenseAtom('GTE', 150, 'USD')] })
    expect(() => evaluateRouting(d, expenseFixture())).toThrow(expect.objectContaining({ code: 'CURRENCY_MISMATCH', expectedCurrency: 'USD', actualCurrency: 'CNY', stepId: 'manager' }))
  })
  it('keeps the existing finite field and same-currency definition contract', () => {
    for (const changes of [{ field: 'payment.netTotal' }, { field: 'expense.total' }, { field: 'expense.lines.amount' }, { operator: 'NE' }, { currency: 'AUD' }, { expected: true }, { expression: 'sum(lines)' }]) {
      expect(validateDefinition(definition(rule({ ...expenseAtom(), ...changes })), 'oa-expense')).not.toEqual([])
    }
    expect(validateDefinition(definition(rule(expenseAtom(), expenseAtom('GT', 0, 'USD'))), 'oa-expense').join(' ')).toContain('same currency')
    const d = definition(); d.nodes[2].runIf = rule(expenseAtom())
    expect(validateDefinition(d, 'oa-expense').join(' ')).toContain('unconditional')
  })
  it('rejects invalid lines and caller-supplied totals even when no conditional stage is configured', () => {
    for (const mutate of [b => { b.totalAmount = '150' }, b => { b.total = '150' }, b => { b.lines[0].amount = '1.0000000001' }, b => { b.lines[0].amount = 123.45 }, b => { b.lines[0].amount = '0' }, b => { b.lines[0].amount = '1000000000.01' }, b => { b.lines[1].receiptRef = b.lines[0].receiptRef }]) {
      const business = expenseFixture(); mutate(business)
      expect(() => evaluateRouting(processFixture({ schemaVersion: 4 }), business)).toThrow(expect.objectContaining({ code: 'INVALID_ROUTING_BUSINESS' }))
    }
  })
  it('evaluates all atoms in original order and distinguishes selected and skipped reviewers', () => {
    const d = setApprovalMode(definition({ mode: 'ANY', predicates: [expenseAtom('GT'), expenseAtom('EQ'), expenseAtom('LT')] }), 'manager', 'ALL')
    const business = expenseFixture(), routing = evaluateRouting(d, business)
    expect(routing.evaluations[0].predicates.map(p => p.result)).toEqual([false, true, false])
    const selected = { definition: d, business, routing, history: [], status: 'PENDING', currentStepId: 'manager' }
    expect(pendingParticipants(selected)).toEqual(['bob', 'carol'])
    selected.definition = definition(rule(expenseAtom('GT'))); selected.routing = evaluateRouting(selected.definition, business); selected.currentStepId = 'finance'
    expect(effectiveApprovalNodes(selected).map(node => node.id)).toEqual(['finance'])
    expect(pendingParticipants(selected)).toEqual(['carol'])
    expect(stepState(selected, selected.definition.nodes[1])).toBe('conditional-skipped')
  })
  it('keeps old requests and already-frozen paths unchanged after a later publication', () => {
    const old = { definition: processFixture(), business: expenseFixture() }, before = JSON.stringify(old)
    const draft = definition(rule(expenseAtom('GT'))), saved = { definition: cloneDefinition(draft), business: expenseFixture() }
    saved.routing = evaluateRouting(saved.definition, saved.business)
    const later = cloneDefinition(draft); later.version++; later.nodes[1].runIf.predicates[0].operator = 'GTE'
    expect(evaluateRouting(later, saved.business).stepIds).toEqual(['manager', 'finance'])
    expect(validateRequestRouting(saved).stepIds).toEqual(['finance'])
    expect(validateRequestRouting(old)).toBeNull(); expect(JSON.stringify(old)).toBe(before)
    const acknowledged = cloneDefinition(draft); acknowledged.version++
    expect(validatePublicationResponse(acknowledged, draft, 'oa-expense')).toBe(acknowledged)
    acknowledged.nodes[1].runIf.predicates[0].field = 'payment.netTotal'
    expect(() => validatePublicationResponse(acknowledged, draft, 'oa-expense')).toThrow()
  })
})
