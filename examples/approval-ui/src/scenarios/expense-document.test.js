import { describe, expect, it } from 'vitest'
import { amountCents, decimal, expenseErrors, expenseTotal, formatExpenseMoney, normalizeExpense, serializeExpensePayload, validDate, reference, emptyExpense, emptyLine } from './expense-document.js'
import { expenseFixture } from './scenario-fixtures.js'

describe('exact expense money', () => {
  it.each([['0.01', 1n], ['0.10', 10n], ['1', 100n], ['0001.2', 120n], ['1000000000', 100000000000n]])('reads %s without binary floating-point arithmetic', (value, cents) => expect(amountCents(value, 'CNY')).toBe(cents))
  it.each(['0', '-1', '+1', '1e2', '.10', '1.', ' 1', '1 ', 'NaN', 'Infinity', '0.001', '1.00000000000000001', '1000000000.01', '', null, 1])('rejects invalid amount %j', value => expect(amountCents(value, 'CNY')).toBeNull())
  it('requires whole yen, known currencies, and positive amounts', () => {
    expect(amountCents('1.00', 'JPY')).toBe(100n)
    expect(amountCents('1.01', 'JPY')).toBeNull()
    expect(amountCents('1', 'XYZ')).toBeNull()
    expect(decimal(150n, 'CNY')).toBe('1.50')
    expect(decimal(200n, 'JPY')).toBe('2')
  })
  it('sums at full precision, including twenty maximum-value lines', () => {
    const business = expenseFixture()
    business.lines[0].amount = '0.10'; business.lines[1].amount = '0.20'
    expect(expenseTotal(business)).toBe('0.30')
    business.lines = Array.from({ length: 20 }, (_, i) => ({ ...business.lines[0], lineId: `line-${i}`, receiptRef: `receipt-${i}`, amount: '1000000000.00' }))
    expect(expenseTotal(business)).toBe('20000000000.00')
    expect(formatExpenseMoney(expenseTotal(business), 'CNY')).toBe('CNY 20,000,000,000.00')
    business.lines[0].amount = '1.001'; expect(expenseTotal(business)).toBeNull()
    expect(expenseTotal({ ...business, lines: [] })).toBeNull()
  })
  it('formats canonical amounts and fails closed on malformed values', () => {
    expect(formatExpenseMoney('0001234.5', 'USD')).toBe('USD 1,234.50')
    expect(formatExpenseMoney('1234.00', 'JPY')).toBe('JPY 1,234')
    for (const [value, currency] of [['1.01', 'JPY'], ['1', 'XXX'], [1, 'CNY'], ['<script>', 'CNY']]) expect(formatExpenseMoney(value, currency)).toBe('—')
  })
})

describe('expense form contract', () => {
  it('accepts leap days and rejects impossible dates and zero years', () => {
    for (const date of ['2024-02-29', '2000-02-29', '2026-12-31']) expect(validDate(date)).toBe(true)
    for (const date of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-00-01', '0000-01-01', '2026-2-01', '2026-10-07T00:00:00Z', null]) expect(validDate(date)).toBe(false)
  })
  it('uses unique ASCII references bounded at 128 characters', () => {
    expect(reference('a'.repeat(128))).toBe(true)
    for (const value of ['', 'a'.repeat(129), '中文', 'bad id', '_first', 'https://x.test/a?x=1', '\nabc', 123]) expect(reference(value)).toBe(false)
    expect(reference('EXP-1:receipt/2026.pdf')).toBe(true)
    const business = expenseFixture(); business.lines[1].lineId = business.lines[0].lineId; business.lines[1].receiptRef = business.lines[0].receiptRef
    expect(expenseErrors(business)).toEqual(expect.arrayContaining(['lines.1.lineId', 'lines.1.receiptRef']))
  })
  it('rejects unknown and missing root or line fields rather than silently dropping them', () => {
    expect(expenseErrors(expenseFixture())).toEqual([])
    expect(expenseErrors({ ...expenseFixture(), approved: true })).toEqual(['fields'])
    const missing = expenseFixture(); delete missing.reason; expect(expenseErrors(missing)).toEqual(['fields'])
    const line = expenseFixture(); line.lines[0].script = 'unsafe'; expect(expenseErrors(line)).toContain('lines.0.fields')
  })
  it.each([['type', 'leave'], ['documentVersion', 2], ['businessId', 'bad id'], ['title', ' '], ['title', 'x'.repeat(121)], ['reason', ''], ['reason', 'x'.repeat(2001)], ['currency', 'XYZ'], ['costCenter', 'LEGAL'], ['lines', []], ['lines', null]])('rejects invalid root %s', (key, value) => expect(expenseErrors(expenseFixture({ [key]: value })).length).toBeGreaterThan(0))
  it.each([['spentOn', '2026-02-30'], ['category', 'FLIGHT'], ['description', ' '], ['description', 'x'.repeat(241)], ['receiptRef', 'x'.repeat(129)], ['amount', '1.001']])('locates invalid line %s', (key, value) => {
    const business = expenseFixture(); business.lines[0][key] = value
    expect(expenseErrors(business)).toContain(`lines.0.${key}`)
  })
  it('bounds lines at twenty without mutating caller data', () => {
    const business = expenseFixture(); business.lines = Array.from({ length: 21 }, (_, i) => ({ ...business.lines[0], lineId: `line-${i}`, receiptRef: `receipt-${i}` }))
    expect(expenseErrors(business)).toContain('lines')
    business.lines.pop(); expect(expenseErrors(business)).toEqual([])
  })
  it('normalizes server-compatible whitespace and freezes a fresh canonical snapshot', () => {
    const business = expenseFixture(); business.title = ' \tClient visit \n'; business.reason = '\r Reason \t'; business.lines[0].description = ' Train '; business.lines[0].amount = '000123.4'
    const normalized = normalizeExpense(business)
    expect(normalized.title).toBe('Client visit'); expect(normalized.reason).toBe('Reason')
    expect(normalized.lines[0]).toMatchObject({ description: 'Train', amount: '123.40' })
    expect(business.lines[0].amount).toBe('000123.4')
    expect(Object.isFrozen(normalized)).toBe(true); expect(Object.isFrozen(normalized.lines)).toBe(true); expect(Object.isFrozen(normalized.lines[0])).toBe(true)
    expect(() => normalizeExpense({ ...business, title: '' })).toThrow('Invalid expense document')
  })
  it('serializes amounts as numeric JSON tokens, safely escapes other fields, and pins the process version', () => {
    const business = expenseFixture(); business.title = 'Quoted "title"'; business.lines[0].description = 'Text \\ and "quoted"'; business.lines[0].amount = '1000000000.00'
    const wire = serializeExpensePayload({ business, processVersion: 7 })
    expect(wire).toContain('"amount":1000000000.00'); expect(wire).not.toContain('"amount":"')
    expect(JSON.parse(wire)).toMatchObject({ business: { title: business.title, lines: [{ amount: 1000000000 }, { amount: 26.55 }] }, processVersion: 7 })
    for (const processVersion of [0, -1, 1.5, '1', 2147483648, NaN]) expect(() => serializeExpensePayload({ business, processVersion })).toThrow('Invalid process version')
  })
  it('starts blank and generates stable independently assigned line identities', () => {
    let sequence = 0; const id = () => String(++sequence)
    const first = emptyExpense(id), second = emptyLine(id)
    expect(first.businessId).toBe(''); expect(first.lines[0].lineId).toBe('line-1'); expect(second.lineId).toBe('line-2')
    expect(first.lines[0].receiptRef).toBe(''); expect(first.lines[0].amount).toBe('')
  })
})
