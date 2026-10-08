# ArcFlow approval UI prototype

A Vue 3 + Vite UI for the Spring Boot approval example. Publish a process, submit a sample leave request, decide its assigned steps, and see the result and activity history. As Alice, you can add, remove, reorder, name and assign 1–8 approval steps. Each step has one approver or an ALL/ANY group. Each submitted request keeps a **read-only definition snapshot**, so later template edits do not change it. Steps run in order, including group steps. The editor does not support arbitrary graphs. The demo offers Bob and Carol as approvers. The shared domain supports groups of 2–16 stable participant IDs; this UI only uses the fixed demo accounts. It includes no DingTalk assets or RuoYi integration.

## Run

Requires Node 22.22.2+ (or 24.15+) (Node 22 LTS recommended) and a running approval backend at `http://localhost:8080`.

From the repository root:

```sh
cd examples/approval-ui
npm ci
npm run dev
```

Open `http://localhost:5173`. The Vite development proxy forwards `/api` to the backend. Configure the backend's permitted UI origin if changing that URL. The backend requires user-provided `APPROVAL_ALICE_PASSWORD`, `APPROVAL_BOB_PASSWORD`, and `APPROVAL_CAROL_PASSWORD`; there are no built-in passwords. Choose three different demo-only passwords, each at least 12 characters and at most 72 UTF-8 bytes. Multibyte characters can reach the byte limit sooner. Sign in as Alice to design/publish and submit, sign out, then sign in as Bob or Carol to review the currently assigned step. Refresh fetches requests and the published template from other sessions while preserving an unsaved local draft. Drafts are lost when signing out or reloading the page; publish to persist.

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
- Schema 2 and 3 use an ordered node array: fixed start, 1–8 approval steps, fixed end. Schema 2 keeps the legacy single-assignee shape. Schema 3 additionally supports `parallelApproval` nodes with `assigneeId: null`, unique `assigneeIds`, and `completionMode: "ALL" | "ANY"`. Converting a local step to a group upgrades only the draft until publication. Array order determines execution; there are no layout coordinates or graph edges. Server validation and authorization remain authoritative. The activity view shows each snapshotted step and every participant’s saved vote, comment and timestamp. The single `approverId` compatibility field is not a complete group assignment; the UI derives all eligible, unvoted participants from the saved definition and history.
- Repeated assignees are allowed as separately identified steps. A request cannot be submitted if its applicant is assigned anywhere in the published process. Each decision sends the exact current step ID; intermediate approval leaves the request pending. A single-step rejection ends it immediately. ALL requires every participant to approve and ends on any rejection. ANY advances on the first approval and ends only after all participants reject. Remaining participants in a completed group display “Not required”; later groups display “Upcoming” or “Not reached”.
- Published-version conflicts preserve the draft and require refresh/reset/reapplication. A later publication never edits a running request. See the [sequential contract](../../docs/SEQUENTIAL_APPROVAL.md).
- Repeated clicks while a mutation is in flight are suppressed. No automatic retry occurs after an ambiguous network failure. The form retains a random submission key and original payload/version in memory for manual retries; normalized edits create a new intent. Page reload, close or logout loses that client key, so inspect saved requests before creating another submission. The backend durably scopes submission keys to the applicant and decision retries to the saved step/participant. See [retry and migration boundaries](../../docs/SUBMISSION_IDEMPOTENCY.md).
- The backend saves a local JSON snapshot across restarts. This is not a production database. Schema-1 saved data has an explicit tested migration; arbitrary workflow migration, production persistence, branching and RuoYi embedding are not provided by this UI. The separate [native RuoYi host](../ruoyi-vue3/README.md#configure-and-vote-in-groups) has its own real-directory group editor and participant worklist.
- The production build is static. The Vite proxy is development-only: production hosting needs a separately configured same-origin `/api` reverse proxy and HTTPS.

## Automated coverage

Component and pure-model tests cover edit/reorder/reset/publish, role restrictions, 1–8 limits, malformed definitions, stale versions and interrupted requests, refresh with a dirty draft, repeated clicks, logout races, per-step decisions, and immutable instance snapshots. Parallel-specific tests cover mode conversion, distinct membership, partial ALL approval/ANY rejection, early termination, repeated participants, group draft conflicts, non-first-member eligibility, and per-participant status. The production build checks compilation. Use the browser tests and their screenshots to check rendering.

## Real-browser first-run check

The approval-demo CI runs Chromium against the actual backend and Vite server on the same runner. It covers the fresh single-step flow, add/reorder/publish, sequential approval, read-only approvers, repeated decision clicks, rejection, reload/re-login, immutable request snapshots and recovery from an injected 503. A second browser journey covers ALL/ANY editing, voting by the non-first member, partial groups, immutable group snapshots, repeated clicks, reload/re-login and a mobile result view. The injected error checks UI recovery only; all other flows use the real backend.

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

Only successful authenticated workspace views are captured under ignored `test-results/` directories; no password-form screenshots, authentication traces, HAR, videos or saved browser sessions are recorded. CI retains screenshot artifacts for seven days. These screenshots cover the standalone demo. They do not verify RuoYi rendering or production readiness. Backend restart persistence has separate backend tests.

To use an already installed Chromium for local verification, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its absolute path. CI continues to use Playwright’s managed browser by default.

## Focused workbench

The [workbench guide](../../docs/DESIGNER_WORKBENCH.md) covers connector insertion, compact stage cards, a single inspector, consistent Chinese/English workspace labels, and 50-edit local undo/redo. Select a card to configure its name, people and exact ALL/ANY rule. Workspace Refresh preserves edits; browser reload or sign out discards the memory-only draft. Confirmed publication clears undo history. The workspace opens in English and one global language selector switches the login/workspace/designer UI consistently (the standalone designer component retains its own selector). User-entered process names, request data and comments are preserved verbatim; unknown server details are clearly identified as original text beneath localized recovery guidance.

The previous desktop and 390px stacked layouts passed the real Chromium workbench journey at `836e605`, retained as historical evidence in the [verified gallery](../../docs/DESIGNER_SHOWCASE.md). The journey checks insertion, invalid-group focus, undo, Escape focus return, narrow inspector visibility, no horizontal overflow and publication. The same source tree was merged as `e1ee9c6`. Browser-native text undo, 200% zoom, cross-browser coverage and a formal accessibility audit remain unverified.

## Workspace visual redesign

The workspace has a navy navigation rail, shared text and status styles, compact stage cards and one inspector. On mobile, you can switch between the flow and its settings. Escape returns to the selected card, including read-only reviewers; switching views or languages preserves the draft and undo history. The request overview counts only records actually returned for the signed-in user.

The [scenario suite](e2e/VISUAL_SCENARIOS.md) captures Chinese and English leave-request forms, sequential steps, ALL/ANY groups, saved snapshots and mobile views. It uses a fresh backend in a separate CI run. Check that the browser job passed for your revision, then inspect its screenshots; unit tests and a successful build do not show how the UI renders. Keep the example on localhost with synthetic leave requests and the fixed Bob/Carol accounts. Expense and contract forms, role resolution, tenant isolation and arbitrary branching are not included, and production use has not been verified.

## Paginated member worklists

**Needs my review** and **My decisions** use the bounded server inbox instead of filtering the legacy full list. Each has its own cursor, filter values, load-more/retry state and loaded-item count. Handled means an actual saved vote; a request can remain pending, or appear in both boxes when the same person reviews a later stage. The existing request list and applicant form keep their broader historical visibility.

Changing filters restarts only that box; signing out or changing identity clears both boxes and all cached records. In-flight reads are aborted and late responses ignored, even when the transport ignores cancellation. A shared actor-scoped snapshot cache prevents older page/legacy replies undoing a saved decision. Decisions restart both first pages; uncertain results also recover through the broader legacy history, with further decisions locked if that recovery fails. Refresh intentionally restarts live worklists; counts are loaded rows, never a server total.

A dependency-free launcher exercises the actual installed client transport/pager against a fresh disposable backend with 27 synthetic requests:

```sh
node scripts/verify-inbox-http.mjs ../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```

Run it from this UI directory with Java 17+ on PATH (or `JAVA=/absolute/path/to/java`). It never targets an existing backend, downloads packages, or writes to a persistent demo store. The original local unit/DOM/build/HTTP checkpoint and browser acceptance boundaries are listed in [MEMBER_INBOX_UI](../../docs/MEMBER_INBOX_UI.md).

## Procurement and member inbox together

The document selector keeps independent leave/procurement drafts and submission
intent keys. Procurement validates item, quantity, currency and decimal price,
then submits a typed immutable business snapshot. Pending/handled tabs use the
bounded member API and keep their own continuation state. Details use the
shared request snapshot cache and compatible visible-request list. See [the business contract](../../docs/BUSINESS_DOCUMENTS.md),
[procurement scope](../../docs/PROCUREMENT_UI.md) and
[combined verification](../../docs/LOCAL_INTEGRATION.md).

Returning to an unchanged document form reuses its unresolved submission key
and original process snapshot, even after a publication refresh. A successful
submission clears only that form. Sign-out clears both forms and retry slots;
editing a form's normalized payload starts a new intent for that form.

## Expense and Travel scenario library

`/scenarios.html` has two compiled typed templates: OA Expense and OA Travel.
It has its own in-memory sign-in, shared across both scenario cards. The reusable
form renderer shows Expense line items or Travel destination, dates, purpose and
estimated budget. Travel's inclusive 1–90-day duration is display-only, derived
from its validated dates. Estimated cost uses exact decimal text internally and
numeric JSON on the wire; JPY is whole yen.

Switching cards preserves each scenario's form, designer draft/undo history,
selected records, original-step retained notes and unresolved submission key.
An unchanged retry keeps its original process snapshot/version even after a
refresh sees a newer publication. Requests, comments and delayed responses stay
in their originating scenario. A successful submission clears only that form;
sign-out or browser reload clears both in-memory workspaces. The list and counts
are scoped to the selected scenario, not a cross-scenario inbox.

All data is synthetic. Travel approval does not book travel, reimburse expenses,
issue payments, send notifications or write back to another system. Neither
scenario adds seal use or arbitrary user-defined schema execution.

The Travel browser source uses the same fresh real-backend launcher:

```sh
npm run test:e2e -- e2e/travel-scenarios.spec.mjs
```

Set `ARCFLOW_CAPTURE_TRAVEL_SCENARIOS=1` to opt into authenticated bilingual
original captures and per-image revision/run/hash sidecars (20 planned images across
10 bilingual states, including validation errors and narrow reviewer controls). Capture output is
isolated under unique `capture-travel-<UUID>/` directories and is not publication.
A successful unit/build run is not browser, backend, database or visual proof;
use the reports for the exact source revision being evaluated.
