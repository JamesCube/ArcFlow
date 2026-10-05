# Mobile slice acceptance / 验收记录

Recorded **2026-10-05 UTC**. Base repository: **549e8da**. This is a local,
H5-first implementation checkpoint, **not a production or real-device sign-off**.

## Executed and passed

- `npm run typecheck`: strict TypeScript/Vue source check.
- `npm test`: **41 tests**, five files. Includes nine component DOM checks,
  API/error/host contracts, 2,304 independently modelled mixed sequential/ALL/ANY
  states, stale refresh races, logout races, double clicks, 401 clearing,
  uncertain write reconciliation, frozen repeated-assignee decisions and repeated worker-config imports preserving the owning run context.
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
- The follow-up capture/test change waits for refresh completion, uses viewport
  captures for fixed action docks/dialogs and adds browser Back/Forward plus
  native dialog Tab/Shift+Tab assertions plus an English 360px decision sheet. Its own exact-head CI must pass before
  those additional assertions are claimed.

The UI tests use an injected transport to cover controlled failure timing; they
are explicitly tests, not a production fixture mode. The HTTP suite uses the real
Spring server and isolated persistence. Combining these is useful evidence but
**does not replace a browser-to-server end-to-end run**.

Basic auth in this backend has no time-based session TTL. The client’s 401 reset
path and invalid backend credentials were tested; timed enterprise-session
expiration and platform-token expiry were **not** tested or implemented.

## Unrun acceptance, still required

No local browser was launched; the local browser restriction was respected.
The Chromium evidence above was executed in GitHub CI. These remain unverified:

- Full screen-reader behavior, 200% text zoom, full contrast, actual touch-target
  measurements, device safe areas and software keyboard coverage.
- Entire-browser offline/reconnect and runtime network/telemetry observation
  (one intercepted POST failure is covered, not every offline condition).
- All native App, mini-program, Feishu, WeCom and DingTalk builds, SSO, permissions,
  tenant identity mapping, delivery, callback signature/code/state validation.

`e2e/mobile.spec.mjs` contains **eight authored browser tests** against a real
local backend, including screenshots produced only when those tests actually
run. They are **unexecuted** locally. The owning test launcher always creates a new
isolated backend store, generates three ephemeral test passwords in memory and
starts loopback servers on ports 8094/5174; it refuses to reuse an existing server
and has no external-server target. No trace, video or authentication screenshots
are captured. Temporary test data is removed when the owning launcher exits. Worker config imports only read the inherited run context.

```sh
# Build/package the backend first, then from examples/approval-mobile:
npx playwright install --with-deps chromium
npm run test:e2e
```

The `Mobile approval CI` workflow runs the real backend harness, all
mobile checks, and these eight Chromium tests. CI status must be checked for the
exact published commit before any browser acceptance claim.

## Dependency security checkpoint

The official uni-app Vue 3 release **3.0.0-5020620260917001** is pinned. Its
upstream compiler declares Vite **5.2.8**, which has known advisories. This slice
uses explicit, lockfile-backed security overrides, rather than keeping that
vulnerable development server:

- Vite **6.4.3**, including nested Vite dependencies.
- Vitest **4.1.11** (removes the older critical Vitest UI-server advisory).
- PostCSS **8.5.28**; adm-zip **0.6.1**.
- @intlify/core-base and @intlify/vue-devtools **9.14.5**.
- Express's path-to-regexp **0.1.13**.

The source/type/component tests and H5 production build passed with these
versions. This is a deliberately tested departure from the compiler's exact
Vite peer pin, **not upstream certification**. It does not prove App or
mini-program compiler compatibility.

The final `npm audit --json` still exits nonzero: **24 affected package entries**
(**0 critical, 8 high, 4 moderate, 12 low**). The complete machine-readable report
is [DEPENDENCY_AUDIT.json](DEPENDENCY_AUDIT.json). Package counts include advisory
propagation through parent packages, not 24 independent vulnerabilities.

Remaining high-severity chain: braces → micromatch / chokidar / fast-glob /
unimport → uni compiler/cloud tooling. The primary advisory is
[braces stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
affecting the registry's current 3.0.3. Do not feed untrusted glob patterns or
project sources to this compiler. Other remaining advisories include compiler
source-map handling, development server/Express request parsing and minor
transitive packages; inspect the attached report for exact ranges and sources.

These npm findings are predominantly source/build/development tooling. The
production output is a static H5 bundle, not a deployed Node/Express server;
that distinction **does not establish the runtime as vulnerability-free**.
Some uni packages classify compiler dependencies as ordinary dependencies, so
`--omit=dev` alone is not an accurate browser-exposure classification.
Development binds to loopback only, and browser acceptance is still required.
Do not expose the Vite server or deploy this demo for real personnel data.

No further unbounded dependency major-version changes were attempted. A supported
production framework/authentication/persistence and resolved dependency baseline
remain release gates.

## What this checkpoint does not claim

No live enterprise platform connection, account creation, OAuth grant, callback,
notification, deployment or merge. Screenshot inspection is limited to the
verified CI captures above; it is not comprehensive visual/device acceptance. The unchanged
backend is single tenant with fixed demo identities. Cross-tenant isolation is
not established. Comments are vote notes; standalone commenting is not present.
The desktop designer remains the authoring tool; mobile flow rendering is read-only.
