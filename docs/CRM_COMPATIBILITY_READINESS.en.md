# CRM compatibility and release gates

<!-- Legacy fragments remain entry points after the language split. -->
<a id="crm-兼容性与发布门槛--crm-compatibility-and-release-gates"></a>
<a id="历史基线与范围--historical-baseline-and-scope"></a>
<a id="后续修改与发布门槛--gates-for-subsequent-changes"></a>
<a id="已接受提交--accepted-crm-checkpoint--2026-10-08"></a>
<a id="覆盖范围与证据边界--coverage-and-evidence-boundaries"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](CRM_COMPATIBILITY_READINESS.md) · [Documentation](README.en.md)

The isolated CRM case is merged through [PR #20](https://github.com/JamesCube/ArcFlow/pull/20). This document records the accepted
checkpoint, its scope and the gates for future changes. A passing base, merge or build is
not a deployment or production-readiness claim.

<a id="accepted-crm-checkpoint"></a>

<!-- topic:accepted-crm-checkpoint-2026-10-08 -->
## Accepted CRM checkpoint — 2026-10-08

- Tested PR head: [`878a5659220aaf546d9d7f77abfa31f42b054938`](https://github.com/JamesCube/ArcFlow/commit/878a5659220aaf546d9d7f77abfa31f42b054938).
- Merged main: [`66ec531270a513f884125065f19fe4e78762992f`](https://github.com/JamesCube/ArcFlow/commit/66ec531270a513f884125065f19fe4e78762992f).
  Both have source tree `12b173536f69b093fd2c9d4ecdd51ceb8e7f5071`. The PR workflows, test counts and screenshot archive below belong to the tested PR head. Post-merge runs are listed separately; tree equality does not turn a PR run into a post-merge run.
- All six PR workflows passed: [Java](https://github.com/JamesCube/ArcFlow/actions/runs/37723133834),
  [approval demo](https://github.com/JamesCube/ArcFlow/actions/runs/37723133831),
  [JDBC](https://github.com/JamesCube/ArcFlow/actions/runs/37723133862),
  [H5](https://github.com/JamesCube/ArcFlow/actions/runs/37723133830),
  [launcher](https://github.com/JamesCube/ArcFlow/actions/runs/37723133848),
  [RuoYi](https://github.com/JamesCube/ArcFlow/actions/runs/37723133896).
- Real server-database reports: PostgreSQL **77 tests per JDK** (17/21); MySQL **83 per version/JDK** (8.0/8.4 × 17/21), **486 total**, zero skips, errors or failures. All 18 new quote-case executions passed.
- The approval-demo run produced eight CRM screenshots covering Chinese/English desktop and 390px views. All eight were independently inspected and their hashes verified. Artifact `11526836399`, archive SHA-256 `b19c735e9df2a924b8db5ef49d77fafd02f23e7f534d528b076f5ac38cd4f0c5`. GitHub artifacts are retained for a limited period.
- A separate same-head [push browser run](https://github.com/JamesCube/ArcFlow/actions/runs/37723130422) failed before tests at a CDN location-based HTTP 403. It was not retried or bypassed. The successful PR browser run is separate evidence; this is not a claim that every push and PR run passed.
- The merge commit also completed all six workflows: [Java](https://github.com/JamesCube/ArcFlow/actions/runs/37723815007),
  [approval demo](https://github.com/JamesCube/ArcFlow/actions/runs/37723815076),
  [JDBC](https://github.com/JamesCube/ArcFlow/actions/runs/37723815753),
  [H5](https://github.com/JamesCube/ArcFlow/actions/runs/37723814962),
  [launcher](https://github.com/JamesCube/ArcFlow/actions/runs/37723815211),
  [RuoYi](https://github.com/JamesCube/ArcFlow/actions/runs/37723815056).
  Java passed on attempt 2 after a Maven resolution failure; the other five passed on attempt 1.

<!-- topic:historical-baseline-and-scope -->
## Historical baseline and scope

- Accepted main commit: `caece22fb52e645f303c6adec73f19a027d38e66`.
- Accepted main tree: `1d3332659bc59f3c70f2ffb5954aed6aa383f522`, matching the final PR #19
  head `b6faef486db71d4bdda28a8c7f8b8d9038c14e58` and retaining its two desktop selector fixes.
- The prior local CRM preflight commit `2bccc99b0aa885bcf657cd69683365db5bae0e0d`, tree
  `ffd6baf376283716a26d3baf1b20627585143020`, is retained as a comparison point, not a
  replacement for the accepted main baseline or proof of final-candidate checks.
- This release scope is the isolated `/api/crm` host and Chinese/English
  `/quote-discount.html` synthetic page. Shared standalone, RuoYi and H5 quote views,
  real CRM connections, AI calls, payments, notifications and writeback remain outside it.
- Real-browser and PostgreSQL/MySQL CRM test definitions are included. The accepted results
  are recorded above; later commits need their own actual CI reports and screenshot artifacts.

<!-- topic:critical-interfaces -->
## Critical interfaces

### 1. Keep the host authorization boundary

The generic `ApprovalService.inbox` checks current account eligibility and snapshotted membership. It does not query a CRM record's current business read permission. `QuoteDiscountCase` does enforce source-record access and quote ownership.

Therefore the bounded CRM service remains private to `/api/crm`. Its records are not added to the generic `/api/requests/inbox`; both generic document submission endpoints reject `quoteDiscount`. The combined real-HTTP smoke checks this separation before and after restart.

A future shared workspace must enforce CRM access before releasing any quote payload. Simply pointing a generic inbox at the quote store, or filtering rows only after returning them to the browser, is unacceptable. Business-aware pagination and source-permission changes need their own design and acceptance tests.

### 2. Extend lexical money decoding with type dispatch

The current standalone and RuoYi `business-document.js` files have explicit `leave`/`procurement` field allowlists. Their `parseApprovalJson` treats only `unitPrice` as exact-decimal money; `listUnitPrice` and `requestedUnitPrice` are currently interpreted through integer-token rules and rejected for decimal/scientific wire spellings.

H5's `BusinessDocument` union and parser also know only `leave`/`procurement`. Its days projection currently accepts zero only for procurement. All these points must change together when shared quote rendering is implemented.

Required files include:
- `examples/approval-ui/src/business-document.js`, `App.vue`, `locale.js`
- `examples/ruoyi-vue3/frontend/src/views/arcflow/approval/business-document.js`, `index.vue`, `locale.js`
- `examples/approval-mobile/src/domain/types.ts`, `business.ts`, `model.ts`, `workspace.ts`, `components/Workspace.vue`, `copy.ts`

Acceptance must cover decimal/scientific JSON lexemes, both quote prices, JPY, maximum totals, strict unknown/missing fields, real dates, quote version bounds, saved text normalization, days=0 for non-leave types, and display of immutable customer/reference/revision/validity fields. Read-only quote support must not silently enable a generic quote submission path or an H5 creation form.

The current isolated CRM page has its own validated model and backend view, so this limitation does not break the bounded example. It blocks claiming that the three shared clients support CRM.

### 3. Distinguish JSON schema from SQL revision

The compatible integration baseline uses SQL revision3 for member projections. CRM retains that SQL revision; its new JSON file format is snapshot schema6. These version numbers describe different contracts.

A compatible reader must understand quote payloads before quote writes or member backfill can inspect them. Stop all writers during the existing SQL revision3 backfill. Schema5→6 JSON upgrades preserve exact pre-upgrade bytes, including same-session mutations and failed atomic writes.

### 4. Preserve global key and process isolation

JDBC keys remain applicant-scoped across processes. The host's deterministic quote-revision key binds one immutable business revision to one request; it is not a generic businessId uniqueness rule. The quote, leave and procurement stores must retain process-scoped list/inbox/decision queries while reconciling global key collisions.

The combined tests cover independent JDBC instances racing on one quote key, one committed request/binding, both fixed reviewers projected, real votes moving pending/handled flags, future reviewers staying out of pending, and a mixed-process resumable backfill.

### 5. Scope future cursor caches by process

The current cursor binds actor, bucket, status and processVersion, but does not encode processId. That is compatible with the current one-service-per-endpoint design. A future multi-process selector must not reuse a cursor from another process merely because its other filters match. Add a versioned process-bound cursor or explicit endpoint/cache isolation before claiming unified multi-process paging.

<!-- topic:coverage-and-evidence-boundaries -->
## Coverage and evidence boundaries

`QuoteDiscountInboxCompatibilityTest` adds six JSON/domain checks:
1. Fixed-step pending/handled membership and restart preserve the quote snapshot.
2. Schema5→6 keeps mixed leave/procurement/quote payloads and rejects key conflicts without duplicate inbox rows.
3. A failed schema6 atomic write exposes neither a quote binding nor an extra work item; retry preserves the migration backup.
4. Quote paging preserves exact totals and rejects foreign actor/bucket cursors.
5. Concurrent retries produce one work item.
6. Rejection does not invent a handled vote for a future finance reviewer.

`QuoteDiscountMemberProjectionTest` adds five JDBC/H2 checks:
1. Quote/leave/procurement inboxes remain process-scoped while global keys conflict.
2. A revision3 batch-size-one backfill restores all three processes and actual quote-vote state.
3. Independent service instances converge on one request, one key and two reviewer rows.
4. A corrupt process projection yields no quote action and is rejected when selected through the foreign process.
5. Invalid persisted quote amounts fail snapshot verification before an inbox response is returned.

The optional `--inbox` flag in `examples/crm-quote/http_smoke.py` adds real-HTTP isolation checks using the actual `/api/requests/inbox` route. It does not simulate a browser. Isolation is checked while Bob is pending, after Bob has voted and Carol is pending, after terminal approval, and after restart. The local Approval demo CI definition wires this smoke into both Java matrix jobs and the CRM model/DOM tests into the frontend job. These are test definitions, not remote execution results. The CRM browser and real-server-database contracts require actual exact-head execution evidence before acceptance.

Earlier local domain/host, JSON/JDBC-H2, model/DOM and live HTTP results apply to the
revisions on which they ran. H2 is not a PostgreSQL/MySQL pass, DOM tests are not browser
journeys, and historical procurement/member-inbox baseline CI does not cover CRM. For
each new candidate, check its actual test reports, non-skipped server contracts and
screenshot artifacts before closing these gates.

<!-- topic:gates-for-subsequent-changes -->
## Gates for subsequent changes

1. CRM owner: start subsequent work from current main, inspect the new delta, and repeat
   affected domain/MVC/JDBC/client builds and live HTTP checks. Preserve the recorded
   checkpoint instead of applying its test results to a new commit.
2. Independent reviewer: review the new delta and any conflict resolutions, including
   authorization, immutable source binding, storage, precision and the generic endpoint guards.
3. QA owner: for a new release, execute its PostgreSQL/MySQL CRM contracts and real-browser CN/EN
   desktop/390px, cross-role, refresh, logout and recovery journeys. Retain exact-commit
   reports and screenshots; do not treat optional or skipped database tests as passes.
4. Release owner: prepare a draft PR for subsequent changes and verify its exact-head remote CI.
   Report any unrun or failed stage. PR #20 is merged; that does not establish deployment
   or production readiness, nor authorize a later release.
5. Future shared-workspace integration: extend business-aware authorization/pagination and
   all type/money/projection dispatch points together, with component/browser coverage.
   Keep H5 review-only. Until then, retain the isolated-page scope explicitly.
