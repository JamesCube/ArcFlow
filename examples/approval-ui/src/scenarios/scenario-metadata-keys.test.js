import { describe, expect, it } from 'vitest'
import { validateScenarioCatalog } from './scenario-template.js'
import { getScenarioHandler } from './scenario-registry.js'
import { catalogFixture } from './scenario-fixtures.js'
describe('metadata path identity cannot use property-key coercion', () => {
  it.each(['root', 'line'])('rejects array-valued %s paths', scope => {
    const catalog = catalogFixture(), fields = scope === 'root' ? catalog[0].sections[0].fields : catalog[0].lineItems.fields
    fields[0].path = [fields[0].path]
    expect(() => validateScenarioCatalog(catalog)).toThrow()
  })
  it('rejects repeated coercive paths that would replace mandatory fields with title inputs', () => {
    const catalog = catalogFixture(), sample = catalog[0].sections[0].fields.find(field => field.path === 'title')
    catalog[0].sections[0].fields = Array.from({ length: 5 }, () => ({ ...sample, path: ['title'] }))
    catalog[0].sections = [catalog[0].sections[0]]
    expect(() => validateScenarioCatalog(catalog)).toThrow()
  })
  it.each([['oa-expense'], null, {}, 1])('rejects coerced template IDs %j', id => {
    const catalog = catalogFixture(); catalog[0].id = id
    expect(() => validateScenarioCatalog(catalog)).toThrow(); expect(() => getScenarioHandler(id)).toThrow()
  })
  it('never obtains metadata paths through the object prototype', () => {
    const catalog = catalogFixture(); catalog[0].lineItems.fields[0].path = '__proto__'
    expect(() => validateScenarioCatalog(catalog)).toThrow()
  })
})
