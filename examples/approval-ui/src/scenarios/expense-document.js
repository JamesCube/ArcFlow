// Decimal text and BigInt throughout. Money crosses the wire only as a
// validated numeric JSON literal; totals never pass through floating point.
export const CURRENCIES = Object.freeze(['CNY', 'USD', 'EUR', 'GBP', 'JPY'])
export const CATEGORIES = Object.freeze(['TRAVEL', 'MEALS', 'OFFICE', 'OTHER'])
export const COST_CENTERS = Object.freeze(['SALES', 'ENGINEERING', 'OPERATIONS'])
export const TEMPLATE_ID = 'oa-expense'
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
export const exactKeys = (value, keys) => isRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
export const reference = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)
export const serverTrim = value => value.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '')
export const text = (value, max) => typeof value === 'string' && !!value.trim() && !!serverTrim(value) && value.length <= max
export class InvalidScenarioPayload extends Error { constructor() { super('Invalid scenario response'); this.name = 'InvalidScenarioPayload' } }
export const invalid = () => { throw new InvalidScenarioPayload() }
export const canonical = value => Array.isArray(value) ? value.map(canonical) : isRecord(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
export const same = (first, second) => JSON.stringify(canonical(first)) === JSON.stringify(canonical(second))
export function amountCents(value, currency) {
  if (!CURRENCIES.includes(currency) || typeof value !== 'string' || value.length > 32 || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return cents > 0n && cents <= 100000000000n && (currency !== 'JPY' || cents % 100n === 0n) ? cents : null
}
export const decimal = (cents, currency) => currency === 'JPY' ? String(cents / 100n) : `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
export function expenseTotal(business) {
  if (!Array.isArray(business?.lines) || !business.lines.length) return null
  let sum = 0n
  for (const line of business.lines) { const cents = amountCents(line.amount, business.currency); if (cents === null) return null; sum += cents }
  return decimal(sum, business.currency)
}
export function formatExpenseMoney(value, currency) {
  if (!CURRENCIES.includes(currency) || typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value)) return '—'
  const [whole, fraction = ''] = value.split('.')
  if (currency === 'JPY' && /[1-9]/.test(fraction)) return '—'
  return `${currency} ${whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${currency === 'JPY' ? '' : `.${fraction.padEnd(2, '0')}`}`
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function expenseErrors(business) {
  if (!exactKeys(business, ['type', 'documentVersion', 'businessId', 'title', 'reason', 'costCenter', 'currency', 'lines'])) return ['fields']
  const errors = []
  if (business.type !== 'expense' || business.documentVersion !== 1) errors.push('type')
  if (!reference(business.businessId)) errors.push('businessId')
  if (!text(business.title, 120)) errors.push('title')
  if (!text(business.reason, 2000)) errors.push('reason')
  if (!COST_CENTERS.includes(business.costCenter)) errors.push('costCenter')
  if (!CURRENCIES.includes(business.currency)) errors.push('currency')
  if (!Array.isArray(business.lines) || business.lines.length < 1 || business.lines.length > 20) return [...errors, 'lines']
  const ids = new Set(), receipts = new Set()
  business.lines.forEach((line, index) => {
    const prefix = `lines.${index}.`
    if (!exactKeys(line, ['lineId', 'spentOn', 'category', 'description', 'amount', 'receiptRef'])) { errors.push(prefix + 'fields'); return }
    if (!reference(line.lineId) || ids.has(line.lineId)) errors.push(prefix + 'lineId'); ids.add(line.lineId)
    if (!validDate(line.spentOn)) errors.push(prefix + 'spentOn')
    if (!CATEGORIES.includes(line.category)) errors.push(prefix + 'category')
    if (!text(line.description, 240)) errors.push(prefix + 'description')
    if (amountCents(line.amount, business.currency) === null) errors.push(prefix + 'amount')
    if (!reference(line.receiptRef) || receipts.has(line.receiptRef)) errors.push(prefix + 'receiptRef'); receipts.add(line.receiptRef)
  })
  return errors
}
export function normalizeExpense(business) {
  if (expenseErrors(business).length) throw new Error('Invalid expense document')
  return Object.freeze({ ...business, title: serverTrim(business.title), reason: serverTrim(business.reason), lines: Object.freeze(business.lines.map(line => Object.freeze({ ...line, description: serverTrim(line.description), amount: decimal(amountCents(line.amount, business.currency), business.currency) }))) })
}
export function serializeExpensePayload(payload) {
  const business = normalizeExpense(payload.business)
  if (!Number.isInteger(payload.processVersion) || payload.processVersion < 1 || payload.processVersion > 2147483647) throw new Error('Invalid process version')
  const lines = business.lines.map(line => `{${Object.entries(line).map(([key, value]) => `${JSON.stringify(key)}:${key === 'amount' ? value : JSON.stringify(value)}`).join(',')}}`)
  return `{"business":{${Object.entries(business).map(([key, value]) => `${JSON.stringify(key)}:${key === 'lines' ? `[${lines.join(',')}]` : JSON.stringify(value)}`).join(',')}},"processVersion":${payload.processVersion}}`
}
export function emptyExpense(idFactory) { return { type: 'expense', documentVersion: 1, businessId: '', title: '', reason: '', costCenter: 'ENGINEERING', currency: 'CNY', lines: [emptyLine(idFactory)] } }
export const emptyLine = idFactory => ({ lineId: `line-${idFactory()}`, spentOn: '', category: 'TRAVEL', description: '', amount: '', receiptRef: '' })
