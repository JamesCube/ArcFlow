import { describe, expect, it } from 'vitest'
import { parseScenarioInstant } from './scenario-instant.js'
import { validateScenarioView } from './scenario-response.js'
import { decidedFixture, viewFixture } from './scenario-fixtures.js'
describe('strict precision-safe backend instant boundary', () => {
  it.each(['1', '2026-02-30T09:00:00Z', '2025-02-29T09:00:00Z', '2026-13-01T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:60:00Z', '2026-01-01T00:00:60Z', '2026-01-01T00:00:00.1234567890Z', '2026-01-01T00:00:00', '2026-01-01T00:00:00+01:00', ' 2026-01-01T00:00:00Z', '+10000-01-01T00:00:00Z', null, 1])('rejects unsupported or impossible instant %j', source => expect(parseScenarioInstant(source)).toBeNull())
  it.each(['2026-10-08T09:00:00Z', '2026-10-08T09:00:00.123Z', '2026-10-08T09:00:00.123456Z', '2026-10-08T09:00:00.123456789Z', '0001-01-01T00:00:00Z', '9999-12-31T23:59:59.999999999Z'])('preserves legitimate backend form %s', source => expect(typeof parseScenarioInstant(source)).toBe('bigint'))
  it('treats equivalent fractional spellings as the same instant', () => {
    expect(parseScenarioInstant('2026-10-08T09:00:00Z')).toBe(parseScenarioInstant('2026-10-08T09:00:00.000000000Z'))
    expect(parseScenarioInstant('2026-10-08T09:00:00.123Z')).toBe(parseScenarioInstant('2026-10-08T09:00:00.123000000Z'))
    expect(parseScenarioInstant('1969-12-31T23:59:59.999999999Z')).toBe(-1n)
  })
  it('accepts current-clock wire output and the real-shaped fixture', () => {
    expect(parseScenarioInstant(new Date().toISOString())).not.toBeNull()
    expect(validateScenarioView(viewFixture())).toEqual(viewFixture())
  })
  it.each(['1', '2026-02-30T09:00:00Z'])('rejects malformed audit timestamps even when outer/history strings match (%s)', at => {
    const view = viewFixture(); view.request.createdAt = at; view.request.updatedAt = at; view.request.history[0].at = at
    expect(() => validateScenarioView(view)).toThrow()
  })
  it('rejects reverse sub-millisecond history without floating-point rounding', () => {
    const view = decidedFixture(viewFixture()), created = '2026-10-07T09:00:00.000000999Z', reversed = '2026-10-07T09:00:00.000000001Z'
    view.request.createdAt = created; view.request.history[0].at = created
    view.request.updatedAt = reversed; view.request.history[1].at = reversed
    expect(() => validateScenarioView(view)).toThrow()
    view.request.updatedAt = '2026-10-07T09:00:00.000001000Z'; view.request.history[1].at = view.request.updatedAt
    expect(validateScenarioView(view)).toBe(view)
  })
})
