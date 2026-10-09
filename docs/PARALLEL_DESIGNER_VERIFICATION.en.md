# Standalone ALL/ANY designer: historical local verification

<!-- Legacy fragments remain entry points after the language split. -->
<a id="standalone-allany-designer-local-verification"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](PARALLEL_DESIGNER_VERIFICATION.md) · [Documentation](README.en.md)

This record covers local testing on 2026-10-04. At that point, the changes had not been pushed to GitHub, deployed or tested in remote CI. Later browser results are recorded in [Designer workbench](DESIGNER_WORKBENCH.en.md); the counts and limitations below describe this earlier run.

<!-- topic:scope -->
## Scope

- Single-reviewer, ALL and ANY stages in a fixed sequence: changing a draft’s mode, selecting distinct participants, publishing, resetting and handling version conflicts.
- An inbox and decision controls for each participant, saved group snapshots, individual votes/comments/timestamps, and group states before and after completion.
- Existing single-assignee flows and HTTP identity checks still work. The standalone demo offers only Bob and Carol; it has no enterprise user directory.
- The shared domain supports 2–16 unique stable IDs per group. RuoYi still accepted only schema 2 at the time of this run. Its later [native group support](../examples/ruoyi-vue3/README.en.md#configure-and-vote-in-groups) is documented separately.

<!-- topic:provenance -->
## Provenance

Base: `e1a90282e374255d69869a8453f676c89bd0d471`.

The restored parallel-domain patch matched its original SHA-256:
`5a3ae9ebd569349a4346d78454587c40fc00461e40ba94d53a14f55e4e6c7e99`.

Its original tree was `4af0653fab36ecbcc307967d3227b5a6e19cd7fa`. The changes tested here add the standalone designer and enable schema 3 in its HTTP adapter. The preserved source artifact remains unchanged.

<!-- topic:tests-that-passed-locally -->
## Tests that passed locally

- Vue/Vitest: **97 tests in 5 files**, including the original 63 tests. The new tests first exposed 9 failures in the old UI; those cases passed after the changes.
- Independent reference reducer: **2,304 reachable states across 64 mixed three-stage processes**, covering all vote orders, repeated participants, pending members, stage outcomes and per-person display. Included as `parallel-model.test.js` in the 97-test suite.
- Vite production build: passed.
- Backend source compilation: passed using the already installed Java 21 compiler with `-source 17 -target 17 -parameters` and existing Spring/Jackson runtime jars. This is **not** Java 17 runtime or `--release 17` verification.
- Real localhost HTTP: **40 assertions** using random disposable accounts and a temporary store. Covers Basic authentication, origin rejection, editor-only publication, duplicate/invalid membership, stale versions, applicant/future-step/other-assignee restrictions, partial ALL, real backend restart, concurrent duplicate votes, immutable legacy snapshots, ANY partial/all rejection/early approval, and ALL early rejection.
- Independent UI review: no blocking correctness, security or session-isolation issue found. Changes from that review clarified the fixed demo identities, ordered browser tests that shared a store, and made the HTTP harness explicitly use loopback and a disposable store.
- `git diff --check`: passed.

<!-- topic:blocked-or-not-rerun -->
## Blocked or not rerun

- Maven/JUnit, JDBC/H2 and PostgreSQL suites were **not rerun for these combined changes**. Maven and a full Java 17 toolchain were unavailable, and a denied installation route was not retried. The added JUnit HTTP scenarios are present in source but were not run.
- Both Playwright journeys were attempted, but Chromium stopped before opening a page because the environment disallowed its local IPC socket. A separate attempt in the available cloud browser rejected localhost navigation with `ERR_BLOCKED_BY_CLIENT`. This run produced no passing browser tests or screenshots, and did not verify the mobile layout.
- This run did not include a GitHub push, remote CI, RuoYi browser retest, deployment or production validation.

<!-- topic:run-the-checks-in-your-development-environment -->
## Run the checks in your development environment

```sh
mvn verify
bash scripts/test.sh
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml verify
python3 examples/approval-demo/verify-parallel-http.py
cd examples/approval-ui
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Follow the JDBC module’s instructions for its full suite and configure a PostgreSQL test database explicitly. The HTTP script creates and removes its own test store, and starts and stops a backend on loopback port 18080. It stops if that endpoint is already occupied and leaves the normal demo store alone.
