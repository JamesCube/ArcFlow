import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import GraphInspector from './GraphInspector.vue'
import { definition, directory } from './fixtures.test-support.js'
import { insertOnEdge, validateClientGraph } from './model.js'
const mountCondition = (id, field) => {
  const graph = insertOnEdge({ ...definition(), id, schemaVersion: id === 'payment-graph' ? 5 : 6 }, 'finish', 'exclusiveGateway', directory)
  const edge = graph.edges.find(value => value.condition)
  if (field) edge.condition.predicates = [{ field, operator: 'GTE', threshold: 20 }]
  return mount(GraphInspector, { props: { definition: graph, selection: { kind: 'edge', id: edge.id }, people: directory, locale: 'en', editable: true, busy: false } })
}
const input = (wrapper, id) => wrapper.get(`[data-testid="${id}"]`)
const changed = wrapper => wrapper.emitted('change').at(-1)[0]
describe('family-typed graph property controls', () => {
  it('edits receiving boolean values without monetary controls or arbitrary fields', async () => {
    const wrapper = mountCondition('receiving-graph')
    expect(input(wrapper, 'graph-field-0').findAll('option').map(option => option.attributes('value'))).toEqual(['receiving.hasRejectedLines'])
    expect(wrapper.find('[data-testid="graph-threshold-0"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="graph-condition-currency-0"]').exists()).toBe(false)
    await input(wrapper, 'graph-expected-0').setValue('false')
    const next = changed(wrapper)
    expect(next.edges.find(edge => edge.condition).condition.predicates[0]).toEqual({ field: 'receiving.hasRejectedLines', operator: 'EQ', expected: false })
    expect(validateClientGraph(next)).toEqual([])
    await wrapper.setProps({ locale: 'zh', definition: next })
    expect(wrapper.text()).toContain('含不合格收货行')
    wrapper.unmount()
  })
  it('switches quote percent to exact money with only the appropriate typed keys', async () => {
    const wrapper = mountCondition('quote-graph', 'quote.discountPercent')
    expect(input(wrapper, 'graph-field-0').findAll('option').map(option => option.attributes('value'))).toEqual(['quote.reductionTotal', 'quote.discountPercent'])
    expect(wrapper.find('[data-testid="graph-condition-currency-0"]').exists()).toBe(false)
    await input(wrapper, 'graph-threshold-0').setValue('20.000000000000001')
    let next = changed(wrapper); await wrapper.setProps({ definition: next })
    expect(input(wrapper, 'graph-threshold-0').attributes('aria-invalid')).toBe('true')
    expect(validateClientGraph(next).some(diagnostic => diagnostic.code === 'INVALID_PREDICATE')).toBe(true)
    await input(wrapper, 'graph-field-0').setValue('quote.reductionTotal')
    next = changed(wrapper); await wrapper.setProps({ definition: next })
    expect(next.edges.find(edge => edge.condition).condition.predicates[0]).toEqual({ field: 'quote.reductionTotal', operator: 'GTE', currency: 'CNY', threshold: 10000 })
    await input(wrapper, 'graph-threshold-0').setValue('1999.99')
    next = changed(wrapper); expect(validateClientGraph(next)).toEqual([])
    expect(next.edges.find(edge => edge.condition).condition.predicates[0].threshold).toBe(1999.99)
    wrapper.unmount()
  })
  it('uses the authoritative server currency/operator choices in the inspector', () => {
    const wrapper = mountCondition('travel-graph')
    const facts = [{ field: 'travel.estimatedCost', type: 'money', currencies: ['CNY'], operators: ['EQ', 'GT', 'GTE', 'LT', 'LTE'] }]
    return wrapper.setProps({ facts }).then(() => {
      expect(input(wrapper, 'graph-condition-currency-0').findAll('option').map(option => option.text())).toEqual(['CNY'])
      expect(input(wrapper, 'graph-field-0').text()).toContain('Estimated travel cost')
      wrapper.unmount()
    })
  })
})
