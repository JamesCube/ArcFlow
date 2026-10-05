# Standalone ALL/ANY designer: local verification

Date: 2026-10-04. This is a local source deliverable. It has not been uploaded to GitHub, deployed, or run through remote CI.

## Scope

- Ordered single / ALL / ANY approval stages; local draft mode conversion, distinct participant selection, publication, reset and version conflicts.
- Participant-aware inbox and decision controls, saved group snapshots, per-participant votes/comments/timestamps, correct partial and terminal group outcomes.
- Existing single-assignee flows and HTTP identity checks are preserved. The standalone demo only offers Bob and Carol; this does not add an enterprise identity picker.
- The shared domain still supports 2–16 unique stable IDs per group. At this historical standalone milestone RuoYi remained schema-2-only; its later [native group integration](../examples/ruoyi-vue3/README.md#configure-and-vote-in-groups) is separate from this verification record.

## Provenance

Base: `e1a90282e374255d69869a8453f676c89bd0d471`.

The restored parallel-domain patch was verified against its original byte-exact SHA-256:
`5a3ae9ebd569349a4346d78454587c40fc00461e40ba94d53a14f55e4e6c7e99`.

Its original tree was `4af0653fab36ecbcc307967d3227b5a6e19cd7fa`. This deliverable adds the standalone designer and enables its existing HTTP adapter for schema 3; it does not change that preserved source artifact.

## Executed successfully on the final local code

- Vue/Vitest: **97 tests in 5 files**, including the original 63 tests. Initial added tests reproduced 9 failures against the old UI; those cases now pass.
- Independent reference reducer: **2,304 reachable states across 64 mixed three-stage processes**, covering all vote orders, repeated participants, pending members, stage outcomes and per-person display. Included as `parallel-model.test.js` in the 97-test suite.
- Vite production build: passed.
- Backend source compilation: passed using the already installed Java 21 compiler with `-source 17 -target 17 -parameters` and existing Spring/Jackson runtime jars. This is **not** Java 17 runtime or `--release 17` verification.
- Real localhost HTTP: **40 assertions** using random disposable accounts and a temporary store. Covers Basic authentication, origin rejection, editor-only publication, duplicate/invalid membership, stale versions, applicant/future-step/other-assignee restrictions, partial ALL, real backend restart, concurrent duplicate votes, immutable legacy snapshots, ANY partial/all rejection/early approval, and ALL early rejection.
- Independent UI review: no blocking correctness/security/session-isolation issue found. Review findings about fixed demo identities/documentation, shared-store browser test ordering, and explicit loopback/disposable-store pinning in the HTTP harness were addressed.
- `git diff --check`: passed.

## Blocked or not rerun

- Maven/JUnit, JDBC/H2 and PostgreSQL suites were **not rerun for this combined deliverable**. Maven and a full Java 17 toolchain were unavailable; no denied tool-installation route was retried. Added JUnit HTTP scenarios are included but are not counted as executed.
- Both Playwright journeys were attempted, but Chromium terminated before opening a page because this environment disallows its local IPC socket. The supported existing cloud browser separately refused localhost navigation with `ERR_BLOCKED_BY_CLIENT`. No browser suite, visual screenshot or mobile-layout success is claimed.
- No GitHub publication, remote CI, RuoYi browser rerun, deployment or production-readiness validation was performed.

## Reproduce in a normal supported development environment

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

Use the JDBC module's own instructions for its full suite and an explicitly configured PostgreSQL test database. The HTTP script creates and removes its own synthetic store and starts/stops its own backend on loopback port 18080. It refuses an already occupied HTTP endpoint and never uses the normal demo store.
