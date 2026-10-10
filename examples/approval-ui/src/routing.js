import { CURRENCIES, amountCents, expenseErrors, exactKeys, isRecord, same } from './scenarios/expense-document.js'
import { paymentErrors, paymentAmountCents } from './scenarios/payment-document.js'
import { receivingErrors, quantity } from './scenarios/receiving-document.js'
import { contractErrors } from './scenarios/contract-document.js'

export const MAX_ROUTING_PREDICATES = 8
export const ROUTING_FIELDS = Object.freeze({
  'oa-expense': 'expense.totalAmount',
  'erp-payment': 'payment.netTotal',
  'erp-receiving': 'receiving.hasRejectedLines',
  'crm-contract': 'contract.termsKind',
})
export const supportsRouting = processId => typeof processId === 'string' && Object.hasOwn(ROUTING_FIELDS, processId)
const approval = node => ['approval', 'parallelApproval'].includes(node?.type)
const nodesFor = definition => Array.isArray(definition?.nodes) ? definition.nodes.filter(approval) : []
const hasCondition = node => isRecord(node) && Object.hasOwn(node, 'runIf')
const moneyField = field => ['expense.totalAmount', 'payment.netTotal'].includes(field)

// Parse the decimal spelling rather than multiply a floating-point value by 100.
// Thresholds are numeric on the wire; document amounts remain decimal strings.
export function routingThresholdCents(value, currency) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 20000000000 || !CURRENCIES.includes(currency)) return null
  const text = String(value)
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return currency === 'JPY' && cents % 100n !== 0n ? null : cents
}

function validPredicate(predicate, processId) {
  if (!isRecord(predicate) || predicate.field !== ROUTING_FIELDS[processId]) return false
  if (moneyField(predicate.field)) return exactKeys(predicate, ['field', 'operator', 'currency', 'threshold']) &&
    ['EQ', 'GT', 'GTE', 'LT', 'LTE'].includes(predicate.operator) && routingThresholdCents(predicate.threshold, predicate.currency) !== null
  if (predicate.field === 'receiving.hasRejectedLines') return exactKeys(predicate, ['field', 'operator', 'expected']) &&
    predicate.operator === 'EQ' && typeof predicate.expected === 'boolean'
  if (predicate.field === 'contract.termsKind') return exactKeys(predicate, ['field', 'operator', 'values']) &&
    ['EQ', 'IN'].includes(predicate.operator) && Array.isArray(predicate.values) && predicate.values.length >= 1 &&
    predicate.values.length <= (predicate.operator === 'EQ' ? 1 : 2) && new Set(predicate.values).size === predicate.values.length &&
    Array.from(predicate.values).every(value => ['STANDARD', 'NONSTANDARD'].includes(value))
  return false
}

// This only validates the routing extension. The shared definition validator
// continues to enforce the unchanged ordered approval/assignment contract.
export function validateRoutingDefinition(definition) {
  if (!isRecord(definition) || !Array.isArray(definition.nodes)) return ['The conditional process must contain an ordered sequence of nodes.']
  const errors = [], conditional = definition.nodes.filter(hasCondition)
  if (definition.schemaVersion !== 4) return conditional.length ? ['Conditions require process schema 4.'] : []
  if (!supportsRouting(definition.id)) errors.push('Conditional routing is supported only for OA expense, ERP payment, ERP receiving, and CRM contract processes.')
  if (!nodesFor(definition).some(node => !hasCondition(node))) errors.push('Keep at least one unconditional approval step.')
  let count = 0
  const currencies = new Set()
  for (const node of conditional) {
    if (!approval(node)) errors.push('Start and end nodes cannot have conditions.')
    const rule = node.runIf
    if (!exactKeys(rule, ['mode', 'predicates']) || !['ALL', 'ANY'].includes(rule.mode) ||
        !Array.isArray(rule.predicates) || rule.predicates.length < 1 || rule.predicates.length > MAX_ROUTING_PREDICATES) {
      errors.push(`Use ALL or ANY with 1–${MAX_ROUTING_PREDICATES} flat predicates for the condition on step ${node.id}.`)
      continue
    }
    count += rule.predicates.length
    for (const predicate of rule.predicates) if (moneyField(predicate?.field)) currencies.add(predicate.currency)
    if (Array.from(rule.predicates).some(predicate => !validPredicate(predicate, definition.id))) errors.push(`Use supported condition fields and values for the ${definition.id} process on step ${node.id}.`)
  }
  if (currencies.size > 1) errors.push('Use the same currency for every amount condition in the process.')
  if (count > MAX_ROUTING_PREDICATES) errors.push(`Use at most ${MAX_ROUTING_PREDICATES} condition predicates across the process.`)
  return errors
}

export class RoutingEvaluationError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'RoutingEvaluationError'
    this.code = code
    Object.assign(this, details)
  }
}
const fail = (code, message, details) => { throw new RoutingEvaluationError(code, message, details) }
const decimalText = cents => {
  const whole = String(cents / 100n), fraction = String(cents % 100n).padStart(2, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}
const compareMoney = (actual, expected, operator) => ({ EQ: actual === expected, GT: actual > expected, GTE: actual >= expected, LT: actual < expected, LTE: actual <= expected })[operator]

export function evaluateRouting(definition, business) {
  if (definition?.schemaVersion !== 4) return null
  if (validateRoutingDefinition(definition).length) fail('INVALID_ROUTING_DEFINITION', 'The conditional process definition is invalid.')
  const errors = { 'oa-expense': expenseErrors, 'erp-payment': paymentErrors, 'erp-receiving': receivingErrors, 'crm-contract': contractErrors }[definition.id]
  if (!errors || errors(business).length) fail('INVALID_ROUTING_BUSINESS', 'Complete a valid document before evaluating its conditions.')
  const steps = nodesFor(definition), evaluations = [], stepIds = []
  // Derive facts only from this request's business snapshot, never a UI total,
  // mutable catalog, latest process, or server-supplied routing evaluation.
  const paymentNet = definition.id === 'erp-payment' ? business.lines.reduce((sum, line) =>
    sum + paymentAmountCents(line.allocationAmount, business.currency) - paymentAmountCents(line.deductionAmount, business.currency, true), 0n) : null
  const expenseTotal = definition.id === 'oa-expense' ? business.lines.reduce((sum, line) =>
    sum + amountCents(line.amount, business.currency), 0n) : null
  const rejected = definition.id === 'erp-receiving' ? business.lines.some(line => quantity(line.rejected) > 0) : null
  for (const step of steps) {
    if (!hasCondition(step)) { stepIds.push(step.id); continue }
    const predicates = step.runIf.predicates.map(predicate => {
      let actualValue, result
      if (moneyField(predicate.field)) {
        if (predicate.currency !== business.currency) fail('CURRENCY_MISMATCH', 'The document currency must match every condition currency. Currency conversion is not supported.', { stepId: step.id, expectedCurrency: predicate.currency, actualCurrency: business.currency })
        const total = predicate.field === 'expense.totalAmount' ? expenseTotal : paymentNet
        actualValue = `${business.currency} ${decimalText(total)}`
        result = compareMoney(total, routingThresholdCents(predicate.threshold, predicate.currency), predicate.operator)
      } else if (predicate.field === 'receiving.hasRejectedLines') {
        actualValue = String(rejected)
        result = rejected === predicate.expected
      } else {
        actualValue = business.termsKind
        result = predicate.values.includes(actualValue)
      }
      return { field: predicate.field, actualValue, result }
    })
    const result = step.runIf.mode === 'ALL' ? predicates.every(predicate => predicate.result) : predicates.some(predicate => predicate.result)
    evaluations.push({ stepId: step.id, result, predicates })
    if (result) stepIds.push(step.id)
  }
  return { schemaVersion: 1, stepIds, evaluations }
}

export function validateRequestRouting(request) {
  if (request?.definition?.schemaVersion !== 4) {
    if (isRecord(request) && Object.hasOwn(request, 'routing')) fail('INVALID_ROUTING_SNAPSHOT', 'Legacy requests cannot contain a routing snapshot.')
    return null
  }
  const actual = request.routing
  if (!exactKeys(actual, ['schemaVersion', 'stepIds', 'evaluations']) || actual.schemaVersion !== 1 ||
      !Array.isArray(actual.stepIds) || actual.stepIds.some(id => typeof id !== 'string') || !Array.isArray(actual.evaluations) ||
      actual.evaluations.some(evaluation => !exactKeys(evaluation, ['stepId', 'result', 'predicates']) || typeof evaluation.stepId !== 'string' || typeof evaluation.result !== 'boolean' ||
        !Array.isArray(evaluation.predicates) || evaluation.predicates.some(predicate => !exactKeys(predicate, ['field', 'actualValue', 'result']) ||
          typeof predicate.field !== 'string' || typeof predicate.actualValue !== 'string' || typeof predicate.result !== 'boolean'))) {
    fail('INVALID_ROUTING_SNAPSHOT', 'The request routing snapshot is missing or invalid.')
  }
  const expected = evaluateRouting(request.definition, request.business)
  if (!same(actual, expected)) fail('INVALID_ROUTING_SNAPSHOT', 'The routing snapshot does not match the saved process and document.')
  return actual
}

export function effectiveApprovalNodes(request) {
  const steps = nodesFor(request?.definition), routing = validateRequestRouting(request)
  return routing ? steps.filter(step => routing.stepIds.includes(step.id)) : steps
}
