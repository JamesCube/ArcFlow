// Only newly added OA expense behavior belongs in this matrix. Historical
// payment/receiving/contract galleries and their evidence remain independent.
const vote = (actor, step, action = 'APPROVE') => [actor, step, action]
const state = (status, currentStepId, expectedVotes, journey, version) => ({ status, currentStepId, expectedVotes, journey, version })
export const expenseCaptureContract = {
  'expense-conditions': null,
  'expense-wrong-currency': null,
  'expense-legacy-frozen': state('PENDING', 'manager', [], 'legacy', 'legacy'),
  'expense-low-frozen': state('PENDING', 'finance', [], 'low', 'conditional'),
  'expense-threshold-entered': state('PENDING', 'manager', [], 'threshold', 'conditional'),
  'expense-threshold-partial': state('PENDING', 'manager', [vote('bob', 'manager')], 'threshold', 'conditional'),
  'expense-threshold-finance': state('PENDING', 'finance', [vote('bob', 'manager'), vote('carol', 'manager')], 'threshold', 'conditional'),
  'expense-threshold-approved': state('APPROVED', null, [vote('bob', 'manager'), vote('carol', 'manager'), vote('carol', 'finance')], 'threshold', 'conditional'),
  'expense-rejected': state('REJECTED', null, [vote('bob', 'manager', 'REJECT')], 'rejected', 'conditional'),
  'expense-low-after-publication': state('PENDING', 'finance', [], 'low', 'conditional'),
  'expense-new-publication': state('PENDING', 'manager', [], 'new', 'later'),
  'expense-low-approved': state('APPROVED', null, [vote('carol', 'finance')], 'low', 'conditional'),
}
export const expenseCaptureNames = Object.keys(expenseCaptureContract).flatMap(state => ['en', 'zh'].flatMap(locale => ['desktop', '390px'].map(viewport => `${state}-${locale}-${viewport}`)))
export const expenseExpectedRoutes = {
  low: { stepIds: ['finance'], result: false, actualValue: 'CNY 9999.99', threshold: 10000 },
  threshold: { stepIds: ['manager', 'finance'], result: true, actualValue: 'CNY 10000', threshold: 10000 },
  rejected: { stepIds: ['manager', 'finance'], result: true, actualValue: 'CNY 10000', threshold: 10000 },
  new: { stepIds: ['manager', 'finance'], result: true, actualValue: 'CNY 9999.99', threshold: 0 },
}
