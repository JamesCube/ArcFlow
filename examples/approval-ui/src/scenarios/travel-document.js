import { amountCents, CURRENCIES, COST_CENTERS, decimal, exactKeys, invalid, reference, same, serverTrim, text, validDate } from './expense-document.js'

export const TEMPLATE_ID = 'oa-travel'
export const TRAVEL_PURPOSES = Object.freeze(['CUSTOMER_VISIT', 'PROJECT_DELIVERY', 'TRAINING', 'CONFERENCE', 'OTHER'])
const FIELDS = Object.freeze(['type', 'documentVersion', 'businessId', 'title', 'reason', 'destination', 'startDate', 'endDate', 'purpose', 'estimatedCost', 'currency', 'costCenter'])

// UTC date-only arithmetic keeps inclusive days independent of local time and
// daylight-saving transitions. The shared date parser rejects rollover dates.
export function travelDurationDays(startDate, endDate) {
  if (!validDate(startDate) || !validDate(endDate)) return null
  const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000 + 1
  return Number.isInteger(days) && days >= 1 && days <= 90 ? days : null
}

export function travelErrors(business) {
  if (!exactKeys(business, FIELDS)) return ['fields']
  const errors = []
  if (business.type !== 'travel' || business.documentVersion !== 1) errors.push('type')
  if (!reference(business.businessId)) errors.push('businessId')
  if (!text(business.title, 120)) errors.push('title')
  if (!text(business.reason, 2000)) errors.push('reason')
  if (!text(business.destination, 160)) errors.push('destination')
  const validStart = validDate(business.startDate), validEnd = validDate(business.endDate)
  if (!validStart) errors.push('startDate')
  if (!validEnd || validStart && travelDurationDays(business.startDate, business.endDate) === null) errors.push('endDate')
  if (!TRAVEL_PURPOSES.includes(business.purpose)) errors.push('purpose')
  if (amountCents(business.estimatedCost, business.currency) === null) errors.push('estimatedCost')
  if (!CURRENCIES.includes(business.currency)) errors.push('currency')
  if (!COST_CENTERS.includes(business.costCenter)) errors.push('costCenter')
  return errors
}

export function travelTotal(business) {
  const cents = amountCents(business?.estimatedCost, business?.currency)
  return cents === null ? null : decimal(cents, business.currency)
}

export function normalizeTravel(business) {
  if (travelErrors(business).length) throw new Error('Invalid travel document')
  return Object.freeze({ ...business, title: serverTrim(business.title), reason: serverTrim(business.reason), destination: serverTrim(business.destination), estimatedCost: travelTotal(business) })
}

// The transport converts validated numeric JSON lexemes into canonical decimal
// text. Responses must already be normalized; do not quietly repair snapshots.
export function validateTravelBusiness(business) {
  if (travelErrors(business).length || !same(business, normalizeTravel(business))) invalid()
  return business
}

export function serializeTravelPayload(payload) {
  const business = normalizeTravel(payload.business)
  if (!Number.isInteger(payload.processVersion) || payload.processVersion < 1 || payload.processVersion > 2147483647) throw new Error('Invalid process version')
  const fields = Object.entries(business).map(([key, value]) => `${JSON.stringify(key)}:${key === 'estimatedCost' ? value : JSON.stringify(value)}`)
  return `{"business":{${fields.join(',')}},"processVersion":${payload.processVersion}}`
}

export function emptyTravel() {
  return { type: 'travel', documentVersion: 1, businessId: '', title: '', reason: '', destination: '', startDate: '', endDate: '', purpose: 'CUSTOMER_VISIT', estimatedCost: '', currency: 'CNY', costCenter: 'ENGINEERING' }
}
