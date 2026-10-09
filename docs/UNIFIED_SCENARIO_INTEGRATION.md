# Unified scenario integration candidate / 三场景统一集成候选

## Status / 状态

This local candidate combines the bounded Travel, Seal-use and Receiving implementations
with the existing Expense scenario. It is **not merged or deployed**. This document describes
contracts and required gates, and does **not claim a complete exact-head CI or release pass**. A test
file, a valid workflow, a historical single-PR green run or an H2 result is not evidence that
the combined host, real databases and browser journeys have passed.

Inputs, compared against common main baseline
`71910bfc2ac1b9d58e0f7f1b85e6bbb206321ec1`:

| Candidate | Exact input head |
| --- | --- |
| [Travel PR35](https://github.com/JamesCube/ArcFlow/pull/35) | `b1306f0cb9571d054949fb4cb89dcc103ddf6347` |
| [Seal-use PR37](https://github.com/JamesCube/ArcFlow/pull/37) | `0fca720bf07085bfd988616074aa03f3b493ed44` |
| [Receiving PR38](https://github.com/JamesCube/ArcFlow/pull/38) | `91facd6bfee8cfa46756f409153f27eb07ec67dd` |

Original candidate screenshot downloads returned **HTTP 403 / 1010**. Their original image
bytes, per-image provenance and independent pixel review remain unverified. New automatic
captures cannot retroactively establish acceptance of those unavailable originals. Fresh
combined-head captures and independent pixel review are separate release gates.

本地候选统一三个原先互不兼容的 reader 与场景宿主；没有执行合并或部署。单 PR 的验证结果不能
当作组合版本通过。原图下载 403／1010 的视觉阻塞独立保留；CI 自动通过不等于独立逐图验收。

## Local verification checkpoint / 本地验证阶段

The following fresh checks were reported for the assembled local worktree on 2026-10-09.
They are separate from a clean committed combined head, GitHub CI and release acceptance:

| Local check | Observed result |
| --- | --- |
| Core regression / Python checks | 24 regression checks and 33 Python tests passed |
| Domain | 505 passed, including 21 `UnifiedBusinessSchemaTest` cases |
| Frontend unit/model/DOM | 1,197 passed; production build passed |
| Shared H2 contract | 94 passed, zero skips/errors/failures; local JDBC module 137 passed |
| Actual MySQL 8.0.46 contract | 100 passed, zero skips/errors/failures; all 15 new scenario/joint names present |
| PostgreSQL / MySQL 8.4 | Not run; PostgreSQL's 94 skipped cases are not a server pass |
| CI/docs static checks | All six workflows parse; shell/embedded-Python syntax, local document links and verifier fixture checks pass; no GitHub CI/browser execution is implied |
| Supplementary Boot 3.5.16 host | 88 tests passed in a separately configured runner; diagnostic only, not the declared-backend gate |
| Declared Boot 4.1.1 | Blocked: parent POM not cached and fresh Maven Central DNS resolution failed |
| Exact-head browser captures / independent pixels | Not established by these checks; original-image access remains blocked |

A separately configured Boot 3 runner, if used, is supplementary diagnostic work and cannot
satisfy the declared Boot 4.1.1 HTTP/browser gate. Later integration edits need the affected
checks repeated; these local counts do not authorize merging or deployment.

## Reader and writer contract / 读写兼容

The unified JSON reader accepts known wrapper schemas **1–10**, retaining each version's
strict shape. The explicit codec supports exactly seven business types:

| Type | Minimum wrapper | Field/version boundary |
| --- | --- | --- |
| `leave`, `procurement` | 5 | Existing strict documents; no new version field |
| `quoteDiscount` | 6 | Existing immutable quote revision/source fields |
| `expense` | 7 | Version 1, exact line-item amounts |
| `travel` | 8 | Version 1, calendar dates and exact estimated cost |
| `sealUse` | 9 | Version 1, non-monetary document/copy fields |
| `receiving` | 10 | Version 1, strict integer quantities and unit-grouped summary |

A minimum is not an exact wrapper requirement. Valid Travel at 9/10, Seal at 10, and empty
or old-type-only wrappers 8/9/10 remain readable. Travel below 8, Seal below 9 and Receiving
below 10 are rejected. Unknown types, case aliases, missing/duplicate/unknown fields,
future document versions, wrapper 11+, fractional or overflowing wrapper numbers and
invalid business data still fail closed. Schema-1 migration and schemas 2/3/4 shapes remain
strict. The new reader does not promise to read future formats or retrofit old binaries.

On each write, the wrapper is the maximum of the existing wrapper, definition/history
requirements, minimum 2, keyed submissions' minimum 4, typed business' minimum 5 and all
present type minima. Opening a file does not rewrite it or promote it to 10. The first
Expense write still needs only 7. After a genuine increase, later legacy, Travel, Seal,
Expense, approval or publication writes cannot lower the wrapper.

Every actual upgrade backs up the byte-exact file immediately before that upgrade,
including earlier writes in that process. Existing backup names are preserved with
collision-safe alternatives. Failed atomic replacement must not publish request/key
state; invalid reads and rejected validation do not alter snapshots or existing backups.

Receiving retains its raw `-0` guard before type-last/tree buffering and strict request
restore. Every scenario decision rechecks the business type on every CAS attempt. Seal
retains strict UTF-8 `application/json` submission and its 8,000,000 UTF-16-unit raw envelope
limit, plus safe 415 handling; this is not an aggregate snapshot-file size cap.

## Four isolated scenarios / 四个独立场景

The catalog is sorted by stable ID: `erp-receiving`, `oa-expense`, `oa-seal-use`, `oa-travel`.
Each compiled entry has an exact business type, process, fixed file suffix and browser
workspace. User-supplied path values cannot select arbitrary files.

| Scenario | Fixed suffix added to `approval.data-file` | Response envelope |
| --- | --- | --- |
| Expense | `.scenario-oa-expense.json` | `{request,total:string}` |
| Travel | `.scenario-oa-travel.json` | `{request,total:string}` |
| Seal-use | `.scenario-oa-seal-use.json` | `{request,total:null}` |
| Receiving | `.scenario-erp-receiving.json` | `{request,total:null,summary}` |

`/scenarios.html` exposes all four entries and preserves each draft, designer draft,
selection, review comment, unresolved submission key and original intent/version separately.
Late responses belong to the initiating scenario/authentication session; logout clears
session-local state. Reload is not durable draft recovery. Receiving also retains the
`/receiving.html` entry and Vite build target.

Each `/api/scenarios/{compiled-id}` host rejects every other business type. The generic
standalone/native document hosts remain leave/procurement-only. CRM retains its separate
source-access/ownership/revision checks and routes. Domain codec support is not permission
to bypass a dedicated host or mix types in a scenario file.

These are fixed, versioned forms with the existing 1–8-stage fixed-reviewer SINGLE/ALL/ANY
workflow. No dynamic conditional-routing engine, arbitrary-field form designer, real source
system, upload, booking, payment, stamping/signing, inventory posting or external writeback
is introduced. Receiving's Bob may be handled in the first ALL stage while pending in a
later stage; each stage requires its own vote. Different quantity units are never added
into a monetary or global quantity total.

Field-level contracts: [Expense](EXPENSE_SCENARIO.md), [Travel](TRAVEL_SCENARIO.md),
[Seal-use](SEAL_USE_SCENARIO.md), [Receiving](RECEIVING_SCENARIO.md).

## JDBC compatibility / 数据库边界

All types use the existing strict `request_json` payload. SQL revision **3** and the ready
member projection are unchanged; registering a new type requires **no DDL or rebuild of
an already-ready member index**. A revision-2 installation still needs its existing
explicit stopped-writer migration and bounded backfill. Do not rerun initialization or
clear ready projection tables merely to add these types.

Keys remain database-global `(applicant_id, submission_key)`, never scenario-scoped.
Process-scoped stores must not expose or mutate another process's requests, history or
inbox membership. Definitions and request process versions remain immutable; members are
derived from fixed snapshots and actual votes. JSON files retain their separate per-file
key scopes. No SQL revision change implies compatibility for an old binary's codec.

## Verification gates

Every workflow checkout uses the exact event head
`${{ github.event.pull_request.head.sha || github.sha }}`. Fresh combined evidence must use
that source, the declared Boot **4.1.1** backend and no substitutions presented as equivalent.
A supplementary different-Boot run is diagnostic evidence only.

Required gates include:

1. Core, domain and migration suites: legal read matrix 1–10; illegal lower-schema/type
   combinations; all six new-type write orders; monotonic writes; byte-exact immediate
   upgrade backups, collisions, failure/retry/restart; no mutation on invalid reads; strict
   Receiving numeric lexemes; preserved legacy shapes, authorization and CAS regressions.
2. Host suites: Travel, Seal and Receiving retain at least 5/10/4 tests respectively, plus
   the combined `UnifiedScenarioApiTest` catalog/response/file/cross-host isolation test.
   The live CRM, Expense, Travel, Seal and member-inbox HTTP scripts remain; Receiving's
   installed-client HTTP verifier runs against the declared packaged backend.
3. H2 plus actual PostgreSQL 17 and MySQL 8.0/8.4, on Java 17/21 where configured. The
   server workflows require zero skips/errors/failures and exact named business cases.
   The baseline union contributes ten new cases (Travel 2, Seal 4, Receiving 4), giving
   PostgreSQL ≥89 and MySQL ≥95. Five new joint-database cases raise current required
   floors to **PostgreSQL ≥94 and MySQL ≥100**. Counts never replace named-case checks.
4. Full shared UI model/DOM tests, native RuoYi mounted regressions, build and real browser
   runs. Heavy Expense/Travel/Seal journeys run in separate scenario matrix jobs and are
   excluded from the generic browser invocation; Receiving keeps its own browser job.
   Legacy leave/procurement, CRM, gallery and rejection journeys remain required.
5. Complete exact-head authenticated capture sets: Expense 16, Travel 20, Seal 18,
   Receiving 15. CI checks the expected state names, source revision, image hashes,
   locale/viewport and provenance. Receiving also requires completed ALL/ANY acceptance
   summary, clean source tree and declared backend identity. No auth traces, passwords,
   HAR, video or login screenshots are retained.
6. Independent original-image review for Chinese/English desktop and 390px controls:
   readable errors and quantities, keyboard/focus behavior, no clipping, distinct real
   workflow states and preserved business snapshots. Original-image access remains a
   blocker; source code, generated pictures or another scenario's gallery cannot satisfy it.

The ten original new shared-server tests must remain present:

- `travelTypedSnapshotGlobalKeysAndMemberProjectionRemainProcessIsolated`
- `travelConcurrentRetryCreatesOneRequestBindingAndExactAudit`
- `sealUseTypedSnapshotGlobalKeysAndMemberProjectionRemainProcessIsolated`
- `sealUseConcurrentRetryCreatesOneRequestBindingAndExactAudit`
- `sealUseEveryFieldAndVersionBindsRetryAfterRejectionAndReopen`
- `sealUseFailedAuditRollsBackTypedRequestMembersAndKey`
- `receivingTypedSnapshotAllVotesAndProcessIsolation`
- `receivingConcurrentRetryAndRepeatedReviewerRemainExact`
- `receivingRawNegativeZeroPayloadCannotBeRead`
- `receivingHostRejectsWrongBusinessTypeBeforeMutation`

The five joint-database tests additionally require isolated reads/decisions/inboxes,
applicant-global cross-type key conflicts, restart with independent versions, a two-connection
single-key race with exactly one winner, and request/audit/key/member rollback together.
Existing Expense/CRM named gates remain enforced too.

## Rollout and stop conditions / 切换与停止条件

1. Verify a unified-reader build against historical data before opening new writers. This
   code does not itself introduce an automatic two-phase deployment or feature switch;
   production use needs an explicit entry-point rollout plan.
2. Stop incompatible writers; back up JSON files or the database; ensure all readers and
   writers use the unified codec and JDBC is revision-3 ready. Then enable each new entry
   only after its final functional and visual gates. Deploy matching frontend/catalog
   validators together: old strict clients can reject a newly expanded catalog.
3. Keep JSON single-writer. On a failed response inspect durable state before retrying or
   restoring: a response failure is not proof that a transaction did not commit.
4. A historical backup restore discards later submissions, votes and publications. It is
   point-in-time recovery, not lossless rollback. Do not lower wrappers, delete new types,
   silently ignore records, or rebuild member indexes to make an old binary appear safe.
5. Stop on a codec, host-isolation, migration or exact-head evidence failure. Report the
   final source, commands, passed/failed/blocked checks and unresolved original-image gate
   separately. Merge and deployment require their own authorization and are not claimed here.
