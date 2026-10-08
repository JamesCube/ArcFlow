import { expenseErrors, normalizeExpense, expenseTotal, InvalidScenarioPayload, TEMPLATE_ID, exactKeys, invalid, same, isRecord, serverTrim } from './expense-document.js'
import { validateDefinition, participants } from '../process.js'
import { parseScenarioInstant } from './scenario-instant.js'
const stableText = (value, limit) => typeof value === 'string' && !!value.trim() && value.length <= limit && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
const timestamp = value => parseScenarioInstant(value) !== null
function validateRequest(item, actor, payload, snapshot, handler) {
  const expectedFields = ['id', 'title', 'reason', 'days', 'applicantId', 'approverId', 'status', 'createdAt', 'updatedAt', 'decision', 'comment', 'processId', 'processVersion', 'definition', 'currentStepId', 'history', 'business']
  if (!exactKeys(item, expectedFields) || handler.errors(item.business).length || handler.errors(payload.business).length ||
      !same(handler.normalize(item.business), handler.normalize(payload.business)) || !same(item.business, handler.normalize(item.business))) invalid()
  if (typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(item.id) || !stableText(item.applicantId, 128) || item.applicantId !== actor ||
      ['title', 'reason'].some(key => item[key] !== serverTrim(payload.business[key])) || item.days !== 0 || item.processVersion !== payload.processVersion ||
      !['PENDING', 'APPROVED', 'REJECTED'].includes(item.status) || !timestamp(item.createdAt) || !timestamp(item.updatedAt) || !isRecord(item.definition)) invalid()
  const definition = item.definition
  if (validateDefinition(definition, handler.id).length || definition.version > 2147483647 || item.processId !== definition.id || definition.version !== payload.processVersion || !same(definition, snapshot)) invalid()
  const steps = definition.nodes.slice(1, -1)
  if (steps.some(node => participants(node).includes(actor)) || !Array.isArray(item.history) || !item.history.length || item.history.length > 129) invalid()
  let stepIndex = 0, derivedStatus = 'PENDING', voted = new Set()
  const seen = new Set()
  for (const [index, event] of item.history.entries()) {
    if (!exactKeys(event, ['actorId', 'action', 'at', 'stepId', 'comment']) || !stableText(event.actorId, 128) || typeof event.comment !== 'string' || event.comment.length > 2000 || !timestamp(event.at)) invalid()
    if (index === 0) {
      if (event.action !== 'SUBMIT' || event.actorId !== actor || event.stepId !== null || event.comment !== '' || event.at !== item.createdAt) invalid()
      continue
    }
    const step = steps.find(node => node.id === event.stepId), vote = JSON.stringify([event.stepId, event.actorId])
    if (!step || !['APPROVE', 'REJECT'].includes(event.action) || !participants(step).includes(event.actorId) || seen.has(vote) || parseScenarioInstant(event.at) < parseScenarioInstant(item.history[index - 1].at) || derivedStatus !== 'PENDING' || steps[stepIndex].id !== event.stepId) invalid()
    seen.add(vote); voted.add(event.actorId)
    const all = step.type === 'approval' || step.completionMode === 'ALL', everyone = voted.size === participants(step).length
    if (event.action === 'REJECT' && (all || everyone)) derivedStatus = 'REJECTED'
    else if (event.action === 'APPROVE' && (!all || everyone)) { stepIndex++; voted = new Set(); if (stepIndex === steps.length) derivedStatus = 'APPROVED' }
  }
  if (item.status !== derivedStatus || item.currentStepId !== (derivedStatus === 'PENDING' ? steps[stepIndex].id : null)) invalid()
  const last = item.history.at(-1), current = steps.find(node => node.id === item.currentStepId)
  if (item.updatedAt !== last.at || (item.history.length === 1 ? item.decision !== null || item.comment !== null : item.decision !== last.action || item.comment !== last.comment)) invalid()
  if (item.status === 'PENDING') {
    if (!current || participants(current).filter(id => !voted.has(id))[0] !== item.approverId || seen.has(JSON.stringify([current.id, item.approverId]))) invalid()
  } else if (item.currentStepId !== null || item.history.length < 2 || item.approverId !== last.actorId || last.action !== (item.status === 'APPROVED' ? 'APPROVE' : 'REJECT')) invalid()
  return item
}
export function createScenarioValidators(handler) {
  function validateScenarioView(view, expected = null) {
    if (!exactKeys(view, ['request', 'total'])) invalid()
    const item = view.request
    if (!isRecord(item)) invalid()
    validateRequest(item, expected?.actor ?? item.applicantId, expected?.payload ?? { business: item.business, processVersion: item.processVersion }, expected?.definition ?? item.definition, handler)
    if (typeof view.total !== 'string' || view.total !== handler.total(item.business)) invalid()
    return view
  }
  function validateScenarioDecision(view, original, actor, stepId, decision, expectedComment) {
    validateScenarioView(original)
    validateScenarioView(view, { actor: original.request.applicantId, payload: { business: original.request.business, processVersion: original.request.processVersion }, definition: original.request.definition })
    const item = view.request, before = original.request
    if (item.id !== before.id || item.createdAt !== before.createdAt || !same(item.history.slice(0, before.history.length), before.history) ||
        !item.history.slice(before.history.length).some(event => event.actorId === actor && event.stepId === stepId && event.action === decision)) invalid()
    const vote = item.history.slice(before.history.length).find(event => event.actorId === actor && event.stepId === stepId && event.action === decision)
    if (expectedComment !== undefined && vote.comment !== expectedComment) {
      throw Object.assign(new InvalidScenarioPayload(), { code: 'DECISION_COMMENT_MISMATCH' })
    }
    return view
  }
  function validateScenarioList(items) {
    if (!Array.isArray(items) || new Set(items.map(item => item?.request?.id)).size !== items.length) invalid()
    items.forEach(item => validateScenarioView(item)); return items
  }

  return { validateView: validateScenarioView, validateDecision: validateScenarioDecision, validateList: validateScenarioList }
}
const expenseValidators = createScenarioValidators({ id: TEMPLATE_ID, errors: expenseErrors, normalize: normalizeExpense, total: expenseTotal })
export const validateScenarioView = expenseValidators.validateView
export const validateScenarioDecision = expenseValidators.validateDecision
export const validateScenarioList = expenseValidators.validateList
