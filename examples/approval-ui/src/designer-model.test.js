import { describe, expect, it } from 'vitest'
import { computed, reactive } from 'vue'
import { createDraftHistory, insertApproval, moveApproval, removeApproval, updateApproval } from './designer-model'
import { cloneDefinition, setApprovalMode, validateDefinition } from './process'

const definition = (count = 3) => ({
  schemaVersion: 2, id: 'leave-approval', version: 1, name: 'Leave approval',
  nodes: [
    { id: 'start', type: 'start', name: 'Start', assigneeId: null },
    ...Array.from({ length: count }, (_, index) => ({ id: `review-${index + 1}`, type: 'approval', name: `Review ${index + 1}`, assigneeId: index % 2 ? 'carol' : 'bob' })),
    { id: 'end', type: 'end', name: 'End', assigneeId: null },
  ],
})
const ids = value => value.nodes.map(node => node.id)
const rename = (value, name) => updateApproval(value, 'review-1', { name })
const freeze = value => {
  Object.freeze(value)
  for (const nested of Object.values(value)) if (nested && typeof nested === 'object') freeze(nested)
  return value
}

describe('designer insertion', () => {
  it.each([
    ['start', ['start', 'new-review', 'review-1', 'review-2', 'review-3', 'end']],
    ['review-1', ['start', 'review-1', 'new-review', 'review-2', 'review-3', 'end']],
    ['review-3', ['start', 'review-1', 'review-2', 'review-3', 'new-review', 'end']],
  ])('inserts after %s without replacing stable IDs', (after, expected) => {
    const original = freeze(definition())
    const next = insertApproval(original, after, 'new-review')
    expect(ids(next)).toEqual(expected)
    expect(next.nodes.find(node => node.id === 'new-review')).toEqual({ id: 'new-review', type: 'approval', name: 'Approval', assigneeId: 'bob' })
    expect(validateDefinition(next)).toEqual([])
    for (const node of original.nodes) {
      const preserved = next.nodes.find(candidate => candidate.id === node.id)
      expect(preserved).toEqual(node)
      expect(preserved).not.toBe(node)
    }
    expect(ids(original)).toEqual(['start', 'review-1', 'review-2', 'review-3', 'end'])
  })

  it.each(['start', 'end', 'review-1', '', '_invalid', 'two words', '1step', 'x'.repeat(65), null, undefined, 10])('rejects duplicate or invalid new ID %j', id => {
    const original = definition()
    expect(insertApproval(original, 'start', id)).toEqual(original)
  })

  it.each(['end', 'missing', null, undefined])('does not insert after invalid target %j', after => {
    const original = definition()
    const next = insertApproval(original, after, 'new-review')
    expect(next).toEqual(original)
    expect(next).not.toBe(original)
  })

  it('allows the eighth review and rejects the ninth', () => {
    const eighth = insertApproval(definition(7), 'review-7', 'eighth')
    expect(eighth.nodes).toHaveLength(10)
    expect(validateDefinition(eighth)).toEqual([])
    expect(insertApproval(eighth, 'eighth', 'ninth')).toEqual(eighth)
  })

  it('preserves parallel nodes and schema when inserting around them', () => {
    const original = setApprovalMode(definition(), 'review-2', 'ANY')
    const next = insertApproval(original, 'review-2', 'new-review')
    expect(next.schemaVersion).toBe(3)
    expect(next.nodes[2]).toEqual(original.nodes[2])
    expect(next.nodes[2].assigneeIds).not.toBe(original.nodes[2].assigneeIds)
    expect(validateDefinition(next)).toEqual([])
  })
})

describe('designer move and remove', () => {
  it('moves approval nodes one slot in both directions, including parallel steps', () => {
    const original = freeze(setApprovalMode(definition(), 'review-2', 'ALL'))
    const up = moveApproval(original, 'review-2', -1)
    expect(ids(up)).toEqual(['start', 'review-2', 'review-1', 'review-3', 'end'])
    const down = moveApproval(original, 'review-2', 1)
    expect(ids(down)).toEqual(['start', 'review-1', 'review-3', 'review-2', 'end'])
    expect(moveApproval(up, 'review-2', 1)).toEqual(original)
    expect(validateDefinition(up)).toEqual([])
    expect(validateDefinition(down)).toEqual([])
    expect(down.nodes[3]).toEqual(original.nodes[2])
  })

  it.each([['start', 1], ['end', -1], ['missing', 1], ['review-1', -1], ['review-3', 1], ['review-2', 0], ['review-2', 2], ['review-2', -2], ['review-2', '1'], ['review-2', null]])('ignores invalid move %j by %j', (id, direction) => {
    const original = definition()
    expect(moveApproval(original, id, direction)).toEqual(original)
  })

  it.each(['review-1', 'review-2', 'review-3'])('removes %s without altering surviving nodes', id => {
    const original = freeze(setApprovalMode(definition(), 'review-2', 'ANY'))
    const next = removeApproval(original, id)
    expect(next.nodes).toEqual(original.nodes.filter(node => node.id !== id))
    expect(validateDefinition(next)).toEqual([])
  })

  it.each(['start', 'end', 'missing', null])('does not remove boundary or absent node %j', id => {
    const original = definition()
    expect(removeApproval(original, id)).toEqual(original)
  })

  it('never deletes the last remaining approval, including a parallel approval', () => {
    for (const original of [definition(1), setApprovalMode(definition(1), 'review-1', 'ALL')]) {
      expect(removeApproval(original, 'review-1')).toEqual(original)
    }
  })
})

describe('designer field editing', () => {
  it('updates a single review with an allowlist and independent copies', () => {
    const original = freeze(definition())
    const next = updateApproval(original, 'review-2', {
      name: 'Finance review', assigneeId: 'bob', id: 'other', type: 'parallelApproval',
      completionMode: 'ANY', assigneeIds: ['bob', 'carol'], extra: 'ignored',
    })
    expect(next.nodes[2]).toEqual({ id: 'review-2', type: 'approval', name: 'Finance review', assigneeId: 'bob' })
    expect(original.nodes[2].name).toBe('Review 2')
    expect(validateDefinition(next)).toEqual([])
  })

  it('updates a parallel participant list without creating a single assignee or changing mode', () => {
    const original = freeze(setApprovalMode(definition(), 'review-2', 'ALL'))
    const members = ['carol', 'bob']
    const next = updateApproval(original, 'review-2', { name: 'Group review', assigneeIds: members, assigneeId: 'carol', completionMode: 'ANY' })
    expect(next.nodes[2]).toEqual({ ...original.nodes[2], name: 'Group review', assigneeIds: ['carol', 'bob'] })
    members.pop()
    expect(next.nodes[2].assigneeIds).toEqual(['carol', 'bob'])
    expect(validateDefinition(next)).toEqual([])
  })

  it('keeps incomplete text and participant edits as local drafts for validation', () => {
    const emptyName = rename(definition(), '')
    expect(emptyName.nodes[1].name).toBe('')
    expect(validateDefinition(emptyName).join(' ')).toContain('Give approval step 1 a name')
    expect(insertApproval(emptyName, 'start', 'new-review').nodes).toHaveLength(6)
    const parallel = setApprovalMode(definition(), 'review-1', 'ALL')
    expect(updateApproval(parallel, 'review-1', { assigneeIds: [] }).nodes[1].assigneeIds).toEqual([])
  })

  it.each(['start', 'end', 'missing', null])('does not update boundary or absent node %j', id => {
    const original = definition()
    expect(updateApproval(original, id, { name: 'Changed', assigneeId: 'bob' })).toEqual(original)
  })

  it.each([null, undefined, [], 'bad', { name: null, assigneeId: 7 }, { name: {}, assigneeIds: 'bob' }])('ignores unsupported update shape %j', changes => {
    const original = definition()
    expect(updateApproval(original, 'review-1', changes)).toEqual(original)
  })

  it.each([null, {}, { nodes: {} }, { nodes: [null] }, { nodes: [{ id: 'start', type: 'start' }, { id: 'end', type: 'end' }] }])('safely rejects structural edits of malformed definition %j', original => {
    for (const edit of [value => insertApproval(value, 'start', 'new-review'), value => moveApproval(value, 'review-1', 1), value => removeApproval(value, 'review-1'), value => updateApproval(value, 'review-1', { name: 'Changed' })]) {
      expect(() => edit(original)).not.toThrow()
      expect(edit(original)).toEqual(original)
    }
  })
})

describe('draft history', () => {
  it('undoes and redoes definition plus selected node', () => {
    const history = createDraftHistory()
    const before = definition(), after = insertApproval(before, 'review-1', 'new-review')
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
    expect(history.undo(before, 'review-1')).toBeNull()
    expect(history.redo(before, 'review-1')).toBeNull()
    expect(history.record(before, after, 'review-1', 'new-review')).toBe(true)
    expect(history.canUndo).toBe(true)
    const previous = history.undo(after, 'new-review')
    expect(previous).toEqual({ definition: before, selection: 'review-1' })
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(true)
    expect(history.redo(previous.definition, previous.selection)).toEqual({ definition: after, selection: 'new-review' })
    expect(history.canUndo).toBe(true)
    expect(history.canRedo).toBe(false)
  })

  it('owns cloned snapshots and returns independent restored values', () => {
    const history = createDraftHistory()
    const before = definition(), after = rename(before, 'Changed')
    const selection = { nodeId: 'review-1' }, currentSelection = { nodeId: 'review-2' }
    history.record(before, after, selection, currentSelection)
    before.nodes[1].name = 'Mutated outside'
    selection.nodeId = 'outside'
    const previous = history.undo(after, currentSelection)
    after.nodes[1].name = 'Mutated current'
    currentSelection.nodeId = 'outside'
    expect(previous.definition.nodes[1].name).toBe('Review 1')
    expect(previous.selection.nodeId).toBe('review-1')
    const redoSnapshot = history.future[0]
    const next = history.redo(previous.definition, previous.selection)
    expect(next.definition.nodes[1].name).toBe('Changed')
    expect(next.selection.nodeId).toBe('review-2')
    expect(next.definition).not.toBe(redoSnapshot.definition)
    expect(next.selection).not.toBe(redoSnapshot.selection)
    previous.definition.nodes[1].name = 'Mutated restored'
    expect(history.past[0].definition.nodes[1].name).toBe('Review 1')
  })

  it('coalesces native text input changes into a single undo and redo', () => {
    const history = createDraftHistory(), initial = definition()
    let current = initial
    for (const name of ['', 'F', 'Fi', 'Finance']) {
      const next = rename(current, name)
      history.record(current, next, 'review-1', 'review-1', 'name:review-1')
      current = next
    }
    expect(history.past).toHaveLength(1)
    expect(history.mergeKey).toBe('name:review-1')
    const previous = history.undo(current, 'review-1')
    expect(previous.definition).toEqual(initial)
    expect(history.mergeKey).toBeNull()
    expect(history.redo(previous.definition, previous.selection).definition).toEqual(current)
  })

  it('ends coalescing on explicit end, another key, or unkeyed edits', () => {
    const history = createDraftHistory()
    let current = definition()
    const edit = (name, key) => {
      const next = rename(current, name)
      history.record(current, next, 'review-1', 'review-1', key)
      current = next
    }
    edit('First', 'name:review-1')
    history.endMerge()
    edit('Second', 'name:review-1')
    edit('Third', 'other')
    edit('Fourth', 'name:review-1')
    edit('Fifth', null)
    edit('Sixth', null)
    expect(history.past).toHaveLength(6)
  })

  it('branches after undo and clears redo without merging into older edits', () => {
    const history = createDraftHistory(), first = definition()
    const second = rename(first, 'Second'), third = rename(second, 'Third')
    history.record(first, second, 'review-1', 'review-1', 'name')
    history.endMerge()
    history.record(second, third, 'review-1', 'review-1', 'name')
    const previous = history.undo(third, 'review-1')
    const branch = rename(previous.definition, 'Branch')
    history.record(previous.definition, branch, previous.selection, 'review-1', 'name')
    expect(history.future).toEqual([])
    expect(history.past).toHaveLength(2)
    expect(history.undo(branch, 'review-1').definition).toEqual(second)
  })

  it('does not record no-op edits or selection-only changes, or discard redo', () => {
    const history = createDraftHistory(), before = definition(), after = rename(before, 'Changed')
    history.record(before, after, 'review-1', 'review-1')
    const previous = history.undo(after, 'review-1')
    expect(history.record(previous.definition, cloneDefinition(previous.definition), 'review-1', 'review-2')).toBe(false)
    expect(history.past).toHaveLength(0)
    expect(history.future).toHaveLength(1)
    expect(history.record(before, moveApproval(before, 'review-1', -1), 'review-1', 'review-1')).toBe(false)
  })

  it('retains only the requested number of undo snapshots', () => {
    const history = createDraftHistory(2), initial = definition()
    let current = initial
    for (const name of ['First', 'Second', 'Third']) {
      const next = rename(current, name)
      history.record(current, next, 'review-1', 'review-1')
      current = next
    }
    expect(history.past).toHaveLength(2)
    const second = history.undo(current, 'review-1')
    const first = history.undo(second.definition, second.selection)
    expect(second.definition.nodes[1].name).toBe('Second')
    expect(first.definition.nodes[1].name).toBe('First')
    expect(history.undo(first.definition, first.selection)).toBeNull()
    history.redo(first.definition, first.selection)
    history.redo(second.definition, second.selection)
    expect(history.past).toHaveLength(2)
  })

  it('defaults to 50 snapshots and allows explicitly disabling history', () => {
    const history = createDraftHistory(), disabled = createDraftHistory(0)
    let current = definition()
    for (let index = 0; index < 55; index++) {
      const next = rename(current, `Edit ${index}`)
      history.record(current, next, null, null)
      disabled.record(current, next, null, null)
      current = next
    }
    expect(history.past).toHaveLength(50)
    expect(disabled.canUndo).toBe(false)
    expect(disabled.undo(current, null)).toBeNull()
  })

  it('clears both stacks and merging while keeping public array references stable', () => {
    const history = createDraftHistory(), before = definition(), after = rename(before, 'Changed')
    const past = history.past, future = history.future
    history.record(before, after, null, null, 'name')
    history.undo(after, null)
    history.clear()
    expect(history.past).toBe(past)
    expect(history.future).toBe(future)
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
    expect(history.mergeKey).toBeNull()
  })

  it('exposes reactive canUndo and canRedo flags when used in Vue', () => {
    const history = reactive(createDraftHistory()), before = definition(), after = rename(before, 'Changed')
    const flags = computed(() => [history.canUndo, history.canRedo])
    expect(flags.value).toEqual([false, false])
    history.record(before, after, 'review-1', 'review-1')
    expect(flags.value).toEqual([true, false])
    history.undo(after, 'review-1')
    expect(flags.value).toEqual([false, true])
    history.clear()
    expect(flags.value).toEqual([false, false])
  })
})
