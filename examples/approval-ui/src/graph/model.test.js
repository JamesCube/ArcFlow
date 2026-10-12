import { describe, expect, it } from 'vitest'
import {
  clone, outgoing, nodeById, graphSequence, insertOnEdge, deleteUnit, moveUnit,
  addBranch, deleteBranch, moveBranch, validateClientGraph, graphRuntimeStatus,
  runtimeNodeStatus, runtimeEdgeStatus, deriveState, GRAPH_LIMITS,
} from './model.js'

const people = [{ id: 'directory-mira', displayName: 'Mira' }, { id: 'directory-jules', displayName: 'Jules' }]
const node = (id, type, extra = {}) => ({ id, type, name: id, assigneeIds: [], completionMode: null, pairId: null, ...extra })
const edge = (id, source, target, extra = {}) => ({ id, source, target, label: 'Continue', condition: null, defaultBranch: false, ...extra })
function empty() {
  return { schemaVersion: 5, id: 'payment-graph', version: 1, name: 'Payment graph',
    nodes: [node('start', 'start'), node('end', 'end')], edges: [edge('entry', 'start', 'end')] }
}
const linear = () => insertOnEdge(empty(), 'entry', 'approval', people)
const region = (type = 'exclusiveGateway') => insertOnEdge(linear(), 'entry', type, people)
const splitOf = definition => definition.nodes.find(value => ['exclusiveGateway', 'parallelFork'].includes(value.type))
const humanOf = definition => definition.nodes.find(value => value.type === 'approval')
const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze) } return value }
const ids = definition => definition.nodes.map(value => value.id)
function allRegions(items) { return items.flatMap(item => item.branches ? [item, ...item.branches.flatMap(branch => allRegions(branch.items))] : []) }

function expectValid(definition) {
  expect(validateClientGraph(definition)).toEqual([])
  expect(new Set(definition.nodes.map(value => value.id)).size).toBe(definition.nodes.length)
  expect(new Set(definition.edges.map(value => value.id)).size).toBe(definition.edges.length)
}

describe('structured graph rendering and assignment', () => {
  it('inserts without mutating a deeply frozen input and preserves all existing IDs', () => {
    const before = freeze(linear()), original = JSON.stringify(before)
    const after = insertOnEdge(before, 'entry', 'parallelApproval', people)
    expect(JSON.stringify(before)).toBe(original)
    for (const value of before.nodes) expect(nodeById(after, value.id)).toEqual(value)
    expect(after.edges.find(value => value.id === 'entry').target).not.toBe(before.edges[0].target)
    expect(nodeById(after, after.edges[0].target).assigneeIds).toEqual(people.map(person => person.id))
    expectValid(after)
  })

  it('uses only supplied directory people, deduplicates them, and leaves missing assignments empty', () => {
    const single = insertOnEdge(empty(), 'entry', 'approval', [])
    expect(humanOf(single).assigneeIds).toEqual([])
    expect(validateClientGraph(single).map(value => value.code)).toContain('INVALID_ASSIGNMENT')
    const group = insertOnEdge(empty(), 'entry', 'parallelApproval', [people[0], people[0]])
    expect(group.nodes.find(value => value.type === 'parallelApproval').assigneeIds).toEqual(['directory-mira'])
    expect(validateClientGraph(group).map(value => value.code)).toContain('INVALID_ASSIGNMENT')
    const split = insertOnEdge(empty(), 'entry', 'parallelFork', people)
    expect(split.nodes.filter(value => value.type === 'approval').map(value => value.assigneeIds[0])).toEqual(people.map(person => person.id))
  })

  it('returns recursive paired regions and stable branch edge references', () => {
    const first = region(), split = splitOf(first), branchEdge = outgoing(first, split.id)[0]
    const nested = insertOnEdge(first, branchEdge.id, 'parallelFork', people)
    const tree = graphSequence(nested)
    expect(tree.map(item => item.node.type)).toEqual(['start', 'exclusiveGateway', 'approval', 'end'])
    const outer = tree[1]
    expect(outer.kind).toBe('region')
    expect(outer.pair.type).toBe('exclusiveMerge')
    expect(outer.branches[0].edge.id).toBe(branchEdge.id)
    expect(outer.branches[0].items[0].node.type).toBe('parallelFork')
    expect(outer.branches[0].items[0].pair.type).toBe('parallelJoin')
    expect(outer.afterEdge.source).toBe(outer.pair.id)
    expect(tree.at(-1).afterEdge).toBeNull()
    expect(graphSequence(nested, branchEdge.target, split.pairId).map(item => item.node.id)).toEqual([branchEdge.target])
    expect(graphSequence(nested, outer.branches[0].edge.target, split.pairId)).toEqual(outer.branches[0].items)
    expectValid(nested)
  })

  it('makes localized names and reuses the condition currency already present', () => {
    const original = region(), split = splitOf(original)
    outgoing(original, split.id)[0].condition.predicates[0].currency = 'CNY'
    const after = addBranch(original, split.id, people, 'zh-CN')
    const added = after.nodes.find(value => !ids(original).includes(value.id))
    expect(added.name).toBe('审批')
    expect(outgoing(after, split.id).filter(value => value.condition).every(value => value.condition.predicates[0].currency === 'CNY')).toBe(true)
    expect(outgoing(after, split.id)[1].label).toContain('条件')
    expectValid(after)
  })

  it('copies nested values independently and safely handles missing lookup IDs', () => {
    const definition = region(), copy = clone(definition)
    copy.nodes[0].name = 'Changed'
    copy.edges.find(value => value.condition).condition.predicates[0].threshold = 25
    expect(definition.nodes[0].name).toBe('start')
    expect(definition.edges.find(value => value.condition).condition.predicates[0].threshold).toBe(10000)
    expect(clone(undefined)).toBeUndefined()
    expect(nodeById(definition, 'missing')).toBeNull()
    expect(outgoing(definition, 'missing')).toEqual([])
  })
})

describe('whole-unit graph edits', () => {
  it('deletes an entire nested region and reconnects its original entrance edge', () => {
    const original = region(), split = splitOf(original), branches = outgoing(original, split.id)
    const nested = insertOnEdge(original, branches[0].id, 'parallelFork', people)
    const before = freeze(nested), after = deleteUnit(before, split.pairId)
    expect(ids(after).sort()).toEqual(ids(linear()).sort())
    expect(after.edges).toEqual(linear().edges)
    expectValid(after)
  })

  it('allows a direct branch to its own pair when every successful process still includes a human', () => {
    const definition = region(), split = splitOf(definition), before = JSON.stringify(definition)
    const branch = outgoing(definition, split.id)[0], after = deleteUnit(definition, branch.target)
    expect(outgoing(after, split.id)[0]).toEqual({ ...branch, target: split.pairId })
    expect(graphSequence(after)[1].branches[0].items).toEqual([])
    expectValid(after)
    expect(JSON.stringify(definition)).toBe(before)
    expect(() => deleteUnit(linear(), humanOf(linear()).id)).toThrow(/human approval/)
    expect(() => deleteUnit(definition, 'start')).toThrow(/Only approval/)
  })

  it('moves a complete nested region without changing its internal branch IDs or rules', () => {
    const original = region(), split = splitOf(original), entrance = outgoing(original, split.id)[0]
    const nested = insertOnEdge(original, entrance.id, 'parallelFork', people)
    const tree = graphSequence(nested), moving = tree[1], target = tree[2].afterEdge
    const after = moveUnit(freeze(nested), moving.node.id, target.id)
    expect(graphSequence(after).map(item => item.node.type)).toEqual(['start', 'approval', 'exclusiveGateway', 'end'])
    const changedEdgeIds = ['entry', moving.afterEdge.id, target.id]
    expect(after.edges.filter(value => !changedEdgeIds.includes(value.id))).toEqual(nested.edges.filter(value => !changedEdgeIds.includes(value.id)))
    expect(ids(after)).toEqual(ids(nested))
    expectValid(after)
  })

  it('moves a human into another branch while preserving the destination branch ID and condition', () => {
    const original = region(), split = splitOf(original), branches = outgoing(original, split.id)
    const expanded = insertOnEdge(original, branches[0].id, 'approval', people)
    const movedId = outgoing(expanded, split.id)[0].target
    const after = moveUnit(expanded, movedId, branches[1].id)
    expect(outgoing(after, split.id)[0]).toEqual(branches[0])
    expect(outgoing(after, split.id)[1]).toEqual({ ...branches[1], target: movedId })
    expectValid(after)
  })

  it('rejects self/descendant moves and adjacent no-ops while allowing safe empty branch moves', () => {
    const definition = region(), split = splitOf(definition), branches = outgoing(definition, split.id)
    const before = JSON.stringify(definition)
    expect(() => moveUnit(definition, split.id, branches[0].id)).toThrow(/descendants/)
    expect(() => moveUnit(definition, split.id, 'entry')).toThrow(/already next/)
    expectValid(moveUnit(definition, branches[0].target, branches[1].id))
    expect(() => moveUnit(definition, split.id, 'missing')).toThrow(/no longer exists/)
    expect(JSON.stringify(definition)).toBe(before)
  })

  it('preserves conditions when inserting onto a branch edge', () => {
    const definition = region(), split = splitOf(definition), branch = outgoing(definition, split.id)[0]
    const after = insertOnEdge(definition, branch.id, 'parallelApproval', people)
    expect(after.edges.find(value => value.id === branch.id)).toEqual({ ...branch, target: after.nodes.at(-1).id })
    expectValid(after)
  })
})

describe('branch edits and FIRST_MATCH order', () => {
  it('adds conditional branches immediately before the one default and limits them to four', () => {
    const definition = region(), split = splitOf(definition), defaultId = outgoing(definition, split.id).at(-1).id
    const three = addBranch(definition, split.id, people), four = addBranch(freeze(three), split.id, people)
    expect(outgoing(four, split.id)).toHaveLength(4)
    expect(outgoing(four, split.id).at(-1).id).toBe(defaultId)
    expect(outgoing(four, split.id).filter(value => value.defaultBranch)).toHaveLength(1)
    expect(outgoing(four, split.id).slice(0, -1).every(value => value.condition)).toBe(true)
    expect(() => addBranch(four, split.id, people)).toThrow(/four/)
    expectValid(four)
  })

  it('reorders nondefault conditions as whole branches and leaves the default last', () => {
    const definition = region(), split = splitOf(definition), expanded = addBranch(definition, split.id, people)
    const branches = outgoing(expanded, split.id), moved = moveBranch(freeze(expanded), branches[1].id, -1)
    expect(outgoing(moved, split.id).map(value => value.id)).toEqual([branches[1].id, branches[0].id, branches[2].id])
    expect(moved.nodes).toEqual(expanded.nodes)
    expect(() => moveBranch(moved, branches[2].id, -1)).toThrow(/default branch/)
    expect(() => moveBranch(moved, branches[0].id, 1)).toThrow(/boundary/)
    expectValid(moved)
  })

  it('deletes nested branch contents and preserves the shared paired closer', () => {
    const definition = region(), split = splitOf(definition), expanded = addBranch(definition, split.id, people)
    const branch = outgoing(expanded, split.id)[1], nested = insertOnEdge(expanded, branch.id, 'parallelFork', people)
    const after = deleteBranch(freeze(nested), branch.id)
    expect(ids(after).sort()).toEqual(ids(definition).sort())
    expect(nodeById(after, split.pairId)).toEqual(nodeById(definition, split.pairId))
    expectValid(after)
    expect(() => deleteBranch(after, outgoing(after, split.id)[0].id)).toThrow(/at least two/)
  })

  it('rejects deletion of the unique default without changing any earlier business condition', () => {
    const definition = region(), split = splitOf(definition), expanded = addBranch(definition, split.id, people)
    const branches = outgoing(expanded, split.id), before = JSON.stringify(expanded)
    expect(() => deleteBranch(freeze(expanded), branches.at(-1).id)).toThrow(/default branch cannot be deleted/)
    expect(JSON.stringify(expanded)).toBe(before)
    expectValid(expanded)
  })

  it('allows all parallel branches to reorder without inventing conditions', () => {
    const definition = region('parallelFork'), split = splitOf(definition), expanded = addBranch(definition, split.id, people)
    const branches = outgoing(expanded, split.id), moved = moveBranch(expanded, branches.at(-1).id, -2)
    expect(outgoing(moved, split.id).map(value => value.id)).toEqual([branches[2].id, branches[0].id, branches[1].id])
    expect(outgoing(moved, split.id).every(value => value.condition === null && value.defaultBranch === false)).toBe(true)
    expectValid(deleteBranch(moved, branches[0].id))
  })
})

describe('bounds and client diagnostics', () => {
  it('locates a broken region pair at the exact split node', () => {
    const definition = region(), split = splitOf(definition); split.pairId = 'missing'
    expect(validateClientGraph(definition)).toContainEqual(expect.objectContaining({code:'INVALID_PAIR', nodeId:split.id}))
  })

  it('requires globally unique node and edge IDs and avoids both namespaces during generation', () => {
    const definition = empty()
    definition.edges[0].id = 'approval_1'
    const added = insertOnEdge(definition, 'approval_1', 'approval', people)
    expect(humanOf(added).id).toBe('approval_2')
    expectValid(added)
    const collision = clone(added)
    collision.edges[0].id = humanOf(collision).id
    expect(() => graphSequence(collision)).toThrow(/globally unique/)
    expect(validateClientGraph(collision).map(value => value.code)).toContain('INVALID_STRUCTURE')
  })

  it('sums human requirements across parallel branches but takes the minimum across exclusive choices', () => {
    const parallel = insertOnEdge(empty(), 'entry', 'parallelFork', people), split = splitOf(parallel)
    const branches = outgoing(parallel, split.id), oneHuman = deleteUnit(parallel, branches[0].target)
    expectValid(oneHuman)
    expect(graphSequence(oneHuman)[1].branches[0].items).toEqual([])
    expect(() => deleteUnit(oneHuman, branches[1].target)).toThrow(/Every successful process path/)
    const exclusive = insertOnEdge(empty(), 'entry', 'exclusiveGateway', people), exclusiveSplit = splitOf(exclusive)
    expect(() => deleteUnit(exclusive, outgoing(exclusive, exclusiveSplit.id)[0].target)).toThrow(/Every successful process path/)
  })

  it('rejects third-level nesting without altering the original definition', () => {
    const definition = region(), split = splitOf(definition)
    const nested = insertOnEdge(definition, outgoing(definition, split.id)[0].id, 'parallelFork', people)
    const inner = nested.nodes.find(value => value.type === 'parallelFork')
    const snapshot = JSON.stringify(nested)
    expect(() => insertOnEdge(nested, outgoing(nested, inner.id)[0].id, 'exclusiveGateway', people)).toThrow(/two nested/)
    expect(JSON.stringify(nested)).toBe(snapshot)
    expectValid(nested)
  })

  it('caps human nodes at sixteen and total nodes at thirty-two', () => {
    let definition = linear()
    for (let index = 1; index < 16; index++) definition = insertOnEdge(definition, 'entry', 'approval', people)
    expectValid(definition)
    expect(() => insertOnEdge(definition, 'entry', 'approval', people)).toThrow(/16 human/)
    let maximal = linear()
    for (let index = 0; index < 7; index++) maximal = insertOnEdge(maximal, 'entry', 'parallelFork', people)
    maximal = insertOnEdge(maximal, 'entry', 'approval', people)
    expect(maximal.nodes).toHaveLength(GRAPH_LIMITS.nodes)
    expectValid(maximal)
    expect(() => insertOnEdge(maximal, 'entry', 'parallelApproval', people)).toThrow(/32 nodes/)
  })

  it('caps predicate atoms and reports mismatched currency or malformed predicates', () => {
    let definition = region()
    for (let index = 0; index < 3; index++) definition = insertOnEdge(definition, 'entry', 'exclusiveGateway', people)
    for (const conditionEdge of definition.edges.filter(value => value.condition)) conditionEdge.condition.predicates = Array.from({ length: 8 }, () => clone(conditionEdge.condition.predicates[0]))
    const conditional = definition.edges.find(value => value.condition)
    expectValid(definition)
    expect(() => addBranch(definition, splitOf(definition).id, people)).toThrow(/32 condition/)
    conditional.condition.predicates[0].currency = 'CNY'
    conditional.condition.predicates[1].threshold = 0.001
    const codes = validateClientGraph(definition).map(value => value.code)
    expect(codes).toContain('CURRENCY_MISMATCH')
    expect(codes).toContain('INVALID_PREDICATE')
  })

  it('diagnoses default order, ordinary conditional edges, invalid assignments, and missing wire fields', () => {
    const definition = region(), split = splitOf(definition), branches = outgoing(definition, split.id)
    branches[0].defaultBranch = true
    definition.edges[0].condition = clone(branches[0].condition)
    humanOf(definition).completionMode = 'ANY'
    delete definition.nodes[0].pairId
    const diagnostics = validateClientGraph(definition)
    expect(diagnostics.map(value => value.code)).toEqual(expect.arrayContaining(['INVALID_DEFAULT', 'INVALID_BRANCH', 'INVALID_ASSIGNMENT', 'INVALID_NODE']))
    expect(diagnostics.every(value => Object.hasOwn(value, 'nodeId') && Object.hasOwn(value, 'edgeId'))).toBe(true)
  })

  it('matches server draft bounds for nonblank edge labels and eight predicates per rule', () => {
    const definition = region(), conditional = definition.edges.find(value => value.condition)
    expect(definition.edges.every(value => value.label.trim().length > 0)).toBe(true)
    conditional.condition.predicates = Array.from({ length: 9 }, () => clone(conditional.condition.predicates[0]))
    definition.edges[0].label = ' '
    const codes = validateClientGraph(definition).map(value => value.code)
    expect(codes).toContain('INVALID_CONDITION')
    expect(codes).toContain('INVALID_EDGE')
  })

  it('rejects cross-branch shortcuts, detached nodes, loops, and mismatched pairs', () => {
    for (const corrupt of [
      definition => { const branches = outgoing(definition, splitOf(definition).id); definition.edges.find(value => value.source === branches[0].target).target = branches[1].target },
      definition => definition.nodes.push(node('detached', 'approval', { assigneeIds: [people[0].id], completionMode: 'ALL' })),
      definition => { definition.edges.at(-1).target = 'start' },
      definition => { nodeById(definition, splitOf(definition).pairId).pairId = 'start' },
    ]) {
      const definition = region(); corrupt(definition)
      expect(() => graphSequence(definition)).toThrow()
      expect(validateClientGraph(definition).map(value => value.code)).toContain('INVALID_STRUCTURE')
    }
  })

  it('returns diagnostics instead of throwing on malformed wire data', () => {
    for (const definition of [null, {}, { ...empty(), nodes: [null] }, { ...empty(), edges: [null] }, { ...empty(), nodes: [null, ...empty().nodes] }]) {
      expect(() => validateClientGraph(definition)).not.toThrow()
      expect(validateClientGraph(definition).length).toBeGreaterThan(0)
    }
    expect(() => insertOnEdge(linear(), 'missing', 'approval', people)).toThrow(/no longer exists/)
    expect(() => insertOnEdge(linear(), 'entry', 'start', people)).toThrow(/Choose an approval/)
  })
})

describe('runtime projection from frozen task, fork, and route records', () => {
  it('marks the chosen conditional branch active and all nested unchosen contents skipped', () => {
    const definition = region(), split = splitOf(definition), branches = outgoing(definition, split.id)
    const nested = insertOnEdge(definition, branches[1].id, 'parallelFork', people)
    const instance = { definition: nested, status: 'PENDING',
      tasks: [{ nodeId: branches[0].target, status: 'ACTIVE', votes: [] }], forks: [],
      routes: [{ gatewayId: split.id, selectedEdgeId: branches[0].id }] }
    const state = graphRuntimeStatus(instance), outer = graphSequence(nested)[1]
    expect(state.nodes[split.id]).toBe('completed')
    expect(state.nodes[branches[0].target]).toBe('active')
    expect(state.nodes[split.pairId]).toBe('waiting')
    expect(state.edges[branches[0].id]).toBe('active')
    expect(state.edges[branches[1].id]).toBe('skipped')
    for (const inner of allRegions(outer.branches[1].items)) {
      expect(state.nodes[inner.node.id]).toBe('skipped')
      expect(state.nodes[inner.pair.id]).toBe('skipped')
      for (const branch of inner.branches) expect(state.edges[branch.edge.id]).toBe('skipped')
    }
    expect(runtimeNodeStatus(instance, branches[0].target)).toBe('active')
    expect(runtimeEdgeStatus(instance, branches[1].id)).toBe('skipped')
    expect(deriveState(instance)).toEqual(state)
  })

  it('keeps a join waiting until its persisted fork fires, even if every branch task is completed', () => {
    const definition = region('parallelFork'), split = splitOf(definition), branches = outgoing(definition, split.id)
    const instance = { definition, status: 'PENDING', routes: [],
      tasks: branches.map(branch => ({ nodeId: branch.target, status: 'COMPLETED' })),
      forks: [{ id: 'activation', forkId: split.id, joinId: split.pairId,
        expectedBranchIds: branches.map(branch => branch.id), arrivedBranchIds: [branches[0].id], fired: false }] }
    let state = graphRuntimeStatus(instance)
    expect(state.nodes[split.pairId]).toBe('waiting')
    expect(state.edges[branches[0].id]).toBe('completed')
    expect(state.edges[branches[1].id]).toBe('active')
    expect(state.nodes[humanOf(definition).id]).toBe('idle')
    instance.forks[0].arrivedBranchIds = branches.map(branch => branch.id)
    instance.forks[0].fired = true
    instance.tasks.push({ nodeId: humanOf(definition).id, status: 'ACTIVE' })
    state = graphRuntimeStatus(instance)
    expect(state.nodes[split.pairId]).toBe('completed')
    expect(state.nodes[humanOf(definition).id]).toBe('active')
  })

  it('uses task status for ANY rejection and terminal cancellation, without guessing from votes', () => {
    const definition = insertOnEdge(empty(), 'entry', 'parallelApproval', people)
    const group = definition.nodes.find(value => value.type === 'parallelApproval'); group.completionMode = 'ANY'
    const instance = { definition, status: 'PENDING', tasks: [{ nodeId: group.id, status: 'ACTIVE', votes: [{ decision: 'REJECT' }] }], routes: [], forks: [] }
    expect(runtimeNodeStatus(instance, group.id)).toBe('active')
    instance.tasks[0].status = 'CANCELLED'; instance.status = 'REJECTED'
    expect(runtimeNodeStatus(instance, group.id)).toBe('cancelled')
    expect(runtimeNodeStatus(instance, 'end')).toBe('idle')
    instance.tasks[0].status = 'REJECTED'
    expect(runtimeNodeStatus(instance, group.id)).toBe('rejected')
  })

  it('cancels an unfired join on rejection while preserving the fork arrival history', () => {
    const definition = region('parallelFork'), split = splitOf(definition), branches = outgoing(definition, split.id)
    const instance = { definition, status: 'REJECTED', routes: [],
      tasks: [{ nodeId: branches[0].target, status: 'COMPLETED' }, { nodeId: branches[1].target, status: 'REJECTED' }],
      forks: [{ forkId: split.id, joinId: split.pairId, expectedBranchIds: branches.map(branch => branch.id), arrivedBranchIds: [branches[0].id], fired: false }] }
    const original = JSON.stringify(instance), state = graphRuntimeStatus(freeze(instance))
    expect(state.nodes[split.pairId]).toBe('cancelled')
    expect(state.edges[branches[0].id]).toBe('completed')
    expect(state.nodes[branches[1].target]).toBe('rejected')
    expect(state.edges[branches[1].id]).toBe('cancelled')
    expect(JSON.stringify(instance)).toBe(original)
  })

  it('preserves the chosen condition and cancelled parallel paths after rejection instead of calling them skipped', () => {
    const outer = region(), gateway = splitOf(outer), choices = outgoing(outer, gateway.id)
    const definition = insertOnEdge(outer, choices[0].id, 'parallelFork', people)
    const fork = definition.nodes.find(value => value.type === 'parallelFork'), branches = outgoing(definition, fork.id)
    const instance = { definition, status: 'REJECTED',
      routes: [{ gatewayId: gateway.id, selectedEdgeId: choices[0].id }],
      tasks: [{ nodeId: branches[0].target, status: 'REJECTED' }, { nodeId: branches[1].target, status: 'CANCELLED' }],
      forks: [{ forkId: fork.id, joinId: fork.pairId, expectedBranchIds: branches.map(branch => branch.id), arrivedBranchIds: [], fired: false }] }
    const before = JSON.stringify(instance), state = graphRuntimeStatus(freeze(instance))
    expect(state.edges[choices[0].id]).toBe('selected')
    expect(state.edges[choices[1].id]).toBe('skipped')
    expect(state.nodes[gateway.id]).toBe('completed')
    expect(state.nodes[gateway.pairId]).toBe('cancelled')
    expect(state.nodes['end']).toBe('idle')
    expect(Object.values(state.nodes)).not.toContain('active')
    expect(Object.values(state.nodes)).not.toContain('waiting')
    expect(state.nodes[fork.pairId]).toBe('cancelled')
    expect(state.nodes[branches[0].target]).toBe('rejected')
    expect(state.nodes[branches[1].target]).toBe('cancelled')
    for (const branch of branches) expect(state.edges[branch.id]).toBe('cancelled')
    expect(JSON.stringify(instance)).toBe(before)
  })

  it('retains a future frozen selection after earlier rejection without claiming its path was activated', () => {
    const base = linear(), first = humanOf(base), tail = outgoing(base, first.id)[0]
    const definition = insertOnEdge(base, tail.id, 'exclusiveGateway', people), gateway = splitOf(definition)
    const choices = outgoing(definition, gateway.id)
    const instance = { definition, status: 'REJECTED', tasks: [{ nodeId: first.id, status: 'REJECTED' }], forks: [], routes: [{ gatewayId: gateway.id, selectedEdgeId: choices[0].id }] }
    const state = graphRuntimeStatus(instance)
    expect(state.edges[choices[0].id]).toBe('selected')
    expect(state.edges[choices[1].id]).toBe('skipped')
    expect(state.nodes[first.id]).toBe('rejected')
    expect(Object.values(state.edges)).not.toContain('active')
    expect(state.edges[tail.id]).toBe('idle')
    expect(state.nodes[gateway.id]).toBe('idle')
    expect(state.nodes[gateway.pairId]).toBe('idle')
    expect(state.nodes[choices[0].target]).toBe('idle')
  })

  it('does not activate a future gateway just because its route was frozen at submission', () => {
    const base = linear(), tail = outgoing(base, humanOf(base).id)[0]
    const definition = insertOnEdge(base, tail.id, 'exclusiveGateway', people), split = splitOf(definition)
    const selected = outgoing(definition, split.id)[0]
    const instance = { definition, status: 'PENDING', tasks: [{ nodeId: humanOf(base).id, status: 'ACTIVE' }], forks: [], routes: [{ gatewayId: split.id, selectedEdgeId: selected.id }] }
    const state = graphRuntimeStatus(instance)
    expect(state.nodes[split.id]).toBe('idle')
    expect(state.nodes[split.pairId]).toBe('idle')
    expect(state.nodes[selected.target]).toBe('idle')
    expect(state.edges[selected.id]).toBe('selected')
  })

  it('marks approved end nodes complete and supports absent snapshots', () => {
    const definition = linear(), instance = { definition, status: 'APPROVED', tasks: [{ nodeId: humanOf(definition).id, status: 'COMPLETED' }] }
    expect(runtimeNodeStatus(instance, 'end')).toBe('completed')
    expect(Object.values(graphRuntimeStatus(instance).edges).every(status => status === 'completed')).toBe(true)
    expect(graphRuntimeStatus(null)).toEqual({ nodes: {}, edges: {} })
  })
})
