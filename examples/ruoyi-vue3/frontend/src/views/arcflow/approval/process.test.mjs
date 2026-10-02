import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const source = await readFile(new URL('./process.js', import.meta.url), 'utf8')
const { validateDefinition, clone, stepState } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const people = [{ id: '101', displayName: 'Reviewer' }]
const definition = { schemaVersion: 2, id: 'leave-approval', version: 1, name: 'Leave', nodes: [
  { id: 'start', type: 'start', name: 'Start', assigneeId: null },
  { id: 'review', type: 'approval', name: 'Review', assigneeId: '101' },
  { id: 'end', type: 'end', name: 'End', assigneeId: null }
] }
test('real numeric-string user IDs validate without demo identities', () => {
  assert.equal(validateDefinition(definition, people), '')
  assert.notEqual(validateDefinition(definition, []), '')
})
test('reject empty approval sequence and duplicate step IDs', () => {
  const empty = clone(definition); empty.nodes.splice(1, 1)
  assert.notEqual(validateDefinition(empty, people), '')
  const duplicate = clone(definition); duplicate.nodes.splice(2, 0, clone(duplicate.nodes[1]))
  assert.notEqual(validateDefinition(duplicate, people), '')
})
test('snapshot is independent from subsequent draft changes', () => {
  const snapshot = clone(definition); const draft = clone(definition)
  draft.nodes[1].name = 'Changed'; draft.version++
  assert.equal(snapshot.nodes[1].name, 'Review'); assert.equal(snapshot.version, 1)
})
test('sequential states distinguish current, rejected and unreachable end', () => {
  const request = { status: 'PENDING', currentStepId: 'review', history: [] }
  assert.equal(stepState(request, definition.nodes[1]), '当前审批')
  request.status = 'REJECTED'; request.history.push({ stepId: 'review', action: 'REJECT' })
  assert.equal(stepState(request, definition.nodes[1]), '已拒绝')
  assert.equal(stepState(request, definition.nodes[2]), '未到达')
})
