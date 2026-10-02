export const clone = value => JSON.parse(JSON.stringify(value))
export const approvals = definition => definition?.nodes?.filter(node => node.type === 'approval') || []
export const validText = (text, limit) => typeof text === 'string' && !!text.trim() && text.length <= limit && !/[\u0000-\u001f\u007f-\u009f]/.test(text)
export function validateDefinition(definition, people) {
  if (!definition || !Array.isArray(definition.nodes)) return '请先加载流程定义'
  if (definition.schemaVersion !== 2 || definition.id !== 'leave-approval' || !Number.isInteger(definition.version) || definition.version < 1) return '流程定义格式或版本无效'
  if (!validText(definition.name, 120)) return '请输入有效的流程名称（最多 120 字）'
  const nodes = definition.nodes, steps = approvals(definition)
  if (steps.length < 1 || steps.length > 8) return '流程需要 1 至 8 个审批节点'
  if (nodes[0]?.id !== 'start' || nodes[0]?.type !== 'start' || nodes[nodes.length - 1]?.id !== 'end' || nodes[nodes.length - 1]?.type !== 'end' || nodes.slice(1, -1).some(node => node.type !== 'approval')) return '流程必须从开始节点依次经过审批节点到结束节点'
  if (nodes[0].assigneeId !== null || nodes[nodes.length - 1].assigneeId !== null) return '开始和结束节点不能指定审批人'
  if (new Set(nodes.map(node => node.id)).size !== nodes.length || nodes.some(node => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(node.id))) return '节点标识无效或重复'
  if (nodes.some(node => !validText(node.name, 120))) return '每个节点都需要有效名称（最多 120 字）'
  if (steps.some(node => !people.some(person => String(person.id) === node.assigneeId))) return '请为每个审批节点选择有效用户'
  return ''
}
export function stepState(request, node) {
  if (node.type === 'start') return '已提交'
  if (node.type === 'end') return request.status === 'APPROVED' ? '已完成' : request.status === 'REJECTED' ? '未到达' : '等待中'
  const event = [...(request.history || [])].reverse().find(event => event.stepId === node.id && ['APPROVE', 'REJECT'].includes(event.action))
  if (event) return event.action === 'APPROVE' ? '已通过' : '已拒绝'
  if (request.status === 'PENDING' && request.currentStepId === node.id) return '当前审批'
  return request.status === 'PENDING' ? '等待中' : '未到达'
}
