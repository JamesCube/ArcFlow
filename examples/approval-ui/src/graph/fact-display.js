// Presentation only. The API verifier and backend keep the exact rational
// evidence and cross-multiply it for routing; this text never chooses a path.
import { factLabel, factType } from './business.js'
const PRECISION = 4
const SCALE = 10n ** BigInt(PRECISION)
function decimalParts(value) {
  if (typeof value !== 'string' || value.length > 128) return null
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value)
  return match ? { coefficient: BigInt(match[1] + (match[2] || '')), scale: (match[2] || '').length } : null
}
function decimalText(value) {
  const fraction = String(value % SCALE).padStart(PRECISION, '0').replace(/0+$/, '')
  return `${value / SCALE}${fraction ? `.${fraction}` : ''}`
}
export function formatRoutingFact(fact, locale = 'en') {
  if (fact?.field === 'receiving.hasRejectedLines') return fact.actualValue === 'true' ? (locale === 'zh' ? '是' : 'Yes') : fact.actualValue === 'false' ? (locale === 'zh' ? '否' : 'No') : '—'
  if (fact?.field !== 'quote.discountPercent') return fact?.actualValue ?? '—'
  const match = typeof fact.actualValue === 'string' && /^([^/]+)\/([^/]+)%$/.exec(fact.actualValue)
  const numerator = match && decimalParts(match[1]), denominator = match && decimalParts(match[2])
  if (!numerator || !denominator || denominator.coefficient === 0n) return '—'
  const top = numerator.coefficient * 10n ** BigInt(denominator.scale)
  const bottom = denominator.coefficient * 10n ** BigInt(numerator.scale)
  if (top > bottom * 100n) return '—'
  const scaled = top * SCALE, whole = scaled / bottom, remainder = scaled % bottom
  if (remainder === 0n) return `${decimalText(whole)}%`
  const zh = locale === 'zh'
  // Do not imply a zero or full discount when a nonzero remainder is hidden.
  if (whole === 0n) return zh ? '小于 0.0001%' : 'Less than 0.0001%'
  const rounded = whole + (remainder * 2n >= bottom ? 1n : 0n)
  if (rounded === 100n * SCALE) return zh ? '大于 99.9999%' : 'More than 99.9999%'
  return `${zh ? '约' : 'Approx.'} ${decimalText(rounded)}%`
}

export function formatPredicateSummary(predicate, locale = 'en') {
  const zh = locale === 'zh', type = factType(predicate.field)
  if (type === 'boolean') return `${factLabel(predicate.field, locale)}${zh ? '：' : ': '}${formatRoutingFact({ field: predicate.field, actualValue: String(predicate.expected) }, locale)}`
  const operators = zh ? { EQ: '等于', GT: '大于', GTE: '不低于', LT: '小于', LTE: '不高于' }
    : { EQ: 'equals', GT: 'greater than', GTE: 'at least', LT: 'less than', LTE: 'at most' }
  const value = type === 'percent' ? `${predicate.threshold}%` : `${predicate.currency} ${predicate.threshold}`
  return `${factLabel(predicate.field, locale)} ${operators[predicate.operator] || '—'} ${value}`
}

export function formatConditionResult(result, locale = 'en') {
  if (typeof result !== 'boolean') return '—'
  return locale === 'zh' ? (result ? '满足' : '未满足') : (result ? 'Met' : 'Not met')
}
