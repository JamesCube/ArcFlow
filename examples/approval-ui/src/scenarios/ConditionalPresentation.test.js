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
    expect(wrapper.get('[data-testid=routing-progress]').text()).toContain('0 / 1')
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
  it('previews the selected route, and blocks a currency-mismatch preview without pretending it skipped', async () => {
    const wrapper = mount(RouteSteps, { props: { definition: definition(), business: paymentFixture(), people, locale: 'en' } })
    expect(wrapper.text()).toContain('1 approval stages included'); expect(wrapper.find('.conditional-skipped').exists()).toBe(true)
    await wrapper.setProps({ business: paymentFixture({ currency: 'USD' }) })
    expect(wrapper.text()).toContain('currency does not match'); expect(wrapper.find('.conditional-skipped').exists()).toBe(false)
    expect(wrapper.text()).toContain('Condition preview pending'); wrapper.unmount()
  })
})
