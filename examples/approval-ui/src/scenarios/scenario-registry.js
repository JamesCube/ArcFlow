import { TEMPLATE_ID, emptyExpense, emptyLine, expenseErrors, expenseTotal, formatExpenseMoney, normalizeExpense, serializeExpensePayload } from './expense-document.js'
import { validateScenarioView, validateScenarioDecision, validateScenarioList } from './scenario-response.js'

// Explicit compiled extension seam. Metadata supplies presentation; a registered
// handler owns each document's rules, codec, arithmetic and snapshot checks.
// V1 registers only oa-expense. Unknown server templates never acquire a generic
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
})
export function getScenarioHandler(id = TEMPLATE_ID) {
  if (typeof id !== 'string' || !Object.hasOwn(scenarioHandlers, id)) throw new Error('Unsupported scenario template')
  return scenarioHandlers[id]
}
