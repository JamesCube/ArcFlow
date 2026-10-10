// Every business state requires both languages and both viewport widths.
// expectedVotes lists real actor/step/action tuples, without inventing skipped votes.
const approved = (actor, step) => [actor, step, 'APPROVE']
const rejected = (actor, step) => [actor, step, 'REJECT']
const state = (status, currentStepId, expectedVotes) => ({ status, currentStepId, expectedVotes })
export const captureContract = {
  'erp-payment': {
    'payment-conditions': null,
    'payment-low-frozen': state('PENDING', 'payment-final', []),
    'payment-high-entered': state('PENDING', 'payment-check', []),
    'payment-high-partial': state('PENDING', 'payment-check', [approved('bob', 'payment-check')]),
    'payment-high-final-review': state('PENDING', 'payment-final', [approved('bob', 'payment-check'), approved('carol', 'payment-check')]),
    'payment-high-complete': state('APPROVED', null, [approved('bob', 'payment-check'), approved('carol', 'payment-check'), approved('carol', 'payment-final')]),
    'payment-low-complete': state('APPROVED', null, [approved('bob', 'payment-final')]),
  },
  'erp-receiving': {
    'receiving-conditions': null,
    'receiving-clean-frozen': state('PENDING', 'procurement-review', []),
    'receiving-exception-entered': state('PENDING', 'receiving-inspection', []),
    'receiving-exception-partial': state('PENDING', 'receiving-inspection', [approved('bob', 'receiving-inspection')]),
    'receiving-procurement-review': state('PENDING', 'procurement-review', [approved('bob', 'receiving-inspection'), approved('carol', 'receiving-inspection')]),
    'receiving-exception-approved': state('APPROVED', null, [approved('bob', 'receiving-inspection'), approved('carol', 'receiving-inspection'), approved('bob', 'procurement-review')]),
    'receiving-exception-rejected': state('REJECTED', null, [rejected('bob', 'receiving-inspection')]),
    'receiving-clean-approved': state('APPROVED', null, [approved('bob', 'procurement-review')]),
  },
  'crm-contract': {
    'contract-conditions': null,
    'contract-nonstandard-entered': state('PENDING', 'contract-review', [approved('bob', 'commercial-review')]),
    'contract-nonstandard-partial': state('PENDING', 'contract-review', [approved('bob', 'commercial-review'), approved('bob', 'contract-review')]),
    'contract-nonstandard-approved': state('APPROVED', null, [approved('bob', 'commercial-review'), approved('bob', 'contract-review'), approved('carol', 'contract-review')]),
    'contract-standard-approved': state('APPROVED', null, [approved('bob', 'commercial-review')]),
  },
}
export const captureStates = Object.values(captureContract).flatMap(Object.keys)
export const captureNames = captureStates.flatMap(state => ['en', 'zh'].flatMap(locale => ['desktop', '390px'].map(viewport => `${state}-${locale}-${viewport}`)))
export const captureJourneys = {
  'erp-payment': [
    ['payment-low-frozen', 'payment-low-complete'],
    ['payment-high-entered', 'payment-high-partial', 'payment-high-final-review', 'payment-high-complete'],
  ],
  'erp-receiving': [
    ['receiving-clean-frozen', 'receiving-clean-approved'],
    ['receiving-exception-entered', 'receiving-exception-partial', 'receiving-procurement-review', 'receiving-exception-approved'],
    ['receiving-exception-rejected'],
  ],
  'crm-contract': [
    ['contract-nonstandard-entered', 'contract-nonstandard-partial', 'contract-nonstandard-approved'],
    ['contract-standard-approved'],
  ],
}
export const expectedRoutes = {
  'payment-low-frozen': { stepIds: ['payment-final'], conditionStepId: 'payment-check', result: false, actualValue: 'CNY 6500' },
  'payment-high-entered': { stepIds: ['payment-check', 'payment-final'], conditionStepId: 'payment-check', result: true, actualValue: 'CNY 10000' },
  'receiving-clean-frozen': { stepIds: ['procurement-review'], conditionStepId: 'receiving-inspection', result: false, actualValue: 'false' },
  'receiving-exception-entered': { stepIds: ['receiving-inspection', 'procurement-review'], conditionStepId: 'receiving-inspection', result: true, actualValue: 'true' },
  'receiving-exception-rejected': { stepIds: ['receiving-inspection', 'procurement-review'], conditionStepId: 'receiving-inspection', result: true, actualValue: 'true' },
  'contract-nonstandard-entered': { stepIds: ['commercial-review', 'contract-review'], conditionStepId: 'contract-review', result: true, actualValue: 'NONSTANDARD' },
  'contract-standard-approved': { stepIds: ['commercial-review'], conditionStepId: 'contract-review', result: false, actualValue: 'STANDARD' },
}
