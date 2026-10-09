import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareBackendArtifact } from '../../scripts/backend-artifact.mjs'
const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'arcflow-backend-artifact-unit-')); roots.push(root)
  const source = join(root, 'build.jar'), launch = join(root, 'launch'), worker = join(root, 'worker')
  mkdirSync(launch); mkdirSync(worker); writeFileSync(source, 'original backend bytes')
  return { root, source, launch, worker, env: { ARCFLOW_BACKEND_JAR: source } }
}
describe('Playwright immutable backend artifact across config reevaluation', () => {
  it('root config creates an independent copy that survives source repackaging', () => {
    const f = fixture(), path = prepareBackendArtifact(f.env, f.launch, f.source)
    expect(path).toBe(join(f.launch, 'backend.jar')); expect(f.env.ARCFLOW_TEST_BACKEND_JAR).toBe(path)
    expect(readFileSync(path, 'utf8')).toBe('original backend bytes')
    writeFileSync(f.source, 'rebuilt backend bytes')
    expect(readFileSync(path, 'utf8')).toBe('original backend bytes')
    expect(readFileSync(f.source, 'utf8')).toBe('rebuilt backend bytes')
  })
  it('worker reevaluation keeps the inherited exact path and bytes after source changes', () => {
    const f = fixture(), path = prepareBackendArtifact(f.env, f.launch, f.source), inheritedEnv = { ...f.env }
    writeFileSync(f.source, 'new build while server uses original')
    const workerPath = prepareBackendArtifact(inheritedEnv, f.worker, f.source)
    expect(workerPath).toBe(path); expect(inheritedEnv.ARCFLOW_TEST_BACKEND_JAR).toBe(path)
    expect(readFileSync(workerPath, 'utf8')).toBe('original backend bytes')
    expect(readdirSync(f.worker)).toEqual([])
  })
  it('retains the valid inherited copy even if the build source disappears', () => {
    const f = fixture(), path = prepareBackendArtifact(f.env, f.launch, f.source)
    rmSync(f.source)
    expect(prepareBackendArtifact({ ...f.env }, f.worker, f.source)).toBe(path)
    expect(readFileSync(path, 'utf8')).toBe('original backend bytes')
  })
  it('fails closed when the inherited launch copy disappears instead of falling back to rebuilt bytes', () => {
    const f = fixture(), path = prepareBackendArtifact(f.env, f.launch, f.source)
    rmSync(path); writeFileSync(f.source, 'available rebuilt bytes')
    expect(() => prepareBackendArtifact(f.env, f.worker, f.source)).toThrow('refusing to replace')
    expect(f.env.ARCFLOW_TEST_BACKEND_JAR).toBe(path); expect(readdirSync(f.worker)).toEqual([])
  })
  it.each(['directory', 'empty', 'symlink'])('rejects an inherited %s without a silent fallback', kind => {
    const f = fixture(), link = join(f.root, 'backend-link.jar'); symlinkSync(f.source, link)
    f.env.ARCFLOW_TEST_BACKEND_JAR = kind === 'directory' ? f.launch : kind === 'empty' ? '' : link
    expect(() => prepareBackendArtifact(f.env, f.worker, f.source)).toThrow('not a regular file')
    expect(readdirSync(f.worker)).toEqual([])
  })
  it('permits listing before the first backend build without inventing an inherited artifact', () => {
    const f = fixture(); rmSync(f.source)
    expect(prepareBackendArtifact(f.env, f.launch, f.source)).toBeUndefined()
    expect(Object.hasOwn(f.env, 'ARCFLOW_TEST_BACKEND_JAR')).toBe(false)
  })
})
