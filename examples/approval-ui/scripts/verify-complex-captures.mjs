import { readdir, readFile } from 'node:fs/promises'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
const root = resolve(process.argv[2] || 'test-results')
const files = []
async function visit(path) { for (const entry of await readdir(path, { withFileTypes: true })) { const child = join(path, entry.name); if (entry.isDirectory()) await visit(child); else if (entry.name.endsWith('.json') && path.includes('capture-complex-')) files.push(child) } }
await visit(root)
if (files.length !== 40) throw new Error(`Expected exactly 40 complex-scenario capture sidecars; found ${files.length}.`)
const seen = new Set(), matrix = new Map(), sessions = new Map()
let runIdentity
for (const file of files) {
  const evidence = JSON.parse(await readFile(file, 'utf8'))
  if (typeof evidence.image !== 'string' || !/^[a-z0-9-]+\.png$/.test(evidence.image)) throw new Error('Invalid relative screenshot filename')
  if (!evidence.viewport || ![[1440, 1000, true], [390, 844, false]].some(([width, height, full]) => evidence.viewport.width === width && evidence.viewport.height === height && evidence.fullPage === full)) throw new Error('Invalid screenshot viewport or mode')
  if (typeof evidence.captureSessionId !== 'string' || !evidence.captureSessionId || typeof evidence.captureRunId !== 'string' || !evidence.captureRunId || !Number.isFinite(Date.parse(evidence.capturedAt))) throw new Error('Missing capture session or time')
  const png = await readFile(join(file, '..', evidence.image))
  if (evidence.schemaVersion !== 1 || !['erp-payment', 'crm-contract'].includes(evidence.scenario) || !['en', 'zh'].includes(evidence.locale) || !/^[a-f0-9]{40}$/.test(evidence.sourceRevision) || !/^[a-f0-9]{64}$/.test(evidence.backendJarSHA256) || !evidence.backendRuntime) throw new Error(`Invalid source/run provenance: ${basename(file)}`)
  if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || png.readUInt32BE(16) !== evidence.viewport.width || createHash('sha256').update(png).digest('hex') !== evidence.imageSHA256) throw new Error(`Image bytes/dimensions mismatch: ${basename(file)}`)
  if (evidence.fullPage && png.readUInt32BE(20) < evidence.viewport.height) throw new Error('Truncated full-page image')
  if (!evidence.fullPage && (png.readUInt32BE(20) !== evidence.viewport.height || evidence.viewport.width !== 390)) throw new Error(`Invalid narrow viewport: ${basename(file)}`)
  if (process.env.ARCFLOW_EXPECT_SOURCE_REVISION && evidence.sourceRevision !== process.env.ARCFLOW_EXPECT_SOURCE_REVISION) throw new Error('Capture revision does not match required head')
  if (process.env.ARCFLOW_REQUIRE_CLEAN_COMPLEX === '1' && evidence.sourceWorkingTree !== 'clean-commit') throw new Error('CI capture must identify a clean commit')
  if (process.env.ARCFLOW_EXPECT_BACKEND_RUNTIME && evidence.backendRuntime !== process.env.ARCFLOW_EXPECT_BACKEND_RUNTIME) throw new Error('Unexpected backend runtime')
  if (process.env.ARCFLOW_EXPECT_CAPTURE_RUN_ID && evidence.captureRunId !== process.env.ARCFLOW_EXPECT_CAPTURE_RUN_ID) throw new Error('Capture belongs to another run')
  if (process.env.ARCFLOW_EXPECT_CAPTURE_RUN_ATTEMPT && evidence.captureRunAttempt !== process.env.ARCFLOW_EXPECT_CAPTURE_RUN_ATTEMPT) throw new Error('Capture belongs to another run attempt')
  if (process.env.ARCFLOW_EXPECT_CAPTURE_REPOSITORY && evidence.captureRepository !== process.env.ARCFLOW_EXPECT_CAPTURE_REPOSITORY) throw new Error('Capture belongs to another repository')
  const identity = JSON.stringify(['sourceRevision', 'sourceWorkingTree', 'trackedDiffSHA256', 'uiSourceTreeSHA256', 'backendJarSHA256', 'backendRuntime', 'captureRunId', 'captureRunAttempt', 'captureRepository'].map(key => evidence[key]))
  if (runIdentity && identity !== runIdentity) throw new Error('Capture source, backend or run identity changed within the matrix')
  runIdentity = identity
  if (sessions.has(evidence.scenario) && sessions.get(evidence.scenario) !== evidence.captureSessionId) throw new Error('Scenario captures contain multiple sessions')
  sessions.set(evidence.scenario, evidence.captureSessionId)
  if (!/^[a-f0-9]{64}$/.test(evidence.uiSourceTreeSHA256)) throw new Error('Missing UI source tree hash')
  matrix.set(`${evidence.scenario}/${evidence.state}/${evidence.locale}/${evidence.viewport.width}`, true)
  const key = `${evidence.scenario}/${evidence.state}/${evidence.locale}/${evidence.viewport.width}`
  if (seen.has(key)) throw new Error(`Duplicate capture: ${key}`)
  seen.add(key)
}
const states = { 'form-filled': 1440, 'form-summary': 390, 'validation-errors': 1440, 'designer-published': 1440, 'saved-original-snapshot': 1440, 'review-controls': 390, 'all-partial': 1440, 'any-partial-rejection': 1440, approved: 1440, rejected: 1440 }
for (const scenario of ['erp-payment', 'crm-contract']) for (const [state, width] of Object.entries(states)) for (const locale of ['en', 'zh']) if (!matrix.has(`${scenario}/${state}/${locale}/${width}`)) throw new Error(`Missing required image: ${scenario}/${state}/${locale}/${width}`)
console.log(`Verified ${files.length} original PNGs with exact hashes, dimensions and source/backend provenance. Capture is not publication or official-runtime certification.`)
