import { MAX_APPROVALS, cloneDefinition, isApproval } from './process'

const validId = id => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)
const editableSequence = definition => {
  const nodes = definition?.nodes
  return Array.isArray(nodes)
    && nodes.length >= 3 && nodes.length <= MAX_APPROVALS + 2
    && nodes[0]?.id === 'start' && nodes[0]?.type === 'start'
    && nodes.at(-1)?.id === 'end' && nodes.at(-1)?.type === 'end'
    && nodes.slice(1, -1).every(isApproval)
    && nodes.every(node => validId(node?.id))
    && new Set(nodes.map(node => node.id)).size === nodes.length
}

// Return independent copies even for rejected edits, matching setApprovalMode.
// Structural edits remain available while a name or assignment is being typed.
export function insertApproval(definition, afterNodeId, newId) {
  const copy = cloneDefinition(definition)
  if (!editableSequence(copy) || copy.nodes.length >= MAX_APPROVALS + 2
    || !validId(newId) || copy.nodes.some(node => node.id === newId)) return copy
  const index = copy.nodes.findIndex(node => node.id === afterNodeId)
  if (index < 0 || index >= copy.nodes.length - 1) return copy
  copy.nodes.splice(index + 1, 0, { id: newId, type: 'approval', name: 'Approval', assigneeId: 'bob' })
  return copy
}

export function moveApproval(definition, id, direction) {
  const copy = cloneDefinition(definition)
  if (!editableSequence(copy) || ![-1, 1].includes(direction)) return copy
  const index = copy.nodes.findIndex(node => node.id === id && isApproval(node))
  const target = index + direction
  if (index < 1 || target < 1 || target >= copy.nodes.length - 1) return copy
  ;[copy.nodes[index], copy.nodes[target]] = [copy.nodes[target], copy.nodes[index]]
  return copy
}

export function removeApproval(definition, id) {
  const copy = cloneDefinition(definition)
  if (!editableSequence(copy) || copy.nodes.length <= 3) return copy
  const index = copy.nodes.findIndex(node => node.id === id && isApproval(node))
  if (index > 0) copy.nodes.splice(index, 1)
  return copy
}

export function updateApproval(definition, id, changes) {
  const copy = cloneDefinition(definition)
  if (!editableSequence(copy) || !changes || typeof changes !== 'object' || Array.isArray(changes)) return copy
  const node = copy.nodes.find(node => node.id === id && isApproval(node))
  if (!node) return copy
  if (Object.hasOwn(changes, 'name') && typeof changes.name === 'string') node.name = changes.name
  if (node.type === 'approval' && Object.hasOwn(changes, 'assigneeId')
    && (typeof changes.assigneeId === 'string' || changes.assigneeId === null)) node.assigneeId = changes.assigneeId
  if (node.type === 'parallelApproval' && Object.hasOwn(changes, 'assigneeIds')
    && Array.isArray(changes.assigneeIds) && changes.assigneeIds.every(id => typeof id === 'string')) node.assigneeIds = [...changes.assigneeIds]
  return copy
}

// Clearing the last condition keeps schema 4 and omits runIf; no null sentinel.
export function setRunIf(definition, id, runIf) {
  const copy = cloneDefinition(definition)
  if (!editableSequence(copy) || !['erp-payment', 'erp-receiving', 'crm-contract'].includes(copy.id)) return copy
  const node = copy.nodes.find(node => node.id === id && isApproval(node))
  if (!node) return copy
  if (runIf === undefined) delete node.runIf
  else { node.runIf = JSON.parse(JSON.stringify(runIf)); copy.schemaVersion = 4 }
  return copy
}

const cloneSelection = selection => selection == null ? selection : JSON.parse(JSON.stringify(selection))
const snapshot = (definition, selection) => ({ definition: cloneDefinition(definition), selection: cloneSelection(selection) })

export function createDraftHistory(limit = 50) {
  const capacity = Number.isInteger(limit) && limit >= 0 ? limit : 50
  return {
    past: [],
    future: [],
    mergeKey: null,
    get canUndo() { return this.past.length > 0 },
    get canRedo() { return this.future.length > 0 },
    record(before, after, selectionBefore, selectionAfter, mergeKey = null) {
      // Focus/selection changes and rejected edits are not document edits.
      if (JSON.stringify(before) === JSON.stringify(after)) return false
      if (capacity && !(mergeKey !== null && this.mergeKey === mergeKey && this.past.length)) {
        this.past.push(snapshot(before, selectionBefore))
        if (this.past.length > capacity) this.past.splice(0, this.past.length - capacity)
      }
      this.future.splice(0)
      this.mergeKey = mergeKey
      return true
    },
    undo(current, currentSelection) {
      this.endMerge()
      if (!this.canUndo) return null
      this.future.push(snapshot(current, currentSelection))
      const previous = this.past.pop()
      return snapshot(previous.definition, previous.selection)
    },
    redo(current, currentSelection) {
      this.endMerge()
      if (!this.canRedo) return null
      this.past.push(snapshot(current, currentSelection))
      if (this.past.length > capacity) this.past.splice(0, this.past.length - capacity)
      const next = this.future.pop()
      return snapshot(next.definition, next.selection)
    },
    endMerge() { this.mergeKey = null },
    clear() {
      this.past.splice(0)
      this.future.splice(0)
      this.endMerge()
    },
  }
}
