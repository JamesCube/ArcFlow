import { defineConfig } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Disposable accounts, fresh single-writer store, and loopback-only servers.
// No trace, HAR or video: those could retain Authorization headers/passwords.
for (const user of ['ALICE', 'BOB', 'CAROL']) {
  process.env[`APPROVAL_${user}_PASSWORD`] ||= randomUUID()
}
const dataDirectory = mkdtempSync(join(tmpdir(), 'arcflow-e2e-'))
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: 'list',
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1440, height: 1000 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
    trace: 'off', video: 'off', screenshot: 'off',
  },
  webServer: [
    {
      command: 'java -jar ../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar',
      url: 'http://127.0.0.1:8080/api/me',
      reuseExistingServer: false,
      timeout: 90_000,
      env: { ...process.env, APPROVAL_DATA_FILE: join(dataDirectory, 'requests.json'), APPROVAL_UI_ORIGIN: 'http://localhost:5173' },
    },
    { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: false, timeout: 30_000 },
  ],
})
