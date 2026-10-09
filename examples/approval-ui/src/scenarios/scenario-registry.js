import { CURRENCIES, COST_CENTERS, CATEGORIES, TEMPLATE_ID, emptyExpense, emptyLine, expenseErrors, expenseTotal, formatExpenseMoney, normalizeExpense, serializeExpensePayload, exactKeys } from './expense-document.js'
import { TEMPLATE_ID as TRAVEL_ID, TRAVEL_PURPOSES, emptyTravel, travelErrors, travelTotal, normalizeTravel, serializeTravelPayload, travelDurationDays } from './travel-document.js'
import { SEAL_TEMPLATE_ID, SEAL_TYPES, emptySeal, sealFormErrors, sealErrors, normalizeSealForm, normalizeSeal, serializeSealPayload, sealSummary, sealDraftSummary, sealErrorText } from './seal-document.js'
import { RECEIVING_ID, WAREHOUSES, UNITS, emptyReceiving, emptyReceivingLine, receivingErrors, normalizeReceiving, receivingSummary, serializeReceivingPayload } from './receiving-document.js'
import { createScenarioValidators } from './scenario-response.js'

const monetaryValidators = (id, errors, normalize, total) => createScenarioValidators({ id, errors, normalize, viewKeys: ['request', 'total'], validEnvelope: (view, business) => typeof view.total === 'string' && view.total === total(business) })
function validReceivingSummary(actual, business) {
  const expected = receivingSummary(business)
  return exactKeys(actual, ['kind', 'lineCount', 'exceptionLineCount', 'quantities']) &&
    ['kind', 'lineCount', 'exceptionLineCount'].every(key => Object.is(actual[key], expected[key])) &&
    Array.isArray(actual.quantities) && actual.quantities.length === expected.quantities.length &&
    actual.quantities.every((row, index) => exactKeys(row, ['unit', 'received', 'accepted', 'rejected']) &&
      ['unit', 'received', 'accepted', 'rejected'].every(key => Object.is(row[key], expected.quantities[index][key])))
}
// Explicit compiled handlers own codecs, document rules, arithmetic and strict
// response envelopes. Presentation metadata cannot register behavior or routes.
export const scenarioHandlers = Object.freeze({
  [TEMPLATE_ID]: Object.freeze({
    id: TEMPLATE_ID, domain: 'OA', documentType: 'expense', documentVersion: 1, formVersion: 1,
    monetary: true, prefix: 'expense',
    enums: Object.freeze({ currency: CURRENCIES, costCenter: COST_CENTERS, category: CATEGORIES }),
    summary: (business, total) => formatExpenseMoney(total, business.currency),
    createDraft: emptyExpense, createLine: emptyLine, errors: expenseErrors,
    normalize: normalizeExpense, total: expenseTotal, money: formatExpenseMoney,
    serialize: serializeExpensePayload, ...monetaryValidators(TEMPLATE_ID, expenseErrors, normalizeExpense, expenseTotal),
    rootKinds: Object.freeze({ businessId: 'text', title: 'text', reason: 'textarea', costCenter: 'select', currency: 'select' }),
    lineKinds: Object.freeze({ spentOn: 'date', category: 'select', description: 'text', amount: 'money', receiptRef: 'text' }),
  }),
  [TRAVEL_ID]: Object.freeze({
    id: TRAVEL_ID, domain: 'OA', documentType: 'travel', documentVersion: 1, formVersion: 1,
    monetary: true, prefix: 'travel',
    enums: Object.freeze({ currency: CURRENCIES, costCenter: COST_CENTERS, purpose: TRAVEL_PURPOSES }),
    summary: (business, total) => formatExpenseMoney(total, business.currency),
    createDraft: emptyTravel, errors: travelErrors, normalize: normalizeTravel, total: travelTotal, money: formatExpenseMoney,
    serialize: serializeTravelPayload, duration: business => travelDurationDays(business?.startDate, business?.endDate),
    ...monetaryValidators(TRAVEL_ID, travelErrors, normalizeTravel, travelTotal),
    rootKinds: Object.freeze({ businessId: 'text', title: 'text', reason: 'textarea', destination: 'text', startDate: 'date', endDate: 'date', purpose: 'select', estimatedCost: 'money', currency: 'select', costCenter: 'select' }),
    lineKinds: null,
  }),
  [SEAL_TEMPLATE_ID]: Object.freeze({
    id: SEAL_TEMPLATE_ID, domain: 'OA', documentType: 'sealUse', documentVersion: 1, formVersion: 1,
    monetary: false, prefix: 'seal', createDraft: emptySeal, errors: sealFormErrors, normalize: normalizeSealForm, serialize: serializeSealPayload,
    total: () => null, summary: (business, _total, locale) => sealSummary(business, locale), draftSummary: sealDraftSummary, errorText: sealErrorText,
    enums: Object.freeze({ sealType: SEAL_TYPES }),
    rootKinds: Object.freeze({ businessId: 'text', title: 'text', reason: 'textarea', documentName: 'text', documentRef: 'text', sealType: 'select', copyCount: 'integer' }),
    rootLengths: Object.freeze({ businessId: 128, title: 120, reason: 2000, documentName: 160, documentRef: 128, sealType: 0, copyCount: 16 }),
    lineKinds: null,
    ...createScenarioValidators({ id: SEAL_TEMPLATE_ID, errors: sealErrors, normalize: normalizeSeal, viewKeys: ['request', 'total'], validEnvelope: view => view.total === null }),
  }),
  [RECEIVING_ID]: Object.freeze({
    id: RECEIVING_ID, domain: 'ERP', documentType: 'receiving', documentVersion: 1, formVersion: 1,
    monetary: false, prefix: 'receiving',
    createDraft: emptyReceiving, createLine: emptyReceivingLine, errors: receivingErrors,
    normalize: normalizeReceiving, summary: receivingSummary, serialize: serializeReceivingPayload,
    ...createScenarioValidators({ id: RECEIVING_ID, errors: receivingErrors, normalize: normalizeReceiving, viewKeys: ['request', 'total', 'summary'], validEnvelope: (view, business) => view.total === null && validReceivingSummary(view.summary, business) }),
    rootKinds: Object.freeze({ businessId: 'text', title: 'text', reason: 'textarea', purchaseOrderRef: 'text', warehouse: 'select', receivedOn: 'date' }),
    lineKinds: Object.freeze({ orderLineRef: 'text', description: 'text', unit: 'select', ordered: 'quantity', received: 'quantity', accepted: 'quantity', rejected: 'quantity', exceptionReason: 'textarea' }),
    optionalFields: Object.freeze(['exceptionReason']), enums: Object.freeze({ warehouse: WAREHOUSES, unit: UNITS }),
  }),
})
export function getScenarioHandler(id = TEMPLATE_ID) {
  if (typeof id !== 'string' || !Object.hasOwn(scenarioHandlers, id)) throw new Error('Unsupported scenario template')
  return scenarioHandlers[id]
}
