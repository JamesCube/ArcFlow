import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("worker config reimports preserve the owner's exact credentials and store", async () => {
  const id = randomUUID();
  const directory = mkdtempSync(join(tmpdir(), `arcflow-mobile-e2e-${id}-`));
  const keys = [
    "ARCFLOW_E2E_RUN_ID",
    "ARCFLOW_MOBILE_E2E_DATA",
    "APPROVAL_ALICE_PASSWORD",
    "APPROVAL_BOB_PASSWORD",
    "APPROVAL_CAROL_PASSWORD",
  ];
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  try {
    process.env.ARCFLOW_E2E_RUN_ID = id;
    process.env.ARCFLOW_MOBILE_E2E_DATA = directory;
    for (const key of keys.slice(2)) process.env[key] = randomUUID();
    const expected = Object.fromEntries(
      keys.map((key) => [key, process.env[key]]),
    );
    const dirs = readdirSync(tmpdir()).filter((name) =>
      name.startsWith(`arcflow-mobile-e2e-${id}-`),
    );
    vi.resetModules();
    const first = (await import("../playwright.config.mjs")).default;
    vi.resetModules();
    const second = (await import("../playwright.config.mjs")).default;
    expect(
      Object.fromEntries(keys.map((key) => [key, process.env[key]])),
    ).toEqual(expected);
    expect(first.webServer).toEqual(second.webServer);
    expect(
      readdirSync(tmpdir()).filter((name) =>
        name.startsWith(`arcflow-mobile-e2e-${id}-`),
      ),
    ).toEqual(dirs);
    expect(
      second.webServer.every(
        (server: { reuseExistingServer: boolean }) =>
          server.reuseExistingServer === false,
      ),
    ).toBe(true);
  } finally {
    for (const key of keys)
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    rmSync(directory, { recursive: true, force: true });
  }
});
