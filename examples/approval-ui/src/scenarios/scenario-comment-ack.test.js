import { describe, expect, it, vi } from 'vitest'
import { validateScenarioDecision } from './scenario-response.js'
import { createScenarioWorkspace } from './scenario-workspace.js'
import { catalogFixture, clone, decidedFixture, people, processFixture, viewFixture } from './scenario-fixtures.js'
const base = '/scenarios/oa-expense'
describe('exact submitted decision comment acknowledgement', () => {
  it('rejects a changed comment even if actor, step and action match', () => {
    const original = viewFixture(), response = decidedFixture(original, 'bob', 'APPROVE', 'SERVER REPLACED COMMENT')
    expect(() => validateScenarioDecision(response, original, 'bob', 'manager', 'APPROVE', 'MY ORIGINAL COMMENT')).toThrow()
    try { validateScenarioDecision(response, original, 'bob', 'manager', 'APPROVE', 'MY ORIGINAL COMMENT') } catch (error) { expect(error.code).toBe('DECISION_COMMENT_MISMATCH') }
  })
  it('accepts the exact captured comment including an empty comment', () => {
    for (const comment of ['', 'Receipts checked.\n已核对。']) {
      const original = viewFixture(), response = decidedFixture(original, 'bob', 'APPROVE', comment)
      expect(validateScenarioDecision(response, original, 'bob', 'manager', 'APPROVE', comment)).toBe(response)
    }
  })
  it('keeps the typed note and locks actions until explicit authoritative refresh', async () => {
    const original = viewFixture(), returned = decidedFixture(original, 'bob', 'APPROVE', 'SERVER REPLACED COMMENT')
    let reads = 0, current = original
    const api = { login: vi.fn(), logout: vi.fn(), request: vi.fn(async (path, options) => {
      if (options?.method === 'POST') { expect(JSON.parse(options.body).comment).toBe('MY ORIGINAL COMMENT'); return clone(returned) }
      if (path === `${base}/requests`) { reads++; return [clone(current)] }
      return clone({ '/me': people[1], '/people': people, '/scenarios': catalogFixture(), [`${base}/process`]: processFixture() }[path])
    }) }
    let count = 0
    const workspace = createScenarioWorkspace(api, () => `key-${++count}`)
    await workspace.login('bob', 'synthetic'); workspace.select(original.request.id); workspace.state.comment = '  MY ORIGINAL COMMENT  '
    await workspace.decide('APPROVE')
    expect(workspace.state.notice).toBe(''); expect(workspace.state.error.cause.code).toBe('DECISION_COMMENT_MISMATCH')
    expect(workspace.state.comment).toBe('  MY ORIGINAL COMMENT  '); expect(workspace.state.items[0]).toEqual(original)
    expect(workspace.state.blockedDecisions).toEqual([original.request.id]); expect(reads).toBe(1)
    await workspace.decide('REJECT'); expect(api.request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
    current = returned; await workspace.refresh()
    expect(workspace.state.items[0]).toEqual(returned); expect(workspace.state.comment).toBe(''); expect(workspace.state.blockedDecisions).toEqual([])
  })
})
