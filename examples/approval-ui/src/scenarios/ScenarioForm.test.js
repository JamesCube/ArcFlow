import { afterEach, describe, expect, it } from 'vitest'
import { mount, enableAutoUnmount, flushPromises } from '@vue/test-utils'
import ScenarioField from './ScenarioField.vue'
import ScenarioForm from './ScenarioForm.vue'
import { catalogFixture, expenseFixture } from './scenario-fixtures.js'
enableAutoUnmount(afterEach)
function form(props = {}) {
  let wrapper
  wrapper = mount(ScenarioForm, { attachTo: document.body, props: { template: catalogFixture()[0], modelValue: expenseFixture(), locale: 'en', errors: [], attempted: false, busy: false, retrying: false, rejectedVersion: false, 'onUpdate:modelValue': value => wrapper.setProps({ modelValue: value }), ...props } })
  return wrapper
}

describe('metadata-driven expense form', () => {
  it('renders every allow-listed field with stable IDs and decimal text input', () => {
    const wrapper = form()
    for (const field of ['businessId', 'title', 'reason', 'costCenter', 'currency']) expect(wrapper.find(`#expense-${field}`).exists()).toBe(true)
    for (const field of ['spentOn', 'category', 'description', 'amount', 'receiptRef']) expect(wrapper.find(`#expense-lines-0-${field}`).exists()).toBe(true)
    const amount = wrapper.find('#expense-lines-0-amount')
    expect(amount.attributes('type')).toBe('text'); expect(amount.attributes('inputmode')).toBe('decimal')
    expect(wrapper.find('[data-testid=expense-total]').text()).toBe('CNY 150.00')
    expect(wrapper.findAll('input[type=file]')).toHaveLength(0)
  })
  it('preserves exact decimal text and line identities when fields change', async () => {
    const business = expenseFixture(), wrapper = form({ modelValue: business })
    await wrapper.find('#expense-lines-0-amount').setValue('0.10'); await wrapper.find('#expense-lines-1-amount').setValue('0.20')
    expect(wrapper.props('modelValue').lines.map(line => line.amount)).toEqual(['0.10', '0.20'])
    expect(wrapper.find('[data-testid=expense-total]').text()).toBe('CNY 0.30')
    expect(business.lines[0].amount).toBe('123.45'); expect(wrapper.props('modelValue').lines[0].lineId).toBe('line-1')
  })
  it('adds a unique line and focuses its first field, while removing one retains remaining identities', async () => {
    const wrapper = form()
    await wrapper.find('[data-testid=add-expense-line]').trigger('click'); await flushPromises()
    expect(wrapper.findAll('fieldset')).toHaveLength(3)
    const ids = wrapper.props('modelValue').lines.map(line => line.lineId); expect(new Set(ids).size).toBe(3)
    expect(document.activeElement.id).toBe('expense-lines-2-spentOn')
    await wrapper.find('[aria-label="Remove expense 1"]').trigger('click')
    expect(wrapper.props('modelValue').lines.map(line => line.lineId)).toEqual(ids.slice(1))
  })
  it('enforces minimum and maximum line counts and locks the form during a mutation', async () => {
    const business = expenseFixture(); business.lines.pop(); const wrapper = form({ modelValue: business })
    expect(wrapper.find('[aria-label="Remove expense 1"]').attributes('disabled')).toBeDefined()
    const expanded = expenseFixture(); expanded.lines = Array.from({ length: 20 }, (_, i) => ({ ...expanded.lines[0], lineId: `line-${i}`, receiptRef: `r-${i}` }))
    await wrapper.setProps({ modelValue: expanded }); expect(wrapper.find('[data-testid=add-expense-line]').attributes('disabled')).toBeDefined()
    await wrapper.setProps({ busy: true })
    expect(wrapper.findAll('input, select, textarea').every(input => input.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.find('[data-testid=submit-expense]').attributes('disabled')).toBeDefined()
  })
  it('links validation messages accessibly and focuses the first invalid field on submission', async () => {
    const wrapper = form({ attempted: true, errors: ['title', 'lines.0.amount'] })
    const title = wrapper.find('#expense-title')
    expect(title.attributes('aria-invalid')).toBe('true'); expect(title.attributes('aria-describedby')).toBe('expense-title-error')
    expect(wrapper.find('#expense-title-error').text()).toContain('120')
    await wrapper.find('form').trigger('submit'); await flushPromises()
    expect(wrapper.emitted('submit')).toHaveLength(1); expect(document.activeElement.id).toBe('expense-title')
  })
  it('localizes inline guidance, yen precision, totals and retry actions', async () => {
    const wrapper = form({ modelValue: expenseFixture({ currency: 'JPY' }), locale: 'zh', attempted: true, errors: ['lines.0.amount'], retrying: true })
    expect(wrapper.find('#expense-lines-0-amount-error').text()).toContain('整数日元')
    expect(wrapper.find('#expense-lines-0-amount').attributes('placeholder')).toBe('0')
    expect(wrapper.find('[data-testid=expense-total]').text()).toBe('—')
    expect(wrapper.find('[data-testid=submit-expense]').text()).toContain('重试原申请')
    await wrapper.setProps({ rejectedVersion: true }); expect(wrapper.find('[data-testid=submit-expense]').attributes('disabled')).toBeDefined()
  })
  it('renders metadata labels as text rather than active HTML', () => {
    const field = { path: 'title', kind: 'text', maxLength: 120, label: { en: '<img src=x onerror=alert(1)>', zh: '标题' }, options: [] }
    const wrapper = mount(ScenarioField, { props: { field, modelValue: '<script>alert(1)</script>', locale: 'en', id: 'safe-field' } })
    expect(wrapper.find('label').text()).toBe(field.label.en); expect(wrapper.findAll('img, script')).toHaveLength(0)
    expect(wrapper.find('input').element.value).toBe('<script>alert(1)</script>')
  })
})
