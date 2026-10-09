import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, lstat, readlink } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
export const captureSession = randomUUID()
export const captureEnabled = process.env.ARCFLOW_CAPTURE_COMPLEX_SCENARIOS === '1'
const hash = value => createHash('sha256').update(value).digest('hex')
let provenance
export async function sourceProvenance() {
  if (provenance) return provenance
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
  const diff = execFileSync('git', ['diff', 'HEAD', '--', '.'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const sourceFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(path => path && path !== 'node_modules').sort()
  const sourceHash = createHash('sha256')
  for (const path of sourceFiles) { try { const stats = await lstat(path); const bytes = stats.isSymbolicLink() ? await readlink(path) : await readFile(path); sourceHash.update(path + '\0').update(bytes).update('\0') } catch (error) { if (error.code !== 'ENOENT') throw error; sourceHash.update(path + '\0DELETED\0') } }
  const jar = resolve(process.env.ARCFLOW_TEST_BACKEND_JAR || process.env.ARCFLOW_BACKEND_JAR || '../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar')
  provenance = { sourceRevision: revision, sourceWorkingTree: status ? 'modified-local-worktree' : 'clean-commit', trackedDiffSHA256: hash(diff), uiSourceTreeSHA256: sourceHash.digest('hex'), backendRuntime: process.env.ARCFLOW_BACKEND_RUNTIME || 'declared-project-runtime', backendJarSHA256: hash(await readFile(jar)), captureSessionId: captureSession, captureRunId: process.env.GITHUB_RUN_ID || `local-${captureSession}`, captureRunAttempt: process.env.GITHUB_RUN_ATTEMPT || null, captureRepository: process.env.GITHUB_REPOSITORY || null, captureRunUrl: process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null }
  return provenance
}
export async function captureComplex(page, info, scenario, state, mobile = false) {
  if (!captureEnabled) return
  if (await page.locator('input[type=password]').count() || !await page.locator('.sf-shell').isVisible()) throw new Error('Only authenticated workspace screenshots may be captured')
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const locale = await page.locator('.sf-shell').getAttribute('lang') === 'zh-CN' ? 'zh' : 'en'
  const name = `${scenario}-${state}-${locale}-${mobile ? '390' : 'desktop'}`
  const directory = info.outputPath(`capture-complex-${captureSession}`)
  await mkdir(directory, { recursive: true })
  const png = await page.screenshot({ fullPage: !mobile, animations: 'disabled' })
  const evidence = { schemaVersion: 1, ...await sourceProvenance(), scenario, state, locale, viewport: page.viewportSize(), fullPage: !mobile, image: `${name}.png`, imageSHA256: hash(png), capturedAt: new Date().toISOString() }
  await writeFile(`${directory}/${name}.png`, png, { flag: 'wx' })
  await writeFile(`${directory}/${name}.json`, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' })
}
