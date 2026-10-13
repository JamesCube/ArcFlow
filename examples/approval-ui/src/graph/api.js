import { validateClientGraph } from './model.js'
import { PAYMENT_AMOUNTS } from '../scenarios/payment-document.js'
import { familyFor, familyForDefinition, normalizeBusiness, validateBusiness, factType, expectedRoutes } from './business.js'
export const GRAPH_BASE = '/graphs/payment'
const bad = () => { throw new Error('Invalid graph response') }
const keys=(value,list)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===list.length&&list.every(key=>Object.hasOwn(value,key))
const strings=value=>Array.isArray(value)&&value.every(item=>typeof item==='string')&&new Set(value).size===value.length
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b))
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))
export function graphDefinition(value, family) {
  let actual
  try { actual = familyForDefinition(value) } catch { bad() }
  if (family && actual.key !== familyFor(family).key) bad()
  if (!keys(value,['schemaVersion','id','version','name','nodes','edges']) || ![5,6].includes(value.schemaVersion) || typeof value.id !== 'string' || !Number.isInteger(value.version) || value.version < 1 || typeof value.name !== 'string' || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || value.nodes.length > 32 || value.edges.length > 48) bad()
  if (value.nodes.some(n => !keys(n,['id','type','name','assigneeIds','completionMode','pairId']) || typeof n.id !== 'string' || typeof n.name !== 'string' || !['start','end','approval','parallelApproval','exclusiveGateway','exclusiveMerge','parallelFork','parallelJoin'].includes(n.type) || !strings(n.assigneeIds) || !(n.pairId===null||typeof n.pairId==='string') || !(n.completionMode===null||['ALL','ANY'].includes(n.completionMode)) || !Object.hasOwn(n,'pairId') || !Object.hasOwn(n,'completionMode'))) bad()
  if (value.edges.some(e => !keys(e,['id','source','target','label','condition','defaultBranch']) || typeof e.id !== 'string' || typeof e.source !== 'string' || typeof e.target !== 'string' || typeof e.label !== 'string' || typeof e.defaultBranch !== 'boolean' || !Object.hasOwn(e,'condition'))) bad()
  return value
}
export function graphInstance(value, family) {
  if (!keys(value,['id','submissionKey','applicantId','status','createdAt','updatedAt','commandRevision','definition','business','tasks','forks','routes','events','commands']) || !['id','submissionKey','applicantId'].every(k=>typeof value[k]==='string'&&value[k]) || !['PENDING','APPROVED','REJECTED'].includes(value.status) || !Number.isSafeInteger(value.commandRevision) || value.commandRevision<0 || !['tasks','forks','routes','events','commands'].every(key=>Array.isArray(value[key])) || !timestamp(value.createdAt) || !timestamp(value.updatedAt)) bad()
  graphDefinition(value.definition, family || value.business); validateBusiness(value.business, family || value.definition)
  if(validateClientGraph(value.definition).length || value.tasks.length>16 || value.commands.length!==value.commandRevision || value.commands.length>1024 || value.events.length>2048)bad()
  const nodes=new Map(value.definition.nodes.map(node=>[node.id,node])), edges=new Map(value.definition.edges.map(edge=>[edge.id,edge]))
  const validFrame=frame=>keys(frame,['forkActivationId','branchId'])&&typeof frame.forkActivationId==='string'&&edges.has(frame.branchId)
  for(const task of value.tasks){
    const node=nodes.get(task.nodeId)
    if(!keys(task,['id','nodeInstanceId','nodeId','status','participants','completionMode','votes','lineage'])||!node||!['approval','parallelApproval'].includes(node.type)||task.id!==`${value.id}:${node.id}`||task.nodeInstanceId!==task.id||!['ACTIVE','COMPLETED','REJECTED','CANCELLED'].includes(task.status)||!same(task.participants,node.assigneeIds)||task.completionMode!==node.completionMode||!Array.isArray(task.votes)||!Array.isArray(task.lineage)||!task.lineage.every(validFrame))bad()
    if(task.votes.some(vote=>!keys(vote,['actorId','decision','comment','at','commandId'])||!task.participants.includes(vote.actorId)||!['APPROVE','REJECT'].includes(vote.decision)||typeof vote.comment!=='string'||typeof vote.commandId!=='string'||!timestamp(vote.at))||new Set(task.votes.map(v=>v.actorId)).size!==task.votes.length)bad()
  }
  if(new Set(value.tasks.map(t=>t.id)).size!==value.tasks.length||value.status!=='PENDING'&&value.tasks.some(t=>t.status==='ACTIVE'))bad()
  for(const fork of value.forks){const node=nodes.get(fork.forkId);if(!keys(fork,['id','forkId','joinId','expectedBranchIds','arrivedBranchIds','fired','lineage'])||node?.type!=='parallelFork'||node.pairId!==fork.joinId||fork.id!==`${value.id}:${node.id}`||!strings(fork.expectedBranchIds)||!strings(fork.arrivedBranchIds)||!same(fork.expectedBranchIds,value.definition.edges.filter(e=>e.source===node.id).map(e=>e.id))||fork.arrivedBranchIds.some(id=>!fork.expectedBranchIds.includes(id))||fork.fired!==(fork.expectedBranchIds.length===fork.arrivedBranchIds.length)||!Array.isArray(fork.lineage)||!fork.lineage.every(validFrame))bad()}
  for(const route of value.routes){const node=nodes.get(route.gatewayId);if(!keys(route,['gatewayId','selectedEdgeId','evaluations'])||node?.type!=='exclusiveGateway'||edges.get(route.selectedEdgeId)?.source!==node.id||!Array.isArray(route.evaluations)||route.evaluations.some(e=>!keys(e,['edgeId','result','facts'])||edges.get(e.edgeId)?.source!==node.id||typeof e.result!=='boolean'||!Array.isArray(e.facts)||e.facts.some(f=>!keys(f,['field','actualValue','result'])||!familyForDefinition(value.definition).fields.includes(f.field)||typeof f.actualValue!=='string'||factType(f.field)==='boolean'&&!['true','false'].includes(f.actualValue)||typeof f.result!=='boolean')))bad()}
  if(!same(value.routes,expectedRoutes(value.definition,value.business)))bad()
  if(value.events.some((event,index)=>!keys(event,['sequence','type','nodeId','taskId','detail','at'])||event.sequence!==index+1||typeof event.type!=='string'||typeof event.detail!=='string'||!timestamp(event.at)||!(event.nodeId===null||nodes.has(event.nodeId))||!(event.taskId===null||value.tasks.some(task=>task.id===event.taskId)))||value.events[0]?.type!=='SUBMITTED')bad()
  if(value.commands.some(command=>!keys(command,['id','taskId','actorId','decision','comment','at'])||typeof command.id!=='string'||!value.tasks.some(task=>task.id===command.taskId&&task.participants.includes(command.actorId))||!['APPROVE','REJECT'].includes(command.decision)||typeof command.comment!=='string'||!timestamp(command.at))||new Set(value.commands.map(c=>c.id)).size!==value.commands.length)bad()
  return value
}
export function verifySubmission(instance,intent,actorId) {
  graphInstance(instance, intent.family || intent.business)
  const original=JSON.parse(intent.body)
  if(instance.submissionKey!==intent.key||instance.applicantId!==actorId||instance.definition.version!==original.expectedVersion||!same(instance.business,normalizeBusiness(intent.business)))bad()
  return instance
}
export function verifyDecision(instance,intent,prior) {
  graphInstance(instance, prior.business)
  if(instance.id!==intent.instanceId||instance.commandRevision<prior.commandRevision||!same(instance.definition,prior.definition)||!same(instance.business,prior.business)||!same(instance.routes,prior.routes)||!same(instance.commands.slice(0,prior.commands.length),prior.commands)||!same(instance.events.slice(0,prior.events.length),prior.events)||!instance.commands.some(c=>c.id===intent.key&&c.taskId===intent.taskId&&c.actorId===intent.actorId&&c.decision===intent.decision&&c.comment===intent.comment))bad()
  return instance
}
// Reuse exact decimal normalization; write money as JSON numbers without a
// floating-point conversion. Never accept a client-supplied netTotal fact.
export function serializeBusiness(business, family) {
  const normalized = normalizeBusiness(business, family)
  const amounts = new Set([...PAYMENT_AMOUNTS, 'estimatedCost', 'listUnitPrice', 'requestedUnitPrice'])
  return `{${Object.entries(normalized).map(([key,value]) => `${JSON.stringify(key)}:${key === 'lines' ? `[${value.map(line => `{${Object.entries(line).map(([field,amount]) => `${JSON.stringify(field)}:${PAYMENT_AMOUNTS.includes(field) ? amount : JSON.stringify(amount)}`).join(',')}}`).join(',')}]` : amounts.has(key) ? value : JSON.stringify(value)}`).join(',')}}`
}
export const submissionBody = (business, expectedVersion) => { if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || expectedVersion > 2147483647) bad(); return `{"expectedVersion":${expectedVersion},"business":${serializeBusiness(business)}}` }
export const previewBody = (definition, business) => `{"definition":${JSON.stringify(definition)},"business":${serializeBusiness(business, definition)}}`

export function graphCapabilities(value, family) {
  const expected = familyFor(family)
  if (!value || value.schemaVersion !== expected.schemaVersion || value.businessType !== expected.type || !Array.isArray(value.facts) || value.facts.length !== expected.fields.length || new Set(value.facts.map(fact => fact.field)).size !== value.facts.length || typeof value.permissions?.canPublish !== 'boolean' || typeof value.permissions?.canSubmit !== 'boolean') bad()
  for (const fact of value.facts) {
    const type = factType(fact.field), operators = type === 'boolean' ? ['EQ'] : ['EQ','GT','GTE','LT','LTE']
    if (!keys(fact, ['field','type','currencies','operators']) || !expected.fields.includes(fact.field) || fact.type !== type || !strings(fact.operators) || !same(fact.operators, operators) || !strings(fact.currencies) || type !== 'money' && fact.currencies.length || type === 'money' && (!fact.currencies.length || fact.currencies.some(currency => !['CNY','USD','EUR','GBP','JPY'].includes(currency)))) bad()
  }
  return value
}
