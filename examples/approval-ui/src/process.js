export const MAX_APPROVALS = 8
export const MAX_NAME_LENGTH = 120
export const cloneDefinition = definition => definition ? JSON.parse(JSON.stringify(definition)) : null
export const isApproval = node => ['approval', 'parallelApproval'].includes(node?.type)
export const approvalNodes = definition => Array.isArray(definition?.nodes) ? definition.nodes.filter(isApproval) : []
export const participants = node => node?.type === 'parallelApproval' ? (Array.isArray(node.assigneeIds) ? node.assigneeIds : []) : node?.type === 'approval' && node.assigneeId ? [node.assigneeId] : []
export const approvalMode = node => node?.type === 'parallelApproval' ? node.completionMode : 'SINGLE'
const isApprove = action => ['APPROVE', 'APPROVED'].includes(action)
const isVote = event => ['APPROVE', 'APPROVED', 'REJECT', 'REJECTED'].includes(event.action)
const votesFor = (request, node) => (request?.history || []).filter(event => event.stepId === node?.id && isVote(event))
export function pendingParticipants(request) {
  if (request?.status !== 'PENDING' || !request.currentStepId) return []
  const node = request.definition?.nodes?.find(node => node.id === request.currentStepId)
  const voters = new Set(votesFor(request, node).map(event => event.actorId))
  return participants(node).filter(id => !voters.has(id))
}
export function setApprovalMode(definition, nodeId, mode, availableIds = ['bob', 'carol']) {
  const copy = cloneDefinition(definition)
  const index = copy?.nodes?.findIndex(node => node.id === nodeId && isApproval(node)) ?? -1
  if (index < 0 || !['SINGLE', 'ALL', 'ANY'].includes(mode)) return copy
  const old = copy.nodes[index], members = participants(old)
  const node = { id: old.id, type: mode === 'SINGLE' ? 'approval' : 'parallelApproval', name: old.name, assigneeId: mode === 'SINGLE' ? (members[0] || availableIds[0] || null) : null }
  if (mode !== 'SINGLE') {
    node.assigneeIds = old.type === 'parallelApproval' ? [...members] : [...new Set([...members, ...availableIds])]
    node.completionMode = mode
    copy.schemaVersion = 3
  }
  copy.nodes[index] = node
  return copy
}
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value)
const hasControlCharacters = value => /[\u0000-\u001f\u007f-\u009f]/.test(value)

export function validateDefinition(definition, expectedProcessId = 'leave-approval') {
  // Preserve legacy use as an Array callback (which supplies its index), and
  // native-parity callers that pass a directory. Only an explicit string opts in.
  if (typeof expectedProcessId !== 'string') expectedProcessId = 'leave-approval'
  if (!isRecord(definition)) return ['The process template is unavailable. Refresh to load it.']
  const errors = []
  if (Object.keys(definition).some(key => !['schemaVersion', 'id', 'version', 'name', 'nodes'].includes(key))) errors.push('The process contains unsupported fields.')
  if (![2, 3].includes(definition.schemaVersion) || definition.id !== expectedProcessId || !Number.isInteger(definition.version) || definition.version < 1) errors.push(`Use schema 2 or 3, the ${expectedProcessId} process, and a positive whole-number version.`)
  if (typeof definition.name !== 'string' || !definition.name.trim()) errors.push('Give the process a name.')
  else if (hasControlCharacters(definition.name)) errors.push('The process name cannot contain control characters.')
  else if (definition.name.length > MAX_NAME_LENGTH) errors.push(`Keep the process name to ${MAX_NAME_LENGTH} characters.`)
  if (!Array.isArray(definition.nodes)) return [...errors, 'The process must contain an ordered sequence of nodes.']
  const nodes = definition.nodes
  if (nodes.some(node => !isRecord(node))) return [...errors, 'Every process node must have an identifier, type, name, and assignment.']
  const approvals = approvalNodes(definition)
  if (nodes[0]?.type !== 'start' || nodes[0]?.id !== 'start' || nodes.at(-1)?.type !== 'end' || nodes.at(-1)?.id !== 'end' || nodes.slice(1, -1).some(node => !isApproval(node))) errors.push('The sequence must have a fixed start, approval steps, and a fixed end.')
  if (approvals.length < 1 || approvals.length > MAX_APPROVALS || nodes.length < 3 || nodes.length > MAX_APPROVALS + 2) errors.push(`Use between 1 and ${MAX_APPROVALS} approval steps.`)
  if (new Set(nodes.map(node => node.id)).size !== nodes.length || nodes.some(node => !node.id)) errors.push('Each step must have a unique identifier.')
  if (nodes.some(node => typeof node.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(node.id))) errors.push('Step identifiers must start with a letter and use at most 64 letters, numbers, underscores, or hyphens.')
  if (nodes[0]?.assigneeId !== null || nodes.at(-1)?.assigneeId !== null) errors.push('Start and end must have no assigned approver.')
  nodes.forEach((node, index) => {
    const label = isApproval(node) ? `approval step ${index}` : `${node.type === 'start' ? 'start' : node.type === 'end' ? 'end' : 'process'} node`
    if (typeof node.name !== 'string' || !node.name.trim()) errors.push(`Give ${label} a name.`)
    else if (hasControlCharacters(node.name)) errors.push(`${label[0].toUpperCase() + label.slice(1)}'s name cannot contain control characters.`)
    else if (node.name.length > MAX_NAME_LENGTH) errors.push(`Keep ${label}'s name to ${MAX_NAME_LENGTH} characters.`)
    const allowed = node.type === 'parallelApproval' ? ['id', 'type', 'name', 'assigneeId', 'assigneeIds', 'completionMode'] : ['id', 'type', 'name', 'assigneeId']
    if (Object.keys(node).some(key => !allowed.includes(key)) || allowed.some(key => !Object.hasOwn(node, key))) errors.push(`Use the supported fields for ${label}.`)
    if (node.type === 'parallelApproval') {
      if (definition.schemaVersion !== 3 || node.assigneeId !== null || !['ALL', 'ANY'].includes(node.completionMode)) errors.push(`Use schema 3 and ALL or ANY for approval step ${index}, with no single assignee.`)
      if (!Array.isArray(node.assigneeIds) || node.assigneeIds.length < 2 || node.assigneeIds.length > 16 || new Set(node.assigneeIds).size !== node.assigneeIds.length || node.assigneeIds.some(id => !['bob', 'carol'].includes(id))) errors.push(`Choose at least two distinct participants (Bob and Carol) for approval step ${index}.`)
    }
    if (node.type === 'approval' && !['bob', 'carol'].includes(node.assigneeId)) errors.push(`Choose Bob or Carol for approval step ${index}.`)
  })
  return errors
}

export function stepState(request, node) {
  if (node.type === 'start') return 'completed'
  if (node.type === 'end') return request.status === 'APPROVED' ? 'completed' : request.status === 'REJECTED' ? 'skipped' : 'upcoming'
  const votes = votesFor(request, node)
  if (node.type === 'parallelApproval') {
    const approvals = new Set(votes.filter(event => isApprove(event.action)).map(event => event.actorId))
    const rejections = new Set(votes.filter(event => !isApprove(event.action)).map(event => event.actorId))
    if (node.completionMode === 'ALL' && rejections.size) return 'rejected'
    if (node.completionMode === 'ANY' && approvals.size) return 'approved'
    if (node.completionMode === 'ALL' && participants(node).every(id => approvals.has(id))) return 'approved'
    if (node.completionMode === 'ANY' && participants(node).every(id => rejections.has(id))) return 'rejected'
  } else if (votes.length) return isApprove(votes.at(-1).action) ? 'approved' : 'rejected'
  if (request.status === 'PENDING' && request.currentStepId === node.id) return 'current'
  return request.status === 'PENDING' ? 'upcoming' : 'skipped'
}
export const stepStateLabel = state => ({ completed: 'Completed', approved: 'Approved', rejected: 'Rejected', current: 'Awaiting review', upcoming: 'Upcoming', skipped: 'Not reached' })[state]

export function participantVotes(request, node) {
  const votes = votesFor(request, node), state = stepState(request, node)
  return participants(node).map(actorId => {
    const event = votes.find(event => event.actorId === actorId)
    return { actorId, state: event ? (isApprove(event.action) ? 'approved' : 'rejected') : ['approved', 'rejected'].includes(state) ? 'not-needed' : state === 'current' ? 'pending' : state === 'upcoming' ? 'upcoming' : 'skipped', comment: event?.comment || '', at: event?.at || null }
  })
}
export const participantStateLabel = state => ({ approved: 'Approved', rejected: 'Rejected', pending: 'Awaiting vote', upcoming: 'Upcoming', 'not-needed': 'Not required', skipped: 'Not reached' })[state]

// Publication must acknowledge the exact ordered process sent by this editor.
// Object key order is irrelevant; stage and participant order are preserved by
// ApprovalService.publish and are part of the returned runtime definition.
export function validatePublicationResponse(published, submitted, expectedProcessId = 'leave-approval') {
  const content = definition => [definition.schemaVersion, definition.id, definition.name,
    definition.nodes.map(node => [node.id, node.type, node.name, node.assigneeId,
      ...(node.type === 'parallelApproval' ? [node.assigneeIds, node.completionMode] : [])])]
  if (validateDefinition(published, expectedProcessId).length || published.version !== submitted.version + 1
    || JSON.stringify(content(published)) !== JSON.stringify(content(submitted))) {
    throw Object.assign(new Error('The publication response did not confirm the submitted template and next version.'), { name: 'InvalidPublicationResponseError' })
  }
  return published
}
