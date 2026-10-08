export const clone = value => JSON.parse(JSON.stringify(value))
export const isApproval = node => ['approval', 'parallelApproval'].includes(node?.type)
export const approvals = definition => Array.isArray(definition?.nodes) ? definition.nodes.filter(isApproval) : []
export const participants = node => node?.type === 'parallelApproval' ? (Array.isArray(node.assigneeIds) ? node.assigneeIds : []) : node?.type === 'approval' && node.assigneeId ? [node.assigneeId] : []
export const approvalMode = node => node?.type === 'parallelApproval' ? node.completionMode : 'SINGLE'
export const modeLabel = node => ({ SINGLE: '单人审批', ALL: '全员同意（ALL）', ANY: '任一同意（ANY）' })[approvalMode(node)] || '无效完成方式'
export const modeRule = node => ({ SINGLE: '由指定审批人决定。', ALL: '全部参与人同意才通过，任一拒绝即驳回。', ANY: '任一参与人同意即通过，全部拒绝才驳回。' })[approvalMode(node)] || ''
export const validText = (text, limit) => typeof text === 'string' && !!text.trim() && text.length <= limit && !/[\u0000-\u001f\u007f-\u009f]/.test(text)
const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
const exactFields = (value, fields) => Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key))
const votesFor = (request, node) => (request?.history || []).filter(event => event.stepId === node?.id && ['APPROVE', 'REJECT'].includes(event.action))

// Conversion keeps the stable step ID and never silently adds people from the directory.
export function setApprovalMode(definition, nodeId, mode) {
  const copy = clone(definition)
  const index = copy?.nodes?.findIndex(node => node.id === nodeId && isApproval(node)) ?? -1
  if (index < 0 || !['SINGLE', 'ALL', 'ANY'].includes(mode)) return copy
  const old = copy.nodes[index], members = participants(old)
  const node = { id: old.id, type: mode === 'SINGLE' ? 'approval' : 'parallelApproval', name: old.name, assigneeId: mode === 'SINGLE' ? (members[0] || '') : null }
  if (mode !== 'SINGLE') {
    node.assigneeIds = [...members]
    node.completionMode = mode
    copy.schemaVersion = 3
  }
  copy.nodes[index] = node
  return copy
}

export function validateDefinition(definition, people) {
  if (!record(definition) || !Array.isArray(definition.nodes)) return '请先加载流程定义'
  if (!exactFields(definition, ['schemaVersion', 'id', 'version', 'name', 'nodes']) || ![2, 3].includes(definition.schemaVersion) || typeof definition.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(definition.id) || !Number.isInteger(definition.version) || definition.version < 1) return '流程定义格式或版本无效'
  if (!validText(definition.name, 120)) return '请输入有效的流程名称（最多 120 字）'
  const nodes = definition.nodes, steps = approvals(definition)
  if (nodes.some(node => !record(node))) return '节点格式无效'
  if (steps.length < 1 || steps.length > 8 || nodes.length !== steps.length + 2) return '流程需要 1 至 8 个审批节点'
  if (nodes[0]?.id !== 'start' || nodes[0]?.type !== 'start' || nodes.at(-1)?.id !== 'end' || nodes.at(-1)?.type !== 'end' || nodes.slice(1, -1).some(node => !isApproval(node))) return '流程必须从开始节点依次经过审批节点到结束节点'
  if (nodes[0].assigneeId !== null || nodes.at(-1).assigneeId !== null) return '开始和结束节点不能指定审批人'
  if (new Set(nodes.map(node => node.id)).size !== nodes.length || nodes.some(node => typeof node.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(node.id))) return '节点标识无效或重复'
  if (nodes.some(node => !validText(node.name, 120))) return '每个节点都需要有效名称（最多 120 字）'
  const activeIds = new Set(people.map(person => String(person.id)))
  for (const node of nodes) {
    const fields = ['id', 'type', 'name', 'assigneeId']
    if (node.type === 'parallelApproval') fields.push('assigneeIds', 'completionMode')
    if (!exactFields(node, fields)) return '节点字段缺失或包含不支持的字段'
    if (node.type === 'parallelApproval') {
      if (definition.schemaVersion !== 3 || node.assigneeId !== null || !['ALL', 'ANY'].includes(node.completionMode)) return '分组需要 schema 3、ALL 或 ANY，且不能指定单人审批'
      if (!Array.isArray(node.assigneeIds) || node.assigneeIds.length < 2 || node.assigneeIds.length > 16 || new Set(node.assigneeIds).size !== node.assigneeIds.length) return '每个分组需要 2 至 16 个不同参与人'
    }
    if (isApproval(node) && (participants(node).length === 0 || participants(node).some(id => typeof id !== 'string' || !activeIds.has(id)))) return '请为每个审批节点选择有效用户'
  }
  return ''
}

// approverId is a legacy first-pending-member field, not the complete group worklist.
export function pendingParticipants(request) {
  if (request?.status !== 'PENDING' || !request.currentStepId) return []
  const node = request.definition?.nodes?.find(node => node.id === request.currentStepId)
  const voted = new Set(votesFor(request, node).map(event => event.actorId))
  return participants(node).filter(id => !voted.has(id))
}
export const canVote = (request, actorId) => !!actorId && pendingParticipants(request).includes(actorId)
export function stepState(request, node) {
  if (node.type === 'start') return '已提交'
  if (node.type === 'end') return request.status === 'APPROVED' ? '已完成' : request.status === 'REJECTED' ? '未到达' : '等待中'
  const votes = votesFor(request, node)
  if (node.type === 'parallelApproval') {
    const approved = new Set(votes.filter(event => event.action === 'APPROVE').map(event => event.actorId))
    const rejected = new Set(votes.filter(event => event.action === 'REJECT').map(event => event.actorId))
    if (node.completionMode === 'ALL' && rejected.size) return '已拒绝'
    if (node.completionMode === 'ANY' && approved.size) return '已通过'
    if (node.completionMode === 'ALL' && participants(node).every(id => approved.has(id))) return '已通过'
    if (node.completionMode === 'ANY' && participants(node).every(id => rejected.has(id))) return '已拒绝'
  } else if (votes.length) return votes.at(-1).action === 'APPROVE' ? '已通过' : '已拒绝'
  if (request.status === 'PENDING' && request.currentStepId === node.id) return '当前审批'
  return request.status === 'PENDING' ? '等待中' : '未到达'
}
export function participantVotes(request, node) {
  const votes = votesFor(request, node), state = stepState(request, node)
  return participants(node).map(actorId => {
    const event = votes.find(event => event.actorId === actorId)
    return { actorId, state: event ? (event.action === 'APPROVE' ? '已同意' : '已拒绝') : ['已通过', '已拒绝'].includes(state) ? '无需再投票' : state === '当前审批' ? '待投票' : state === '等待中' ? '等待中' : '未到达', comment: event?.comment || '' }
  })
}
