import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import ComplexScenarioForm from './ComplexScenarioForm.vue'
import ScenarioDetail from './ScenarioDetail.vue'
import { getScenarioHandler } from './scenario-registry.js'
import { parseScenarioJson } from './scenario-api.js'
import { validateScenarioCatalog } from './scenario-template.js'
import { catalogFixture, clone, paymentFixture, contractFixture, paymentTemplateFixture, contractTemplateFixture, paymentViewFixture, contractViewFixture, people, decidedFixture } from './scenario-fixtures.js'
enableAutoUnmount(afterEach)
const specs = [ { id: 'erp-payment', prefix: 'payment', form: paymentFixture, template: paymentTemplateFixture, view: paymentViewFixture }, { id: 'crm-contract', prefix: 'contract', form: contractFixture, template: contractTemplateFixture, view: contractViewFixture } ]
function mountForm(spec, locale = 'en') {
  const handler = getScenarioHandler(spec.id), submit = vi.fn()
  const wrapper = mount(defineComponent({ components: { ComplexScenarioForm }, setup() { const draft = ref(spec.form()), attempted = ref(false); return { draft, attempted, handler, template: spec.template(), submit: () => { attempted.value = true; submit() }, locale } }, template: '<ComplexScenarioForm :template="template" :handler="handler" v-model="draft" :errors="handler.errors(draft)" :attempted="attempted" :locale="locale" @submit="submit" />' }), { attachTo: document.body })
  return { wrapper, handler, submit }
}
describe('dedicated payment and contract documents', () => {
  it.each(specs)('$id remains exact through serialized numeric JSON and typed response validation', spec => {
    const handler = getScenarioHandler(spec.id), business = spec.form()
    expect(parseScenarioJson(handler.serialize({ business, processVersion: 1 })).business).toEqual(handler.normalize(business))
    expect(handler.validateView(spec.view())).toEqual(spec.view())
    for (const wrong of [ { ...spec.view(), total: null }, { ...spec.view(), total: '6500' }, { ...spec.view(), summary: {} } ]) expect(() => handler.validateView(wrong)).toThrow()
    const extra = spec.view(); extra.request.business.derivedTotal = '0'; expect(() => handler.validateView(extra)).toThrow()
  })
  it('validates all payment summary fields, exact envelope and zero-valued wire amount fields', () => {
    const handler = getScenarioHandler('erp-payment'), valid = paymentViewFixture()
    for (const key of Object.keys(valid.paymentSummary)) {
      const wrong = clone(valid); wrong.paymentSummary[key] = key === 'type' ? 'expense' : '0.00'; expect(() => handler.validateView(wrong)).toThrow()
      const missing = clone(valid); delete missing.paymentSummary[key]; expect(() => handler.validateView(missing)).toThrow()
    }
    expect(() => handler.validateView({ ...valid, paymentSummary: { ...valid.paymentSummary, extra: 1 } })).toThrow()
    for (const field of ['previouslySettledAmount', 'deductionAmount']) expect(parseScenarioJson(`{"currency":"CNY","${field}":0}`)[field]).toBe('0.00')
    for (const field of ['invoiceAmount', 'allocationAmount', 'contractAmount', 'amount', 'estimatedCost']) expect(() => parseScenarioJson(`{"currency":"CNY","${field}":0}`)).toThrow()
    for (const field of ['invoiceAmount', 'previouslySettledAmount', 'allocationAmount', 'deductionAmount', 'contractAmount']) {
      for (const value of ['"0.10"', 'null', '-1', '0.001', '1000000000.01']) expect(() => parseScenarioJson(`{"currency":"CNY","${field}":${value}}`)).toThrow()
      expect(parseScenarioJson(`{"currency":"CNY","${field}":0.10}`)[field]).toBe('0.10')
    }
  })
  it('rejects a string contract revision in saved responses and metadata drift', () => {
    const wrong = contractViewFixture(); wrong.request.business.contractRevision = '1'; expect(() => getScenarioHandler('crm-contract').validateView(wrong)).toThrow()
    for (const id of ['erp-payment', 'crm-contract']) {
      const catalog = catalogFixture(), entry = catalog.find(value => value.id === id)
      entry.lineItems.fields[0].kind = 'money'; expect(() => validateScenarioCatalog(catalog)).toThrow()
      for (const scope of ['root', 'line']) { const changed = catalogFixture(), target = changed.find(value => value.id === id); (scope === 'root' ? target.sections[0].fields[0] : target.lineItems.fields[0]).maxLength = 129; expect(() => validateScenarioCatalog(changed)).toThrow() }
    }
  })
  it.each(specs.flatMap(spec => ['en', 'zh'].map(locale => ({ ...spec, locale }))))('$prefix renders its own fields, exact summary and reversible line editing in $locale', async spec => {
    const { wrapper } = mountForm(spec, spec.locale)
    expect(wrapper.findAll('.xf-line-card')).toHaveLength(spec.form().lines.length)
    expect(wrapper.get(`[data-testid=${spec.prefix}-summary]`).text()).toContain(spec.prefix === 'payment' ? 'CNY 6,500.00' : 'CNY 0.00')
    expect(wrapper.find('[data-testid=expense-total]').exists()).toBe(false)
    const ids = wrapper.vm.draft.lines.map(line => line.lineId)
    await wrapper.get('.xf-line-actions button:nth-child(2)').trigger('click')
    expect(wrapper.vm.draft.lines[0].lineId).toBe(ids[1])
    await wrapper.get('.xf-line-card:nth-of-type(2) .xf-line-actions button').trigger('click')
    expect(wrapper.vm.draft.lines[0].lineId).toBe(ids[0])
    await wrapper.get(`[data-testid=add-${spec.prefix}-line]`).trigger('click'); await flushPromises()
    expect(wrapper.findAll('.xf-line-card')).toHaveLength(ids.length + 1)
    expect(document.activeElement.id).toBe(`${spec.prefix}-lines-${ids.length}-${spec.prefix === 'payment' ? 'invoiceRef' : 'milestoneRef'}`)
    await wrapper.findAll('.xf-remove-line, .sf-remove-line').at(-1).trigger('click')
    expect(wrapper.vm.draft.lines.map(line => line.lineId)).toEqual(ids)
  })
  it('preserves invalid payment text, focuses its field and requires deduction explanations', async () => {
    const { wrapper } = mountForm(specs[0])
    expect(wrapper.get('#payment-lines-0-deductionReason').attributes('aria-required')).toBe('true')
    await wrapper.get('#payment-lines-0-allocationAmount').setValue('6000.01')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.get('#payment-lines-0-allocationAmount').element.value).toBe('6000.01')
    expect(document.activeElement.id).toBe('payment-lines-0-allocationAmount')
    expect(wrapper.get('#payment-lines-0-allocationAmount-error').text()).toContain('minus settled')
    await wrapper.get('#payment-lines-0-allocationAmount').setValue('4500.00'); await wrapper.get('#payment-lines-0-deductionReason').setValue('')
    expect(wrapper.get('#payment-lines-0-deductionReason').attributes('aria-invalid')).toBe('true')
  })
  it('preserves nonstandard text on STANDARD switch and shows a one-cent reconciliation difference', async () => {
    const { wrapper } = mountForm(specs[1])
    const original = wrapper.vm.draft.deviationReason
    expect(wrapper.get('#contract-deviationReason').attributes('aria-required')).toBe('true')
    await wrapper.get('#contract-termsKind').setValue('STANDARD'); await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.vm.draft.deviationReason).toBe(original)
    expect(wrapper.get('#contract-deviationReason').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('[data-testid=contract-terms-note]').text()).toContain('clear it explicitly')
    await wrapper.get('#contract-deviationReason').setValue(''); await wrapper.get('#contract-lines-2-amount').setValue('29999.99')
    expect(wrapper.get('[data-testid=contract-balance]').text()).toBe('CNY 0.01')
    expect(wrapper.get('.xf-total-error').text()).toContain('exactly')
    await wrapper.get('#contract-lines-2-dueOn').setValue('2100-01-01')
    expect(wrapper.get('#contract-lines-2-dueOn').attributes('aria-invalid')).toBe('true')
    await wrapper.get('#contract-contractRevision').setValue('1e2')
    expect(wrapper.get('#contract-contractRevision').element.value).toBe('1e2')
    expect(wrapper.get('#contract-contractRevision').attributes('aria-invalid')).toBe('true')
  })
  it.each(specs)('$prefix enforces 1–20 line limits and locks mutations while busy', async spec => {
    const handler = getScenarioHandler(spec.id), business = spec.form(); business.lines = [business.lines[0]]
    const wrapper = mount(ComplexScenarioForm, { props: { handler, template: spec.template(), modelValue: business, locale: 'en', errors: [], busy: true } })
    expect(wrapper.get('[data-testid=add-' + spec.prefix + '-line]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.sf-remove-line').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid=add-' + spec.prefix + '-line]').trigger('click'); expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await wrapper.setProps({ busy: false }); expect(wrapper.get('.sf-remove-line').attributes('disabled')).toBeDefined()
    await wrapper.setProps({ modelValue: { ...business, lines: Array.from({ length: 20 }, (_, index) => ({ ...business.lines[0], lineId: 'line-' + index })) } })
    expect(wrapper.get('[data-testid=add-' + spec.prefix + '-line]').attributes('disabled')).toBeDefined()
  })
  it.each(specs)('$prefix shows immutable submitted fields and accurate outcome without execution claims', async spec => {
    let view = spec.view()
    view = decidedFixture(view, 'bob'); view = decidedFixture(view, spec.prefix === 'payment' ? 'carol' : 'bob'); view = decidedFixture(view, spec.prefix === 'payment' ? 'bob' : 'carol')
    const wrapper = mount(ScenarioDetail, { props: { view, template: spec.template(), locale: 'en', people, comment: '', canDecide: false } })
    expect(wrapper.findAll('.sf-saved-lines > section')).toHaveLength(spec.form().lines.length)
    expect(wrapper.find('.sf-saved-lines input').exists()).toBe(false)
    expect(wrapper.find('.sf-saved-lines textarea').exists()).toBe(false)
    expect(wrapper.findAll('.xf-detail-outcome')[0].text()).toContain(spec.prefix === 'payment' ? 'No payment has been made' : 'not been signed')
    await wrapper.setProps({ locale: 'zh' }); expect(wrapper.findAll('.xf-detail-outcome')[0].text()).toContain(spec.prefix === 'payment' ? '尚未执行付款' : '尚未签署')
  })
})
