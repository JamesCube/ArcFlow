import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import GraphRuntime from './GraphRuntime.vue'
import GraphSequence from './GraphSequence.vue'
import { formatRoutingFact, formatPredicateSummary, formatConditionResult } from './fact-display.js'
import { expectedRoutes } from './business.js'
import { insertOnEdge, graphSequence } from './model.js'
import { directory, instance } from './fixtures.test-support.js'

const fact = actualValue => ({ field: 'quote.discountPercent', actualValue, result: true })
describe('business-readable routing percentages', () => {
  it.each(['en', 'zh'])('renders exact percentages and boundary values without approximation in %s', locale => {
    for (const [evidence, display] of [['20000/1000%', '20%'], ['19999/1000%', '19.999%'], ['1/8%', '0.125%'], ['0/1000%', '0%'], ['100000/1000%', '100%'], ['2.5/0.125%', '20%']]) {
      expect(formatRoutingFact(fact(evidence), locale)).toBe(display)
    }
  })
  it.each([['en', 'Approx.'], ['zh', '约']])('explicitly marks display rounding in %s without floating-point arithmetic', (locale, marker) => {
    expect(formatRoutingFact(fact('100/3%'), locale)).toBe(`${marker} 33.3333%`)
    expect(formatRoutingFact(fact('200/3%'), locale)).toBe(`${marker} 66.6667%`)
    expect(formatRoutingFact(fact('1/128%'), locale)).toBe(`${marker} 0.0078%`)
  })
  it.each([['en', 'Less than 0.0001%', 'More than 99.9999%'], ['zh', '小于 0.0001%', '大于 99.9999%']])('keeps tiny discounts and nearly-full discounts distinct from exact 0/100 in %s', (locale, low, high) => {
    expect(formatRoutingFact(fact('1/1000000000%'), locale)).toBe(low)
    expect(formatRoutingFact(fact('99999999999/1000000000%'), locale)).toBe(high)
  })
  it('does not expose malformed percent evidence as primary text or alter other fact types', () => {
    for (const evidence of ['20%', '1/0%', '-1/10%', '101/1%', 'Infinity/1%', '1e2/5%', '1/2/3%', null]) expect(formatRoutingFact(fact(evidence))).toBe('—')
    expect(formatRoutingFact({ field: 'travel.estimatedCost', actualValue: 'CNY 12500.01' })).toBe('CNY 12500.01')
  })
  it.each([['en', 'Yes', 'No', 'Met', 'Not met'], ['zh', '是', '否', '满足', '未满足']])('localizes boolean facts and condition results in %s', (locale, yes, no, met, notMet) => {
    expect(formatRoutingFact({ field: 'receiving.hasRejectedLines', actualValue: 'true' }, locale)).toBe(yes)
    expect(formatRoutingFact({ field: 'receiving.hasRejectedLines', actualValue: 'false' }, locale)).toBe(no)
    expect(formatRoutingFact({ field: 'receiving.hasRejectedLines', actualValue: 'unknown' }, locale)).toBe('—')
    expect(formatConditionResult(true, locale)).toBe(met)
    expect(formatConditionResult(false, locale)).toBe(notMet)
  })
  it.each([['en', ['equals', 'greater than', 'at least', 'less than', 'at most']], ['zh', ['等于', '大于', '不低于', '小于', '不高于']]])('uses readable comparisons without changing operator codes in %s', (locale, labels) => {
    for (const [index, operator] of ['EQ', 'GT', 'GTE', 'LT', 'LTE'].entries()) {
      const predicate = { field: 'quote.discountPercent', operator, threshold: 20 }, frozen = JSON.stringify(predicate)
      expect(formatPredicateSummary(predicate, locale)).toContain(`${labels[index]} 20%`)
      expect(formatPredicateSummary(predicate, locale)).not.toContain(operator)
      expect(JSON.stringify(predicate)).toBe(frozen)
    }
  })
  it.each([['en', 'Has rejected receiving lines: Yes'], ['zh', '含不合格收货行：是']])('renders localized boolean branches in %s', (locale, expected) => {
    const graph = insertOnEdge({ ...instance().definition, id: 'receiving-graph', schemaVersion: 6 }, 'finish', 'exclusiveGateway', directory)
    const edge = graph.edges.find(value => value.condition), wrapper = mount(GraphSequence, { props: { items: graphSequence(graph), locale, people: directory } })
    expect(wrapper.get(`[data-testid="graph-branch-${edge.id}"]`).text()).toContain(expected)
    expect(wrapper.get(`[data-testid="graph-branch-${edge.id}"]`).text()).not.toContain('EQ')
    wrapper.unmount()
  })
  it('renders readable EN/ZH primary facts while retaining unchanged exact evidence in the frozen snapshot', async () => {
    const value = instance()
    value.business = { type: 'quoteDiscount', businessId: 'Q-1', title: 'Quote review', reason: 'Volume order', customerRef: 'C-1', quoteRevision: 1, item: 'Equipment', quantity: 10, listUnitPrice: '3.00', requestedUnitPrice: '2.00', currency: 'CNY', validUntil: '2099-12-31' }
    value.definition = insertOnEdge({ ...value.definition, id: 'quote-graph', schemaVersion: 6 }, 'finish', 'exclusiveGateway', directory)
    const conditionalEdge = value.definition.edges.find(edge => edge.condition)
    conditionalEdge.condition.predicates = [{ field: 'quote.discountPercent', operator: 'GTE', threshold: 33.34 }]
    value.routes = expectedRoutes(value.definition, value.business)
    const frozen = JSON.stringify(value), wrapper = mount(GraphRuntime, { props: { instance: value, locale: 'en', people: directory, actor: directory[0] } })
    const primary = () => wrapper.get('[data-testid="graph-server-fact"]')
    expect(primary().text()).toContain('Quote discount percentage · Actual value: Approx. 33.3333%')
    expect(primary().text()).not.toContain('100/3%')
    expect(wrapper.get('.gf-route-status').text()).toContain('Condition result: Not met')
    expect(wrapper.get('.gf-route-status').text()).toContain('Condition result: Met')
    expect(wrapper.get(`[data-testid="graph-branch-${conditionalEdge.id}"]`).text()).toContain('Quote discount percentage at least 33.34%')
    expect(wrapper.get('.gf-json').text()).toContain('100/3%')
    expect(value.routes[0].evaluations[0].facts[0].result).toBe(false)
    await wrapper.setProps({ locale: 'zh' })
    expect(primary().text()).toContain('报价折扣百分比 · 实际值: 约 33.3333%')
    expect(wrapper.get('.gf-route-status').text()).toContain('条件结果: 未满足')
    expect(wrapper.get('.gf-route-status').text()).toContain('条件结果: 满足')
    expect(wrapper.get(`[data-testid="graph-branch-${conditionalEdge.id}"]`).text()).toContain('报价折扣百分比 不低于 33.34%')
    expect(JSON.stringify(value)).toBe(frozen)
    wrapper.unmount()
  })
})
