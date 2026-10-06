import { describe, expect, it } from 'vitest'
import { validateSubmissionResponse } from './submission-response'

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
