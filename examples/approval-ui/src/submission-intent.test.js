import { describe, expect, it, vi } from 'vitest'
import { createSubmissionIntent, newSubmissionKey, isRejectedSubmissionVersion } from './submission-intent'

const fields = { title: ' Leave ', reason: ' Rest ', days: '2' }
describe('submission intent identity', () => {
  it('only treats the exact authenticated stale-version response as definitive non-creation', () => {
    const message = 'The published process changed; reload before submitting'
    expect(isRejectedSubmissionVersion({ status: 409, message })).toBe(true)
    expect(isRejectedSubmissionVersion({ response: { status: 409, data: { msg: message, code: 409 } } })).toBe(true)
    for (const error of [{ message }, { status: 503, message }, { status: 409, message: 'Idempotency-Key was already used for a different submission' }, 'error', null]) {
      expect(isRejectedSubmissionVersion(error)).toBe(false)
    }
  })
  it('uses strong opaque keys with valid bounded header syntax', () => {
    const first = newSubmissionKey(), second = newSubmissionKey()
    expect(first).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
    expect(first.length).toBeGreaterThanOrEqual(32)
    expect(first).not.toBe(second)
  })
  it('freezes normalized fields and version until completion or a real edit', () => {
    const factory = vi.fn().mockReturnValueOnce('one').mockReturnValueOnce('two')
    const intent = createSubmissionIntent(factory)
    const initial = intent.prepare('alice', fields, 1)
    expect(initial.payload).toEqual({ title: 'Leave', reason: 'Rest', days: 2, processVersion: 1 })
    expect(Object.isFrozen(initial.payload)).toBe(true)
    expect(intent.prepare('alice', { ...fields, title: 'Leave', days: 2 }, 99)).toBe(initial)
    expect(factory).toHaveBeenCalledTimes(1)
    intent.invalidate('alice', { ...fields, reason: 'Updated' })
    expect(intent.current('alice', fields)).toBeNull()
    expect(intent.prepare('alice', fields, 99).key).toBe('two')
  })
  it('never reuses a key for another account, changed intent, or completed/new submission', () => {
    let count = 0
    const intent = createSubmissionIntent(() => `key-${++count}`)
    const first = intent.prepare('alice', fields, 1)
    expect(intent.prepare('carol', fields, 1).key).not.toBe(first.key)
    const second = intent.prepare('alice', { ...fields, days: 3 }, 2)
    expect(second.payload.days).toBe(3)
    intent.clear()
    expect(intent.prepare('alice', { ...fields, days: 3 }, 2).key).not.toBe(second.key)
  })
})
