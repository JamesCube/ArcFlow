// Shared, framework-free business boundary for both example hosts. Money stays
// decimal text / BigInt until the bounded unit price is serialized to JSON.
export const SUPPORTED_CURRENCIES = Object.freeze(['CNY', 'USD', 'EUR', 'GBP', 'JPY'])
const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const fields = {
  leave: ['type', 'businessId', 'title', 'reason', 'days'],
  procurement: ['type', 'businessId', 'title', 'reason', 'item', 'quantity', 'unitPrice', 'currency'],
}
const serverTrim = value => value.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '')
const inputText = value => typeof value === 'string' ? value.trim() : ''
const validText = (value, limit) => typeof value === 'string' && !!value.trim() && value.length <= limit
const integer = (value, limit, wire = false) => {
  if (wire && typeof value !== 'number') return false
  const text = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : ''
  return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) >= 1 && Number(text) <= limit
}

export function parseUnitPrice(value, currency) {
  if (!SUPPORTED_CURRENCIES.includes(currency) || !['number', 'string'].includes(typeof value)) return null
  const text = String(value).trim()
  // No exponents, signs, separators, fractional pennies or implicit empty zero.
  if (!/^\d+(?:\.\d{1,2})?$/.test(text) || text.length > 32) return null
  const [whole, fraction = ''] = text.split('.')
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (cents <= 0n || cents > 100000000000n || (currency === 'JPY' && cents % 100n !== 0n)) return null
  const decimal = `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
  return decimal.replace(/\.?0+$/, '')
}

export function procurementTotal(quantity, unitPrice, currency) {
  const price = parseUnitPrice(unitPrice, currency)
  if (!integer(quantity, 100000) || price === null) return null
  const [whole, fraction = ''] = price.split('.')
  const total = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * BigInt(String(quantity).trim())
  return currency === 'JPY' ? String(total / 100n) : `${total / 100n}.${String(total % 100n).padStart(2, '0')}`
}

export function formatMoney(amount, currency, locale = 'en') {
  if (!SUPPORTED_CURRENCIES.includes(currency) || !['string', 'number'].includes(typeof amount) ||
      !/^\d+(?:\.\d{1,2})?$/.test(String(amount))) return '—'
  const [whole, fraction = ''] = String(amount).split('.')
  if (currency === 'JPY' && /[1-9]/.test(fraction)) return '—'
  // en and zh use the same grouping; do not coerce a potentially >2^53 cent
  // total into Number or rely on Intl implementations rounding decimal strings.
  const grouped = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${currency} ${grouped}${currency === 'JPY' ? '' : `.${fraction.padEnd(2, '0')}`}`
}

export function businessDocumentErrors(business, { wire = false } = {}) {
  if (!record(business) || !owns(fields, business.type)) return ['type']
  const errors = [], expected = fields[business.type]
  if (Object.keys(business).some(key => !expected.includes(key)) || expected.some(key => !owns(business, key))) errors.push('fields')
  if (typeof business.businessId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(business.businessId)) errors.push('businessId')
  for (const [key, limit] of [['title', 120], ['reason', 2000]]) if (!validText(business[key], limit)) errors.push(key)
  if (business.type === 'leave') {
    if (!integer(business.days, 365, wire)) errors.push('days')
  } else {
    if (!validText(business.item, 240)) errors.push('item')
    if (!integer(business.quantity, 100000, wire)) errors.push('quantity')
    if (!SUPPORTED_CURRENCIES.includes(business.currency)) errors.push('currency')
    if ((wire && typeof business.unitPrice !== 'number') || parseUnitPrice(business.unitPrice, business.currency) === null) errors.push('unitPrice')
  }
  return errors
}

export function normalizeBusinessDocument(business) {
  if (businessDocumentErrors(business).length) throw new Error('Invalid business document')
  const common = { type: business.type, businessId: business.businessId, title: inputText(business.title), reason: inputText(business.reason) }
  return Object.freeze(business.type === 'leave' ? { ...common, days: Number(business.days) }
    : { ...common, item: inputText(business.item), quantity: Number(business.quantity),
      unitPrice: Number(parseUnitPrice(business.unitPrice, business.currency)), currency: business.currency })
}

// Distinguish absence (legacy leave) from null/unknown/malformed typed data.
// All detail/list consumers must call this before choosing a business renderer.
export function requestBusiness(item) {
  const invalid = () => { throw new Error('Invalid business document') }
  if (!record(item)) invalid()
  if (!owns(item, 'business')) {
    if (!integer(item.days, 365, true) || !validText(item.title, 120) || !validText(item.reason, 2000)) invalid()
    return null
  }
  const business = item.business
  if (businessDocumentErrors(business, { wire: true }).length || item.title !== business.title || item.reason !== business.reason ||
      item.days !== (business.type === 'leave' ? business.days : 0) ||
      ['title', 'reason', ...(business.type === 'procurement' ? ['item'] : [])].some(key => business[key] !== serverTrim(business[key]))) invalid()
  return business
}

export class InvalidApprovalPayloadError extends Error {
  constructor() { super('Invalid approval response'); this.name = 'InvalidApprovalPayloadError' }
}
const invalidJson = () => { throw new InvalidApprovalPayloadError() }
class NumberToken { constructor(source) { this.source = source } }

// Parse numeric lexemes before JSON.parse/axios can erase an invalid fraction.
// The grammar is ordinary JSON, with duplicate keys and excessive nesting
// rejected. Strings alone use JSON.parse to preserve its escape semantics.
export function parseApprovalJson(source) {
  if (typeof source !== 'string') return invalidJson()
  let position = 0
  const whitespace = () => { while (/[\x20\t\r\n]/.test(source[position] || '!')) position++ }
  function string() {
    const start = position++
    while (position < source.length) {
      const character = source[position++]
      if (character === '\\') position++
      else if (character === '"') {
        try { return JSON.parse(source.slice(start, position)) } catch { return invalidJson() }
      }
    }
    return invalidJson()
  }
  function value(depth) {
    if (depth > 64) return invalidJson()
    whitespace()
    const character = source[position]
    if (character === '"') return string()
    if (character === '{') {
      position++; whitespace()
      const result = Object.create(null)
      if (source[position] === '}') { position++; return result }
      while (position < source.length) {
        whitespace()
        if (source[position] !== '"') return invalidJson()
        const key = string()
        if (owns(result, key)) return invalidJson()
        whitespace()
        if (source[position++] !== ':') return invalidJson()
        result[key] = value(depth + 1); whitespace()
        const delimiter = source[position++]
        if (delimiter === '}') return result
        if (delimiter !== ',') return invalidJson()
      }
      return invalidJson()
    }
    if (character === '[') {
      position++; whitespace()
      const result = []
      if (source[position] === ']') { position++; return result }
      while (position < source.length) {
        result.push(value(depth + 1)); whitespace()
        const delimiter = source[position++]
        if (delimiter === ']') return result
        if (delimiter !== ',') return invalidJson()
      }
      return invalidJson()
    }
    for (const [token, result] of [['true', true], ['false', false], ['null', null]]) {
      if (source.startsWith(token, position)) { position += token.length; return result }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(position))
    if (!number) return invalidJson()
    position += number[0].length
    return new NumberToken(number[0])
  }
  const raw = value(0); whitespace()
  if (position !== source.length) return invalidJson()
  function materialize(current, key, parent) {
    if (current instanceof NumberToken) {
      if (key === 'unitPrice') return exactWirePrice(current.source, parent?.currency)
      // All other numeric fields in approval responses are bounded integers.
      // Decimal/exponent spellings must not masquerade as quantity/days/version.
      if (!/^-?(?:0|[1-9]\d*)$/.test(current.source) || !Number.isSafeInteger(Number(current.source))) return invalidJson()
      return Number(current.source)
    }
    if (Array.isArray(current)) return current.map(entry => materialize(entry))
    if (record(current)) return Object.fromEntries(Object.entries(current).map(([field, entry]) => [field, materialize(entry, field, current)]))
    return current
  }
  return materialize(raw)
}

function exactWirePrice(source, currency) {
  if (!SUPPORTED_CURRENCIES.includes(currency)) return invalidJson()
  const parts = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source)
  if (!parts) return invalidJson()
  const fraction = parts[2] || '', exponent = BigInt(parts[3] || '0')
  const scale = BigInt(fraction.length) - exponent
  // Match BigDecimal.scale(), not just the rounded numeric value. Canonical
  // server tokens such as 1E+9 are valid; 1.000e0 and hidden fractions are not.
  if (scale > 2n) return invalidJson()
  const coefficient = `${parts[1]}${fraction}`.replace(/^0+/, '')
  const shift = 2n - scale
  if (!coefficient || BigInt(coefficient.length) + shift > 12n) return invalidJson()
  const cents = BigInt(coefficient) * 10n ** shift
  if (cents > 100000000000n || (currency === 'JPY' && cents % 100n !== 0n)) return invalidJson()
  // Only a validated <=1e9 two-decimal unit price crosses to Number. Totals
  // never do. String(number) preserves every valid bounded decimal token.
  return Number(`${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`)
}
