import { describe, expect, it } from 'vitest'
import { appCopy, translate, validationText, apiFailure } from './locale'
import { validateDefinition } from './process'

describe('complete bilingual application copy', () => {
  it('provides both locales for every application message and preserves interpolation values', () => {
    expect(Object.keys(appCopy.zh).sort()).toEqual(Object.keys(appCopy.en).sort())
    for (const locale of ['en', 'zh']) {
      for (const value of Object.values(appCopy[locale])) expect(value).toBeTruthy()
      expect(translate(locale, 'submitted', { names: 'Bob, Carol' })).toContain('Bob, Carol')
      expect(translate(locale, 'published', { version: 42 })).toContain('v42')
    }
    expect(translate('invalid', 'submit')).toBe('Submit request')
  })
  it('localizes every supported process validation without altering validation logic', () => {
    const good = { schemaVersion: 2, id: 'leave-approval', version: 1, name: 'Leave', nodes: [
      { id: 'start', type: 'start', name: 'Submit', assigneeId: null },
      { id: 'review', type: 'approval', name: 'Review', assigneeId: 'bob' },
      { id: 'end', type: 'end', name: 'End', assigneeId: null },
    ] }
    const cases = [null, {}, { ...good, nodes: null }, { ...good, nodes: [null] }, { ...good, name: '' }, { ...good, name: '\n' }, { ...good, name: 'x'.repeat(121) }, { ...good, schemaVersion: 999, unknown: 1 }, { ...good, nodes: [] }]
    for (const index of [0, 1, 2]) for (const change of [{ name: '' }, { name: 'Bad\n' }, { name: 'x'.repeat(121) }, { id: '?' }, { id: 'start' }, { assigneeId: 'alice' }, { extra: true }, { type: 'parallelApproval', assigneeIds: ['bob', 'bob'], completionMode: 'bad' }]) {
      const copy = structuredClone(good); copy.nodes[index] = { ...copy.nodes[index], ...change }; cases.push(copy)
    }
    const messages = new Set(cases.flatMap(validateDefinition))
    expect(messages.size).toBeGreaterThan(25)
    for (const message of messages) {
      expect(validationText(message, 'en')).toBe(message)
      expect(validationText(message, 'zh')).not.toBe(message)
      expect(validationText(message, 'zh')).not.toContain('校验信息（原文）')
    }
    expect(validationText('Future validation rule', 'zh')).toBe('校验信息（原文）：Future validation rule')
  })
})

describe('accurate localized API recovery', () => {
  it('uses friendly login guidance for HTTP 401 without inventing a password failure reason', () => {
    const failure = Object.assign(new Error('Unauthorized'), { status: 401 })
    expect(apiFailure(failure, 'login', 'en')).toContain('Check the demo account')
    expect(apiFailure(failure, 'login', 'zh')).toContain('登录未通过')
    expect(apiFailure(failure, 'refresh', 'zh')).toContain('退出后重新登录')
  })
  it('localizes known conflicts and labels unknown server messages as original details', () => {
    const known = Object.assign(new Error('This approval step is not current'), { status: 409 })
    const unknown = Object.assign(new Error('Synthetic temporary outage'), { status: 503 })
    expect(apiFailure(known, 'decision', 'zh')).toContain('此节点已不是当前审批节点')
    expect(apiFailure(known, 'decision', 'zh')).not.toContain(known.message)
    expect(apiFailure(unknown, 'refresh', 'en')).toContain('Server detail (original): Synthetic temporary outage')
    expect(apiFailure(unknown, 'refresh', 'zh')).toContain('服务返回信息（原文）：Synthetic temporary outage')
  })
  it.each(['publish', 'submit', 'decision'])('does not assert a %s mutation was lost after a connection error', operation => {
    const error = new TypeError('Failed to fetch')
    const en = apiFailure(error, operation, 'en'), zh = apiFailure(error, operation, 'zh')
    expect(en).toContain('couldn’t confirm')
    expect(en).toContain('Refresh')
    expect(zh).toContain('暂时无法确认')
    expect(zh).toContain('更新')
    expect(zh).not.toContain('Failed to fetch')
  })
})
