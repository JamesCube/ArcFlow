import { describe, expect, it } from 'vitest'
import { routingActualValueLabel } from './routing-copy.js'

describe('display-only routing actual values', () => {
  it.each([
    ['receiving.hasRejectedLines', 'true', 'Has lines with rejected goods', '有不合格明细'],
    ['receiving.hasRejectedLines', 'false', 'No lines with rejected goods', '无不合格明细'],
    ['contract.termsKind', 'STANDARD', 'Standard terms', '标准条款'],
    ['contract.termsKind', 'NONSTANDARD', 'Nonstandard terms', '非标准条款'],
  ])('localizes %s %s in English and Chinese without changing the canonical fact', (field, actualValue, en, zh) => {
    const fact = Object.freeze({ field, actualValue, result: true })
    expect(routingActualValueLabel(fact.field, fact.actualValue, 'en')).toBe(en)
    expect(routingActualValueLabel(fact.field, fact.actualValue, 'zh')).toBe(zh)
    expect(fact.actualValue).toBe(actualValue)
  })
  it.each(['CNY 6500', 'USD 10000.01', 'JPY 0', 'EUR 20000000000', 'GBP 0.1'])('preserves the exact money fact %s in both languages', actualValue => {
    for (const locale of ['en', 'zh']) expect(routingActualValueLabel('payment.netTotal', actualValue, locale)).toBe(actualValue)
  })
  it.each([
    ['future.field', 'STANDARD'], ['future.field', 'false'],
    ['contract.termsKind', 'UNKNOWN'], ['contract.termsKind', 'standard'],
    ['receiving.hasRejectedLines', 'TRUE'], ['receiving.hasRejectedLines', '0'],
    ['constructor', 'STANDARD'], ['contract.termsKind', 'constructor'],
    ['__proto__', 'true'], ['contract.termsKind', '__proto__'],
  ])('preserves an unknown field/value pair %s %s without guessing its meaning', (field, value) => {
    for (const locale of ['en', 'zh']) expect(routingActualValueLabel(field, value, locale)).toBe(value)
  })
  it.each([null, undefined, false, 0, {}, ['STANDARD']])('uses a neutral fallback for noncanonical value %j', value => {
    expect(routingActualValueLabel('contract.termsKind', value, 'zh')).toBe('—')
  })
})
