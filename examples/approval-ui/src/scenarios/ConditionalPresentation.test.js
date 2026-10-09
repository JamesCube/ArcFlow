import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ScenarioDetail from './ScenarioDetail.vue'
import RouteSteps from './RouteSteps.vue'
import { evaluateRouting } from '../routing.js'
import { paymentFixture, paymentViewFixture, paymentTemplateFixture, complexProcessFixture, people } from './scenario-fixtures.js'
const definition = () => { const value = complexProcessFixture(); value.schemaVersion = 4; value.nodes[1].runIf = { mode: 'ALL', predicates: [{ field: 'payment.netTotal', operator: 'GTE', currency: 'CNY', threshold: 10000 }] }; return value }
describe('conditional route presentation', () => {
  it('labels excluded stages honestly and derives progress from the frozen selected path', () => {
    const view = paymentViewFixture(), process = definition()
    Object.assign(view.request, { definition: process, routing: evaluateRouting(process, view.request.business), currentStepId: 'payment-final' })
    const wrapper = mount(ScenarioDetail, { props: { view, template: paymentTemplateFixture(), people, locale: 'en' } })
    expect(wrapper.get('[data-testid=routing-progress]').text()).toContain('Selected route, stages decided: 0 / 1.')
    const excluded = wrapper.get('.sf-snapshot-flow > li.conditional-skipped')
    expect(excluded.text()).toContain('Condition not met'); expect(excluded.text()).toContain('Actual value: CNY 6500')
    expect(excluded.text()).not.toContain('Approved'); expect(excluded.text()).not.toContain('Awaiting vote')
    expect(wrapper.get('[data-routing-evaluation=payment-check]').text()).toContain('≥ CNY 10000')
    wrapper.unmount()
  })
  it('shows translated frozen facts for Chinese users', () => {
    const view = paymentViewFixture(), process = definition()
    Object.assign(view.request, { definition: process, routing: evaluateRouting(process, view.request.business), currentStepId: 'payment-final' })
    const wrapper = mount(ScenarioDetail, { props: { view, template: paymentTemplateFixture(), people, locale: 'zh' } })
    expect(wrapper.text()).toContain('条件未满足，未纳入'); expect(wrapper.text()).toContain('实际值: CNY 6500'); wrapper.unmount()
  })
  it('describes a single completed selected stage without a plural grammar error', () => {
    const view = paymentViewFixture(), process = definition()
    Object.assign(view.request, { definition: process, routing: evaluateRouting(process, view.request.business), currentStepId: null, status: 'APPROVED', history: [...view.request.history, { actorId: 'bob', action: 'APPROVE', stepId: 'payment-final', comment: '', at: view.request.updatedAt }] })
    const wrapper = mount(ScenarioDetail, { props: { view, template: paymentTemplateFixture(), people, locale: 'en' } })
    expect(wrapper.get('[data-testid=routing-progress]').text()).toContain('Selected route, stages decided: 1 / 1.')
    wrapper.unmount()
  })
  it('previews the selected route, and blocks a currency-mismatch preview without pretending it skipped', async () => {
    const wrapper = mount(RouteSteps, { props: { definition: definition(), business: paymentFixture(), people, locale: 'en' } })
    expect(wrapper.text()).toContain('1 approval stage included'); expect(wrapper.find('.conditional-skipped').exists()).toBe(true)
    await wrapper.setProps({ business: paymentFixture({ currency: 'USD' }) })
    expect(wrapper.text()).toContain('currency does not match'); expect(wrapper.find('.conditional-skipped').exists()).toBe(false)
    expect(wrapper.text()).toContain('Condition preview pending'); wrapper.unmount()
  })
})

describe('localized saved routing facts', () => {
  const cases = [
    ['receiving.hasRejectedLines', 'true', { operator: 'EQ', expected: true }, 'Has lines with rejected goods', '有不合格明细'],
    ['receiving.hasRejectedLines', 'false', { operator: 'EQ', expected: true }, 'No lines with rejected goods', '无不合格明细'],
    ['contract.termsKind', 'STANDARD', { operator: 'EQ', values: ['NONSTANDARD'] }, 'Standard terms', '标准条款'],
    ['contract.termsKind', 'NONSTANDARD', { operator: 'EQ', values: ['NONSTANDARD'] }, 'Nonstandard terms', '非标准条款'],
  ]
  it.each(cases)('renders %s %s naturally across a language switch while retaining canonical data', async (field, actualValue, predicate, en, zh) => {
    const { default: RoutingExplanation } = await import('./RoutingExplanation.vue')
    const node = { id: 'review', runIf: { mode: 'ALL', predicates: [{ field, ...predicate }] } }
    const routing = { evaluations: [{ stepId: 'review', result: true, predicates: [{ field, actualValue, result: true }] }] }
    const original = JSON.stringify(routing)
    const wrapper = mount(RoutingExplanation, { props: { node, routing, locale: 'en' } })
    expect(wrapper.get('.routing-fact').text()).toBe(`Actual value: ${en} · Matched`)
    await wrapper.setProps({ locale: 'zh' })
    expect(wrapper.get('.routing-fact').text()).toBe(`实际值: ${zh} · 满足`)
    expect(JSON.stringify(routing)).toBe(original)
    wrapper.unmount()
  })
  it('renders unknown actual-value strings as escaped text rather than markup', async () => {
    const { default: RoutingExplanation } = await import('./RoutingExplanation.vue')
    const actualValue = '<img src=x onerror=alert(1)>', node = { id: 'review', runIf: { mode: 'ALL', predicates: [{ field: 'receiving.hasRejectedLines', operator: 'EQ', expected: true }] } }
    const routing = { evaluations: [{ stepId: 'review', result: false, predicates: [{ field: 'future.field', actualValue, result: false }] }] }
    const wrapper = mount(RoutingExplanation, { props: { node, routing, locale: 'zh' } })
    expect(wrapper.get('.routing-fact').text()).toContain(actualValue)
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('.routing-fact').html()).toContain('&lt;img')
    wrapper.unmount()
  })
})
