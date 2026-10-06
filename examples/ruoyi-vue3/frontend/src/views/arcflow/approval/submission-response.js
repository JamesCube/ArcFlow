// Validate a confirmed response before discarding retry identity or form input.
// Only the frozen snapshot is relevant; never consult today's active directory.
const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && !!value.trim()
const timestamp = value => text(value) && Number.isFinite(Date.parse(value))
const canonical = value => Array.isArray(value) ? value.map(canonical) : record(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const members = node => node.type === 'parallelApproval' ? node.assigneeIds : [node.assigneeId]
const invalid = () => { throw new Error('Invalid submission response') }
// SubmissionWorkflow uses Java String.trim(), which additionally removes ASCII
// boundary controls that JavaScript String.trim() leaves in the wire payload.
const serverText = value => value.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '')

export function validateSubmissionResponse(item, actor, payload, snapshot) {
  if (!record(item) || typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(item.id) ||
      item.applicantId !== actor || ['title', 'reason'].some(key => item[key] !== serverText(payload[key])) ||
      ['days', 'processVersion'].some(key => item[key] !== payload[key]) ||
      !['PENDING', 'APPROVED', 'REJECTED'].includes(item.status) || !timestamp(item.createdAt) || !timestamp(item.updatedAt) ||
      !record(item.definition)) invalid()
  const definition = item.definition, nodes = definition.nodes
  if (definition.id !== 'leave-approval' || item.processId !== definition.id || definition.version !== payload.processVersion ||
      ![2, 3].includes(definition.schemaVersion) || !text(definition.name) || !Array.isArray(nodes) || nodes.length < 3 || nodes.length > 10 ||
      nodes.some(node => !record(node) || !text(node.id) || !text(node.name)) || new Set(nodes.map(node => node.id)).size !== nodes.length ||
      nodes[0].id !== 'start' || nodes[0].type !== 'start' || nodes[0].assigneeId !== null ||
      nodes.at(-1).id !== 'end' || nodes.at(-1).type !== 'end' || nodes.at(-1).assigneeId !== null) invalid()
  const steps = nodes.slice(1, -1)
  for (const node of steps) {
    if (node.type === 'approval') { if (!text(node.assigneeId)) invalid() }
    else if (node.type === 'parallelApproval') {
      if (definition.schemaVersion !== 3 || node.assigneeId !== null || !['ALL', 'ANY'].includes(node.completionMode) ||
          !Array.isArray(node.assigneeIds) || node.assigneeIds.length < 2 || node.assigneeIds.length > 16 ||
          node.assigneeIds.some(id => !text(id)) || new Set(node.assigneeIds).size !== node.assigneeIds.length) invalid()
    } else invalid()
    if (members(node).includes(actor)) invalid()
  }
  if (JSON.stringify(canonical(definition)) !== JSON.stringify(canonical(snapshot)) ||
      !Array.isArray(item.history) || !item.history.length || item.history.length > 129) invalid()
  const seen = new Set()
  for (const [index, event] of item.history.entries()) {
    if (!record(event) || !text(event.actorId) || typeof event.comment !== 'string' || !timestamp(event.at)) invalid()
    if (index === 0) {
      if (event.action !== 'SUBMIT' || event.actorId !== actor || event.stepId !== null || event.comment !== '' || event.at !== item.createdAt) invalid()
    } else {
      const step = steps.find(node => node.id === event.stepId), vote = JSON.stringify([event.stepId, event.actorId])
      if (!step || !['APPROVE', 'REJECT'].includes(event.action) || !members(step).includes(event.actorId) || seen.has(vote) ||
          Date.parse(event.at) < Date.parse(item.history[index - 1].at)) invalid()
      seen.add(vote)
    }
  }
  const last = item.history.at(-1), current = steps.find(node => node.id === item.currentStepId)
  if (item.updatedAt !== last.at || (item.history.length === 1 ? item.decision !== null || item.comment !== null
      : item.decision !== last.action || item.comment !== last.comment)) invalid()
  if (item.status === 'PENDING') {
    if (!current || !members(current).includes(item.approverId) || seen.has(JSON.stringify([current.id, item.approverId]))) invalid()
  } else if (item.currentStepId !== null || item.history.length < 2 || item.approverId !== last.actorId ||
      last.action !== (item.status === 'APPROVED' ? 'APPROVE' : 'REJECT')) invalid()
  return item
}
