import { describe, expect, it } from 'vitest'
import { participantVotes, pendingParticipants, stepState } from './process'

// Deliberately keep the reference transition model independent of process.js.
// Its bounded state space includes every vote order and outcome in every
// three-step combination, including the same participant in later steps.
const variants = [
  { type: 'approval', assigneeId: 'bob' },
  { type: 'approval', assigneeId: 'carol' },
  { type: 'parallelApproval', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ALL' },
  { type: 'parallelApproval', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ANY' },
]
const members = node => node.type === 'parallelApproval' ? node.assigneeIds : [node.assigneeId]

describe('parallel progress against an independent reference model', () => {
  it('matches all 2,304 reachable states across 64 mixed three-step processes', () => {
    let checkedStates = 0
    let checkedProcesses = 0

    for (const first of variants) for (const second of variants) for (const third of variants) {
      const steps = [first, second, third].map((variant, index) => ({
        ...variant, id: `step-${index}`, name: `Step ${index + 1}`,
      }))
      const start = { id: 'start', type: 'start', name: 'Start', assigneeId: null }
      const end = { id: 'end', type: 'end', name: 'End', assigneeId: null }
      const definition = {
        schemaVersion: steps.some(node => node.type === 'parallelApproval') ? 3 : 2,
        id: 'leave-approval', version: 1, name: 'Reference process', nodes: [start, ...steps, end],
      }

      function visit(index, status, history, outcomes) {
        const current = steps[index]
        const currentVotes = history.filter(event => event.stepId === current.id)
        const expectedPending = status === 'PENDING'
          ? members(current).filter(actorId => !currentVotes.some(event => event.actorId === actorId))
          : []
        const request = {
          definition, history, status,
          currentStepId: status === 'PENDING' ? current.id : null,
          approverId: expectedPending[0] || history.at(-1).actorId,
        }
        const context = JSON.stringify({ steps, status, index, history })

        expect(pendingParticipants(request), context).toEqual(expectedPending)
        expect(stepState(request, start), context).toBe('completed')
        expect(stepState(request, end), context).toBe(status === 'APPROVED' ? 'completed' : status === 'REJECTED' ? 'skipped' : 'upcoming')

        for (const [stepIndex, node] of steps.entries()) {
          const expectedState = outcomes[stepIndex]
            || (stepIndex === index && status === 'PENDING' ? 'current' : status === 'PENDING' ? 'upcoming' : 'skipped')
          expect(stepState(request, node), context).toBe(expectedState)
          const expectedVotes = members(node).map(actorId => {
            const event = history.find(entry => entry.stepId === node.id && entry.actorId === actorId)
            return {
              actorId,
              state: event ? (event.action === 'APPROVE' ? 'approved' : 'rejected')
                : outcomes[stepIndex] ? 'not-needed'
                  : stepIndex === index && status === 'PENDING' ? 'pending'
                    : status === 'PENDING' ? 'upcoming' : 'skipped',
              comment: event?.comment || '',
              at: event?.at || null,
            }
          })
          expect(participantVotes(request, node), context).toEqual(expectedVotes)
        }

        checkedStates++
        if (status !== 'PENDING') return

        for (const actorId of expectedPending) for (const action of ['APPROVE', 'REJECT']) {
          const nextHistory = [...history, {
            stepId: current.id, actorId, action,
            comment: `${actorId} ${action} on ${current.id}`,
            at: new Date(Date.UTC(2026, 9, 4, 12, 0, history.length)).toISOString(),
          }]
          const stepVotes = nextHistory.filter(event => event.stepId === current.id)
          const approvedCount = stepVotes.filter(event => event.action === 'APPROVE').length
          const rejectedCount = stepVotes.filter(event => event.action === 'REJECT').length
          const requiredCount = members(current).length
          const all = current.type === 'approval' || current.completionMode === 'ALL'
          const approved = all ? approvedCount === requiredCount : approvedCount > 0
          const rejected = all ? rejectedCount > 0 : rejectedCount === requiredCount
          const nextOutcomes = [...outcomes]

          if (rejected) {
            nextOutcomes[index] = 'rejected'
            visit(index, 'REJECTED', nextHistory, nextOutcomes)
          } else if (approved) {
            nextOutcomes[index] = 'approved'
            const lastStep = index === steps.length - 1
            visit(lastStep ? index : index + 1, lastStep ? 'APPROVED' : 'PENDING', nextHistory, nextOutcomes)
          } else {
            visit(index, 'PENDING', nextHistory, nextOutcomes)
          }
        }
      }

      visit(0, 'PENDING', [{ actorId: 'alice', action: 'SUBMIT', stepId: null, comment: '', at: '2026-10-04T12:00:00.000Z' }], [])
      checkedProcesses++
    }

    expect(checkedProcesses).toBe(64)
    expect(checkedStates).toBe(2304)
  })
})
