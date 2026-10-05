import { describe, it, expect } from 'vitest'
import { approvalNodes, participants, pendingParticipants, participantVotes, setApprovalMode, validateDefinition, stepState } from './process'
const group = mode => ({ id: 'team', type: 'parallelApproval', name: 'Team review', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: mode })
const definition = (mode = 'ALL') => ({ schemaVersion: 3, id: 'leave-approval', version: 4, name: 'Leave approval', nodes: [{ id: 'start', type: 'start', name: 'Start', assigneeId: null }, group(mode), { id: 'end', type: 'end', name: 'End', assigneeId: null }] })
const request = (mode = 'ALL', history = [], overrides = {}) => ({ definition: definition(mode), currentStepId: 'team', status: 'PENDING', approverId: 'bob', history, ...overrides })
const vote = (actorId, action) => ({ actorId, action, stepId: 'team', comment: 'Saved vote', at: '2026-10-04T12:00:00Z' })
describe('parallel definition contract', () => {
  it.each(['ALL', 'ANY'])('validates %s groups and includes them in ordered approvals', mode => {
    expect(validateDefinition(definition(mode))).toEqual([])
    expect(approvalNodes(definition(mode))).toEqual([group(mode)])
    expect(participants(group(mode))).toEqual(['bob', 'carol'])
  })
  it.each([['bob'], ['bob', 'bob'], ['bob', 'alice'], [], null, 'bob'].map(members => [members]))('rejects invalid group membership %j', assigneeIds => {
    const d = definition(); d.nodes[1].assigneeIds = assigneeIds
    expect(validateDefinition(d).length).toBeGreaterThan(0)
  })
  it.each([{ schemaVersion: 2 }, { completionMode: 'MAJORITY' }, { assigneeId: 'bob' }])('rejects incompatible group shape %j', changes => {
    const d = definition(); if (changes.schemaVersion) d.schemaVersion = changes.schemaVersion; else Object.assign(d.nodes[1], changes)
    expect(validateDefinition(d).length).toBeGreaterThan(0)
  })
  it('upgrades only the local draft and removes group-only fields when converting to single', () => {
    const old = definition(); old.schemaVersion = 2; old.nodes[1] = { id: 'team', type: 'approval', name: 'Team review', assigneeId: 'carol' }
    const next = setApprovalMode(old, 'team', 'ALL', ['bob', 'carol'])
    expect(old.schemaVersion).toBe(2); expect(old.nodes[1].type).toBe('approval')
    expect(next.schemaVersion).toBe(3); expect(next.nodes[1].assigneeIds).toEqual(['carol', 'bob'])
    const any = setApprovalMode(next, 'team', 'ANY', ['bob', 'carol'])
    expect(any.nodes[1].assigneeIds).toEqual(['carol', 'bob']); expect(any.nodes[1].completionMode).toBe('ANY')
    const single = setApprovalMode(any, 'team', 'SINGLE', ['bob', 'carol'])
    expect(single.nodes[1]).toEqual(old.nodes[1]); expect(validateDefinition(single)).toEqual([])
  })
  it('rejects unknown fields and group fields on sequential or fixed nodes', () => {
    for (const i of [0, 2]) { const d = definition(); d.nodes[i].assigneeIds = []; expect(validateDefinition(d).length).toBeGreaterThan(0) }
    const d = definition(); d.nodes[1].script = 'unsafe'; expect(validateDefinition(d).length).toBeGreaterThan(0)
  })
})
describe('participant-level progress', () => {
  it('makes every unvoted member eligible regardless of legacy approverId', () => {
    expect(pendingParticipants(request())).toEqual(['bob', 'carol'])
    expect(pendingParticipants(request('ALL', [vote('bob', 'APPROVE')]))).toEqual(['carol'])
    expect(pendingParticipants(request('ANY', [vote('bob', 'REJECT')]))).toEqual(['carol'])
    expect(pendingParticipants(request('ALL', [], { status: 'REJECTED', currentStepId: null }))).toEqual([])
  })
  it.each([['ALL', 'APPROVE'], ['ANY', 'REJECT']])('keeps %s current after a partial %s', (mode, action) => {
    const r = request(mode, [vote('bob', action)])
    expect(stepState(r, r.definition.nodes[1])).toBe('current')
    const votes = participantVotes(r, r.definition.nodes[1])
    expect(votes[0]).toMatchObject({ actorId: 'bob', state: action === 'APPROVE' ? 'approved' : 'rejected', comment: 'Saved vote' })
    expect(votes[1]).toMatchObject({ actorId: 'carol', state: 'pending' })
  })
  it.each([['ALL', 'REJECT', 'rejected'], ['ANY', 'APPROVE', 'approved']])('shows %s early terminal votes and unneeded members', (mode, action, state) => {
    const r = request(mode, [vote('bob', action)], { status: state.toUpperCase(), currentStepId: null })
    expect(stepState(r, r.definition.nodes[1])).toBe(state)
    expect(participantVotes(r, r.definition.nodes[1])[1].state).toBe('not-needed')
  })
  it.each([['ALL', 'APPROVE', 'approved'], ['ANY', 'REJECT', 'rejected']])('resolves %s only after every %s', (mode, action, state) => {
    const r = request(mode, [vote('bob', action), vote('carol', action)], { status: state.toUpperCase(), currentStepId: null })
    expect(stepState(r, r.definition.nodes[1])).toBe(state)
  })
  it('separates votes on repeated participants in other groups', () => {
    const r = request('ALL', [{ ...vote('bob', 'APPROVE'), stepId: 'earlier' }])
    expect(pendingParticipants(r)).toEqual(['bob', 'carol'])
    expect(participantVotes(r, group('ALL')).map(v => v.state)).toEqual(['pending', 'pending'])
  })
})
