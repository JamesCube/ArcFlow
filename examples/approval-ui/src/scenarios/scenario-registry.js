import { CURRENCIES, COST_CENTERS, CATEGORIES, TEMPLATE_ID, emptyExpense, emptyLine, expenseErrors, expenseTotal, formatExpenseMoney, normalizeExpense, serializeExpensePayload } from './expense-document.js'
import { SEAL_TEMPLATE_ID, SEAL_TYPES, emptySeal, sealFormErrors, normalizeSealForm, serializeSealPayload, sealSummary, sealDraftSummary, sealErrorText } from './seal-document.js'
import { validateScenarioView, validateScenarioDecision, validateScenarioList } from './scenario-response.js'

// Explicit compiled extension seam. Metadata supplies presentation; a registered
// handler owns each document's rules, codec, arithmetic and snapshot checks.
// V1 registers Expense and Seal only. Unknown server templates never acquire a generic
// fallback renderer or permission to execute code supplied by metadata.
export const scenarioHandlers = Object.freeze({
  [TEMPLATE_ID]: Object.freeze({
    id: TEMPLATE_ID, domain: 'OA', documentType: 'expense', documentVersion: 1, formVersion: 1,
    monetary: true, prefix: 'expense',
    enums: Object.freeze({ currency: CURRENCIES, costCenter: COST_CENTERS, category: CATEGORIES }),
    summary: (business, total) => formatExpenseMoney(total, business.currency),
    createDraft: emptyExpense, createLine: emptyLine, errors: expenseErrors,
    normalize: normalizeExpense, total: expenseTotal, money: formatExpenseMoney,
    serialize: serializeExpensePayload, validateView: validateScenarioView,
    validateDecision: validateScenarioDecision, validateList: validateScenarioList,
    rootKinds: Object.freeze({ businessId: 'text', title: 'text', reason: 'textarea', costCenter: 'select', currency: 'select' }),
    lineKinds: Object.freeze({ spentOn: 'date', category: 'select', description: 'text', amount: 'money', receiptRef: 'text' }),
  }),
  [SEAL_TEMPLATE_ID]: Object.freeze({
    id: SEAL_TEMPLATE_ID, domain: 'OA', documentType: 'sealUse', documentVersion: 1, formVersion: 1,
    monetary: false, prefix: 'seal', createDraft: emptySeal, errors: sealFormErrors, normalize: normalizeSealForm, serialize: serializeSealPayload,
    total: () => null, summary: (business, _total, locale) => sealSummary(business, locale), draftSummary: sealDraftSummary, errorText: sealErrorText,
    enums: Object.freeze({ sealType: SEAL_TYPES }),
    rootKinds: Object.freeze({ businessId: 'text', title: 'text', reason: 'textarea', documentName: 'text', documentRef: 'text', sealType: 'select', copyCount: 'integer' }),
    rootLengths: Object.freeze({ businessId: 128, title: 120, reason: 2000, documentName: 160, documentRef: 128, sealType: 0, copyCount: 16 }),
    lineKinds: null,
    validateView: (view, expected) => validateScenarioView(view, expected, SEAL_TEMPLATE_ID),
    validateDecision: (view, original, actor, stepId, decision, comment) => validateScenarioDecision(view, original, actor, stepId, decision, comment, SEAL_TEMPLATE_ID),
    validateList: items => validateScenarioList(items, SEAL_TEMPLATE_ID),
  }),
})
export function getScenarioHandler(id = TEMPLATE_ID) {
  if (typeof id !== 'string' || !Object.hasOwn(scenarioHandlers, id)) throw new Error('Unsupported scenario template')
  return scenarioHandlers[id]
}
