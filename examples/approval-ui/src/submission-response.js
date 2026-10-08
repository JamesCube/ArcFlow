import { requestBusiness, businessDocumentErrors, parseUnitPrice } from './business-document.js'

// Validate a confirmed response before discarding retry identity or form input.
// Only the frozen snapshot is relevant; never consult today's active directory.
const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && !!value.trim()
const stableText = (value, limit) => text(value) && value.length <= limit && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
const exactFields = (value, expected) => Object.keys(value).length === expected.length && expected.every(key => Object.prototype.hasOwnProperty.call(value, key))
const timestamp = value => text(value) && Number.isFinite(Date.parse(value))
const canonical = value => Array.isArray(value) ? value.map(canonical) : record(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const members = node => node.type === 'parallelApproval' ? node.assigneeIds : [node.assigneeId]
const invalid = () => { throw new Error('Invalid submission response') }
// SubmissionWorkflow uses Java String.trim(), which additionally removes ASCII
// boundary controls that JavaScript String.trim() leaves in the wire payload.
const serverText = value => value.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '')

export function validateSubmissionResponse(item, actor, payload, snapshot) {
  const typed = Object.prototype.hasOwnProperty.call(payload, 'business')
  const expectedFields = ['id', 'title', 'reason', 'days', 'applicantId', 'approverId', 'status', 'createdAt', 'updatedAt', 'decision', 'comment', 'processId', 'processVersion', 'definition', 'currentStepId', 'history', ...(typed ? ['business'] : [])]
  const common = typed ? payload.business : payload
  try { requestBusiness(item) } catch { invalid() }
  if (typed) {
    if (businessDocumentErrors(payload.business, { wire: true }).length || businessDocumentErrors(item.business, { wire: true }).length) invalid()
    for (const key of Object.keys(payload.business)) {
      const expected = ['title', 'reason', 'item'].includes(key) ? serverText(payload.business[key]) : payload.business[key]
      if (key === 'unitPrice' ? parseUnitPrice(item.business[key], item.business.currency) !== parseUnitPrice(expected, payload.business.currency) : item.business[key] !== expected) invalid()
    }
  }
  if (!record(item) || Object.keys(item).some(key => !expectedFields.includes(key)) || expectedFields.some(key => !Object.prototype.hasOwnProperty.call(item, key)) || typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(item.id) ||
      !stableText(item.applicantId, 128) || item.applicantId !== actor || ['title', 'reason'].some(key => item[key] !== serverText(common[key])) ||
      item.days !== (typed && common.type === 'procurement' ? 0 : common.days) || item.processVersion !== payload.processVersion ||
      !['PENDING', 'APPROVED', 'REJECTED'].includes(item.status) || !timestamp(item.createdAt) || !timestamp(item.updatedAt) ||
      !record(item.definition)) invalid()
  const definition = item.definition, nodes = definition.nodes
  if (!exactFields(definition, ['schemaVersion', 'id', 'version', 'name', 'nodes']) || typeof definition.id !== 'string' || !/^([A-Za-z][A-Za-z0-9_-]{0,127})$/.test(definition.id) || item.processId !== definition.id || definition.version !== payload.processVersion || !Number.isInteger(definition.version) || definition.version < 1 || definition.version > 2147483647 ||
      ![2, 3].includes(definition.schemaVersion) || !stableText(definition.name, 120) || !Array.isArray(nodes) || nodes.length < 3 || nodes.length > 10 ||
      nodes.some(node => !record(node) || typeof node.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(node.id) || !stableText(node.name, 120) || !exactFields(node, node.type === 'parallelApproval' ? ['id', 'type', 'name', 'assigneeId', 'assigneeIds', 'completionMode'] : ['id', 'type', 'name', 'assigneeId'])) || new Set(nodes.map(node => node.id)).size !== nodes.length ||
      nodes[0].id !== 'start' || nodes[0].type !== 'start' || nodes[0].assigneeId !== null ||
      nodes.at(-1).id !== 'end' || nodes.at(-1).type !== 'end' || nodes.at(-1).assigneeId !== null) invalid()
  const steps = nodes.slice(1, -1)
  for (const node of steps) {
    if (node.type === 'approval') { if (!stableText(node.assigneeId, 128)) invalid() }
    else if (node.type === 'parallelApproval') {
      if (definition.schemaVersion !== 3 || node.assigneeId !== null || !['ALL', 'ANY'].includes(node.completionMode) ||
          !Array.isArray(node.assigneeIds) || node.assigneeIds.length < 2 || node.assigneeIds.length > 16 ||
          node.assigneeIds.some(id => !stableText(id, 128)) || new Set(node.assigneeIds).size !== node.assigneeIds.length) invalid()
    } else invalid()
    if (members(node).includes(actor)) invalid()
  }
  if (JSON.stringify(canonical(definition)) !== JSON.stringify(canonical(snapshot)) ||
      !Array.isArray(item.history) || !item.history.length || item.history.length > 129) invalid()
  const seen = new Set()
  let stepIndex = 0, derivedStatus = 'PENDING', voted = new Set()
  for (const [index, event] of item.history.entries()) {
    if (!record(event) || Object.keys(event).sort().join(',') !== 'action,actorId,at,comment,stepId' || !stableText(event.actorId, 128) || typeof event.comment !== 'string' || event.comment.length > 2000 || !timestamp(event.at)) invalid()
    if (index === 0) {
      if (event.action !== 'SUBMIT' || event.actorId !== actor || event.stepId !== null || event.comment !== '' || event.at !== item.createdAt) invalid()
    } else {
      const step = steps.find(node => node.id === event.stepId), vote = JSON.stringify([event.stepId, event.actorId])
      if (!step || !['APPROVE', 'REJECT'].includes(event.action) || !members(step).includes(event.actorId) || seen.has(vote) ||
          Date.parse(event.at) < Date.parse(item.history[index - 1].at)) invalid()
      if (derivedStatus !== 'PENDING' || steps[stepIndex].id !== event.stepId) invalid()
      seen.add(vote); voted.add(event.actorId)
      const all = step.type === 'approval' || step.completionMode === 'ALL'
      const everyone = voted.size === members(step).length
      if (event.action === 'REJECT' && (all || everyone)) derivedStatus = 'REJECTED'
      else if (event.action === 'APPROVE' && (!all || everyone)) {
        stepIndex++; voted = new Set()
        if (stepIndex === steps.length) derivedStatus = 'APPROVED'
      }
    }
  }
  if (item.status !== derivedStatus || item.currentStepId !== (derivedStatus === 'PENDING' ? steps[stepIndex].id : null)) invalid()
  const last = item.history.at(-1), current = steps.find(node => node.id === item.currentStepId)
  if (item.updatedAt !== last.at || (item.history.length === 1 ? item.decision !== null || item.comment !== null
      : item.decision !== last.action || item.comment !== last.comment)) invalid()
  if (item.status === 'PENDING') {
    if (!current || members(current).filter(id => !voted.has(id))[0] !== item.approverId || seen.has(JSON.stringify([current.id, item.approverId]))) invalid()
  } else if (item.currentStepId !== null || item.history.length < 2 || item.approverId !== last.actorId ||
      last.action !== (item.status === 'APPROVED' ? 'APPROVE' : 'REJECT')) invalid()
  return item
}

// A valid-looking unchanged response does not confirm a decision. Confirm the
// exact requested vote in the append-only audit, even when a retry returns a
// newer state that includes other participants' subsequent decisions. The server
// intentionally retains an already-saved comment on same-action retries.
export function validateDecisionResponse(item, original, actor, stepId, decision) {
  const payload = Object.prototype.hasOwnProperty.call(original, 'business')
    ? { business: original.business, processVersion: original.processVersion }
    : { title: original.title, reason: original.reason, days: original.days, processVersion: original.processVersion }
  validateSubmissionResponse(original, original.applicantId, payload, original.definition)
  validateSubmissionResponse(item, original.applicantId, payload, original.definition)
  if (item.id !== original.id || item.createdAt !== original.createdAt ||
      JSON.stringify(canonical(item.history.slice(0, original.history.length))) !== JSON.stringify(canonical(original.history)) ||
      !item.history.slice(original.history.length).some(event => event.actorId === actor && event.stepId === stepId &&
        event.action === decision)) invalid()
  return item
}
