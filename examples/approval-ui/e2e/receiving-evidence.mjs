import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Only explicit public build identifiers belong in screenshot provenance.
// Never copy process.env wholesale: it contains disposable account secrets.
export function sourceProvenance({ head, dirtyTracked = false, env = {}, requireClean = false }) {
  if (typeof head !== 'string' || !/^[a-f0-9]{40}$/.test(head)) throw new Error('Screenshot provenance requires the actual full Git HEAD SHA')
  if (env.ARCFLOW_SOURCE_REVISION && env.ARCFLOW_SOURCE_REVISION !== head) throw new Error('ARCFLOW_SOURCE_REVISION differs from the actual checked-out Git HEAD')
  if (requireClean && dirtyTracked) throw new Error('Screenshot capture requires a clean tracked source tree for its Git HEAD')
  return {
    sourceRevision: head,
    sourceTreeClean: !dirtyTracked,
    verificationBackend: env.ARCFLOW_VERIFICATION_BACKEND || 'declared-backend',
    githubRun: env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY ? { id: env.GITHUB_RUN_ID, repository: env.GITHUB_REPOSITORY, attempt: env.GITHUB_RUN_ATTEMPT || '1' } : null,
  }
}
export function readSourceProvenance(env = process.env, requireClean = false) {
  const cwd = fileURLToPath(new URL('../../../', import.meta.url))
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  let head, dirtyTracked
  try { head = git(['rev-parse', 'HEAD']); dirtyTracked = !!git(['status', '--porcelain', '--untracked-files=no']) }
  catch { throw new Error('Could not verify screenshot source against the local Git checkout') }
  return sourceProvenance({ head, dirtyTracked, env, requireClean })
}
