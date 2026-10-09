import { afterEach, describe, expect, it } from 'vitest'
import { mount, enableAutoUnmount, flushPromises } from '@vue/test-utils'
import ScenarioForm from './ScenarioForm.vue'
import ScenarioDetail from './ScenarioDetail.vue'
import { getScenarioHandler } from './scenario-registry.js'
import { sealFixture, sealTemplateFixture, sealViewFixture, decidedFixture, people } from './scenario-fixtures.js'
enableAutoUnmount(afterEach)
const handler = getScenarioHandler('oa-seal-use')
function form() {
  let wrapper
  wrapper = mount(ScenarioForm, { attachTo: document.body, props: { template: sealTemplateFixture(), handler, modelValue: sealFixture({ copyCount: '2' }), locale: 'en', errors: [], attempted: false, busy: false, 'onUpdate:modelValue': value => wrapper.setProps({ modelValue: value, errors: handler.errors(value), attempted: true }) } })
  return wrapper
}
describe('mounted Seal form and saved details', () => {
  it('renders seven real fields without expense widgets and never coerces invalid raw count', async () => {
    const wrapper = form(), count = wrapper.find('#seal-copyCount')
    expect(wrapper.findAll('input, textarea, select')).toHaveLength(7)
    expect(count.attributes()).toMatchObject({ type: 'text', inputmode: 'numeric', maxlength: '16' })
    expect(wrapper.findAll('fieldset, input[type=file], [data-testid=expense-total]')).toHaveLength(0)
    for (const raw of ['', '1e2', '1.5', '-1', '0', '101', '2copies']) {
      await count.setValue(raw)
      expect(wrapper.props('modelValue').copyCount).toBe(raw); expect(count.element.value).toBe(raw)
      expect(count.attributes('aria-invalid')).toBe('true'); expect(wrapper.find('#seal-copyCount-error').text()).toContain('whole-number')
    }
    await wrapper.find('form').trigger('submit'); await flushPromises()
    expect(document.activeElement.id).toBe('seal-copyCount')
    await wrapper.setProps({ locale: 'zh' }); expect(wrapper.find('#seal-copyCount-error').text()).toContain('整数份数')
    await count.setValue(' 02 '); expect(wrapper.props('modelValue').copyCount).toBe(' 02 ')
    expect(wrapper.find('[data-testid=seal-summary]').text()).toContain('2 份')
  })
  it('retains safe text, shows no invented monetary amount, and disables all inputs while busy', async () => {
    const wrapper = form()
    await wrapper.find('#seal-documentName').setValue('<img src=x>')
    expect(wrapper.findAll('img')).toHaveLength(0)
    expect(wrapper.text()).toContain('2 copies'); expect(wrapper.text()).not.toContain('CNY')
    await wrapper.setProps({ busy: true, retrying: true })
    expect(wrapper.findAll('input, textarea, select').every(field => field.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.find('[data-testid=submit-seal]').attributes('disabled')).toBeDefined()
  })
  it.each(['PENDING', 'APPROVED', 'REJECTED'])('shows actual copy and synthetic category in %s detail without implying execution', status => {
    const pending = sealViewFixture()
    const view = status === 'PENDING' ? pending : status === 'REJECTED' ? decidedFixture(pending, 'bob', 'REJECT') : decidedFixture(decidedFixture(pending), 'carol')
    const wrapper = mount(ScenarioDetail, { props: { view, template: sealTemplateFixture(), locale: 'en', people, comment: '', busy: false, canDecide: status === 'PENDING' } })
    expect(wrapper.find('.sf-detail-header').text()).toContain('2 copies · Synthetic official seal')
    expect(wrapper.find('.sf-saved-lines').exists()).toBe(false)
    expect(wrapper.text()).toContain('does not mean the document was stamped or signed')
    expect(wrapper.text()).toContain('Document review'); expect(wrapper.text()).toContain('Seal-use review')
    expect(wrapper.text()).not.toContain('CNY'); expect(wrapper.text()).not.toContain('0.00')
  })
})
