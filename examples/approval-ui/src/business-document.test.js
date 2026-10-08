import { describe, expect, it } from 'vitest'
import { SUPPORTED_CURRENCIES, parseUnitPrice, procurementTotal, formatMoney, businessDocumentErrors, normalizeBusinessDocument, requestBusiness, parseApprovalJson } from './business-document'

const procurement = { type: 'procurement', businessId: 'PO-2026/001:a_b.c', title: 'Chairs', reason: 'Expansion', item: 'Ergonomic chair', quantity: '3', unitPrice: '199.50', currency: 'CNY' }
const business = normalizeBusinessDocument(procurement)
const request = { title: business.title, reason: business.reason, days: 0, business }

describe('exact bounded procurement amounts', () => {
  it.each(['', ' ', '0', '0.00', '-1', '+1', '.1', '1.', '1e2', '1,000', '1.001', '1000000000.01', 'Infinity', 'NaN', null, undefined, true, [], {}])('rejects a malformed or out-of-range price %j', value => {
    expect(parseUnitPrice(value, 'CNY')).toBeNull()
    expect(procurementTotal('3', value, 'CNY')).toBeNull()
    expect(businessDocumentErrors({ ...procurement, unitPrice: value })).toContain('unitPrice')
  })
  it.each(['', '0', '1.1', '1e2', '+2', '-2', '100001', null, true])('rejects a non-integer or out-of-range quantity %j', quantity => {
    expect(procurementTotal(quantity, '1', 'USD')).toBeNull()
    expect(businessDocumentErrors({ ...procurement, quantity })).toContain('quantity')
  })
  it('normalizes valid decimal input and never multiplies binary floats', () => {
    expect(parseUnitPrice(' 00199.50 ', 'CNY')).toBe('199.5')
    expect(procurementTotal('3', '0.10', 'USD')).toBe('0.30')
    expect(procurementTotal('3', '199.50', 'CNY')).toBe('598.50')
    expect(procurementTotal('100000', '999999999.99', 'GBP')).toBe('99999999999000.00')
    expect(procurementTotal('100000', '1000000000', 'EUR')).toBe('100000000000000.00')
    expect(formatMoney('99999999999000.00', 'GBP')).toBe('GBP 99,999,999,999,000.00')
    expect(formatMoney('0.30', 'CNY', 'zh')).toBe('CNY 0.30')
    expect(formatMoney(null, 'CNY')).toBe('—')
    expect(formatMoney('1.001', 'CNY')).toBe('—')
  })
  it('enforces JPY whole prices and supported currencies without conversion', () => {
    expect(parseUnitPrice('199.50', 'JPY')).toBeNull()
    expect(parseUnitPrice('199.00', 'JPY')).toBe('199')
    expect(procurementTotal('3', '199.00', 'JPY')).toBe('597')
    expect(formatMoney('597', 'JPY')).toBe('JPY 597')
    expect(formatMoney('597.01', 'JPY')).toBe('—')
    for (const currency of SUPPORTED_CURRENCIES) expect(businessDocumentErrors({ ...procurement, currency, unitPrice: '199' })).toEqual([])
    for (const currency of ['usd', 'AUD', '', null, 1]) expect(businessDocumentErrors({ ...procurement, currency })).toContain('currency')
  })
})

describe('strict immutable business boundaries', () => {
  it('normalizes text and bounded numeric values only after validation', () => {
    const document = normalizeBusinessDocument({ ...procurement, title: ' Chairs ', reason: ' Expansion ', item: ' Chair ' })
    expect(document).toEqual({ ...business, item: 'Chair' })
    expect(Object.isFrozen(document)).toBe(true)
    expect(JSON.stringify(document)).toContain('"unitPrice":199.5')
    expect(procurement.unitPrice).toBe('199.50')
  })
  it.each(['', ' ', '_PO', '-PO', '采购001', 'PO 001', 'x'.repeat(129), null, 42])('validates the business ID %j without inventing one', businessId => {
    expect(businessDocumentErrors({ ...procurement, businessId })).toContain('businessId')
  })
  it.each([['title', 120], ['reason', 2000], ['item', 240]])('bounds mandatory %s text', (field, max) => {
    for (const value of ['', '  ', 'x'.repeat(max + 1), null, 8]) expect(businessDocumentErrors({ ...procurement, [field]: value })).toContain(field)
    expect(businessDocumentErrors({ ...procurement, [field]: 'x'.repeat(max) })).toEqual([])
  })
  it('rejects unknown, missing and wrongly typed fields on the wire', () => {
    expect(businessDocumentErrors(business, { wire: true })).toEqual([])
    for (const key of Object.keys(business)) {
      const missing = { ...business }; delete missing[key]
      expect(businessDocumentErrors(missing, { wire: true }).length).toBeGreaterThan(0)
    }
    for (const bad of [{ ...business, extra: true }, { ...business, quantity: '3' }, { ...business, unitPrice: '199.50' }, { ...business, type: 'expense' }, null, []]) {
      expect(() => requestBusiness({ ...request, business: bad })).toThrow('Invalid business document')
    }
    expect(() => normalizeBusinessDocument({ ...procurement, hidden: 1 })).toThrow()
  })
  it('separates legacy leave, typed leave and procurement and checks all compatibility projections', () => {
    expect(requestBusiness({ title: 'Leave', reason: 'Rest', days: 1 })).toBeNull()
    const leave = { type: 'leave', businessId: 'LEAVE.001', title: 'Leave', reason: 'Rest', days: 2 }
    expect(requestBusiness({ title: leave.title, reason: leave.reason, days: 2, business: leave })).toBe(leave)
    expect(requestBusiness(request)).toBe(business)
    for (const change of [{ days: 1 }, { title: 'Other' }, { reason: 'Other' }, { business: null }, { business: { ...business, item: ' Chair ' } }]) expect(() => requestBusiness({ ...request, ...change })).toThrow()
    for (const days of [0, 366, '1', null]) expect(() => requestBusiness({ title: 'Leave', reason: 'Rest', days })).toThrow()
    for (const change of [{ days: '2' }, { quantity: 2 }, { type: 'procurement' }]) expect(() => requestBusiness({ title: leave.title, reason: leave.reason, days: 2, business: { ...leave, ...change } })).toThrow()
  })
})


describe('raw numeric lexemes before JSON rounding', () => {
  const raw = token => `{"code":200,"msg":"Success","data":{"business":{"currency":"CNY","unitPrice":${token}}}}`
  it.each(['1.00000000000000001', '1000000000.00000001', '1.000', '1.000e0', '0', '-1', '1e-3', '1000000001', '1e999999999'])('rejects invalid price token %s inside native envelopes', token => {
    expect(() => parseApprovalJson(raw(token))).toThrow('Invalid approval response')
  })
  it.each([['1E+9', 1000000000], ['1.00e2', 100], ['1e-2', 0.01], ['199.50', 199.5]])('accepts exact legal server price token %s', (token, expected) => {
    expect(parseApprovalJson(raw(token)).data.business.unitPrice).toBe(expected)
  })
  it.each(['1.00000000000000001', '3.0', '3e0', '9007199254740993'])('rejects wrongly typed or lossy integer token %s', token => {
    expect(() => parseApprovalJson(`{"quantity":${token}}`)).toThrow()
    expect(() => parseApprovalJson(`{"days":${token}}`)).toThrow()
    expect(() => parseApprovalJson(`{"processVersion":${token}}`)).toThrow()
  })
  it('rejects duplicate/escaped keys, invalid grammar and excessive nesting', () => {
    for (const raw of ['{"quantity":1,"quantity":2}', '{"quantity":1,"quanti\\u0074y":2}', '{"x":1,}', '[1,]', '[01]', '[NaN]', '{} trailing', '{"x":"bad\nstring"}', '['.repeat(66) + '1' + ']'.repeat(66)]) expect(() => parseApprovalJson(raw)).toThrow()
    expect(parseApprovalJson('{"name":"He said \\"Hi\\"","nested":[null,true,false]}')).toEqual({ name: 'He said "Hi"', nested: [null,true,false] })
  })
})
