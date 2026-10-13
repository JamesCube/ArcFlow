import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GraphBusinessForm from './GraphBusinessForm.vue'
import GraphBusinessSnapshot from './GraphBusinessSnapshot.vue'
import GraphPaymentForm from './GraphPaymentForm.vue'
import { emptyBusiness, quoteFromSource } from './business.js'
import { paymentFixture, receivingFixture, travelFixture } from '../scenarios/scenario-fixtures.js'

const source = overrides => ({ businessId: 'Q-DEMO-001', revision: 1, customerRef: 'CUSTOMER-DEMO-A', ownerId: 'alice', readerIds: ['alice', 'bob', 'carol'], item: 'Equipment set', quantity: 10, listUnitPrice: '1000.00', currency: 'CNY', validUntil: '2099-12-31', ...overrides })
const quote = overrides => ({ ...quoteFromSource(source(), { title: 'Project pricing', reason: 'Volume discount', requestedUnitPrice: '800.00' }), ...overrides })
const field = (wrapper, id) => wrapper.get(`[data-testid="${id}"]`)
function form(business, extra = {}) {
  const wrapper = mount(GraphBusinessForm, { props: { modelValue: structuredClone(business), locale: 'en', attempted: false, actor: { id: 'alice' }, ...extra, 'onUpdate:modelValue': next => wrapper.setProps({ modelValue: next }) } })
  return wrapper
}

describe('graph business forms', () => {
  it('keeps the payment form and its public fields unchanged', async () => {
    const wrapper = form(paymentFixture())
    expect(wrapper.findComponent(GraphPaymentForm).exists()).toBe(true)
    await field(wrapper, 'graph-payment-title').setValue('Revised payment')
    expect(wrapper.props('modelValue').title).toBe('Revised payment')
    expect(field(wrapper, 'graph-net-total').text()).toContain('6500.00')
    expect(wrapper.find('button[type="submit"]').exists()).toBe(false)
  })

  it('renders the complete travel schema with lossless inputs and accessible date errors', async () => {
    const original = travelFixture(), wrapper = form(original, { attempted: true })
    for (const key of ['businessId', 'title', 'reason', 'destination', 'startDate', 'endDate', 'purpose', 'estimatedCost', 'currency', 'costCenter']) expect(field(wrapper, `graph-travel-${key}`).exists()).toBe(true)
    expect(field(wrapper, 'graph-travel-duration').text()).toBe('3 days')
    await field(wrapper, 'graph-travel-endDate').setValue('2026-10-11')
    const end = field(wrapper, 'graph-travel-endDate')
    expect(end.attributes('aria-invalid')).toBe('true')
    expect(wrapper.get(`#${end.attributes('aria-describedby')}`).text()).toContain('1–90 days')
    await field(wrapper, 'graph-travel-estimatedCost').setValue('2e3')
    expect(wrapper.props('modelValue').estimatedCost).toBe('2e3')
    expect(field(wrapper, 'graph-travel-estimatedCost').attributes('aria-invalid')).toBe('true')
    expect(original.estimatedCost).toBe('2800.00')
    await wrapper.setProps({ locale: 'zh' })
    expect(wrapper.text()).toContain('出差天数（含首尾）')
    expect(wrapper.text()).toContain('最多两位小数')
  })

  it('validates exact receiving quantities, reconciliation and required exception reasons', async () => {
    const wrapper = form(receivingFixture(), { attempted: true })
    expect(field(wrapper, 'graph-receiving-summary').text()).toContain('Pieces (PCS)')
    expect(field(wrapper, 'graph-receiving-summary').text()).toContain('Boxes (BOX)')
    for (const invalid of ['', '1.5', '1e2', '-1', '100001']) {
      await field(wrapper, 'graph-receiving-0-received').setValue(invalid)
      expect(wrapper.props('modelValue').lines[0].received).toBe(invalid)
      expect(field(wrapper, 'graph-receiving-0-received').attributes('aria-invalid')).toBe('true')
    }
    await field(wrapper, 'graph-receiving-0-received').setValue('80')
    await field(wrapper, 'graph-receiving-0-accepted').setValue('79')
    expect(field(wrapper, 'graph-receiving-0-accepted').attributes('aria-invalid')).toBe('true')
    expect(wrapper.text()).toContain('Accepted plus rejected must equal received.')
    await field(wrapper, 'graph-receiving-0-accepted').setValue('78')
    await field(wrapper, 'graph-receiving-0-exceptionReason').setValue('')
    expect(field(wrapper, 'graph-receiving-0-exceptionReason').attributes('aria-required')).toBe('true')
    expect(field(wrapper, 'graph-receiving-0-exceptionReason').attributes('aria-invalid')).toBe('true')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('button[type="submit"]').exists()).toBe(false)
  })

  it('adds distinct receiving lines, keeps one line, and locks every mutation while busy', async () => {
    const wrapper = form(receivingFixture())
    await field(wrapper, 'graph-add-receiving-line').trigger('click')
    expect(wrapper.props('modelValue').lines).toHaveLength(3)
    expect(new Set(wrapper.props('modelValue').lines.map(line => line.lineId)).size).toBe(3)
    await field(wrapper, 'graph-remove-receiving-line-2').trigger('click')
    await field(wrapper, 'graph-remove-receiving-line-1').trigger('click')
    expect(field(wrapper, 'graph-remove-receiving-line-0').attributes('disabled')).toBeDefined()
    await wrapper.setProps({ busy: true })
    expect(wrapper.findAll('input,select,textarea,button').every(control => control.attributes('disabled') !== undefined)).toBe(true)
    const before = JSON.stringify(wrapper.props('modelValue'))
    await field(wrapper, 'graph-add-receiving-line').trigger('click')
    expect(JSON.stringify(wrapper.props('modelValue'))).toBe(before)
  })

  it('selects a genuine quote revision, exposes source fields as read-only, and keeps only three editable values', async () => {
    const wrapper = form(emptyBusiness('quoteDiscount'), { quotes: [source()] })
    await field(wrapper, 'graph-quote-title').setValue('Project pricing')
    await field(wrapper, 'graph-quote-reason').setValue('Volume discount')
    await field(wrapper, 'graph-quote-requestedUnitPrice').setValue('800.00')
    await field(wrapper, 'graph-quote-source').setValue(JSON.stringify(['Q-DEMO-001', 1]))
    expect(wrapper.props('modelValue')).toEqual(quote())
    expect(wrapper.props('modelValue')).not.toHaveProperty('readerIds')
    expect(wrapper.props('modelValue')).not.toHaveProperty('documentVersion')
    expect(wrapper.findAll('input,textarea').map(control => control.attributes('data-testid'))).toEqual(['graph-quote-title', 'graph-quote-requestedUnitPrice', 'graph-quote-reason'])
    for (const key of ['businessId', 'customerRef', 'quoteRevision', 'item', 'quantity', 'listUnitPrice', 'currency', 'validUntil']) expect(field(wrapper, `graph-quote-${key}`).element.tagName).toBe('DD')
    expect(field(wrapper, 'graph-quote-total').text()).toBe('CNY 8000.00')
    expect(wrapper.text()).toContain('rechecked on submission')
    await field(wrapper, 'graph-refresh-quotes').trigger('click')
    expect(wrapper.emitted('refresh-quotes')).toHaveLength(1)
  })

  it('keeps monetary inputs exact and requires an actual discount below the source list price', async () => {
    const tiny = source({ listUnitPrice: '0.30', quantity: 3 }), wrapper = form(quoteFromSource(tiny, { title: 'Small items', reason: 'Exact arithmetic', requestedUnitPrice: '0.29' }), { quotes: [tiny], attempted: true })
    expect(field(wrapper, 'graph-quote-total').text()).toBe('CNY 0.87')
    await field(wrapper, 'graph-quote-requestedUnitPrice').setValue('0.30')
    expect(field(wrapper, 'graph-quote-requestedUnitPrice').attributes('aria-invalid')).toBe('true')
    expect(wrapper.text()).toContain('below the source list price')
    await field(wrapper, 'graph-quote-requestedUnitPrice').setValue('0.291')
    expect(wrapper.props('modelValue').requestedUnitPrice).toBe('0.291')
    expect(field(wrapper, 'graph-quote-total').text()).toBe('CNY —')
  })

  it('retains stale quote inputs and disables sources owned by others or already expired', async () => {
    const wrapper = form(quote(), { quotes: [source()] }), prior = JSON.stringify(wrapper.props('modelValue'))
    await wrapper.setProps({ quotes: [source({ revision: 2 })] })
    expect(field(wrapper, 'graph-quote-source-stale').text()).toContain('Your inputs are preserved')
    expect(JSON.stringify(wrapper.props('modelValue'))).toBe(prior)
    const foreign = source({ businessId: 'Q-OTHER', ownerId: 'bob' }), old = source({ businessId: 'Q-OLD', validUntil: '2000-01-01' })
    await wrapper.setProps({ quotes: [source(), foreign, old] })
    const options = wrapper.findAll('#graph-quote-source option')
    expect(options.find(option => option.text().includes('Q-OTHER')).attributes('disabled')).toBeDefined()
    expect(options.find(option => option.text().includes('Q-OLD')).attributes('disabled')).toBeDefined()
    await field(wrapper, 'graph-quote-source').setValue(JSON.stringify(['Q-OTHER', 1]))
    expect(JSON.stringify(wrapper.props('modelValue'))).toBe(prior)
    await wrapper.setProps({ modelValue: quote({ validUntil: '2000-01-01' }) })
    expect(field(wrapper, 'graph-quote-source-expired').text()).toContain('has expired')
  })

  it('only replaces mismatched source facts after an explicit reload and preserves the requested terms', async () => {
    const wrapper = form(quote({ quantity: 99 }), { quotes: [source()] })
    expect(wrapper.props('modelValue').quantity).toBe(99)
    await field(wrapper, 'graph-quote-reload-source').trigger('click')
    expect(wrapper.props('modelValue')).toEqual(quote())
    expect(wrapper.find('[data-testid="graph-quote-source-stale"]').exists()).toBe(false)
  })
})

describe('frozen graph business snapshots', () => {
  it('shows every payment line and its purpose, allocations, deductions and totals', () => {
    const wrapper = mount(GraphBusinessSnapshot, { props: { business: paymentFixture(), locale: 'en' } })
    expect(field(wrapper, 'graph-snapshot-supplierRef').text()).toBe('SUPPLIER-DEMO-A')
    expect(field(wrapper, 'graph-snapshot-0-invoiceAmount').text()).toBe('CNY 10,000.00')
    expect(field(wrapper, 'graph-snapshot-0-previouslySettledAmount').text()).toBe('CNY 4,000.00')
    expect(field(wrapper, 'graph-snapshot-0-deductionReason').text()).toBe('Synthetic quality deduction')
    expect(field(wrapper, 'graph-snapshot-1-invoiceRef').text()).toBe('INV-DEMO-02')
    expect(field(wrapper, 'graph-snapshot-netTotal-total').text()).toBe('CNY 6,500.00')
  })

  it('shows the full travel itinerary and localized purpose without payment labels', async () => {
    const business = travelFixture(), wrapper = mount(GraphBusinessSnapshot, { props: { business, locale: 'en' } })
    for (const key of ['businessId', 'title', 'reason', 'destination', 'startDate', 'endDate', 'purpose', 'costCenter', 'estimatedCost', 'currency']) expect(field(wrapper, `graph-snapshot-${key}`).exists()).toBe(true)
    expect(field(wrapper, 'graph-snapshot-purpose').text()).toBe('Project delivery')
    expect(field(wrapper, 'graph-snapshot-duration-total').text()).toBe('3 days')
    expect(wrapper.text()).not.toContain('Net requested payment')
    await wrapper.setProps({ locale: 'zh' })
    expect(field(wrapper, 'graph-snapshot-purpose').text()).toBe('项目交付')
    expect(wrapper.text()).toContain('出差申请详情')
  })

  it('shows full receiving lines and separate per-unit quantities with exception evidence', () => {
    const wrapper = mount(GraphBusinessSnapshot, { props: { business: receivingFixture(), locale: 'en' } })
    expect(field(wrapper, 'graph-snapshot-0-orderLineRef').text()).toBe('PO-DEMO-001-10')
    expect(field(wrapper, 'graph-snapshot-0-ordered').text()).toBe('100')
    expect(field(wrapper, 'graph-snapshot-0-exceptionReason').text()).toBe('Two bent brackets')
    expect(field(wrapper, 'graph-snapshot-1-unit').text()).toBe('Boxes (BOX)')
    expect(field(wrapper, 'graph-snapshot-exceptionLineCount-total').text()).toBe('1')
    expect(field(wrapper, 'graph-snapshot-quantities').text()).toContain('Pieces (PCS)')
    expect(wrapper.text()).not.toContain('Net requested payment')
  })

  it('shows source provenance and exact requested/list totals for single-line quote discounts', () => {
    const wrapper = mount(GraphBusinessSnapshot, { props: { business: quote({ quantity: 3, listUnitPrice: '0.30', requestedUnitPrice: '0.29' }), locale: 'en' } })
    for (const key of ['businessId', 'title', 'reason', 'quoteRevision', 'customerRef', 'item', 'quantity', 'listUnitPrice', 'requestedUnitPrice', 'currency', 'validUntil']) expect(field(wrapper, `graph-snapshot-${key}`).exists()).toBe(true)
    expect(field(wrapper, 'graph-snapshot-listTotal-total').text()).toBe('CNY 0.90')
    expect(field(wrapper, 'graph-snapshot-requestedTotal-total').text()).toBe('CNY 0.87')
    expect(wrapper.text()).toContain('Source quote facts and revision are frozen')
    expect(wrapper.text()).not.toContain('Net requested payment')
    expect(wrapper.find('input,select,textarea').exists()).toBe(false)
  })
})
