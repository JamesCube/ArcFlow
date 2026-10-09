import vectors from '../../../../contracts/seal-use/java/src/test/resources/seal-use-vectors.json'
import { describe, it, expect } from 'vitest'
import { readSealUse, serializeSealUse, normalizeSealUseForm, validateSealUseForm } from './seal-contract.js'
import { getScenarioHandler, scenarioHandlers } from './scenario-registry.js'
import { validateScenarioCatalog } from './scenario-template.js'
import { parseScenarioJson, createScenarioApi } from './scenario-api.js'
import { catalogFixture, sealFixture, sealViewFixture, decidedFixture, viewFixture } from './scenario-fixtures.js'
const handler = getScenarioHandler('oa-seal-use')
describe('Seal runtime uses the reviewed raw contract', () => {
  it.each(vectors.valid)('accepts shared raw vector $name', vector => {
    expect(serializeSealUse(readSealUse(vector.raw))).toBe(vector.canonical)
  })
  it.each(vectors.invalid)('rejects shared raw vector $name', vector => {
    expect(() => readSealUse(vector.raw)).toThrow()
  })
  it('registers exactly six compiled types; arbitrary and inherited names stay closed', () => {
    expect(Object.keys(scenarioHandlers).sort()).toEqual(['crm-contract', 'erp-payment', 'erp-receiving', 'oa-expense', 'oa-seal-use', 'oa-travel'])
    for (const id of ['crm-quote', 'leave-approval', ['oa-seal-use'], 'toString']) expect(() => getScenarioHandler(id)).toThrow()
  })
  it.each(['', '0', '101', '-1', '+1', '1.0', '1e0', '2copies', '12345678901234567'])('retains and rejects invalid count input %j', copyCount => {
    const form = sealFixture({ copyCount })
    expect(validateSealUseForm(form).some(issue => issue.path === 'copyCount')).toBe(true)
    expect(() => normalizeSealUseForm(form)).toThrow(); expect(form.copyCount).toBe(copyCount)
  })
  it.each([' 2 ', '02', '0000000000000002'])('normalizes only a valid draft count %j', copyCount => {
    expect(normalizeSealUseForm(sealFixture({ copyCount })).copyCount).toBe(2)
  })
})
describe('Seal metadata and nonmonetary response boundary', () => {
  it.each([
    t => { t.lineItems = {} }, t => { t.sections[1].fields[3].kind = 'money' },
    t => { t.sections[1].fields[3].maxLength = 15 }, t => { t.sections[1].fields[3].minimum = 1 },
    t => { t.sections[1].fields[3].required = false }, t => { t.sections[1].fields[2].options[0].value = 'REAL_SEAL' },
    t => { t.sections[1].fields[0].path = 'currency' }, t => { t.sections[0].fields[0].path = ['businessId'] },
    t => { t.documentType = 'expense' }, t => { t.sections[2].fields = [] },
  ])('rejects altered compiled metadata', change => {
    const catalog = catalogFixture(); change(catalog.find(template => template.id === 'oa-seal-use')); expect(() => validateScenarioCatalog(catalog)).toThrow()
  })
  it('accepts only the explicit null total envelope and two complete stages', () => {
    const pending = sealViewFixture(), second = decidedFixture(pending), approved = decidedFixture(second, 'carol')
    expect(handler.validateView(pending)).toBe(pending)
    expect(handler.validateDecision(second, pending, 'bob', 'documentReview', 'APPROVE', 'Reviewed')).toBe(second)
    expect(handler.validateDecision(second, pending, 'bob', 'documentReview', 'APPROVE')).toBe(second)
    expect(handler.validateDecision(approved, second, 'carol', 'sealReview', 'APPROVE', 'Reviewed')).toBe(approved)
    expect(approved.request.status).toBe('APPROVED')
    expect(handler.validateView(decidedFixture(pending, 'bob', 'REJECT')).request.status).toBe('REJECTED')
  })
  it.each([undefined, 0, '0', '0.00', {}, []])('rejects Seal total %j', total => {
    const view = { ...sealViewFixture(), total }; if (total === undefined) delete view.total
    expect(() => handler.validateView(view)).toThrow()
  })
  it('never relaxes Expense totals or accepts another scenario’s business', () => {
    expect(() => getScenarioHandler('oa-expense').validateView({ ...viewFixture(), total: null })).toThrow()
    expect(() => getScenarioHandler('oa-expense').validateView(sealViewFixture())).toThrow()
    expect(() => handler.validateView(viewFixture())).toThrow()
  })
  it.each([['copyCount', '1.0'], ['copyCount', '1e0'], ['copyCount', '"2"'], ['copyCount', 'true'], ['copyCount', 'null'], ['documentVersion', '1.0']])('rejects raw transport %s:%s', async (field, literal) => {
    const raw = JSON.stringify(sealViewFixture()).replace(new RegExp(`"${field}":\\d+`), `"${field}":${literal}`)
    const api = createScenarioApi(async () => ({ ok: true, text: async () => raw }))
    await expect(api.request('/scenarios/oa-seal-use/requests').then(view => handler.validateView(view))).rejects.toThrow()
  })
  it('rejects duplicate keys, financial fields and missing mandatory fields from raw responses', () => {
    for (const raw of [JSON.stringify(sealViewFixture()).replace('"copyCount":2', '"copyCount":2,"copyCount":3'), JSON.stringify(sealViewFixture()).replace('"copyCount":2', '"copyCount":2,"currency":"CNY"'), JSON.stringify(sealViewFixture()).replace(',"copyCount":2', '')]) {
      expect(() => handler.validateView(parseScenarioJson(raw))).toThrow()
    }
  })
})
