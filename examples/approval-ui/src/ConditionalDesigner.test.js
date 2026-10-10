import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ProcessDesigner from './ProcessDesigner.vue'
import { setRunIf } from './designer-model.js'
import { validateDefinition } from './process.js'
import { processFixture, people } from './scenarios/scenario-fixtures.js'
const clone = value => JSON.parse(JSON.stringify(value))
const atom = { field: 'payment.netTotal', operator: 'GTE', currency: 'CNY', threshold: 10000 }
let wrappers = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers = [] })
function setup(id = 'erp-payment', options = {}) {
  const published = processFixture({ id }), state = { value: clone(published) }
  let wrapper
  wrapper = mount(ProcessDesigner, { props: { modelValue: state.value, published, expectedProcessId: id, people, editable: true, initialLocale: 'en', ...options, 'onUpdate:modelValue': value => { state.value = value; wrapper.setProps({ modelValue: value, dirty: true }) } } })
  wrappers.push(wrapper); return { wrapper, state }
}
async function enable(wrapper) { await wrapper.get('[data-testid=condition-enabled]').setValue('conditional'); await flushPromises() }
const button = (wrapper, id) => wrapper.get(`[data-testid=${id}]`)
describe('restricted conditional designer', () => {
  it.each(['leave-approval', 'oa-travel', 'oa-seal-use', 'crm-quote'])('does not expose routing in %s', id => { expect(setup(id).wrapper.find('[data-testid=routing-editor]').exists()).toBe(false) })
  it.each(['oa-expense', 'erp-payment'])('configures %s money conditions across SINGLE/ALL/ANY and undo/redo', async id => {
    const { wrapper, state } = setup(id); await enable(wrapper)
    expect(state.value.schemaVersion).toBe(4); expect(state.value.nodes[1].runIf).toEqual({ mode: 'ALL', predicates: [{ ...atom, field: id === 'oa-expense' ? 'expense.totalAmount' : atom.field }] })
    await wrapper.get('[aria-label="Condition 1 threshold"]').setValue('100.01')
    await wrapper.get('[aria-label="Step 1 review mode"]').setValue('ANY')
    expect(state.value.nodes[1].runIf.predicates[0].threshold).toBe(100.01)
    await wrapper.get('[aria-label="Step 1 review mode"]').setValue('SINGLE')
    expect(state.value.schemaVersion).toBe(4); expect(state.value.nodes[1].runIf.predicates[0].threshold).toBe(100.01)
    await button(wrapper, 'undo').trigger('click'); expect(state.value.nodes[1].completionMode).toBe('ANY')
    await button(wrapper, 'redo').trigger('click'); expect(state.value.nodes[1].type).toBe('approval')
    await wrapper.get('[data-testid=condition-enabled]').setValue('always')
    expect(state.value.schemaVersion).toBe(4); expect(Object.hasOwn(state.value.nodes[1], 'runIf')).toBe(false)
    await button(wrapper, 'undo').trigger('click'); expect(state.value.nodes[1].runIf.predicates[0].threshold).toBe(100.01)
  })
  it.each(['oa-expense', 'erp-payment'])('blocks %s invalid precision, JPY fractions, and mixed currencies with bilingual guidance', async id => {
    const { wrapper, state } = setup(id); await enable(wrapper)
    await wrapper.get('[aria-label="Condition 1 threshold"]').setValue('1.0000000000000001'); expect(state.value.nodes[1].runIf.predicates[0].threshold).toBe('1.0000000000000001'); expect(button(wrapper, 'publish').attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="Condition 1 threshold"]').setValue('1.001'); expect(button(wrapper, 'publish').attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="Condition 1 threshold"]').setValue('1.01'); expect(validateDefinition(state.value, id)).toEqual([])
    await wrapper.get('[aria-label="Condition 1 currency"]').setValue('JPY'); expect(button(wrapper, 'publish').attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="Condition 1 threshold"]').setValue('1')
    await button(wrapper, 'add-condition').trigger('click'); expect(wrapper.text()).toContain('same currency')
    await wrapper.get('[data-testid=designer-language]').setValue('zh'); expect(wrapper.text()).toContain('所有金额条件必须使用相同币种')
  })
  it('keeps one unconditional step and caps the total at eight atoms', async () => {
    const { wrapper, state } = setup(); await enable(wrapper)
    for (let i = 1; i < 8; i++) await button(wrapper, 'add-condition').trigger('click')
    expect(button(wrapper, 'add-condition').attributes('disabled')).toBeDefined()
    expect(state.value.nodes[1].runIf.predicates).toHaveLength(8)
    await wrapper.findAll('[data-testid=select-step]')[1].trigger('click')
    expect(wrapper.get('[data-testid=condition-enabled] option[value=conditional]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('last unconditional step')
  })
  it('supports boolean receiving predicates and ANY matching', async () => {
    const { wrapper, state } = setup('erp-receiving'); await enable(wrapper)
    await wrapper.get('[aria-label="Condition 1 expected value"]').setValue('false')
    await button(wrapper, 'condition-mode').setValue('ANY')
    expect(state.value.nodes[1].runIf).toEqual({ mode: 'ANY', predicates: [{ field: 'receiving.hasRejectedLines', operator: 'EQ', expected: false }] })
    expect(validateDefinition(state.value, 'erp-receiving')).toEqual([])
  })
  it('supports EQ/IN terms selection, rejects empty IN, and safely narrows to EQ', async () => {
    const { wrapper, state } = setup('crm-contract'); await enable(wrapper)
    await wrapper.get('[aria-label="Condition 1 comparison"]').setValue('IN')
    await wrapper.get('[aria-label="Condition 1 NONSTANDARD"]').setValue(false); expect(button(wrapper, 'publish').attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="Condition 1 STANDARD"]').setValue(true)
    await wrapper.get('[aria-label="Condition 1 NONSTANDARD"]').setValue(true)
    expect(state.value.nodes[1].runIf.predicates[0].values).toEqual(['STANDARD', 'NONSTANDARD'])
    await wrapper.get('[aria-label="Condition 1 comparison"]').setValue('EQ')
    expect(state.value.nodes[1].runIf.predicates[0].values).toEqual(['STANDARD'])
  })
  it('allows inspection but no condition edits for reviewers', async () => {
    const definition = setRunIf(processFixture({ id: 'erp-payment' }), 'manager', { mode: 'ALL', predicates: [atom] })
    const { wrapper } = setup('erp-payment', { editable: false, modelValue: definition, published: definition })
    expect(wrapper.text()).toContain('Conditional step'); expect(wrapper.find('[data-testid=condition-enabled]').exists()).toBe(false)
    expect(wrapper.get('.routing-atom').attributes('disabled')).toBeDefined(); expect(wrapper.find('[data-testid=publish]').exists()).toBe(false)
  })
})
