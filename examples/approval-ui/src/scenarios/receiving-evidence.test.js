import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { sourceProvenance } from '../../e2e/receiving-evidence.mjs'
const HEAD = '7'.repeat(40), OTHER = '9'.repeat(40)

describe('receiving browser evidence provenance', () => {
  it('uses the actual checked-out full commit, with explicit clean-source evidence', () => {
    expect(sourceProvenance({ head: HEAD, requireClean: true })).toEqual({ sourceRevision: HEAD, sourceTreeClean: true, verificationBackend: 'declared-backend', githubRun: null })
    expect(sourceProvenance({ head: HEAD, env: { ARCFLOW_SOURCE_REVISION: HEAD } }).sourceRevision).toBe(HEAD)
  })
  it.each(['local-uncommitted', '71910bfc', '', null, undefined])('refuses invented or incomplete revision %j', head => {
    expect(() => sourceProvenance({ head, requireClean: true })).toThrow('actual full Git HEAD SHA')
  })
  it('refuses a claimed PR SHA that differs from the source actually checked out', () => {
    expect(() => sourceProvenance({ head: HEAD, env: { ARCFLOW_SOURCE_REVISION: OTHER }, requireClean: true })).toThrow('differs from the actual checked-out Git HEAD')
  })
  it('rejects capturing dirty tracked code under a committed SHA', () => {
    expect(() => sourceProvenance({ head: HEAD, dirtyTracked: true, requireClean: true })).toThrow('clean tracked source tree')
    expect(sourceProvenance({ head: HEAD, dirtyTracked: true }).sourceTreeClean).toBe(false)
  })
  it('retains public CI identifiers and compatibility labels without copying credential environment variables', () => {
    const result = sourceProvenance({ head: HEAD, env: { GITHUB_RUN_ID: '12345', GITHUB_REPOSITORY: 'example/arcflow', GITHUB_RUN_ATTEMPT: '2', ARCFLOW_VERIFICATION_BACKEND: 'explicit-compatibility-runner', APPROVAL_ALICE_PASSWORD: 'must-never-be-copied', APPROVAL_BOB_PASSWORD: 'private' } })
    expect(result.githubRun).toEqual({ id: '12345', repository: 'example/arcflow', attempt: '2' })
    expect(result.verificationBackend).toBe('explicit-compatibility-runner')
    expect(JSON.stringify(result)).not.toContain('must-never-be-copied'); expect(JSON.stringify(result)).not.toContain('PASSWORD')
  })
  it('declares fifteen unique authenticated evidence states and no implicit screenshot/trace capture', () => {
    const source = readFileSync('e2e/receiving.spec.mjs', 'utf8')
    const captures = [...source.matchAll(/capture\(page, info, '([^']+)'/g)].map(match => match[1])
    expect(captures).toHaveLength(15); expect(new Set(captures).size).toBe(15)
    expect(captures).toContain('04-quantity-error-en-desktop'); expect(captures).toContain('05-quantity-error-zh-390')
    expect(captures).toContain('06-published-any-designer-en-desktop'); expect(captures).toContain('09-all-partial-bob-vote-en-desktop')
    expect(captures).toContain('15-any-approved-zh-390')
    expect(source).toContain("trace: 'off', video: 'off', screenshot: 'off'")
    expect(source).toContain("await expect(page.locator('input[type=password]')).toHaveCount(0)")
    expect(source).not.toContain('storageState(')
    expect(source).toContain("backendRead(request, '/scenarios/oa-expense/process')).toEqual(originalExpense)")
    expect(source).toContain("backendRead(request, '/process')).toEqual(originalMain)")
  })
})
