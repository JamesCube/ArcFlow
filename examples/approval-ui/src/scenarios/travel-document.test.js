import { describe, expect, it } from 'vitest'
import { CURRENCIES, COST_CENTERS, InvalidScenarioPayload, expenseErrors, normalizeExpense } from './expense-document.js'
import { expenseFixture } from './scenario-fixtures.js'
import { parseScenarioJson } from './scenario-api.js'
import { TEMPLATE_ID, TRAVEL_PURPOSES, emptyTravel, travelErrors, travelDurationDays, travelTotal, normalizeTravel, serializeTravelPayload, validateTravelBusiness } from './travel-document.js'

const travelFixture = (overrides = {}) => ({ type: 'travel', documentVersion: 1, businessId: 'TRV-2026-001', title: 'Client visit', reason: 'Synthetic travel fixture; no personal information.', destination: 'Shanghai', startDate: '2026-10-08', endDate: '2026-10-10', purpose: 'CUSTOMER_VISIT', estimatedCost: '1234.50', currency: 'CNY', costCenter: 'ENGINEERING', ...overrides })

describe('travel date-only duration', () => {
  it.each([
    ['2026-10-08', '2026-10-08', 1],
    ['2026-10-08', '2026-10-10', 3],
    ['2026-01-01', '2026-03-31', 90],
    ['2024-01-01', '2024-03-30', 90],
    ['2024-02-28', '2024-03-01', 3],
    ['2000-02-28', '2000-03-01', 3],
    ['1900-02-28', '1900-03-01', 2],
    ['2026-03-07', '2026-03-09', 3],
    ['2026-10-31', '2026-11-02', 3],
    ['2026-12-31', '2027-01-01', 2],
    ['0001-01-01', '0001-01-01', 1],
    ['0099-12-31', '0100-01-01', 2],
    ['9999-12-31', '9999-12-31', 1],
  ])('derives %s through %s as %i inclusive days', (startDate, endDate, days) => {
    expect(travelDurationDays(startDate, endDate)).toBe(days)
    expect(travelErrors(travelFixture({ startDate, endDate }))).toEqual([])
  })
  it.each([
    ['2026-10-10', '2026-10-08'],
    ['2026-01-01', '2026-04-01'],
    ['2024-01-01', '2024-03-31'],
    ['0001-01-01', '9999-12-31'],
  ])('rejects reversed or overlong date ranges %s through %s', (startDate, endDate) => {
    expect(travelDurationDays(startDate, endDate)).toBeNull()
    expect(travelErrors(travelFixture({ startDate, endDate }))).toEqual(['endDate'])
  })
  it.each(['2026-02-29', '1900-02-29', '2100-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '0000-01-01', '10000-01-01', '2026-2-01', '2026-01-1', '26-01-01', '2026-10-08T00:00:00Z', ' 2026-10-08', '2026-10-08\n', '', null, 20261008])('rejects non-date value %j at either endpoint', value => {
    expect(travelDurationDays(value, '2026-10-08')).toBeNull()
    expect(travelDurationDays('2026-10-08', value)).toBeNull()
    expect(travelErrors(travelFixture({ startDate: value }))).toContain('startDate')
    expect(travelErrors(travelFixture({ endDate: value }))).toContain('endDate')
  })
})

describe('exact travel estimated cost', () => {
  it.each([
    ['0.01', 'CNY', '0.01'], ['0.10', 'USD', '0.10'], ['0.29', 'EUR', '0.29'],
    ['0001234.5', 'GBP', '1234.50'], ['1000000000.00', 'CNY', '1000000000.00'],
    ['999999999.99', 'CNY', '999999999.99'], ['1', 'JPY', '1'], ['0001.00', 'JPY', '1'],
    ['1000000000', 'JPY', '1000000000'],
  ])('keeps %s %s exact as %s', (estimatedCost, currency, expected) => {
    const business = travelFixture({ estimatedCost, currency })
    expect(travelErrors(business)).toEqual([])
    expect(travelTotal(business)).toBe(expected)
    expect(normalizeTravel(business).estimatedCost).toBe(expected)
    const wire = serializeTravelPayload({ business, processVersion: 1 })
    expect(wire).toContain(`"estimatedCost":${expected}`)
    expect(wire).not.toContain('"estimatedCost":"')
  })
  it.each(['0', '0.00', '-0', '-1', '+1', '1e2', '1E-2', '.01', '1.', ' 1', '1 ', 'NaN', 'Infinity', '0.001', '1.000', '1.00000000000000001', '1000000000.01', '999999999.999', '0'.repeat(33) + '1', '', null, 1, 0.1, NaN, Infinity])('rejects invalid draft amount %j before serialization', estimatedCost => {
    const business = travelFixture({ estimatedCost })
    expect(travelErrors(business)).toContain('estimatedCost')
    expect(travelTotal(business)).toBeNull()
    expect(() => serializeTravelPayload({ business, processVersion: 1 })).toThrow('Invalid travel document')
  })
  it('requires a known currency and whole yen without rounding', () => {
    for (const estimatedCost of ['0.01', '1.01', '999999999.99']) {
      const business = travelFixture({ estimatedCost, currency: 'JPY' })
      expect(travelErrors(business)).toContain('estimatedCost')
      expect(travelTotal(business)).toBeNull()
    }
    expect(travelErrors(travelFixture({ currency: 'XXX' }))).toEqual(['estimatedCost', 'currency'])
    expect(travelTotal(null)).toBeNull()
    expect(travelTotal({})).toBeNull()
  })
  it.each([
    ['1', 'CNY', '1.00'], ['0.01', 'CNY', '0.01'], ['1e-2', 'CNY', '0.01'],
    ['1E3', 'USD', '1000.00'], ['999999999.99', 'CNY', '999999999.99'],
    ['1000000000.00', 'CNY', '1000000000.00'], ['1.00', 'JPY', '1'], ['100E-2', 'JPY', '1'],
  ])('validates exact numeric response lexeme %s without losing precision', (token, currency, expected) => {
    const wire = serializeTravelPayload({ business: travelFixture({ estimatedCost: '1.00', currency }), processVersion: 1 })
    const parsed = parseScenarioJson(wire.replace(/"estimatedCost":\d+(?:\.\d+)?/, `"estimatedCost":${token}`))
    expect(parsed.business.estimatedCost).toBe(expected)
    expect(validateTravelBusiness(parsed.business)).toBe(parsed.business)
  })
  it.each(['0', '-1', '1.001', '1.000', '0.10000000000000001', '1000000000.0000000001', '1000000000.01', '1e100000', '1e-100000', '"1.00"', 'true', 'null', '[]', '{}'])('rejects invalid numeric response lexeme %s before JavaScript rounding', token => {
    const wire = serializeTravelPayload({ business: travelFixture({ estimatedCost: '1.00' }), processVersion: 1 })
    expect(() => validateTravelBusiness(parseScenarioJson(wire.replace('"estimatedCost":1.00', `"estimatedCost":${token}`)).business)).toThrow(InvalidScenarioPayload)
  })
  it('rejects duplicate estimated-cost keys in wire JSON', () => {
    const wire = serializeTravelPayload({ business: travelFixture(), processVersion: 1 })
    expect(() => parseScenarioJson(wire.replace('"estimatedCost":1234.50', '"estimatedCost":1234.50,"estimatedCost":1'))).toThrow(InvalidScenarioPayload)
  })
})

describe('strict travel business contract', () => {
  it('starts an independent blank draft with exactly the registered fields', () => {
    const first = emptyTravel(), second = emptyTravel()
    expect(TEMPLATE_ID).toBe('oa-travel')
    expect(first).toEqual({ type: 'travel', documentVersion: 1, businessId: '', title: '', reason: '', destination: '', startDate: '', endDate: '', purpose: 'CUSTOMER_VISIT', estimatedCost: '', currency: 'CNY', costCenter: 'ENGINEERING' })
    expect(first).not.toBe(second)
    first.destination = 'Shanghai'; expect(second.destination).toBe('')
    expect(Object.isFrozen(TRAVEL_PURPOSES)).toBe(true)
  })
  it('requires every exact business key and rejects derived and foreign fields', () => {
    const original = travelFixture()
    expect(travelErrors(original)).toEqual([])
    for (const key of Object.keys(original)) {
      const business = { ...original }; delete business[key]
      expect(travelErrors(business)).toEqual(['fields'])
      expect(() => validateTravelBusiness(business)).toThrow(InvalidScenarioPayload)
    }
    for (const [key, value] of [['durationDays', 3], ['days', 3], ['total', '1234.50'], ['lines', []], ['approved', true], ['constructor', 'unsafe'], ['__proto__', {}]]) {
      const business = { ...original, [key]: value }
      expect(travelErrors(business)).toEqual(['fields'])
      expect(() => normalizeTravel(business)).toThrow('Invalid travel document')
    }
    for (const value of [null, [], 'travel', 1, Object.create(original)]) expect(travelErrors(value)).toEqual(['fields'])
  })
  it.each([
    ['type', 'expense', 'type'], ['documentVersion', 2, 'type'], ['documentVersion', '1', 'type'],
    ['businessId', '', 'businessId'], ['businessId', 'bad id', 'businessId'], ['businessId', '中文', 'businessId'], ['businessId', '_first', 'businessId'], ['businessId', 'a'.repeat(129), 'businessId'],
    ['title', ' ', 'title'], ['title', 'x'.repeat(121), 'title'], ['reason', '', 'reason'], ['reason', 'x'.repeat(2001), 'reason'],
    ['destination', ' ', 'destination'], ['destination', '\u0000\u001f', 'destination'], ['destination', 'x'.repeat(161), 'destination'], ['destination', null, 'destination'],
    ['purpose', 'TRAVEL', 'purpose'], ['purpose', 'customer_visit', 'purpose'], ['purpose', null, 'purpose'], ['costCenter', 'LEGAL', 'costCenter'],
  ])('locates invalid %s %j', (key, value, error) => expect(travelErrors(travelFixture({ [key]: value }))).toContain(error))
  it('accepts only supported purposes, currencies, and cost centers', () => {
    expect(TRAVEL_PURPOSES).toEqual(['CUSTOMER_VISIT', 'PROJECT_DELIVERY', 'TRAINING', 'CONFERENCE', 'OTHER'])
    for (const purpose of TRAVEL_PURPOSES) expect(travelErrors(travelFixture({ purpose }))).toEqual([])
    for (const currency of CURRENCIES) expect(travelErrors(travelFixture({ currency, estimatedCost: '1.00' }))).toEqual([])
    for (const costCenter of COST_CENTERS) expect(travelErrors(travelFixture({ costCenter }))).toEqual([])
  })
  it('shares reference and text boundaries with Expense', () => {
    const business = travelFixture({ businessId: 'a'.repeat(128), title: 't'.repeat(120), reason: 'r'.repeat(2000), destination: 'd'.repeat(160) })
    expect(travelErrors(business)).toEqual([])
    for (const key of ['businessId', 'title', 'reason']) {
      for (const value of ['', ' ', '\u0000', '\u00a0', ' \tText\n', '<script>', null, 1]) {
        expect(travelErrors(travelFixture({ [key]: value })).includes(key)).toBe(expenseErrors(expenseFixture({ [key]: value })).includes(key))
      }
    }
  })
  it('normalizes a fresh immutable snapshot without changing input or introducing derived fields', () => {
    const business = travelFixture({ title: ' \tClient visit\n', reason: '\r Reason \t', destination: ' \tShanghai\n', estimatedCost: '0001234.5' })
    const normalized = normalizeTravel(business)
    expect(normalized).toMatchObject({ title: 'Client visit', reason: 'Reason', destination: 'Shanghai', estimatedCost: '1234.50' })
    expect(normalized.title).toBe(normalizeExpense(expenseFixture({ title: business.title })).title)
    expect(Object.isFrozen(normalized)).toBe(true)
    expect(normalized).not.toBe(business)
    expect(Object.keys(normalized).sort()).toEqual(Object.keys(business).sort())
    expect(business.estimatedCost).toBe('0001234.5'); expect(business.destination).toBe(' \tShanghai\n')
    expect(() => normalizeTravel({ ...business, durationDays: 3 })).toThrow('Invalid travel document')
  })
  it('requires response business snapshots to already be canonical', () => {
    const canonical = normalizeTravel(travelFixture())
    expect(validateTravelBusiness(canonical)).toBe(canonical)
    for (const changes of [{ title: ' Client visit ' }, { reason: ' Reason ' }, { destination: ' Shanghai ' }, { estimatedCost: '1234.5' }, { estimatedCost: 1234.5 }, { estimatedCost: '01.00' }, { currency: 'JPY', estimatedCost: '1.00' }, { durationDays: 3 }]) {
      expect(() => validateTravelBusiness({ ...canonical, ...changes })).toThrow(InvalidScenarioPayload)
    }
    expect(() => validateTravelBusiness(null)).toThrow(InvalidScenarioPayload)
    expect(validateTravelBusiness(normalizeTravel(travelFixture({ currency: 'JPY', estimatedCost: '1.00' }))).estimatedCost).toBe('1')
  })
  it('emits safe numeric money JSON and pins a valid process version', () => {
    const business = travelFixture({ title: 'Quoted "title"', reason: 'Line one\nLine two', destination: 'Text \\ and "quoted"', estimatedCost: '999999999.99' })
    const wire = serializeTravelPayload({ business, processVersion: 2147483647 })
    expect(wire).toContain('"estimatedCost":999999999.99')
    expect(JSON.parse(wire)).toEqual({ business: { ...business, estimatedCost: 999999999.99 }, processVersion: 2147483647 })
    expect(wire).not.toContain('durationDays')
    for (const processVersion of [0, -1, 1.5, '1', 2147483648, NaN, Infinity, null]) expect(() => serializeTravelPayload({ business, processVersion })).toThrow('Invalid process version')
    expect(JSON.parse(serializeTravelPayload({ business, processVersion: 1 })).processVersion).toBe(1)
  })
})
