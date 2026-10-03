# Arcflow approval UI prototype

Vue 3 + Vite UI for the companion Spring Boot approval example. This is an original, deliberately narrow demonstration: edit and publish a sequence → submit leave → complete assigned steps → visible status and activity. Alice can add, remove, reorder, name and assign 1–8 approval steps. Existing requests show their own **read-only definition snapshot**, separate from the current editable template. This is a sequential designer, not a general graph editor. No DingTalk assets or RuoYi integration are included.

## Run

Requires Node 22.22.2+ (or 24.15+) (Node 22 LTS recommended) and a running approval backend at `http://localhost:8080`.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. The Vite development proxy forwards `/api` to the backend. Configure the backend's permitted UI origin if changing that URL. The backend requires user-provided `APPROVAL_ALICE_PASSWORD`, `APPROVAL_BOB_PASSWORD`, and `APPROVAL_CAROL_PASSWORD`; there are no built-in passwords. Sign in as Alice to design/publish and submit, sign out, then sign in as Bob or Carol to review the currently assigned step. Refresh fetches requests and the published template from other sessions while preserving an unsaved local draft. Drafts are lost when signing out or reloading the page; publish to persist.

```sh
npm test
npm run build
```

## Contract and boundaries

- GET `/api/me`, `/api/people`, `/api/process`, `/api/requests`
- POST `/api/process`: `{expectedVersion, definition}`; Alice-only version-checked publication
- POST `/api/requests`: `{title, reason, days, processVersion}`
- POST `/api/requests/{id}/decisions`: `{stepId, decision: "APPROVE" | "REJECT", comment}`
- All requests send an explicit Basic Authorization header and `X-Arcflow-Client: approval-demo`, with `credentials: omit` and `cache: no-store`.
- Credentials are held in a private in-memory API closure. Password input clears after login attempts; logout clears the closure and all request data. There is no browser storage or persistent session. Browsers/password managers may independently offer to remember input; do not save demo passwords on shared machines.
- This demo is localhost-only and intended for synthetic data. Remote deployment requires a separate security review and production authentication/session design.
- Schema 2 uses an ordered node array: fixed start, 1–8 assigned approval steps, fixed end. Array order determines execution; there are no layout coordinates or graph edges. Server validation and authorization remain authoritative. The activity view shows each snapshotted step, assignee, decision, comment and timestamp.
- Repeated assignees are allowed as separately identified steps. A request cannot be submitted if its applicant is assigned anywhere in the published process. Each decision sends the exact current step ID; intermediate approval leaves the request pending. Reject ends it immediately.
- Published-version conflicts preserve the draft and require refresh/reset/reapplication. A later publication never edits a running request. See the [sequential contract](../../docs/SEQUENTIAL_APPROVAL.md).
- Repeated clicks while a mutation is in flight are suppressed. No automatic retry occurs after an ambiguous network failure: refresh first to avoid creating duplicate requests. The backend makes decision retries idempotent per step; submitting a new request has no idempotency key.
- The backend saves a local JSON snapshot across restarts. This is not a production database. Schema-1 saved data has an explicit tested migration; arbitrary workflow migration, production persistence, distributed concurrency, branching and RuoYi embedding are not provided.
- The production build is static. The Vite proxy is development-only: production hosting needs a separately configured same-origin `/api` reverse proxy and HTTPS.

## Automated coverage

Component and pure-model tests cover edit/reorder/reset/publish, role restrictions, 1–8 limits, malformed definitions, stale versions and interrupted requests, refresh with a dirty draft, repeated clicks, logout races, per-step decisions, and immutable instance snapshots. A production build is a compilation check, not browser visual verification.

## Real-browser first-run check

The approval-demo CI runs Chromium against the actual backend and Vite server on the same runner. It covers the fresh single-step flow, add/reorder/publish, sequential approval, read-only approvers, repeated decision clicks, rejection, reload/re-login, immutable request snapshots and recovery from an injected 503. The injected error checks UI recovery only; all other flows use the real backend.

To run locally from the repository root (JDK 17+, Maven, supported Node/npm):

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml package
cd examples/approval-ui
npm ci
npx playwright install chromium
npm run test:e2e
```

On a clean Linux machine, Playwright may also require system browser dependencies (`npx playwright install --with-deps chromium`, which can need administrator permission). Stop other servers on ports 8080 and 5173 first: the test deliberately refuses to reuse an existing app or store. It generates disposable demo passwords and a fresh temporary data directory, and binds both servers to loopback. Test data is synthetic. The temporary `arcflow-e2e-*` directory in your OS temporary folder may be removed after the run; it is not your normal demo store.

Only successful authenticated workspace views are captured under ignored `test-results/` directories; no password-form screenshots, authentication traces, HAR, videos or saved browser sessions are recorded. CI retains screenshot artifacts for seven days. These are proof of the standalone demo only, not visual verification of the RuoYi integration, production readiness, or backend restart persistence (covered separately by backend tests).
