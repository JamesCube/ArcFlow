# Mobile verification record / 验证记录

Recorded **2026-10-05 UTC**, based on **549e8da**. This records what was tested
for the H5 mobile client and what remained open. It does not approve the client
for production or claim real-device testing.

## Executed and passed

- `npm run typecheck`: strict TypeScript/Vue source check.
- `npm test`: **41 tests**, five files. Includes nine component DOM checks,
  API/error/host contracts, 2,304 mixed sequential/ALL/ANY
  states checked against an independent model, stale refresh races, logout races, double clicks, clearing state on 401,
  checking saved state after uncertain writes, decisions locked to the original
  repeated-assignee step and worker-config imports that preserve the run context.
- `npm run build:h5`: real uni-app Vue 3 production H5 build, including the
  security overrides below. Build output is under `dist/build/h5`.
- Independent source/generated-CSS review repeated typecheck, the then-current 40 tests and
  the H5 build. See [REVIEW.md](REVIEW.md).
- Real unchanged Java backend: **177 HTTP status checks + 223 invariants**, two
  restarts. Existing parallel harness: **40 checks**. Core: **24 regression
  checks**; domain: **36 tests**; backend: **35 tests**. See
  [HTTP_VERIFICATION.md](HTTP_VERIFICATION.md).
- Chromium CI at **6838509e195935de35f4479d9aa39d159f46f967** passed all **seven**
  real-backend browser journeys. [Run 37266601292](https://github.com/JamesCube/ArcFlow/actions/runs/37266601292)
  completed on 2026-10-05. Its seven synthetic PNGs were downloaded, SHA256-verified
  (`5ec912b5ce913c2ed9b5392ed01dced27ca3b10b7d349b330dd9aee7936c63d1`) and inspected.
  Inbox, decisions, ALL/ANY outcomes, retained notes after a blocked request,
  deep-link reload, application Back/Cancel and 360/390/430 long-content reflow
  passed. No horizontal clipping was visible in those captures.
- A later test change waits for refresh completion, uses viewport captures for
  fixed action docks/dialogs, and adds browser Back/Forward, native dialog
  Tab/Shift+Tab checks and an English 360px decision sheet. Those additions need
  a passing CI run at their own revision; the seven-test run above does not cover them.

The UI tests inject a transport to control when failures occur; that test setup
is not available as a production mode. The HTTP suite uses the Spring server
and an isolated store. The two local suites test separate layers. The CI
browser-to-server run above checks the complete path.

Basic auth in this backend has no time-based session TTL. The client’s 401 reset
path and invalid backend credentials were tested; timed enterprise-session
expiration and platform-token expiry were **not** tested or implemented.

## Unrun acceptance, still required

No local browser was launched. The Chromium run above took place in GitHub CI.
The following checks were still open when this record was written:

- Full screen-reader behavior, 200% text zoom, full contrast, actual touch-target
  measurements, device safe areas and software keyboard coverage.
- Entire-browser offline/reconnect and runtime network/telemetry observation
  (one intercepted POST failure is covered, not every offline condition).
- All native App, mini-program, Feishu, WeCom and DingTalk builds, SSO, permissions,
  tenant identity mapping, delivery, callback signature/code/state validation.

`e2e/mobile.spec.mjs` contains **eight authored browser tests** against a real
local backend, including screenshots produced only when those tests actually
run. They are **unexecuted** locally. The test launcher always creates a new
isolated backend store, generates three temporary test passwords in memory and
starts loopback servers on ports 8094/5174; it refuses to reuse an existing server
and has no external-server target. No trace, video or authentication screenshots
are captured. Temporary test data is removed when the launcher exits. Worker config imports only read the inherited run context.

```sh
# Build/package the backend first, then from examples/approval-mobile:
npx playwright install --with-deps chromium
npm run test:e2e
```

The `Mobile approval CI` workflow runs the real backend harness, all
mobile checks, and these eight Chromium tests. Check the result for the
commit you are using before treating those browser tests as passed.

## Dependency security checkpoint

The official uni-app Vue 3 release **3.0.0-5020620260917001** is pinned. Its
upstream compiler declares Vite **5.2.8**, which has known advisories. The lockfile
pins these security overrides:

- Vite **6.4.3**, including nested Vite dependencies.
- Vitest **4.1.11** (removes the older critical Vitest UI-server advisory).
- PostCSS **8.5.28**; adm-zip **0.6.1**.
- @intlify/core-base and @intlify/vue-devtools **9.14.5**.
- Express's path-to-regexp **0.1.13**.

The source/type/component tests and H5 production build passed with these
versions. These versions differ from the compiler’s exact Vite peer pin. The local H5
checks passed, but upstream has not certified this combination, and App and
mini-program compiler compatibility remain untested.

The recorded `npm audit --json` run exited nonzero: **24 affected package entries**
(**0 critical, 8 high, 4 moderate, 12 low**). The complete machine-readable report
is [DEPENDENCY_AUDIT.json](DEPENDENCY_AUDIT.json). Package counts include advisory
propagation through parent packages, not 24 independent vulnerabilities.

Remaining high-severity chain: braces → micromatch / chokidar / fast-glob /
unimport → uni compiler/cloud tooling. The primary advisory is
[braces stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
affecting version 3.0.3, which was current in the registry when this audit ran. Do not feed untrusted glob patterns or
project sources to this compiler. Other remaining advisories include compiler
source-map handling, development server/Express request parsing and minor
transitive packages; see the linked report for exact ranges and sources.

These npm findings are predominantly source/build/development tooling. The
production output is a static H5 bundle, not a deployed Node/Express server;
the browser runtime still needs its own security review.
Some uni packages classify compiler dependencies as ordinary dependencies, so
`--omit=dev` alone is not an accurate browser-exposure classification.
Development binds to loopback only, and browser acceptance is still required.
Do not expose the Vite server or deploy this demo for real personnel data.

No further major-version dependency changes were attempted in this review.
Before production use, choose supported framework versions, resolve the
dependency risks, and review authentication and persistence.

## What this checkpoint does not claim

This checkpoint did not connect an enterprise platform, create an account or
OAuth grant, add a callback, send a notification, deploy the client or merge code. Screenshot inspection is limited to the
verified CI captures above; it is not comprehensive visual/device acceptance. The backend uses one tenant and fixed demo accounts. These tests do not cover
cross-tenant isolation. Comments are vote notes; standalone commenting is not present.
The desktop designer remains the authoring tool; mobile flow rendering is read-only.
