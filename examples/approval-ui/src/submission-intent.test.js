import { describe, expect, it, vi } from 'vitest'
import { createSubmissionIntent, createSubmissionForms, newSubmissionKey, isRejectedSubmissionVersion } from './submission-intent'

const fields = { title: ' Leave ', reason: ' Rest ', days: '2' }
it('creates isolated document drafts, keys and resettable retry metadata', () => {
  let count = 0
  const forms = createSubmissionForms(() => `key-${++count}`)
  forms.leave.fields.title = 'Personal leave'
  expect(forms.procurement.fields.title).toBe('')
  const first = forms.leave.intent.prepare('alice', fields, 1)
  const other = forms.procurement.intent.prepare('alice', fields, 1)
  expect(other.key).not.toBe(first.key)
  forms.procurement.intent.clear()
  expect(forms.leave.intent.prepare('alice', fields, 2)).toBe(first)
  expect(forms.leave.versionRejected).toBe(false)
  expect(forms.procurement.attempt).toBeNull()
  expect(createSubmissionForms().leave.fields.title).toBe('')
})
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

describe('typed procurement retry identity', () => {
  const business = { type: 'procurement', businessId: 'PO-001', title: ' Chairs ', reason: ' Growth ', item: ' Chair ', quantity: '3', unitPrice: '199.50', currency: 'CNY' }
  it('freezes all typed business fields, endpoint and original process version for uncertain retries', () => {
    let count = 0
    const intent = createSubmissionIntent(() => `key-${++count}`)
    const first = intent.prepare('alice', { business }, 1)
    expect(first.endpoint).toBe('/documents')
    expect(first.payload.business).toEqual({ ...business, title: 'Chairs', reason: 'Growth', item: 'Chair', quantity: 3, unitPrice: 199.5 })
    expect(Object.isFrozen(first.payload.business)).toBe(true)
    const normalized = { business: { ...business, title: 'Chairs', item: 'Chair', quantity: 3, unitPrice: '199.5' } }
    expect(intent.prepare('alice', normalized, 7)).toBe(first)
    expect(first.payload.processVersion).toBe(1)
    for (const [key, value] of [['businessId', 'PO-002'], ['item', 'Desk'], ['quantity', 4], ['unitPrice', '199.51'], ['currency', 'USD']]) {
      const next = intent.prepare('alice', { business: { ...business, [key]: value } }, 7)
      expect(next.key).not.toBe(first.key)
    }
  })
  it('handles incomplete edits safely and never treats legacy and typed leave as the same intent', () => {
    let count = 0
    const intent = createSubmissionIntent(() => `key-${++count}`)
    const first = intent.prepare('alice', { business }, 1)
    intent.invalidate('alice', { business: { ...business, unitPrice: '' } })
    expect(intent.current('alice', { business })).toBeNull()
    expect(() => intent.prepare('alice', { business: { ...business, unitPrice: '' } }, 1)).toThrow('Invalid business document')
    const legacy = intent.prepare('alice', fields, 1)
    expect(legacy.endpoint).toBe('/requests')
    const typed = intent.prepare('alice', { business: { type: 'leave', businessId: 'L-001', ...fields } }, 1)
    expect(typed.endpoint).toBe('/documents')
    expect(typed.key).not.toBe(legacy.key)
    expect(typed.key).not.toBe(first.key)
    expect(intent.prepare('alice', fields, 1).key).not.toBe(typed.key)
  })
})
