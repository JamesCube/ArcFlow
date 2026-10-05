import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// This one owning process creates secrets/store exactly once. Playwright workers
// reimport config, so the config must only read the inherited run environment.
const runId = randomUUID();
const dataDirectory = mkdtempSync(
  join(tmpdir(), `arcflow-mobile-e2e-${runId}-`),
);
const env = {
  ...process.env,
  ARCFLOW_E2E_RUN_ID: runId,
  ARCFLOW_MOBILE_E2E_DATA: dataDirectory,
  ARCFLOW_E2E_CONFIRM_DISPOSABLE: "yes",
  ARCFLOW_MOBILE_URL: "http://127.0.0.1:5174",
};
for (const user of ["ALICE", "BOB", "CAROL"])
  env[`APPROVAL_${user}_PASSWORD`] = randomUUID();
let status = 1;
try {
  const cli = fileURLToPath(
    new URL("../node_modules/@playwright/test/cli.js", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [cli, "test", ...process.argv.slice(2)],
    { stdio: "inherit", env },
  );
  if (result.error)
    console.error("Unable to start the installed browser test runner.");
  status = result.status ?? 1;
} finally {
  rmSync(dataDirectory, { recursive: true, force: true });
}
process.exit(status);
