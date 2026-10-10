import { describe, it, expect } from 'vitest'
import { businessFor, comments, processNames } from '../../e2e/conditional-fixtures.mjs'
import { getScenarioHandler } from './scenario-registry.js'
import { captureContract, captureNames } from '../../scripts/routing-capture-contract.mjs'

describe('conditional browser evidence business fixtures', () => {
  for (const locale of ['en', 'zh']) for (const [prefix, id, variants] of [
    ['payment', 'erp-payment', ['old', 'low', 'high']],
    ['receiving', 'erp-receiving', ['exception', 'rejected', 'clean']],
    ['contract', 'crm-contract', ['nonstandard', 'standard']],
  ]) for (const variant of variants) it(`${prefix} ${variant} ${locale} obeys the unchanged domain form contract`, () => {
    const value = businessFor(prefix, locale, variant, 'abcd1234'), handler = getScenarioHandler(id)
    expect(handler.errors(value)).toEqual([])
    expect(() => handler.serialize({ business: value, processVersion: 1 })).not.toThrow()
    expect(value.title).not.toContain('abcd1234')
    expect(JSON.stringify(value)).not.toMatch(/Synthetic|合成|fixture|testing|2099/)
    if (locale === 'zh') expect(value.title).toMatch(/[\u4e00-\u9fff]/)
    else expect(value.title).not.toMatch(/[\u4e00-\u9fff]/)
  })
  it('isolates business references without random title suffixes', () => {
    const first = businessFor('payment', 'en', 'high', '11111111'), second = businessFor('payment', 'en', 'high', '22222222')
    expect(first.title).toBe(second.title); expect(first.businessId).not.toBe(second.businessId)
  })
  it('requires twenty distinct states with matching bilingual desktop and narrow captures', () => {
    expect(Object.values(captureContract).map(value => Object.keys(value).length)).toEqual([7, 8, 5])
    expect(captureNames).toHaveLength(80); expect(new Set(captureNames).size).toBe(80)
    for (const names of Object.values(processNames)) for (const locale of ['en', 'zh']) expect(names[locale]).toHaveLength(3)
    for (const value of Object.values(comments)) for (const locale of ['en', 'zh']) expect(value[locale]).not.toMatch(/Synthetic|合成|fixture|testing/)
  })
})
