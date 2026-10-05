import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
const runId = process.env.ARCFLOW_E2E_RUN_ID || "";
const dataDirectory = process.env.ARCFLOW_MOBILE_E2E_DATA || "";
if (
  !/^[0-9a-f-]{36}$/.test(runId) ||
  dirname(dataDirectory) !== tmpdir() ||
  !basename(dataDirectory).startsWith(`arcflow-mobile-e2e-${runId}-`) ||
  !existsSync(dataDirectory)
)
  throw new Error(
    "Run browser tests through npm run test:e2e to create an isolated test context.",
  );
const baseURL = "http://127.0.0.1:5174";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90000,
  reporter: "list",
  outputDir: "test-results",
  use: {
    baseURL,
    viewport: { width: 390, height: 844 },
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  webServer: [
    {
      command:
        "java -jar ../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar --server.port=8094",
      url: "http://127.0.0.1:8094/api/me",
      reuseExistingServer: false,
      timeout: 90000,
      env: {
        ...process.env,
        APPROVAL_DATA_FILE: join(dataDirectory, "requests.json"),
        APPROVAL_UI_ORIGIN: baseURL,
      },
    },
    {
      command: "npm run dev:h5",
      url: baseURL,
      reuseExistingServer: false,
      timeout: 90000,
      env: { ...process.env, ARCFLOW_BACKEND_PORT: "8094" },
    },
  ],
});
