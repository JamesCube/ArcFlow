import { copyFileSync, existsSync, lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Playwright evaluates its config again inside workers. Inherited launch bytes
// must win over the build target, which may have been repackaged meanwhile.
export function prepareBackendArtifact(env, directory, defaultJar) {
  if (Object.hasOwn(env, 'ARCFLOW_TEST_BACKEND_JAR')) {
    const inherited = env.ARCFLOW_TEST_BACKEND_JAR
    let valid = false
    try { valid = typeof inherited === 'string' && inherited.length > 0 && lstatSync(inherited).isFile() } catch {}
    if (!valid) throw new Error('Inherited ARCFLOW_TEST_BACKEND_JAR is missing or is not a regular file; refusing to replace the launched backend artifact.')
    return inherited
  }
  const source = resolve(env.ARCFLOW_BACKEND_JAR || defaultJar)
  // Keep Playwright --list available before a backend has been built. An actual
  // test run still fails at backend startup if no requested archive exists.
  if (!existsSync(source)) return undefined
  const target = join(directory, 'backend.jar')
  copyFileSync(source, target)
  env.ARCFLOW_TEST_BACKEND_JAR = target
  return target
}
