import { exactKeys, reference, serverTrim, validDate } from './expense-document.js'
export const RECEIVING_ID = 'erp-receiving'
export const WAREHOUSES = Object.freeze(['EAST', 'WEST'])
export const UNITS = Object.freeze(['PCS', 'BOX'])
export const QUANTITIES = Object.freeze(['ordered', 'received', 'accepted', 'rejected'])
const text = (value, max) => typeof value === 'string' && !/^[\u0000-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$/.test(value) && value.length <= max
// Text inputs remain lossless until validation; never coerce blank, decimal,
// exponent, signed, boolean or rounded numbers into valid quantities.
export function quantity(value) {
  if (typeof value === 'string' && !/^(?:0|[1-9]\d*)$/.test(value)) return null
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const number = Number(value)
  return Number.isSafeInteger(number) && !Object.is(number, -0) && number >= 0 && number <= 100000 ? number : null
}
export function receivingErrors(business) {
  if (!exactKeys(business, ['type', 'documentVersion', 'businessId', 'title', 'reason', 'purchaseOrderRef', 'warehouse', 'receivedOn', 'lines'])) return ['fields']
  const errors = []
  if (business.type !== 'receiving' || business.documentVersion !== 1) errors.push('type')
  for (const key of ['businessId', 'purchaseOrderRef']) if (!reference(business[key])) errors.push(key)
  if (!text(business.title, 120)) errors.push('title')
  if (!text(business.reason, 2000)) errors.push('reason')
  if (!WAREHOUSES.includes(business.warehouse)) errors.push('warehouse')
  if (!validDate(business.receivedOn)) errors.push('receivedOn')
  if (!Array.isArray(business.lines) || business.lines.length < 1 || business.lines.length > 20) return [...errors, 'lines']
  const ids = new Set(), orderLines = new Set()
  let anyReceived = false
  business.lines.forEach((line, index) => {
    const prefix = `lines.${index}.`
    if (!exactKeys(line, ['lineId', 'orderLineRef', 'description', 'unit', ...QUANTITIES, 'exceptionReason'])) { errors.push(prefix + 'fields'); return }
    if (!reference(line.lineId) || ids.has(line.lineId)) errors.push(prefix + 'lineId'); ids.add(line.lineId)
    if (!reference(line.orderLineRef) || orderLines.has(line.orderLineRef)) errors.push(prefix + 'orderLineRef'); orderLines.add(line.orderLineRef)
    if (!text(line.description, 240)) errors.push(prefix + 'description')
    if (!UNITS.includes(line.unit)) errors.push(prefix + 'unit')
    const values = Object.fromEntries(QUANTITIES.map(key => [key, quantity(line[key])]))
    for (const key of QUANTITIES) if (values[key] === null || key === 'ordered' && values[key] === 0) errors.push(prefix + key)
    if (values.received !== null && values.received > 0) anyReceived = true
    if (values.received !== null && values.ordered !== null && values.received > values.ordered) errors.push(prefix + 'received')
    if ([values.received, values.accepted, values.rejected].every(value => value !== null) && values.accepted + values.rejected !== values.received) errors.push(prefix + 'reconciliation')
    if (typeof line.exceptionReason !== 'string' || line.exceptionReason.length > 1000 || values.rejected > 0 && !text(line.exceptionReason, 1000)) errors.push(prefix + 'exceptionReason')
  })
  if (!anyReceived) errors.push('received')
  return [...new Set(errors)]
}
export function normalizeReceiving(business) {
  if (receivingErrors(business).length) throw new Error('Invalid receiving document')
  return Object.freeze({ ...business, title: serverTrim(business.title), reason: serverTrim(business.reason), lines: Object.freeze(business.lines.map(line => Object.freeze({ ...line, description: serverTrim(line.description), exceptionReason: serverTrim(line.exceptionReason), ...Object.fromEntries(QUANTITIES.map(key => [key, quantity(line[key])])) }))) })
}
export function receivingSummary(business) {
  if (receivingErrors(business).length) return null
  return { kind: 'receiving', lineCount: business.lines.length, exceptionLineCount: business.lines.filter(line => quantity(line.rejected) > 0).length, quantities: UNITS.filter(unit => business.lines.some(line => line.unit === unit)).map(unit => {
    const lines = business.lines.filter(line => line.unit === unit)
    return { unit, ...Object.fromEntries(['received', 'accepted', 'rejected'].map(key => [key, lines.reduce((sum, line) => sum + quantity(line[key]), 0)])) }
  }) }
}
export function serializeReceivingPayload(payload) {
  if (!Number.isInteger(payload.processVersion) || payload.processVersion < 1 || payload.processVersion > 2147483647) throw new Error('Invalid process version')
  return JSON.stringify({ business: normalizeReceiving(payload.business), processVersion: payload.processVersion })
}
export const emptyReceivingLine = idFactory => ({ lineId: `line-${idFactory()}`, orderLineRef: '', description: '', unit: 'PCS', ordered: '', received: '', accepted: '', rejected: '0', exceptionReason: '' })
export const emptyReceiving = idFactory => ({ type: 'receiving', documentVersion: 1, businessId: '', title: '', reason: '', purchaseOrderRef: '', warehouse: 'EAST', receivedOn: '', lines: [emptyReceivingLine(idFactory)] })
