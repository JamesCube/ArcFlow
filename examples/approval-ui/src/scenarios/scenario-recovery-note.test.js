import { describe, expect, it, vi } from 'vitest'
import { createScenarioWorkspace } from './scenario-workspace.js'
import { catalogFixture, clone, decidedFixture, people, processFixture, viewFixture } from './scenario-fixtures.js'
const base = '/scenarios/oa-expense'
async function recover(original, recovered, typed = 'MY UNSAVED NOTE') {
  let current = original, count = 0
  const api = { login: vi.fn(), logout: vi.fn(), request: vi.fn(async (path, options) => {
    if (options?.method === 'POST') { current = recovered; throw new TypeError('Lost response') }
    if (path === `${base}/requests`) return [clone(current)]
    return clone({ '/me': people[1], '/people': people, '/scenarios': catalogFixture(), [`${base}/process`]: original.request.definition }[path])
  }) }
  const workspace = createScenarioWorkspace(api, () => `key-${++count}`)
  await workspace.login('bob', 'synthetic'); workspace.select(original.request.id); workspace.state.comment = typed
  await workspace.decide('APPROVE'); return workspace
}
describe('uncertain decision notes remain bound to their original request and stage', () => {
  it('preserves a note when recovery finds a different comment from another tab', async () => {
    const original = viewFixture(), recovered = decidedFixture(original, 'bob', 'APPROVE', 'SAVED IN ANOTHER TAB')
    const workspace = await recover(original, recovered)
    expect(workspace.state.items[0]).toEqual(recovered); expect(workspace.state.error.cause.code).toBe('DECISION_RECOVERY_MISMATCH')
    expect(workspace.state.blockedDecisions).toEqual(['expense-1']); expect(workspace.state.comment).toBe('')
    expect(workspace.retainedNotesFor('expense-1')).toEqual([{ requestId: 'expense-1', stepId: 'manager', comment: 'MY UNSAVED NOTE' }])
    await workspace.refresh()
    expect(workspace.state.blockedDecisions).toEqual([]); expect(workspace.state.comment).toBe('')
    expect(workspace.retainedNotesFor('expense-1')[0].comment).toBe('MY UNSAVED NOTE')
  })
  it('never carries an unrecorded ANY-stage note into a later stage assigned to the same actor', async () => {
    const definition = processFixture({ schemaVersion: 3 })
    definition.nodes[1] = { id: 'manager', type: 'parallelApproval', name: 'Shared review', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ANY' }
    definition.nodes[2].assigneeId = 'bob'
    const original = viewFixture({ definition }), recovered = decidedFixture(original, 'carol', 'APPROVE', 'Carol won the ANY stage')
    const workspace = await recover(original, recovered)
    expect(workspace.state.items[0].request.currentStepId).toBe('finance'); expect(workspace.state.comment).toBe('')
    expect(workspace.canDecide(workspace.state.items[0])).toBe(false)
    expect(workspace.retainedNotesFor('expense-1')[0].stepId).toBe('manager')
    await workspace.refresh()
    expect(workspace.canDecide(workspace.state.items[0])).toBe(true); expect(workspace.state.comment).toBe('')
    expect(workspace.retainedNotesFor('expense-1')[0].comment).toBe('MY UNSAVED NOTE')
    workspace.dismissRetainedNote('expense-1', 'manager'); expect(workspace.retainedNotesFor('expense-1')).toEqual([])
  })
  it('clears a retained note only when recovery confirms the exact submitted vote and note', async () => {
    const original = viewFixture(), recovered = decidedFixture(original, 'bob', 'APPROVE', 'MY UNSAVED NOTE')
    const workspace = await recover(original, recovered)
    expect(workspace.state.items[0]).toEqual(recovered); expect(workspace.state.blockedDecisions).toEqual([])
    expect(workspace.retainedNotesFor('expense-1')).toEqual([]); expect(workspace.state.comment).toBe('')
  })
  it('clears retained notes at sign-out and never exposes them to another actor', async () => {
    const original = viewFixture(), workspace = await recover(original, decidedFixture(original))
    expect(workspace.retainedNotesFor('expense-1')).toHaveLength(1)
    workspace.logout(); expect(workspace.state.retainedNotes).toEqual({}); expect(workspace.state.items).toEqual([])
  })
})
