import { TEMPLATE_ID, emptyExpense, emptyLine, expenseErrors, expenseTotal, formatExpenseMoney, normalizeExpense, serializeExpensePayload } from './expense-document.js'
import { createScenarioValidators, validateScenarioView, validateScenarioDecision, validateScenarioList } from './scenario-response.js'

import { RECEIVING_ID, WAREHOUSES, UNITS, emptyReceiving, emptyReceivingLine, receivingErrors, normalizeReceiving, receivingSummary, serializeReceivingPayload } from './receiving-document.js'
import { same } from './expense-document.js'
const receivingValidators = createScenarioValidators({ id: RECEIVING_ID, errors: receivingErrors, normalize: normalizeReceiving, viewKeys: ['request', 'total', 'summary'], validEnvelope: (view, business) => view.total === null && same(view.summary, receivingSummary(business)) })
// Explicit compiled extension seam. Metadata supplies presentation; a registered
// handler owns each document's rules, codec, arithmetic and snapshot checks.
// Only explicitly compiled document handlers are supported. Unknown server templates never acquire a generic
// fallback renderer or permission to execute code supplied by metadata.
export const scenarioHandlers = Object.freeze({
  [TEMPLATE_ID]: Object.freeze({
    id: TEMPLATE_ID, domain: 'OA', documentType: 'expense', documentVersion: 1, formVersion: 1,
    createDraft: emptyExpense, createLine: emptyLine, errors: expenseErrors,
    normalize: normalizeExpense, total: expenseTotal, money: formatExpenseMoney,
    serialize: serializeExpensePayload, validateView: validateScenarioView,
    validateDecision: validateScenarioDecision, validateList: validateScenarioList,
    rootKinds: Object.freeze({ businessId: 'text', title: 'text', reason: 'textarea', costCenter: 'select', currency: 'select' }),
    lineKinds: Object.freeze({ spentOn: 'date', category: 'select', description: 'text', amount: 'money', receiptRef: 'text' }),
  }),
  [RECEIVING_ID]: Object.freeze({
    id: RECEIVING_ID, domain: 'ERP', documentType: 'receiving', documentVersion: 1, formVersion: 1,
    createDraft: emptyReceiving, createLine: emptyReceivingLine, errors: receivingErrors,
    normalize: normalizeReceiving, summary: receivingSummary, serialize: serializeReceivingPayload,
    ...receivingValidators,
    rootKinds: Object.freeze({ businessId: 'text', title: 'text', reason: 'textarea', purchaseOrderRef: 'text', warehouse: 'select', receivedOn: 'date' }),
    lineKinds: Object.freeze({ orderLineRef: 'text', description: 'text', unit: 'select', ordered: 'quantity', received: 'quantity', accepted: 'quantity', rejected: 'quantity', exceptionReason: 'textarea' }),
    optionalFields: Object.freeze(['exceptionReason']), enums: Object.freeze({ warehouse: WAREHOUSES, unit: UNITS }),
  }),
})
export function getScenarioHandler(id = TEMPLATE_ID) {
  if (typeof id !== 'string' || !Object.hasOwn(scenarioHandlers, id)) throw new Error('Unsupported scenario template')
  return scenarioHandlers[id]
}
