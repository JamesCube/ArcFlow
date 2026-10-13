import { emptyPayment, paymentErrors, normalizePayment, paymentTotal } from '../scenarios/payment-document.js'
import { emptyTravel, travelErrors, normalizeTravel, travelTotal } from '../scenarios/travel-document.js'
import { emptyReceiving, receivingErrors, normalizeReceiving, receivingSummary } from '../scenarios/receiving-document.js'
import { amountCents, CURRENCIES, decimal, exactKeys, reference, same, serverTrim, text, validDate } from '../scenarios/expense-document.js'

export const GRAPH_FAMILIES = Object.freeze([
  { key: 'payment', schemaVersion: 5, type: 'paymentRequest', id: 'payment-graph', base: '/graphs/payment', en: 'Payment', zh: '付款', fields: ['payment.netTotal'] },
  { key: 'travel', schemaVersion: 6, type: 'travel', id: 'travel-graph', base: '/graphs/travel', en: 'OA travel', zh: 'OA 出差', fields: ['travel.estimatedCost'] },
  { key: 'receiving', schemaVersion: 6, type: 'receiving', id: 'receiving-graph', base: '/graphs/receiving', en: 'ERP receiving', zh: 'ERP 收货', fields: ['receiving.hasRejectedLines'] },
  { key: 'quoteDiscount', schemaVersion: 6, type: 'quoteDiscount', id: 'quote-graph', base: '/graphs/quote', en: 'CRM quote discount', zh: 'CRM 报价折扣', fields: ['quote.reductionTotal', 'quote.discountPercent'] },
].map(family => Object.freeze(family)))
export function familyFor(value = 'payment') {
  if (value && typeof value === 'object' && Object.hasOwn(value, 'schemaVersion')) return familyForDefinition(value)
  const key = typeof value === 'object' ? value?.type || value?.id : value
  const family = GRAPH_FAMILIES.find(entry => [entry.key, entry.type, entry.id].includes(key))
  if (!family) throw new Error('Unsupported graph business family')
  return family
}
// Schema 5 predates business-family IDs: every valid historical ID remains
// payment. Schema 6 reserves only the three newly registered families.
export function familyForDefinition(definition) {
  if (!definition || typeof definition.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(definition.id)) throw new Error('Invalid graph identity')
  if (definition.schemaVersion === 5) return GRAPH_FAMILIES[0]
  const family = GRAPH_FAMILIES.find(entry => entry.schemaVersion === 6 && entry.id === definition.id)
  if (definition.schemaVersion !== 6 || !family) throw new Error('Unsupported graph schema and business family')
  return family
}
const QUOTE_FIELDS = ['type', 'businessId', 'title', 'reason', 'customerRef', 'quoteRevision', 'item', 'quantity', 'listUnitPrice', 'requestedUnitPrice', 'currency', 'validUntil']
export function quoteErrors(business) {
  if (!exactKeys(business, QUOTE_FIELDS)) return ['fields']
  const errors = []
  if (business.type !== 'quoteDiscount') errors.push('type')
  if (!reference(business.businessId)) errors.push('businessId')
  for (const [field, limit] of [['title', 120], ['reason', 2000], ['customerRef', 128], ['item', 240]]) if (!text(business[field], limit)) errors.push(field)
  if (!Number.isInteger(business.quoteRevision) || business.quoteRevision < 1 || business.quoteRevision > 2147483647) errors.push('quoteRevision')
  if (!Number.isInteger(business.quantity) || business.quantity < 1 || business.quantity > 100000) errors.push('quantity')
  if (!CURRENCIES.includes(business.currency)) errors.push('currency')
  const list = amountCents(business.listUnitPrice, business.currency), requested = amountCents(business.requestedUnitPrice, business.currency)
  if (list === null) errors.push('listUnitPrice')
  if (requested === null || list !== null && requested >= list) errors.push('requestedUnitPrice')
  if (!validDate(business.validUntil)) errors.push('validUntil')
  return errors
}
export function normalizeQuote(business) {
  if (quoteErrors(business).length) throw new Error('Invalid quote discount document')
  return { ...business, ...Object.fromEntries(['title', 'reason', 'customerRef', 'item'].map(key => [key, serverTrim(business[key])])), listUnitPrice: decimal(amountCents(business.listUnitPrice, business.currency), business.currency), requestedUnitPrice: decimal(amountCents(business.requestedUnitPrice, business.currency), business.currency) }
}
export const businessErrors = business => ({ paymentRequest: paymentErrors, travel: travelErrors, receiving: receivingErrors, quoteDiscount: quoteErrors }[business?.type]?.(business) || ['type'])
export function normalizeBusiness(business, family) {
  const expected = familyFor(family || business)
  if (business?.type !== expected.type) throw new Error('Wrong graph business family')
  return { paymentRequest: normalizePayment, travel: normalizeTravel, receiving: normalizeReceiving, quoteDiscount: normalizeQuote }[expected.type](business)
}
export function validateBusiness(business, family) {
  if (!same(business, normalizeBusiness(business, family))) throw new Error('Invalid graph business snapshot')
  return business
}
export function emptyBusiness(family = 'payment', idFactory) {
  switch (familyFor(family).key) {
    case 'payment': return emptyPayment(idFactory)
    case 'travel': return emptyTravel()
    case 'receiving': return emptyReceiving(idFactory)
    default: return { type: 'quoteDiscount', businessId: '', title: '', reason: '', customerRef: '', quoteRevision: 1, item: '', quantity: 1, listUnitPrice: '', requestedUnitPrice: '', currency: 'CNY', validUntil: '' }
  }
}
export function quoteFromSource(source, prior = {}) {
  return { type: 'quoteDiscount', businessId: source.businessId, title: prior.title || '', reason: prior.reason || '', customerRef: source.customerRef, quoteRevision: source.revision, item: source.item, quantity: source.quantity, listUnitPrice: source.listUnitPrice, requestedUnitPrice: prior.requestedUnitPrice || '', currency: source.currency, validUntil: source.validUntil }
}
export function validateQuoteSources(values) {
  if (!Array.isArray(values)) throw new Error('Invalid quote source response')
  const identities = new Set()
  for (const source of values) {
    if (!exactKeys(source, ['businessId', 'revision', 'customerRef', 'ownerId', 'readerIds', 'item', 'quantity', 'listUnitPrice', 'currency', 'validUntil']) || !reference(source.businessId) || !Number.isInteger(source.revision) || source.revision < 1 || source.revision > 2147483647 || !text(source.customerRef, 128) || !text(source.item, 240) || !Number.isInteger(source.quantity) || source.quantity < 1 || source.quantity > 100000 || amountCents(source.listUnitPrice, source.currency) === null || !validDate(source.validUntil) || typeof source.ownerId !== 'string' || !source.ownerId || !Array.isArray(source.readerIds) || !source.readerIds.includes(source.ownerId) || source.readerIds.some(id => typeof id !== 'string' || !id) || new Set(source.readerIds).size !== source.readerIds.length || identities.has(source.businessId)) throw new Error('Invalid quote source response')
    identities.add(source.businessId)
  }
  return values
}
export async function quoteSubmissionKey(business) {
  const bytes = new TextEncoder().encode(`${business.businessId}\\n${business.quoteRevision}`)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return `quote:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`
}
export const factType = field => field === 'receiving.hasRejectedLines' ? 'boolean' : field === 'quote.discountPercent' ? 'percent' : 'money'
const FACT_LABELS = {
  'payment.netTotal': ['Net payment total', '净付款申请总额'], 'travel.estimatedCost': ['Estimated travel cost', '预计出差费用'],
  'receiving.hasRejectedLines': ['Has rejected receiving lines', '含不合格收货行'], 'quote.reductionTotal': ['Quote reduction total', '报价减免总额'], 'quote.discountPercent': ['Quote discount percentage', '报价折扣百分比'],
}
export const factLabel = (field, locale = 'en') => FACT_LABELS[field]?.[locale === 'zh' ? 1 : 0] || field
export function businessSummary(business, locale = 'en') {
  const zh = locale === 'zh'
  if (business.type === 'paymentRequest') return { label: factLabel('payment.netTotal', locale), value: `${business.currency} ${paymentTotal(business)}` }
  if (business.type === 'travel') return { label: factLabel('travel.estimatedCost', locale), value: `${business.currency} ${travelTotal(business)}` }
  if (business.type === 'receiving') return { label: zh ? '收货数量（按单位）' : 'Received quantities by unit', value: receivingSummary(business)?.quantities.map(row => `${row.received} ${row.unit}`).join(' · ') || '—' }
  const list = amountCents(business.listUnitPrice, business.currency), requested = amountCents(business.requestedUnitPrice, business.currency)
  return { label: factLabel('quote.reductionTotal', locale), value: list === null || requested === null ? '—' : `${business.currency} ${decimal((list - requested) * BigInt(business.quantity), business.currency)}` }
}

const plainDecimal = value => String(value).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
const centsOf = value => { const [whole, fraction = ''] = String(value).split('.'); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')) }
export function expectedFact(predicate, business) {
  if (!familyFor(business).fields.includes(predicate.field)) throw new Error('Wrong routing fact family')
  if (factType(predicate.field) === 'boolean') {
    const actual = business.lines.some(line => line.rejected > 0)
    return { field: predicate.field, actualValue: String(actual), result: actual === predicate.expected }
  }
  let actualValue, actual, threshold
  if (factType(predicate.field) === 'percent') {
    const list = centsOf(business.listUnitPrice), reduction = list - centsOf(business.requestedUnitPrice)
    actualValue = `${reduction}/${plainDecimal(business.listUnitPrice)}%`
    // (list-requested)*100/list compared by exact cross multiplication.
    actual = reduction * 10000n; threshold = list * centsOf(predicate.threshold)
  } else {
    if (predicate.currency !== business.currency) throw new Error('Routing currency does not match the business snapshot')
    const amount = predicate.field === 'payment.netTotal' ? paymentTotal(business) : predicate.field === 'travel.estimatedCost' ? business.estimatedCost : decimal((centsOf(business.listUnitPrice) - centsOf(business.requestedUnitPrice)) * BigInt(business.quantity), business.currency)
    actualValue = `${business.currency} ${plainDecimal(amount)}`
    actual = centsOf(amount); threshold = centsOf(predicate.threshold)
  }
  const result = { EQ: actual === threshold, GT: actual > threshold, GTE: actual >= threshold, LT: actual < threshold, LTE: actual <= threshold }[predicate.operator]
  return { field: predicate.field, actualValue, result }
}
export function expectedRoutes(definition, business) {
  return definition.nodes.filter(node => node.type === 'exclusiveGateway').map(node => {
    let selectedEdgeId = null
    const evaluations = definition.edges.filter(edge => edge.source === node.id).map(edge => {
      const facts = (edge.condition?.predicates || []).map(predicate => expectedFact(predicate, business))
      const result = edge.defaultBranch ? selectedEdgeId === null : edge.condition.mode === 'ALL' ? facts.every(fact => fact.result) : facts.some(fact => fact.result)
      if (selectedEdgeId === null && result) selectedEdgeId = edge.id
      return { edgeId: edge.id, result, facts }
    })
    return { gatewayId: node.id, selectedEdgeId, evaluations }
  })
}
