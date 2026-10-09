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

The [scenario suite](e2e/VISUAL_SCENARIOS.md) captures Chinese and English leave-request forms, sequential steps, ALL/ANY groups, saved snapshots and mobile views. It uses a fresh backend in a separate CI run. Check that the browser job passed for your revision, then inspect its screenshots; unit tests and a successful build do not show how the UI renders. Keep the example on localhost with synthetic leave requests and the fixed Bob/Carol accounts. These leave-workspace captures do not cover the separate scenario library described below. Dynamic role resolution, tenant isolation, arbitrary branching and production use have not been verified.

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

## Unified typed scenario library

`/scenarios.html` includes six explicitly compiled templates: OA Expense,
OA Travel, OA Seal Use, ERP Receiving, ERP Payment Request and CRM Contract Approval. The backend catalog is stably sorted
by full ID: `crm-contract`, `erp-payment`, `erp-receiving`, `oa-expense`, `oa-seal-use`, `oa-travel`.
The matching catalog and UI must be deployed together. Unknown templates,
unknown metadata and malformed response envelopes fail closed; the registry
does not execute arbitrary user-defined schemas.

All six cards open their own active scope within the shared in-memory library
sign-in. `/receiving.html` also remains an independent bilingual receiving desk.
The existing `/` leave/procurement workspace remains available.

Switching cards preserves each scenario's form, unresolved submission key and
original process snapshot/version, unpublished process draft, designer
undo/selection, selected records, review notes and original-stage retained notes.
An unchanged uncertain retry keeps its original process version even after a
refresh sees a newer publication. Refresh preserves a dirty draft. Successful
submission clears only its originating form; delayed replies stay in their
originating scope and cannot take over newer navigation. Lists and loaded-item
counts belong to the selected scenario, rather than a cross-scenario inbox.
Sign-out, identity change or an unauthorized response invalidates every scope.
Credentials and unsaved work remain memory-only; browser reload clears them.

Response contracts stay distinct: Expense and Travel require exactly
`{request, total}` with a decimal-string total; Seal requires exactly
`{request, total: null}`; Receiving requires exactly
`{request, total: null, summary}`. A permissive union of those envelopes would
hide wrong-scenario data and is not accepted.

### Expense and Travel

The reusable form renderer shows Expense line items or Travel destination,
dates, purpose and estimated budget. Travel's inclusive 1–90-day duration is
display-only, derived from its validated dates. Estimated cost uses exact decimal
text internally and numeric JSON on the wire; JPY is whole yen. Travel metadata
has no line items. Monetary totals retain Expense's exact decimal semantics.

All data is synthetic. Travel approval does not book travel, reimburse expenses,
issue payments, send notifications or write back to another system.

The independent Expense and Travel browser journeys use the fresh real-backend
launcher, preserving both single-scenario review and cross-scenario retry,
draft, designer and retained-note isolation coverage:

```sh
npm run test:e2e -- e2e/scenarios.spec.mjs e2e/travel-scenarios.spec.mjs
```

Set `ARCFLOW_CAPTURE_SCENARIOS=1` for Expense captures or
`ARCFLOW_CAPTURE_TRAVEL_SCENARIOS=1` for authenticated bilingual Travel captures
and per-image revision/run/hash sidecars. Travel plans 20 images across 10
bilingual states, including validation errors and narrow reviewer controls.
Travel output uses unique `capture-travel-<UUID>/` directories; Expense output
uses unique `capture-<UUID>/` directories. Capture is not publication.

### Seal-use review

Seal uses seven real input fields and the immutable nine-property `sealUse`
document. Its copy count stays raw text while editing and becomes an integer
from 1 through 100 only after validation. Decimal, exponent and malformed count
input is preserved for correction, never truncated or treated as money.
Metadata retains the existing DTO shape: `copyCount` has kind `integer`,
`maxLength: 16`; `lineItems` is explicitly null. Fixed root text lengths and
strict Seal-specific field validation remain enforced.

Seal shows document, synthetic seal category and copy count in the form, list
and saved detail. The initial process is Bob's `documentReview`, then Carol's
`sealReview`. Approval records review only: it does not apply a physical or
electronic seal, sign anything, upload or verify a file, or fetch the inert
synthetic document reference.

The unit/DOM suite includes shared raw Seal vectors, strict transport and metadata
negatives, mounted bilingual form/detail cases, Catalog switching and retry
identity/version, independent designer undo, note retention and interruption
cases. `e2e/seal-use.spec.mjs` remains a separate real-backend journey covering
publication, form validation, pending and next-stage review, approved/rejected
results, reload and 390px reviewer controls:

```sh
npm run test:e2e -- e2e/seal-use.spec.mjs
```

It creates images only when `ARCFLOW_CAPTURE_SCENARIOS=1`, alongside per-image
SHA-256 and run/source provenance in unique `capture-<UUID>/` directories.

### ERP receiving

The receiving desk records a synthetic purchase order reference, warehouse,
delivery date, and 1–20 individually identified material lines. Each line has
an independent purchase order line reference and a `PCS` or `BOX` unit.
Ordered, received, accepted and rejected quantities are integers from 0 to
100,000; ordered must be positive, received cannot exceed ordered, and accepted
plus rejected must equal received. At least one line must receive goods.
Rejected goods require an exception reason (up to 1,000 UTF-16 code units).
The input preserves raw text until validation, so blanks, fractions, exponent
notation, signed or oversized values cannot silently become valid integers.
Line IDs and purchase order line references are unique within a document;
there is no cross-document quantity allocation or order-balance validation.

Quantities are reconciled and summarized separately per unit, in PCS then BOX
order. No combined scalar total treats pieces and boxes as interchangeable.
The receiving summary is
`{kind: "receiving", lineCount, exceptionLineCount, quantities}`; each quantity
row is `{unit, received, accepted, rejected}`. Optional exception reasons and
Receiving-specific quantity/enumeration metadata remain strictly validated.

The receiving namespace is `/api/scenarios/erp-receiving` with `/process`,
`/documents`, `/requests`, and `/requests/{id}/decisions`. Its own process,
records and business snapshots stay isolated from the other scenario stores.
Submission keys retain the store's existing applicant-scoped binding; no new
scenario scope is added to the shared JDBC key contract. The shared workspace
preserves original submission keys and process snapshots for uncertain retries,
suppresses repeated mutations, clears actor-scoped state on sign-out, rejects
malformed acknowledgements, and retains unconfirmed comments under their
original stage.

The default schema-3 route is an ALL inspection by Bob and Carol followed by a
separate procurement review by Bob. Bob deliberately serves both stages in this
fixed-account demo. Alice can use the real ProcessDesigner to publish a changed
ordered single/ALL/ANY process; submitted receipts retain their saved process.
The displayed process defines actual assignments. There is no dynamic role
resolution or separation-of-duties guarantee.

This is a localhost synthetic-data demonstration. It does not fetch real
purchase orders, check cumulative received quantities across receipts, post
stock, create payments, or write back to an external ERP. Approval completes
only the review lifecycle. Browser reload/sign-out clears unsaved forms,
comments, retry keys and credentials; saved data remains in the backend.

Receiving-specific tests cover exact raw quantity boundaries, per-unit summaries,
metadata allow-lists, malformed acknowledgements, uncertain retries, identity
changes, immutable process/business snapshots, Bob's repeated stages, ALL
rejection, bilingual validation, focus and retained-note recovery. The separate
browser journey is `e2e/receiving.spec.mjs`; it exercises real persisted
transitions and an injected lost acknowledgement:

```sh
npm run test:e2e -- e2e/receiving.spec.mjs
```

`ARCFLOW_CAPTURE_RECEIVING=1` opts into credential-free screenshots of signed-in
desktop/mobile workspaces with SHA-256 metadata. The [receiving evidence guide](e2e/RECEIVING_SCENARIOS.md)
describes the clean-checkout, exact-revision provenance requirements and all
15 expected captures. A compatibility-backend run must be labeled separately
from acceptance against the repository's declared backend version.

Run the real installed-client HTTP journey against a built backend jar:

```sh
node scripts/verify-receiving-http.mjs ../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```

It starts a fresh loopback backend on port 18089 with generated disposable
credentials and a temporary store, checks the client transport and workspace,
then stops its own backend. Set `JAVA` to a Java 17+ executable or
`ARCFLOW_RECEIVING_TEST_PORT` to another free loopback port. This verifies HTTP
behavior; it does not verify browser rendering.

### Combined verification and visual boundary

Run every retained scenario journey against the same combined backend and UI:

```sh
npm run test:e2e -- e2e/scenarios.spec.mjs e2e/travel-scenarios.spec.mjs e2e/seal-use.spec.mjs e2e/receiving.spec.mjs
```

The shared catalog checks require all four cards, localized titles and the
backend's exact full-ID order. A combined browser case also checks independent
four-scenario drafts and the standalone Receiving entry point. These assertions
supplement the original candidate journeys; they do not replace them.

Expense/Travel/Seal capture metadata prefers `ARCFLOW_SOURCE_REVISION` over
`GITHUB_SHA`, so a CI checkout of an explicit PR head is not mislabeled with a
synthetic merge revision. Supply the actual checked-out revision. Without a
revision, local captures are labeled `LOCAL_UNVERIFIED_WORKTREE`. Receiving
independently reads the actual Git HEAD and requires a clean tracked source tree
for capture. No login screenshots, traces, HARs, saved browser sessions or
credential logs are recorded.

Test discovery, a unit/DOM pass or a successful production build does not prove
browser, backend, database or visual acceptance. Individual candidate results
are not proof for this combined tree: rerun the combined gates and retain their
exact source and backend identity. The external reference image remains
unavailable (HTTP 403); no pixel comparison or reference-image visual acceptance
is claimed. Original bilingual browser captures and independent pixel review
remain required. Unified reader support does not establish deployment or
scenario acceptance, and older binaries cannot read every new scenario schema.

## Payment and contract review candidate / 付款与合同审批候选

This unmerged extension adds independent ERP payment allocation and CRM contract milestone reviews to the six-entry `/scenarios.html` catalog. It uses nine exact business types, monotonic JSON wrappers 1–12 and separate compiled API/store boundaries. Actual ALL/ANY and versioned human review do not execute payment, signing or external writes. See [business models, workflow semantics, compatibility and verification gates](../../docs/PAYMENT_CONTRACT_SCENARIOS.md). Earlier candidate descriptions refer to the PR39 baseline. This extension requires matching frontend and backend versions; old schema-10 readers cannot read the new documents.


### ERP payment request and CRM contract approval

Payment uses its own teal invoice-allocation desk. Every invoice retains its
original amount, declared prior settlement, current allocation and deduction.
The form shows per-line outstanding/net amounts and four exact document totals.
Positive deductions require a reason. Zero net requests cannot be submitted.

Contract uses a distinct plum dossier with terms, a declared revision and an
ordered milestone editor. The amount must exactly equal the milestone sum;
dates stay within the contract term and in nondecreasing order. Nonstandard
terms require an explanation. Switching to standard terms preserves the text
and reports a validation error until the explanation is explicitly cleared.
Neither flags nor amounts dynamically change the fixed route.

Both preserve raw editable numeric text, validate before numeric JSON emission,
and calculate with decimal strings and BigInt. Lines can be added, removed or
reordered, with stable IDs and a 1–20 limit. Submitted documents are read-only.
Payment responses require exactly `{request,total,paymentSummary}`; its total
means net requested. Contract responses require exactly `{request,total}`;
its total means contract amount. The four earlier envelopes remain unchanged.

The two journeys in `e2e/complex-scenarios.spec.mjs` verify the fresh default v1,
real designer publication to v2, lost-response retry pinned to the original v1,
repeated reviewer decisions, ALL/ANY outcomes, bilingual forms/errors/details
and 390px controls. To execute with the declared project backend:

```sh
npm run test:e2e -- e2e/complex-scenarios.spec.mjs
ARCFLOW_CAPTURE_COMPLEX_SCENARIOS=1 npm run test:e2e -- e2e/complex-scenarios.spec.mjs
node scripts/verify-complex-captures.mjs test-results
node scripts/verify-complex-http.mjs ../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```

The capture verifier requires the complete 40-image matrix, original PNG hashes,
source/UI/backend identity and one session per scenario. CI additionally binds
evidence to the exact clean head, run, attempt, repository and declared runtime.
A custom `ARCFLOW_BACKEND_JAR`/`ARCFLOW_BACKEND_RUNTIME` can label supplementary
local checks; it must never be passed off as the declared runtime. The HTTP
launcher tests the installed client and a fresh disposable real backend but
does not verify rendering. No screenshots are produced when browser launch is
blocked. Original inaccessible gallery images remain unverified and are not
replaced by synthetic captures or edited images.

All references, invoice balances and contract revisions are synthetic inputs.
There is no verified ERP/CRM source, cross-request invoice reservation, currency
conversion, bank data, payment execution, signing, customer delivery, receivable
creation or external writeback. Approval is an internal review result only.
