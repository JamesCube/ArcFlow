import { TEMPLATE_ID, emptyExpense, emptyLine, expenseErrors, expenseTotal, formatExpenseMoney, normalizeExpense, serializeExpensePayload } from './expense-document.js'
import { createScenarioValidators } from './scenario-response.js'
import { TEMPLATE_ID as TRAVEL_ID, emptyTravel, travelErrors, travelTotal, normalizeTravel, serializeTravelPayload, travelDurationDays } from './travel-document.js'

// Explicit compiled extension seam. Metadata supplies presentation; a registered
// handler owns each document's rules, codec, arithmetic and snapshot checks.
// Only explicitly registered typed scenarios are supported. Unknown server templates never acquire a generic
// fallback renderer or permission to execute code supplied by metadata.
export const scenarioHandlers = Object.freeze({
  [TEMPLATE_ID]: Object.freeze({
    id: TEMPLATE_ID, domain: 'OA', documentType: 'expense', documentVersion: 1, formVersion: 1,
    createDraft: emptyExpense, createLine: emptyLine, errors: expenseErrors,
    normalize: normalizeExpense, total: expenseTotal, money: formatExpenseMoney,
    serialize: serializeExpensePayload, ...createScenarioValidators({ id: TEMPLATE_ID, errors: expenseErrors, normalize: normalizeExpense, total: expenseTotal }),
    rootKinds: Object.freeze({ businessId: 'text', title: 'text', reason: 'textarea', costCenter: 'select', currency: 'select' }),
    lineKinds: Object.freeze({ spentOn: 'date', category: 'select', description: 'text', amount: 'money', receiptRef: 'text' }),
  }),
  [TRAVEL_ID]: Object.freeze({
    id: TRAVEL_ID, domain: 'OA', documentType: 'travel', documentVersion: 1, formVersion: 1,
    createDraft: emptyTravel, errors: travelErrors, normalize: normalizeTravel, total: travelTotal, money: formatExpenseMoney,
    serialize: serializeTravelPayload, duration: business => travelDurationDays(business?.startDate, business?.endDate),
    ...createScenarioValidators({ id: TRAVEL_ID, errors: travelErrors, normalize: normalizeTravel, total: travelTotal }),
    rootKinds: Object.freeze({ businessId: 'text', title: 'text', reason: 'textarea', destination: 'text', startDate: 'date', endDate: 'date', purpose: 'select', estimatedCost: 'money', currency: 'select', costCenter: 'select' }),
    lineKinds: null,
  }),
})
export function getScenarioHandler(id = TEMPLATE_ID) {
  if (typeof id !== 'string' || !Object.hasOwn(scenarioHandlers, id)) throw new Error('Unsupported scenario template')
  return scenarioHandlers[id]
}
