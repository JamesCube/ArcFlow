export const MAX_APPROVALS = 8
export const MAX_NAME_LENGTH = 120
export const cloneDefinition = definition => definition ? JSON.parse(JSON.stringify(definition)) : null
export const approvalNodes = definition => Array.isArray(definition?.nodes) ? definition.nodes.filter(node => node?.type === 'approval') : []
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value)
const hasControlCharacters = value => /[\u0000-\u001f\u007f-\u009f]/.test(value)

export function validateDefinition(definition) {
  if (!isRecord(definition)) return ['The process template is unavailable. Refresh to load it.']
  const errors = []
  if (definition.schemaVersion !== 2 || definition.id !== 'leave-approval' || !Number.isInteger(definition.version) || definition.version < 1) errors.push('Use schema 2, the leave-approval process, and a positive whole-number version.')
  if (typeof definition.name !== 'string' || !definition.name.trim()) errors.push('Give the process a name.')
  else if (hasControlCharacters(definition.name)) errors.push('The process name cannot contain control characters.')
  else if (definition.name.length > MAX_NAME_LENGTH) errors.push(`Keep the process name to ${MAX_NAME_LENGTH} characters.`)
  if (!Array.isArray(definition.nodes)) return [...errors, 'The process must contain an ordered sequence of nodes.']
  const nodes = definition.nodes
  if (nodes.some(node => !isRecord(node))) return [...errors, 'Every process node must have an identifier, type, name, and assignment.']
  const approvals = approvalNodes(definition)
  if (nodes[0]?.type !== 'start' || nodes[0]?.id !== 'start' || nodes.at(-1)?.type !== 'end' || nodes.at(-1)?.id !== 'end' || nodes.slice(1, -1).some(node => node.type !== 'approval')) errors.push('The sequence must have a fixed start, approval steps, and a fixed end.')
  if (approvals.length < 1 || approvals.length > MAX_APPROVALS || nodes.length < 3 || nodes.length > MAX_APPROVALS + 2) errors.push(`Use between 1 and ${MAX_APPROVALS} approval steps.`)
  if (new Set(nodes.map(node => node.id)).size !== nodes.length || nodes.some(node => !node.id)) errors.push('Each step must have a unique identifier.')
  if (nodes.some(node => typeof node.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(node.id))) errors.push('Step identifiers must start with a letter and use at most 64 letters, numbers, underscores, or hyphens.')
  if (nodes[0]?.assigneeId !== null || nodes.at(-1)?.assigneeId !== null) errors.push('Start and end must have no assigned approver.')
  nodes.forEach((node, index) => {
    const label = node.type === 'approval' ? `approval step ${index}` : `${node.type === 'start' ? 'start' : node.type === 'end' ? 'end' : 'process'} node`
    if (typeof node.name !== 'string' || !node.name.trim()) errors.push(`Give ${label} a name.`)
    else if (hasControlCharacters(node.name)) errors.push(`${label[0].toUpperCase() + label.slice(1)}'s name cannot contain control characters.`)
    else if (node.name.length > MAX_NAME_LENGTH) errors.push(`Keep ${label}'s name to ${MAX_NAME_LENGTH} characters.`)
    if (node.type === 'approval' && !['bob', 'carol'].includes(node.assigneeId)) errors.push(`Choose Bob or Carol for approval step ${index}.`)
  })
  return errors
}

export function stepState(request, node) {
  if (node.type === 'start') return 'completed'
  if (node.type === 'end') return request.status === 'APPROVED' ? 'completed' : request.status === 'REJECTED' ? 'skipped' : 'upcoming'
  const decision = [...(request.history || [])].reverse().find(entry => entry.stepId === node.id && ['APPROVE', 'APPROVED', 'REJECT', 'REJECTED'].includes(entry.action))
  if (decision) return ['REJECT', 'REJECTED'].includes(decision.action) ? 'rejected' : 'approved'
  if (request.status === 'PENDING' && request.currentStepId === node.id) return 'current'
  return request.status === 'PENDING' ? 'upcoming' : 'skipped'
}
export const stepStateLabel = state => ({ completed: 'Completed', approved: 'Approved', rejected: 'Rejected', current: 'Awaiting review', upcoming: 'Upcoming', skipped: 'Not reached' })[state]
