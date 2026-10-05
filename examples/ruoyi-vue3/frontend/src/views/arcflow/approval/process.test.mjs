import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const source = await readFile(new URL('./process.js', import.meta.url), 'utf8')
const { validateDefinition, clone, stepState, setApprovalMode, pendingParticipants, participantVotes, participants, approvalMode, canVote, modeRule } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
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

test('group conversion upgrades schema, preserves stable identity and selects no extra people', () => {
  const group = setApprovalMode(definition, 'review', 'ALL')
  assert.equal(group.schemaVersion, 3)
  assert.deepEqual(group.nodes[1], { id: 'review', type: 'parallelApproval', name: 'Review', assigneeId: null, assigneeIds: ['101'], completionMode: 'ALL' })
  assert.equal(definition.schemaVersion, 2)
  assert.match(validateDefinition(group, groupPeople), /2 至 16/)
  group.nodes[1].assigneeIds.push('102')
  assert.equal(validateDefinition(group, groupPeople), '')
  const any = setApprovalMode(group, 'review', 'ANY')
  assert.deepEqual(any.nodes[1].assigneeIds, ['101', '102'])
  assert.equal(any.nodes[1].id, 'review')
  const single = setApprovalMode(any, 'review', 'SINGLE')
  assert.deepEqual(single.nodes[1], definition.nodes[1])
  assert.equal(single.schemaVersion, 3)
  assert.equal(validateDefinition(single, groupPeople), '')
})
test('mode conversion rejects unsupported modes and boundary IDs without mutation', () => {
  for (const [id, mode] of [['start', 'ALL'], ['missing', 'ALL'], ['review', 'MAJORITY']]) {
    assert.deepEqual(setApprovalMode(definition, id, mode), definition)
  }
})
const groupPeople = ['101', '102', ...Array.from({ length: 15 }, (_, i) => String(103 + i))].map(id => ({ id, displayName: `Person ${id}` }))
const groupDefinition = mode => {
  const result = setApprovalMode(definition, 'review', mode)
  result.nodes[1].assigneeIds = ['101', '102']
  return result
}
const requestFor = mode => ({ status: 'PENDING', currentStepId: 'review', approverId: '101', definition: groupDefinition(mode), history: [{ actorId: '100', action: 'SUBMIT', stepId: null }] })
const vote = (request, actorId, action) => request.history.push({ actorId, action, stepId: 'review', comment: 'Reason' })
for (const mode of ['ALL', 'ANY']) test(`${mode} validates real directory participants and schema 3`, () => {
  const d = groupDefinition(mode)
  assert.equal(validateDefinition(d, groupPeople), '')
  d.schemaVersion = 2
  assert.notEqual(validateDefinition(d, groupPeople), '')
})
for (const [name, edit] of [
  ['one participant', n => { n.assigneeIds = ['101'] }],
  ['duplicate participants', n => { n.assigneeIds = ['101', '101'] }],
  ['unknown participant', n => { n.assigneeIds = ['101', 'missing'] }],
  ['number participant', n => { n.assigneeIds = ['101', 102] }],
  ['missing participant array', n => { delete n.assigneeIds }],
  ['non-array participants', n => { n.assigneeIds = '101,102' }],
  ['seventeen participants', n => { n.assigneeIds = groupPeople.map(p => p.id) }],
  ['invalid completion mode', n => { n.completionMode = 'MAJORITY' }],
  ['mixed single/group assignment', n => { n.assigneeId = '101' }],
  ['unknown fields', n => { n.roleId = 'administrator' }],
]) test(`reject ${name}`, () => {
  const d = groupDefinition('ALL'); edit(d.nodes[1])
  assert.notEqual(validateDefinition(d, groupPeople), '')
})
test('sixteen distinct directory members are accepted; removal invalidates new publication', () => {
  const d = groupDefinition('ALL'); d.nodes[1].assigneeIds = groupPeople.slice(0, 16).map(p => p.id)
  assert.equal(validateDefinition(d, groupPeople), '')
  assert.notEqual(validateDefinition(d, groupPeople.slice(1)), '')
})
test('malformed nodes, missing fields, boundary group fields and oversized sequence are rejected', () => {
  for (const mutate of [
    d => { d.nodes[1] = null }, d => { d.nodes[0].assigneeIds = [] },
    d => { delete d.nodes[1].assigneeId }, d => { d.nodes[1].id = 'end' },
    d => { d.nodes = [d.nodes[0], ...Array.from({ length: 9 }, (_, i) => ({ ...d.nodes[1], id: `r${i}` })), d.nodes[2]] }
  ]) { const d = clone(definition); mutate(d); assert.notEqual(validateDefinition(d, groupPeople), '') }
})
test('group worklist includes non-first participant and excludes voters, applicant, admin and outsiders', () => {
  const r = requestFor('ALL')
  assert.deepEqual(pendingParticipants(r), ['101', '102'])
  assert.equal(canVote(r, '102'), true)
  for (const id of ['100', '1', '999', null]) assert.equal(canVote(r, id), false)
  vote(r, '102', 'APPROVE')
  assert.deepEqual(pendingParticipants(r), ['101'])
  assert.equal(canVote(r, '102'), false)
  r.status = 'APPROVED'; r.currentStepId = null
  assert.deepEqual(pendingParticipants(r), [])
})
test('ALL partial agreement remains current and shows individual votes', () => {
  const r = requestFor('ALL'), node = r.definition.nodes[1]
  vote(r, '102', 'APPROVE')
  assert.equal(stepState(r, node), '当前审批')
  assert.deepEqual(participantVotes(r, node).map(v => v.state), ['待投票', '已同意'])
  vote(r, '101', 'APPROVE'); r.status = 'APPROVED'; r.currentStepId = null
  assert.equal(stepState(r, node), '已通过')
  assert.deepEqual(participantVotes(r, node).map(v => v.state), ['已同意', '已同意'])
})
test('ALL rejection is terminal and leaves other participants unnecessary', () => {
  const r = requestFor('ALL'), node = r.definition.nodes[1]
  vote(r, '102', 'REJECT'); r.status = 'REJECTED'; r.currentStepId = null
  assert.equal(stepState(r, node), '已拒绝')
  assert.deepEqual(participantVotes(r, node).map(v => v.state), ['无需再投票', '已拒绝'])
})
test('ANY rejection remains current and later agreement approves despite rejected participant', () => {
  const r = requestFor('ANY'), node = r.definition.nodes[1]
  vote(r, '102', 'REJECT')
  assert.equal(stepState(r, node), '当前审批')
  assert.deepEqual(pendingParticipants(r), ['101'])
  assert.deepEqual(participantVotes(r, node).map(v => v.state), ['待投票', '已拒绝'])
  vote(r, '101', 'APPROVE'); r.status = 'APPROVED'; r.currentStepId = null
  assert.equal(stepState(r, node), '已通过')
  assert.deepEqual(participantVotes(r, node).map(v => v.state), ['已同意', '已拒绝'])
})
test('ANY first agreement skips remaining votes; all rejections reject', () => {
  const r = requestFor('ANY'), node = r.definition.nodes[1]
  vote(r, '102', 'APPROVE'); r.status = 'APPROVED'; r.currentStepId = null
  assert.equal(stepState(r, node), '已通过')
  assert.deepEqual(participantVotes(r, node).map(v => v.state), ['无需再投票', '已同意'])
  const rejected = requestFor('ANY')
  vote(rejected, '101', 'REJECT'); vote(rejected, '102', 'REJECT'); rejected.status = 'REJECTED'; rejected.currentStepId = null
  assert.equal(stepState(rejected, rejected.definition.nodes[1]), '已拒绝')
})
test('future stages never become pending because of earlier actor votes', () => {
  const r = requestFor('ALL'), next = { ...clone(r.definition.nodes[1]), id: 'next' }
  r.definition.nodes.splice(2, 0, next)
  vote(r, '101', 'APPROVE'); vote(r, '102', 'APPROVE'); r.currentStepId = 'next'
  assert.equal(stepState(r, next), '当前审批')
  assert.deepEqual(pendingParticipants(r), ['101', '102'])
  assert.equal(participantVotes(r, next)[0].state, '待投票')
  r.currentStepId = 'review'
  assert.equal(stepState(r, next), '等待中')
  r.status = 'REJECTED'; r.currentStepId = null
  assert.equal(participantVotes(r, next)[0].state, '未到达')
})
test('snapshot participant display stays independent from active directory and draft edits', () => {
  const r = requestFor('ALL'), draft = clone(r.definition)
  draft.nodes[1].assigneeIds = ['999', '998']; draft.nodes[1].completionMode = 'ANY'
  assert.deepEqual(participants(r.definition.nodes[1]), ['101', '102'])
  assert.equal(approvalMode(r.definition.nodes[1]), 'ALL')
  assert.match(modeRule(r.definition.nodes[1]), /任一拒绝即驳回/)
  assert.match(modeRule(draft.nodes[1]), /全部拒绝才驳回/)
})
