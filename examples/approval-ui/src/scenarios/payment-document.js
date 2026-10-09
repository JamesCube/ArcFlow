import { CURRENCIES, decimal, exactKeys, reference, serverTrim, validDate } from './expense-document.js'

export const PAYMENT_ID = 'erp-payment'
export const PAYMENT_AMOUNTS = Object.freeze(['invoiceAmount', 'previouslySettledAmount', 'allocationAmount', 'deductionAmount'])
const FIELDS = Object.freeze(['type', 'documentVersion', 'businessId', 'title', 'reason', 'supplierRef', 'currency', 'requestedPaymentOn', 'lines'])
const LINE_FIELDS = Object.freeze(['lineId', 'invoiceRef', 'description', ...PAYMENT_AMOUNTS, 'deductionReason'])
// Match the complex-document server's Unicode blank set, including U+0085
// which ECMAScript trim() does not recognize as whitespace.
const text = (value, max) => typeof value === 'string' && !/^[\u0000-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$/.test(value) && value.length <= max

// Amounts stay as decimal text until serialized as numeric JSON lexemes. Even
// zero-valued fields use this parser: Number('') and floating-point sums cannot
// turn an unfinished or imprecise input into a valid submitted amount.
export function paymentAmountCents(value, currency, allowZero = false) {
  if (!CURRENCIES.includes(currency) || typeof value !== 'string' || value.length > 32 || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return cents >= (allowZero ? 0n : 1n) && cents <= 100000000000n && (currency !== 'JPY' || cents % 100n === 0n) ? cents : null
}

function lineAmounts(line, currency) {
  if (!line || typeof line !== 'object') return null
  const amounts = Object.fromEntries(PAYMENT_AMOUNTS.map(key => [key, paymentAmountCents(line[key], currency, key === 'previouslySettledAmount' || key === 'deductionAmount')]))
  return Object.values(amounts).some(value => value === null) ? null : amounts
}

export function paymentErrors(business) {
  if (!exactKeys(business, FIELDS)) return ['fields']
  const errors = []
  if (business.type !== 'paymentRequest' || business.documentVersion !== 1) errors.push('type')
  for (const key of ['businessId', 'supplierRef']) if (!reference(business[key])) errors.push(key)
  if (!text(business.title, 120)) errors.push('title')
  if (!text(business.reason, 2000)) errors.push('reason')
  if (!CURRENCIES.includes(business.currency)) errors.push('currency')
  if (!validDate(business.requestedPaymentOn)) errors.push('requestedPaymentOn')
  if (!Array.isArray(business.lines) || business.lines.length < 1 || business.lines.length > 20) return [...errors, 'lines']
  const ids = new Set(), invoices = new Set()
  let net = 0n, validAmounts = true
  Array.from(business.lines).forEach((line, index) => {
    const prefix = `lines.${index}.`
    if (!exactKeys(line, LINE_FIELDS)) { errors.push(prefix + 'fields'); validAmounts = false; return }
    if (!reference(line.lineId) || ids.has(line.lineId)) errors.push(prefix + 'lineId'); ids.add(line.lineId)
    if (!reference(line.invoiceRef) || invoices.has(line.invoiceRef)) errors.push(prefix + 'invoiceRef'); invoices.add(line.invoiceRef)
    if (!text(line.description, 240)) errors.push(prefix + 'description')
    const amounts = Object.fromEntries(PAYMENT_AMOUNTS.map(key => [key, paymentAmountCents(line[key], business.currency, key === 'previouslySettledAmount' || key === 'deductionAmount')]))
    for (const key of PAYMENT_AMOUNTS) if (amounts[key] === null) { errors.push(prefix + key); validAmounts = false }
    const { invoiceAmount: invoice, previouslySettledAmount: settled, allocationAmount: allocation, deductionAmount: deduction } = amounts
    if (invoice !== null && settled !== null && settled > invoice) errors.push(prefix + 'previouslySettledAmount')
    if (invoice !== null && settled !== null && allocation !== null && allocation > invoice - settled) errors.push(prefix + 'allocationAmount')
    if (allocation !== null && deduction !== null && deduction > allocation) errors.push(prefix + 'deductionAmount')
    if (typeof line.deductionReason !== 'string' || line.deductionReason.length > 1000 || deduction !== null && deduction > 0n && !text(line.deductionReason, 1000)) errors.push(prefix + 'deductionReason')
    if (allocation !== null && deduction !== null) net += allocation - deduction
  })
  if (validAmounts && net <= 0n) errors.push('netTotal')
  return [...new Set(errors)]
}

// Draft summaries depend on the numeric inputs only, so they are useful while
// the user is still entering references or the purpose. Invalid relationships
// have no summary. A zero net amount is shown, but paymentErrors blocks submit.
export function paymentSummary(business) {
  if (!Array.isArray(business?.lines) || business.lines.length < 1 || business.lines.length > 20) return null
  let outstanding = 0n, allocation = 0n, deduction = 0n
  for (const line of business.lines) {
    const amounts = lineAmounts(line, business.currency)
    if (!amounts) return null
    const { invoiceAmount: invoice, previouslySettledAmount: settled, allocationAmount: allocated, deductionAmount: deducted } = amounts
    if (settled > invoice || allocated > invoice - settled || deducted > allocated) return null
    outstanding += invoice - settled; allocation += allocated; deduction += deducted
  }
  return Object.freeze({ type: 'paymentRequest', declaredOutstanding: decimal(outstanding, business.currency), grossAllocation: decimal(allocation, business.currency), deductionTotal: decimal(deduction, business.currency), netTotal: decimal(allocation - deduction, business.currency) })
}
export const paymentTotal = business => paymentSummary(business)?.netTotal ?? null

export function normalizePayment(business) {
  if (paymentErrors(business).length) throw new Error('Invalid payment document')
  return Object.freeze({ ...business, title: serverTrim(business.title), reason: serverTrim(business.reason), lines: Object.freeze(business.lines.map(line => Object.freeze({ ...line, description: serverTrim(line.description), deductionReason: serverTrim(line.deductionReason), ...Object.fromEntries(PAYMENT_AMOUNTS.map(key => [key, decimal(paymentAmountCents(line[key], business.currency, true), business.currency)])) }))) })
}

export function serializePaymentPayload(payload) {
  if (!exactKeys(payload, ['business', 'processVersion'])) throw new Error('Invalid payment payload')
  const business = normalizePayment(payload.business)
  if (!Number.isInteger(payload.processVersion) || payload.processVersion < 1 || payload.processVersion > 2147483647) throw new Error('Invalid process version')
  const lines = business.lines.map(line => `{${Object.entries(line).map(([key, value]) => `${JSON.stringify(key)}:${PAYMENT_AMOUNTS.includes(key) ? value : JSON.stringify(value)}`).join(',')}}`)
  return `{"business":{${Object.entries(business).map(([key, value]) => `${JSON.stringify(key)}:${key === 'lines' ? `[${lines.join(',')}]` : JSON.stringify(value)}`).join(',')}},"processVersion":${payload.processVersion}}`
}

export const emptyPaymentLine = idFactory => ({ lineId: `line-${idFactory()}`, invoiceRef: '', description: '', invoiceAmount: '', previouslySettledAmount: '0', allocationAmount: '', deductionAmount: '0', deductionReason: '' })
export const emptyPayment = idFactory => ({ type: 'paymentRequest', documentVersion: 1, businessId: '', title: '', reason: '', supplierRef: '', currency: 'CNY', requestedPaymentOn: '', lines: [emptyPaymentLine(idFactory)] })

const REFERENCE_EN = 'Use 1–128 ASCII letters, digits or . _ : / -; start with a letter or digit.'
const REFERENCE_ZH = '请输入 1–128 位字母、数字或 . _ : / -，以字母或数字开头。'
const ERROR_TEXT = Object.freeze({
  fields: ['Only the documented payment fields are allowed; all fields are required.', '付款申请只能包含约定字段，且字段不可缺失。'],
  type: ['Use a payment request with document version 1.', '付款申请类型与单据版本 1 必须匹配。'],
  businessId: [REFERENCE_EN, REFERENCE_ZH], supplierRef: [REFERENCE_EN, REFERENCE_ZH],
  title: ['Enter a title, up to 120 characters.', '请填写标题，最多 120 字。'],
  reason: ['Enter the payment purpose, up to 2,000 characters.', '请填写付款事由，最多 2,000 字。'],
  currency: ['Choose CNY, USD, EUR, GBP or JPY.', '请选择 CNY、USD、EUR、GBP 或 JPY。'],
  requestedPaymentOn: ['Enter a real payment date in YYYY-MM-DD format.', '请输入真实有效的申请付款日期，格式为 YYYY-MM-DD。'],
  lines: ['Include 1–20 invoice allocations.', '请填写 1–20 条发票分配明细。'],
  lineId: ['Each line needs a unique reference. ' + REFERENCE_EN, '每行编号必须唯一。' + REFERENCE_ZH],
  invoiceRef: ['Each invoice reference must be unique in this request. ' + REFERENCE_EN, '同一申请内发票引用不可重复。' + REFERENCE_ZH],
  description: ['Describe this invoice allocation, up to 240 characters.', '请填写此发票分配说明，最多 240 字。'],
  invoiceAmount: ['Enter an invoice amount above 0 and at most 1,000,000,000, with up to 2 decimals; JPY must be whole yen.', '发票原额须大于 0 且不超过 1,000,000,000，最多两位小数；日元须为整数。'],
  previouslySettledAmount: ['Enter a settled amount from 0 to the invoice amount, with up to 2 decimals; JPY must be whole yen.', '已结金额须在 0 与发票原额之间，最多两位小数；日元须为整数。'],
  allocationAmount: ['Allocation must be above 0 and no greater than invoice amount minus settled amount, with up to 2 decimals; JPY must be whole yen.', '本次冲销须大于 0，且不超过发票原额减去已结金额，最多两位小数；日元须为整数。'],
  deductionAmount: ['Deduction must be from 0 to the allocation amount, with up to 2 decimals; JPY must be whole yen.', '扣减金额须在 0 与本次冲销金额之间，最多两位小数；日元须为整数。'],
  deductionReason: ['A positive deduction needs a reason, up to 1,000 characters.', '扣减大于 0 时必须填写原因，最多 1,000 字。'],
  netTotal: ['The total net request must be above 0; at least one line must retain a positive net amount.', '净申请总额须大于 0；至少一行扣减后净额须为正数。'],
})
export function paymentErrorText(path, locale = 'en') { return (ERROR_TEXT[path.split('.').at(-1)] || ERROR_TEXT.fields)[locale === 'zh' ? 1 : 0] }
