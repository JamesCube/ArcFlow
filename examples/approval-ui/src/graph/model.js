import { routingThresholdCents } from '../routing.js'
import { familyForDefinition, factType } from './business.js'
import { parsePercentInput } from './threshold.js'

export const GRAPH_LIMITS = Object.freeze({ nodes: 32, edges: 48, humans: 16, depth: 2, branches: 4, predicates: 32 })
const HUMAN = new Set(['approval', 'parallelApproval'])
const PAIRS = { exclusiveGateway: 'exclusiveMerge', parallelFork: 'parallelJoin' }
const CLOSERS = new Set(Object.values(PAIRS))
const TYPES = new Set(['start', 'end', ...HUMAN, ...Object.keys(PAIRS), ...CLOSERS])
const validId = id => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)
const validText = (value, maximum = 120) => typeof value === 'string' && Boolean(value.trim()) && value.length <= maximum && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const fail = message => { throw new Error(message) }
export const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
export const nodeById = (definition, id) => (Array.isArray(definition?.nodes) ? definition.nodes : []).find(node => node?.id === id) || null
export const outgoing = (definition, id) => (Array.isArray(definition?.edges) ? definition.edges : []).filter(edge => edge?.source === id)
const incoming = (definition, id) => definition.edges.filter(edge => edge.target === id)
const isSplit = node => Boolean(node && Object.hasOwn(PAIRS, node.type))

function indexGraph(definition) {
  if (![5, 6].includes(definition?.schemaVersion) || !Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) fail('A supported graph with nodes and edges is required.')
  const nodes = new Map(), edges = new Map(), starts = [], ends = []
  for (const node of definition.nodes) {
    if (!record(node) || !validId(node.id) || !TYPES.has(node.type) || nodes.has(node.id)) fail('Every graph node needs a unique ID and supported type.')
    nodes.set(node.id, node)
    if (node.type === 'start') starts.push(node)
    if (node.type === 'end') ends.push(node)
  }
  if (starts.length !== 1 || ends.length !== 1) fail('Keep exactly one start node and one end node.')
  for (const edge of definition.edges) {
    if (!record(edge) || !validId(edge.id) || edges.has(edge.id) || nodes.has(edge.id) || !nodes.has(edge.source) || !nodes.has(edge.target)) fail('Node and edge IDs must be globally unique, and every edge needs existing endpoints.')
    edges.set(edge.id, edge)
  }
  return { nodes, edges, start: starts[0], end: ends[0] }
}

// Structured traversal consumes each node once. A branch may exit only through
// its own paired closer, so cycles, shared branch contents and cross-links fail.
function structure(definition) {
  const index = indexGraph(definition), visited = new Set(), usedEdges = new Set(), units = new Map()
  let maxDepth = 0
  function sequence(fromId, stopId = null, depth = 0) {
    const items = []
    let id = fromId, tail = null, minimumHumans = 0
    while (id !== stopId) {
      const node = index.nodes.get(id)
      if (!node || visited.has(id)) fail('Graph paths cannot loop or share branch contents.')
      if (CLOSERS.has(node.type)) fail('A branch must finish at its own paired merge or join.')
      if (node.type === 'end' && stopId) fail('Branches must rejoin before the end node.')
      visited.add(id)
      let exit = node, branchMinimum = 0
      const item = { kind: isSplit(node) ? 'region' : 'node', node, afterEdge: null }
      if (isSplit(node)) {
        maxDepth = Math.max(maxDepth, depth + 1)
        const pair = index.nodes.get(node.pairId), branches = outgoing(definition, id)
        if (!pair || pair.type !== PAIRS[node.type] || pair.pairId !== id || visited.has(pair.id)) fail('Every split needs its own matching paired merge or join.')
        if (branches.length < 2 || branches.length > GRAPH_LIMITS.branches) fail('Each split must have between two and four branches.')
        item.pair = pair
        item.branches = []
        const tails = []
        for (const edge of branches) {
          usedEdges.add(edge.id)
          const branch = sequence(edge.target, pair.id, depth + 1)
          item.branches.push({ edge, items: branch.items })
          tails.push(branch.tail || edge.id)
          branchMinimum = node.type === 'parallelFork' ? branchMinimum + branch.minimumHumans
            : item.branches.length === 1 ? branch.minimumHumans : Math.min(branchMinimum, branch.minimumHumans)
        }
        const entrances = incoming(definition, pair.id)
        if (entrances.length !== tails.length || !entrances.every(edge => tails.includes(edge.id))) fail('Only the matching branches may enter a merge or join.')
        visited.add(pair.id)
        exit = pair
      }
      minimumHumans += HUMAN.has(node.type) ? 1 : branchMinimum
      if (node.type === 'end') {
        if (outgoing(definition, id).length) fail('The end node cannot have outgoing edges.')
      } else {
        const next = outgoing(definition, exit.id)
        if (next.length !== 1) fail('Ordinary nodes and paired closers need exactly one outgoing edge.')
        item.afterEdge = next[0]
        usedEdges.add(next[0].id)
        tail = next[0].id
      }
      items.push(item)
      units.set(node.id, item)
      if (item.pair) units.set(item.pair.id, item)
      if (!item.afterEdge) break
      id = item.afterEdge.target
    }
    if (stopId && id !== stopId) fail('A branch does not reach its paired merge or join.')
    return { items, tail, minimumHumans }
  }
  const result = sequence(index.start.id)
  if (visited.size !== definition.nodes.length || usedEdges.size !== definition.edges.length) fail('All graph nodes and edges must belong to the start-to-end process.')
  for (const node of definition.nodes) {
    const count = incoming(definition, node.id).length
    if (node.type === 'start' ? count !== 0 : !CLOSERS.has(node.type) && count !== 1) fail('Nodes cannot have extra entrances or cross-region edges.')
  }
  return { ...index, ...result, units, maxDepth }
}

/** A sequence includes start/end; each region includes its split, paired closer,
 * and branches: [{edge, items}]. afterEdge always follows the whole unit. */
export function graphSequence(definition, fromId, stopId) {
  const graph = structure(definition)
  if (fromId === undefined && stopId === undefined) return graph.items
  const start = fromId ?? graph.start.id, result = [], seen = new Set()
  let id = start
  while (id !== stopId) {
    const item = graph.units.get(id)
    if (!item || seen.has(id) || item.pair?.id === id) fail('The requested sequence is not a structured path.')
    seen.add(id)
    result.push(item)
    if (!item.afterEdge) {
      if (stopId != null) fail('The requested stop node is not on this sequence.')
      break
    }
    id = item.afterEdge.target
  }
  return result
}

function walkItems(items, visit) {
  for (const item of items) {
    visit(item)
    for (const branch of item.branches || []) walkItems(branch.items, visit)
  }
}
function unitIds(item) {
  const ids = new Set()
  walkItems([item], entry => { ids.add(entry.node.id); if (entry.pair) ids.add(entry.pair.id) })
  return ids
}
function minimumHumans(items) {
  return items.reduce((sum, item) => {
    if (HUMAN.has(item.node.type)) return sum + 1
    if (!item.branches) return sum
    const counts = item.branches.map(branch => minimumHumans(branch.items))
    return sum + (item.node.type === 'parallelFork' ? counts.reduce((total, count) => total + count, 0) : Math.min(...counts))
  }, 0)
}
function checkCaps(definition, graph = structure(definition)) {
  if (definition.nodes.length > GRAPH_LIMITS.nodes) fail('Use at most 32 nodes.')
  if (definition.edges.length > GRAPH_LIMITS.edges) fail('Use at most 48 edges.')
  if (definition.nodes.filter(node => HUMAN.has(node.type)).length > GRAPH_LIMITS.humans) fail('Use at most 16 human approval nodes.')
  if (graph.maxDepth > GRAPH_LIMITS.depth) fail('Use at most two nested split regions.')
  const atoms = definition.edges.reduce((sum, edge) => sum + (Array.isArray(edge.condition?.predicates) ? edge.condition.predicates.length : 0), 0)
  if (atoms > GRAPH_LIMITS.predicates) fail('Use at most 32 condition predicates.')
}
function finish(definition) {
  const graph = structure(definition)
  checkCaps(definition, graph)
  if (!minimumHumans(graph.items)) fail('Every successful process path needs a human approval.')
  return definition
}
function freshId(definition, prefix) {
  const ids = new Set([...definition.nodes, ...definition.edges].map(value => value.id))
  let number = 1
  while (ids.has(`${prefix}_${number}`)) number++
  return `${prefix}_${number}`
}
const copyText = (locale, en, zh) => String(locale).toLowerCase().startsWith('zh') ? zh : en
const peopleIds = people => [...new Set((Array.isArray(people) ? people : []).map(person => typeof person === 'string' ? person : person?.id).filter(id => typeof id === 'string' && id.trim()))]
function makeNode(definition, type, people = [], locale = 'en', participantIndex = 0) {
  const labels = {
    approval: ['Approval', '审批'], parallelApproval: ['Group approval', '多人审批'],
    exclusiveGateway: ['Condition branches', '条件分支'], exclusiveMerge: ['Condition merge', '条件汇合'],
    parallelFork: ['Parallel branches', '并行分支'], parallelJoin: ['Wait for all branches', '等待全部分支'],
  }
  const ids = peopleIds(people)
  const node = {
    id: freshId(definition, type), type, name: copyText(locale, ...labels[type]),
    assigneeIds: HUMAN.has(type) ? (type === 'approval' ? (ids.length ? [ids[participantIndex % ids.length]] : []) : ids.slice(0, 2)) : [],
    completionMode: HUMAN.has(type) ? 'ALL' : null, pairId: null,
  }
  definition.nodes.push(node)
  return node
}
function makeEdge(definition, source, target, extras = {}) {
  const edge = { id: freshId(definition, 'edge'), source, target, label: 'Continue', condition: null, defaultBranch: false, ...extras }
  definition.edges.push(edge)
  return edge
}
export function defaultPredicate(definition, field = familyForDefinition(definition).fields[0]) {
  if (!familyForDefinition(definition).fields.includes(field)) fail('This field belongs to a different business family.')
  if (factType(field) === 'boolean') return { field, operator: 'EQ', expected: true }
  if (factType(field) === 'percent') return { field, operator: 'GTE', threshold: 20 }
  return { field, operator: 'GTE', currency: definition.edges.flatMap(edge => edge.condition?.predicates || []).find(predicate => predicate.currency)?.currency || (familyForDefinition(definition).key === 'payment' ? 'USD' : 'CNY'), threshold: 10000 }
}
const initialCondition = definition => ({ mode: 'ALL', predicates: [defaultPredicate(definition)] })

function requireUnit(graph, id) {
  const item = graph.units.get(id)
  if (!item || !HUMAN.has(item.node.type) && !item.branches) fail('Only approval nodes and complete split regions can be edited as a unit.')
  return item
}
function requireBranch(definition, edgeId) {
  const graph = structure(definition), edge = graph.edges.get(edgeId), split = edge && nodeById(definition, edge.source)
  if (!isSplit(split)) fail('Choose an outgoing branch edge from a split.')
  return { graph, edge, split, branches: outgoing(definition, split.id), item: graph.units.get(split.id) }
}

export function insertOnEdge(definition, edgeId, type, people = [], locale = 'en') {
  structure(definition)
  if (!HUMAN.has(type) && !Object.hasOwn(PAIRS, type)) fail('Choose an approval, group approval, conditional split, or parallel split.')
  const next = clone(definition), edge = next.edges.find(value => value.id === edgeId)
  if (!edge) fail('The insertion edge no longer exists.')
  const target = edge.target, node = makeNode(next, type, people, locale)
  edge.target = node.id
  if (HUMAN.has(type)) makeEdge(next, node.id, target)
  else {
    const pair = makeNode(next, PAIRS[type], [], locale)
    node.pairId = pair.id
    pair.pairId = node.id
    for (let index = 0; index < 2; index++) {
      const human = makeNode(next, 'approval', people, locale, index), exclusive = type === 'exclusiveGateway'
      makeEdge(next, node.id, human.id, {
        label: exclusive ? (index === 1 ? copyText(locale, 'Otherwise', '其他情况') : copyText(locale, 'Condition 1', '条件 1')) : copyText(locale, `Branch ${index + 1}`, `分支 ${index + 1}`),
        condition: exclusive && index === 0 ? initialCondition(next) : null,
        defaultBranch: exclusive && index === 1,
      })
      makeEdge(next, human.id, pair.id)
    }
    makeEdge(next, pair.id, target)
  }
  return finish(next)
}

export function deleteUnit(definition, nodeId) {
  const graph = structure(definition), item = requireUnit(graph, nodeId), ids = unitIds(item)
  const entrance = incoming(definition, item.node.id)[0], exit = item.afterEdge
  if (!entrance || !exit) fail('This unit cannot be removed.')
  const next = clone(definition)
  next.nodes = next.nodes.filter(node => !ids.has(node.id))
  next.edges = next.edges.filter(edge => edge.id === entrance.id || !ids.has(edge.source) && !ids.has(edge.target))
  next.edges.find(edge => edge.id === entrance.id).target = exit.target
  return finish(next)
}

export function moveUnit(definition, nodeId, targetEdgeId) {
  const graph = structure(definition), item = requireUnit(graph, nodeId), ids = unitIds(item)
  const entrance = incoming(definition, item.node.id)[0], exit = item.afterEdge, target = graph.edges.get(targetEdgeId)
  if (!target || !entrance || !exit) fail('The move destination no longer exists.')
  if (target.id === entrance.id || target.id === exit.id) fail('The unit is already next to that edge.')
  if (ids.has(target.source) || ids.has(target.target)) fail('A region cannot be moved into itself or one of its descendants.')
  const next = clone(definition), edgeMap = new Map(next.edges.map(edge => [edge.id, edge]))
  edgeMap.get(entrance.id).target = exit.target
  edgeMap.get(target.id).target = item.node.id
  edgeMap.get(exit.id).target = target.target
  return finish(next)
}

export function addBranch(definition, splitId, people = [], locale = 'en') {
  const graph = structure(definition), split = graph.nodes.get(splitId)
  if (!isSplit(split)) fail('Choose a split to add a branch.')
  const branches = outgoing(definition, splitId)
  if (branches.length >= GRAPH_LIMITS.branches) fail('A split can have at most four branches.')
  const next = clone(definition), human = makeNode(next, 'approval', people, locale, branches.length)
  const exclusive = split.type === 'exclusiveGateway'
  const edge = makeEdge(next, split.id, human.id, {
    label: copyText(locale, `${exclusive ? 'Condition' : 'Branch'} ${exclusive ? branches.length : branches.length + 1}`, `${exclusive ? '条件' : '分支'} ${exclusive ? branches.length : branches.length + 1}`),
    condition: exclusive ? initialCondition(next) : null,
  })
  if (exclusive) {
    const defaultEdge = branches.find(value => value.defaultBranch)
    if (!defaultEdge || branches.at(-1).id !== defaultEdge.id) fail('Keep one default branch last before adding another branch.')
    next.edges.splice(next.edges.indexOf(edge), 1)
    next.edges.splice(next.edges.findIndex(value => value.id === defaultEdge.id), 0, edge)
  }
  makeEdge(next, human.id, split.pairId)
  return finish(next)
}

export function deleteBranch(definition, edgeId) {
  const { split, branches, item } = requireBranch(definition, edgeId)
  if (split.type === 'exclusiveGateway' && branches.find(edge => edge.id === edgeId)?.defaultBranch) fail('The default branch cannot be deleted. Delete the entire region instead.')
  if (branches.length <= 2) fail('Keep at least two branches, or delete the entire region.')
  const branch = item.branches.find(value => value.edge.id === edgeId), ids = new Set()
  for (const entry of branch.items) for (const id of unitIds(entry)) ids.add(id)
  const next = clone(definition)
  next.nodes = next.nodes.filter(node => !ids.has(node.id))
  next.edges = next.edges.filter(edge => edge.id !== edgeId && !ids.has(edge.source) && !ids.has(edge.target))
  return finish(next)
}

export function moveBranch(definition, edgeId, offset) {
  const { split, branches, edge } = requireBranch(definition, edgeId)
  if (!Number.isInteger(offset) || !offset) fail('Choose a nonzero branch move offset.')
  if (edge.defaultBranch) fail('The default branch must remain last.')
  const index = branches.findIndex(value => value.id === edgeId), target = index + offset
  const maximum = branches.length - 1 - (split.type === 'exclusiveGateway' ? 1 : 0)
  if (target < 0 || target > maximum) fail('The branch cannot move past this boundary or the default branch.')
  const order = branches.map(value => value.id)
  order.splice(target, 0, order.splice(index, 1)[0])
  const next = clone(definition), edgeMap = new Map(next.edges.map(value => [value.id, value]))
  let cursor = 0
  next.edges = next.edges.map(value => value.source === split.id ? edgeMap.get(order[cursor++]) : value)
  return finish(next)
}

export function validateClientGraph(definition) {
  const diagnostics = [], add = (code, message, nodeId = null, edgeId = null) => diagnostics.push({ code, message, nodeId, edgeId })
  if (!exact(definition, ['schemaVersion', 'id', 'version', 'name', 'nodes', 'edges']) || ![5, 6].includes(definition.schemaVersion) || typeof definition.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(definition.id) || !Number.isInteger(definition.version) || definition.version < 1 || !validText(definition.name) || !Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
    add('INVALID_DEFINITION', 'Use a named supported graph definition with an ID, version, nodes, and edges.')
    if (!Array.isArray(definition?.nodes) || !Array.isArray(definition?.edges)) return diagnostics
  }
  try { familyForDefinition(definition) } catch { add('INVALID_DEFINITION', 'This schema and graph ID do not identify a registered business family.') }
  for (const node of definition.nodes) {
    if (!exact(node, ['id', 'type', 'name', 'assigneeIds', 'completionMode', 'pairId']) || !validId(node.id) || !TYPES.has(node.type) || !validText(node.name) || !Array.isArray(node.assigneeIds) || node.assigneeIds.some(id => !validText(id, 128)) || new Set(node.assigneeIds).size !== node.assigneeIds.length) {
      add('INVALID_NODE', 'Each node needs all graph fields, a name, and distinct participant IDs.', node?.id || null)
      continue
    }
    if (HUMAN.has(node.type)) {
      if (node.type === 'approval' ? node.assigneeIds.length !== 1 || node.completionMode !== 'ALL' : node.assigneeIds.length < 2 || node.assigneeIds.length > 16 || !['ALL', 'ANY'].includes(node.completionMode)) add('INVALID_ASSIGNMENT', node.type === 'approval' ? 'Select one approver.' : 'Select 2–16 participants and ALL or ANY completion.', node.id)
      if (node.pairId !== null) add('INVALID_PAIR', 'Human approvals cannot have a pair ID.', node.id)
    } else {
      if (node.assigneeIds.length || node.completionMode !== null) add('INVALID_ASSIGNMENT', 'Nonhuman nodes must have no participants and a null completion mode.', node.id)
      if (['start', 'end'].includes(node.type) && node.pairId !== null) add('INVALID_PAIR', 'Start and end nodes cannot have pair IDs.', node.id)
      if (isSplit(node) || CLOSERS.has(node.type)) {
        const pair = nodeById(definition, node.pairId), expected = PAIRS[node.type] || Object.keys(PAIRS).find(type => PAIRS[type] === node.type)
        if (!pair || pair.type !== expected || pair.pairId !== node.id) add('INVALID_PAIR', 'This region needs its own reciprocal split and matching merge or join.', node.id)
      }
    }
  }
  const currencies = new Set()
  for (const edge of definition.edges) {
    if (!exact(edge, ['id', 'source', 'target', 'label', 'condition', 'defaultBranch']) || !validId(edge.id) || !validText(edge.label) || typeof edge.defaultBranch !== 'boolean') {
      add('INVALID_EDGE', 'Each edge needs all graph fields and a unique ID.', null, edge?.id || null)
      continue
    }
    const source = nodeById(definition, edge.source)
    if (source?.type !== 'exclusiveGateway' && (edge.condition !== null || edge.defaultBranch)) add('INVALID_BRANCH', 'Only conditional split branches can have a condition or be the default.', source?.id || null, edge.id)
    if (edge.condition !== null) {
      const rule = edge.condition
      if (!exact(rule, ['mode', 'predicates']) || !['ALL', 'ANY'].includes(rule.mode) || !Array.isArray(rule.predicates) || !rule.predicates.length || rule.predicates.length > 8) {
        add('INVALID_CONDITION', 'Use ALL or ANY with 1–8 typed business predicates per condition.', null, edge.id)
        continue
      }
      for (const predicate of rule.predicates) {
        let fields = []
        try { fields = familyForDefinition(definition).fields } catch { /* Unknown hosts have no allowed facts. */ }
        const type = factType(predicate?.field), comparison = ['EQ', 'GT', 'GTE', 'LT', 'LTE'].includes(predicate?.operator)
        const valid = fields.includes(predicate?.field) && (type === 'boolean'
          ? exact(predicate, ['field', 'operator', 'expected']) && predicate.operator === 'EQ' && typeof predicate.expected === 'boolean'
          : type === 'percent' ? exact(predicate, ['field', 'operator', 'threshold']) && comparison && typeof predicate.threshold === 'number' && parsePercentInput(String(predicate.threshold)) !== null
          : exact(predicate, ['field', 'operator', 'currency', 'threshold']) && comparison && routingThresholdCents(predicate.threshold, predicate.currency) !== null)
        if (!valid) add('INVALID_PREDICATE', 'Use a supported typed fact and exact comparison for this business family.', null, edge.id)
        if (type === 'money' && predicate?.currency) currencies.add(predicate.currency)
      }
    }
  }
  for (const split of definition.nodes.filter(node => node?.type === 'exclusiveGateway')) {
    const branches = outgoing(definition, split.id), defaults = branches.filter(edge => edge.defaultBranch)
    if (defaults.length !== 1 || !branches.at(-1)?.defaultBranch || defaults[0]?.condition !== null || branches.filter(edge => !edge.defaultBranch).some(edge => !edge.condition)) add('INVALID_DEFAULT', 'Each conditional split needs conditioned branches followed by one unconditional default branch.', split.id)
  }
  if (currencies.size > 1) add('CURRENCY_MISMATCH', 'All monetary conditions must use the same currency.')
  try {
    const graph = structure(definition)
    checkCaps(definition, graph)
    if (!minimumHumans(graph.items)) add('EMPTY_PATH', 'Every successful process path needs a human approval.')
  } catch (error) { add('INVALID_STRUCTURE', error.message) }
  return diagnostics
}

// Tasks are authoritative for human state. Frozen route selections determine
// skipped branches; fork activation/arrival/fired records determine join state.
export function graphRuntimeStatus(instance) {
  const definition = instance?.definition, nodes = {}, edges = {}
  if (!definition) return { nodes, edges }
  for (const node of definition.nodes || []) nodes[node.id] = 'idle'
  for (const edge of definition.edges || []) edges[edge.id] = 'idle'
  const tasks = new Map((instance.tasks || []).map(task => [task.nodeId, task]))
  const forks = new Map((instance.forks || []).map(fork => [fork.forkId, fork]))
  const routes = new Map((instance.routes || []).map(route => [route.gatewayId, route.selectedEdgeId]))
  function skip(items) {
    walkItems(items, item => {
      nodes[item.node.id] = 'skipped'
      if (item.afterEdge) edges[item.afterEdge.id] = 'skipped'
      if (item.pair) nodes[item.pair.id] = 'skipped'
      for (const branch of item.branches || []) edges[branch.edge.id] = 'skipped'
    })
  }
  function sequence(items, entered) {
    let ready = entered
    for (const item of items) {
      const { node, pair, branches, afterEdge } = item
      let complete = false
      if (HUMAN.has(node.type)) {
        const task = tasks.get(node.id)
        nodes[node.id] = task ? String(task.status).toLowerCase() : 'idle'
        complete = task?.status === 'COMPLETED'
      } else if (node.type === 'start') { nodes[node.id] = 'completed'; complete = true }
      else if (node.type === 'end') { nodes[node.id] = instance.status === 'APPROVED' ? 'completed' : 'idle'; complete = instance.status === 'APPROVED' }
      else if (node.type === 'exclusiveGateway') {
        const selected = routes.get(node.id)
        nodes[node.id] = ready && selected ? 'completed' : 'idle'
        for (const branch of branches) {
          if (selected && branch.edge.id !== selected) { edges[branch.edge.id] = 'skipped'; skip(branch.items) }
          else {
            const done = sequence(branch.items, ready && branch.edge.id === selected)
            edges[branch.edge.id] = branch.edge.id === selected ? (done ? 'completed' : instance.status === 'REJECTED' ? 'selected' : ready ? 'active' : 'selected') : 'idle'
            if (branch.edge.id === selected) complete = done
          }
        }
        nodes[pair.id] = complete ? 'completed' : ready && selected ? (instance.status === 'REJECTED' ? 'cancelled' : 'waiting') : 'idle'
      } else if (node.type === 'parallelFork') {
        const fork = forks.get(node.id)
        nodes[node.id] = fork ? 'completed' : 'idle'
        for (const branch of branches) {
          sequence(branch.items, Boolean(fork))
          edges[branch.edge.id] = fork?.arrivedBranchIds?.includes(branch.edge.id) ? 'completed' : fork ? 'active' : 'idle'
        }
        complete = Boolean(fork?.fired)
        nodes[pair.id] = complete ? 'completed' : fork ? (instance.status === 'REJECTED' ? 'cancelled' : 'waiting') : 'idle'
      }
      if (afterEdge) edges[afterEdge.id] = complete ? 'completed' : 'idle'
      ready = complete
    }
    return ready
  }
  try { sequence(graphSequence(definition), true) } catch {
    for (const [id, task] of tasks) nodes[id] = String(task.status).toLowerCase()
    for (const fork of forks.values()) { nodes[fork.forkId] = 'completed'; nodes[fork.joinId] = fork.fired ? 'completed' : instance.status === 'REJECTED' ? 'cancelled' : 'waiting' }
  }
  if (instance.status === 'REJECTED') {
    // A terminal rejection cancels live paths; it cannot rewrite frozen route
    // selection or erase an activated fork's history as an unchosen branch.
    for (const id of Object.keys(edges)) if (edges[id] === 'active') edges[id] = 'cancelled'
  }
  return { nodes, edges }
}
export const runtimeNodeStatus = (instance, nodeId) => graphRuntimeStatus(instance).nodes[nodeId] || 'idle'
export const runtimeEdgeStatus = (instance, edgeId) => graphRuntimeStatus(instance).edges[edgeId] || 'idle'
export const deriveState = graphRuntimeStatus
