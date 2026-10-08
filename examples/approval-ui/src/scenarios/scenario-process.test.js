import { describe, expect, it } from 'vitest'
import { validateDefinition, validatePublicationResponse } from '../process.js'
import { processFixture, people } from './scenario-fixtures.js'

describe('shared designer process identity compatibility', () => {
  it('opts into expense only through an explicit expected process ID', () => {
    const expense = processFixture()
    expect(validateDefinition(expense, 'oa-expense')).toEqual([])
    expect(validateDefinition(expense).length).toBeGreaterThan(0)
    expect(validateDefinition({ ...expense, id: 'leave-approval' }, 'oa-expense').length).toBeGreaterThan(0)
  })
  it('preserves legacy array callback and actor-directory call shapes', () => {
    const leave = processFixture({ id: 'leave-approval' })
    expect([leave, leave].flatMap(validateDefinition)).toEqual([])
    expect(validateDefinition(leave, people)).toEqual([])
    expect(validatePublicationResponse({ ...leave, version: 2 }, leave, people).version).toBe(2)
  })
  it('confirms only the published content, correct scenario ID and immediate next version', () => {
    const expense = processFixture(), saved = { ...expense, version: 2 }
    expect(validatePublicationResponse(saved, expense, 'oa-expense')).toBe(saved)
    for (const invalid of [{ ...saved, version: 3 }, { ...saved, id: 'leave-approval' }, { ...saved, name: 'Different' }]) expect(() => validatePublicationResponse(invalid, expense, 'oa-expense')).toThrow()
  })
})
