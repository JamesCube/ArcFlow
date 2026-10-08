import { describe, expect, it } from 'vitest'
import { validateSubmissionResponse, validateDecisionResponse } from './submission-response'

const definition = { schemaVersion: 2, id: 'leave-approval', version: 1, name: 'Leave', nodes: [
  { id: 'start', type: 'start', name: 'Start', assigneeId: null },
  { id: 'review', type: 'approval', name: 'Review', assigneeId: 'bob' },
  { id: 'end', type: 'end', name: 'End', assigneeId: null },
] }
const at = '2026-10-05T01:00:00Z'
const request = { id: 'r1', applicantId: 'alice', approverId: 'bob', title: 'Leave', reason: 'Rest', days: 2,
  status: 'PENDING', createdAt: at, updatedAt: at, decision: null, comment: null, processId: 'leave-approval',
  processVersion: 1, definition, currentStepId: 'review', history: [{ actorId: 'alice', action: 'SUBMIT', stepId: null, comment: '', at }] }

describe('submission response normalization', () => {
  it('accepts backend ASCII-control trimming without treating a confirmed submission as malformed', () => {
    const payload = { title: '\u0001Leave\u001f', reason: '\u0000Rest\u0002', days: 2, processVersion: 1 }
    expect(validateSubmissionResponse(request, 'alice', payload, definition)).toBe(request)
  })
  it('preserves characters that Java trim leaves alone and rejects different text', () => {
    const payload = { title: 'Leave', reason: '\u2003Rest\u2003', days: 2, processVersion: 1 }
    const response = { ...request, reason: payload.reason }
    expect(validateSubmissionResponse(response, 'alice', payload, definition)).toBe(response)
    expect(() => validateSubmissionResponse(request, 'alice', payload, definition)).toThrow('Invalid submission response')
  })
})

const business = { type: 'procurement', businessId: 'PO-001', title: 'Chairs', reason: 'Expansion', item: 'Office chair', quantity: 3, unitPrice: 199.5, currency: 'CNY' }
const procurement = { ...request, title: business.title, reason: business.reason, days: 0, business }
const typedPayload = { business, processVersion: 1 }
const clone = value => structuredClone(value)
const validate = (item, payload = typedPayload, snapshot = definition) => validateSubmissionResponse(item, 'alice', payload, snapshot)

describe('strict typed confirmations and immutable intent', () => {
  it('accepts procurement and typed leave without conflating them with legacy', () => {
    expect(validate(procurement)).toBe(procurement)
    const leave = { type: 'leave', businessId: 'L-001', title: request.title, reason: request.reason, days: request.days }
    const response = { ...request, business: leave }
    expect(validate(response, { business: leave, processVersion: 1 })).toBe(response)
    expect(() => validate(response, { title: request.title, reason: request.reason, days: 2, processVersion: 1 })).toThrow()
    expect(() => validate(request, { business: leave, processVersion: 1 })).toThrow()
    expect(() => validate({ ...procurement, business: { ...business, type: 'leave', days: 2 } })).toThrow()
  })
  it('rejects missing or unknown root and business fields and malformed projections', () => {
    for (const key of Object.keys(procurement)) {
      const response = clone(procurement); delete response[key]
      expect(() => validate(response), `missing root ${key}`).toThrow('Invalid submission response')
    }
    for (const key of Object.keys(business)) {
      const response = clone(procurement); delete response.business[key]
      expect(() => validate(response), `missing business ${key}`).toThrow('Invalid submission response')
    }
    for (const changes of [{ extra: true }, { business: null }, { business: { ...business, extra: true } }, { days: 3 }, { title: 'Changed' }, { reason: 'Changed' }, { processVersion: 2 }]) {
      expect(() => validate({ ...procurement, ...changes })).toThrow('Invalid submission response')
    }
  })
  it('rejects a changed business value or wrong wire type even if flat projections look correct', () => {
    for (const changes of [{ businessId: 'PO-002' }, { item: 'Desk' }, { quantity: 4 }, { unitPrice: 199.51 }, { currency: 'USD' }, { quantity: '3' }, { unitPrice: '199.50' }, { currency: 'CAD' }, { type: 'expense' }, { quantity: 0 }, { unitPrice: 0 }, { unitPrice: 1.001 }]) {
      expect(() => validate({ ...procurement, business: { ...business, ...changes } })).toThrow('Invalid submission response')
    }
  })
  it('accepts a replay with valid decisions while rejecting lifecycle contradictions', () => {
    const event = { action: 'APPROVE', actorId: 'bob', stepId: 'review', comment: 'Checked', at: '2026-10-05T02:00:00Z' }
    const approved = { ...procurement, status: 'APPROVED', currentStepId: null, updatedAt: event.at, decision: 'APPROVE', comment: event.comment, history: [...procurement.history, event] }
    expect(validate(approved)).toBe(approved)
    for (const changes of [{ status: 'PENDING', currentStepId: 'review' }, { status: 'REJECTED' }, { updatedAt: at }, { history: [...approved.history, event] }, { history: [procurement.history[0], { ...event, extra: true }] }]) expect(() => validate({ ...approved, ...changes })).toThrow()
  })
  it('replays ALL/ANY votes in order and rejects skipped stages and fabricated pending approvers', () => {
    const group = { id: 'group', type: 'parallelApproval', name: 'Group', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ALL' }
    const next = { id: 'final', type: 'approval', name: 'Final', assigneeId: 'bob' }
    const snapshot = { ...definition, schemaVersion: 3, nodes: [definition.nodes[0], group, next, definition.nodes.at(-1)] }
    const base = { ...procurement, definition: snapshot, currentStepId: 'group' }
    const event = { action: 'APPROVE', actorId: 'carol', stepId: 'group', comment: '', at: '2026-10-05T02:00:00Z' }
    const partial = { ...base, updatedAt: event.at, decision: event.action, comment: '', history: [...base.history, event] }
    expect(validate(partial, typedPayload, snapshot)).toBe(partial)
    expect(() => validate({ ...partial, approverId: 'carol' }, typedPayload, snapshot)).toThrow()
    expect(() => validate({ ...partial, history: [base.history[0], { ...event, stepId: 'final', actorId: 'bob' }] }, typedPayload, snapshot)).toThrow()
    const anySnapshot = { ...snapshot, nodes: [snapshot.nodes[0], { ...group, completionMode: 'ANY' }, next, snapshot.nodes.at(-1)] }
    const progressed = { ...partial, definition: anySnapshot, currentStepId: 'final' }
    expect(validate(progressed, typedPayload, anySnapshot)).toBe(progressed)
  })
})


describe('typed decision confirmation proves the requested mutation', () => {
  const event = { action: 'APPROVE', actorId: 'bob', stepId: 'review', comment: 'Checked', at: '2026-10-05T02:00:00Z' }
  const approved = { ...procurement, status: 'APPROVED', currentStepId: null, updatedAt: event.at, decision: event.action, comment: event.comment, history: [...procurement.history, event] }
  it('requires the exact actor, step and action while preserving previously saved comments on retries', () => {
    expect(validateDecisionResponse(approved, procurement, 'bob', 'review', 'APPROVE')).toBe(approved)
    expect(() => validateDecisionResponse(procurement, procurement, 'bob', 'review', 'APPROVE', 'Checked')).toThrow()
    for (const [actor, step, action, comment] of [['carol', 'review', 'APPROVE', 'Checked'], ['bob', 'other', 'APPROVE', 'Checked'], ['bob', 'review', 'REJECT', 'Checked']]) expect(() => validateDecisionResponse(approved, procurement, actor, step, action, comment)).toThrow()
    expect(() => validateDecisionResponse({ ...approved, id: 'another' }, procurement, 'bob', 'review', 'APPROVE', 'Checked')).toThrow()
    expect(() => validateDecisionResponse({ ...approved, history: [{ ...procurement.history[0], at: '2026-10-05T00:00:00Z' }, event], createdAt: '2026-10-05T00:00:00Z' }, procurement, 'bob', 'review', 'APPROVE', 'Checked')).toThrow()
  })
  it('rejects unknown or wrongly typed process snapshot fields even when a loaded item is its own snapshot', () => {
    for (const change of [{ id: null }, { version: '1' }, { extra: true }, { name: 'x'.repeat(121) }]) {
      const item = clone(procurement); item.definition = { ...item.definition, ...change }; item.processId = item.definition.id; item.processVersion = item.definition.version
      expect(() => validateSubmissionResponse(item, 'alice', { business, processVersion: item.processVersion }, item.definition)).toThrow()
    }
    const item = clone(procurement); item.definition.nodes[1].extra = true
    expect(() => validateSubmissionResponse(item, 'alice', typedPayload, item.definition)).toThrow()
  })
})
