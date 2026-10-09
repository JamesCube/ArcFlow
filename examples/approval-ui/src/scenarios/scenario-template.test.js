import { describe, expect, it } from 'vitest'
import { validateScenarioCatalog } from './scenario-template.js'
import { InvalidScenarioPayload } from './expense-document.js'
import { catalogFixture } from './scenario-fixtures.js'

describe('allow-listed bilingual scenario metadata', () => {
  it('accepts the four supported typed templates without rewriting it', () => {
    const catalog = catalogFixture(); expect(validateScenarioCatalog(catalog)).toBe(catalog)
  })
  it.each([null, {}, [], [{ id: 'other' }]])('rejects unsupported catalog %j', value => expect(() => validateScenarioCatalog(value)).toThrow(InvalidScenarioPayload))
  const mutations = [
    catalog => catalog.push(catalog[0]),
    catalog => { catalog[0].id = 'crm-expense' },
    catalog => { catalog[0].domain = 'CRM' },
    catalog => { catalog[0].documentVersion = 2 },
    catalog => { catalog[0].formVersion = 2 },
    catalog => { catalog[0].action = 'https://evil.test' },
    catalog => { catalog[0].title = { en: 'English only' } },
    catalog => { catalog[0].description.zh = '' },
    catalog => { catalog[0].sections[0].fields[0].path = '__proto__' },
    catalog => { catalog[0].sections[0].fields[0].kind = 'html' },
    catalog => { catalog[0].sections[0].fields[0].required = false },
    catalog => { catalog[0].sections[0].fields[0].maxLength = -1 },
    catalog => { catalog[0].sections[0].fields[0].script = 'alert(1)' },
    catalog => { catalog[0].sections[0].fields.pop() },
    catalog => { catalog[0].sections[0].fields[1] = catalog[0].sections[0].fields[0] },
    catalog => { catalog[0].sections.push(catalog[0].sections[0]) },
    catalog => { catalog[0].sections[0].id = 'Bad id' },
    catalog => { catalog[0].sections[0].fields[4].options[0].value = 'BTC' },
    catalog => { catalog[0].sections[0].fields[4].options[1] = catalog[0].sections[0].fields[4].options[0] },
    catalog => { catalog[0].sections[0].fields[4].options.pop() },
    catalog => { catalog[0].sections[0].fields[0].options = [{ value: 'x', label: { en: 'x', zh: 'x' } }] },
    catalog => { catalog[0].lineItems.maxItems = 21 },
    catalog => { catalog[0].lineItems.minItems = 0 },
    catalog => { catalog[0].lineItems.path = 'arbitrary' },
    catalog => { catalog[0].lineItems.fields[0].path = 'lineId' },
    catalog => { catalog[0].lineItems.fields[3].kind = 'number' },
  ]
  it.each(mutations.map((change, index) => [index, change]))('rejects unsafe, incomplete or incompatible metadata case %i', (_, change) => {
    const catalog = catalogFixture(); change(catalog)
    expect(() => validateScenarioCatalog(catalog)).toThrow(InvalidScenarioPayload)
  })
})
