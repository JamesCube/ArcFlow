# CRM 兼容性与发布门槛 / CRM compatibility and release gates

采购／成员待办基线已合入 main；独立 CRM 报价案例在该基线上接续。
本文件记录接口边界与验收门槛，不把已合并基线的结果当作 CRM 验收，也不表示 CRM 已合并或上线。

The accepted procurement/member-inbox baseline is merged. The CRM delta remains a separate
release candidate; acceptance of its base does not establish that CRM browser, database or
remote CI checks passed.

- Accepted main commit: `caece22fb52e645f303c6adec73f19a027d38e66`.
- Accepted main tree: `1d3332659bc59f3c70f2ffb5954aed6aa383f522`, matching the final PR #19
  head `b6faef486db71d4bdda28a8c7f8b8d9038c14e58` and retaining its two desktop selector fixes.
- The prior local CRM preflight commit `2bccc99b0aa885bcf657cd69683365db5bae0e0d`, tree
  `ffd6baf376283716a26d3baf1b20627585143020`, is retained as a comparison point, not a
  replacement for the accepted main baseline or proof of final-candidate checks.
- This release scope is the isolated `/api/crm` host and Chinese/English
  `/quote-discount.html` synthetic page. Shared standalone, RuoYi and H5 quote views,
  real CRM connections, AI calls, payments, notifications and writeback remain outside it.
- Real-browser and PostgreSQL/MySQL CRM test definitions are included. Execution results
  must come from the target commit’s actual CI reports and screenshot artifacts; this document
  does not assert a passing result.

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

## 本地覆盖与未完成验证 / Local coverage and pending verification

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
journeys, and the accepted main CI is not CRM CI. Check the final candidate's actual test
reports, non-skipped server contracts and screenshot artifacts before closing these gates.

此前本地结果仅对应当时的源码。最终候选仍需真实浏览器、真实数据库和远端 exact-head CI 证据；
未配置数据库导致的跳过、DOM 测试通过或基线 CI 通过，都不能替代这些结果。

## 后续责任与发布门槛 / Owned next actions

1. CRM owner: reconcile the candidate with accepted main `caece22fb52e645f303c6adec73f19a027d38e66`,
   retain the final PR #19 fixes, inspect the complete delta, and repeat domain/MVC/JDBC/client
   builds and live HTTP checks. The baseline acceptance gate is satisfied; final CRM regression
   results still need to be recorded.
2. Independent reviewer: review the final-base delta and conflict resolutions, including
   authorization, immutable source binding, storage, precision and the generic endpoint guards.
3. QA owner: execute the final tree's PostgreSQL/MySQL CRM contracts and real-browser CN/EN
   desktop/390px, cross-role, refresh, logout and recovery journeys. Retain exact-commit
   reports and screenshots; do not treat optional or skipped database tests as passes.
4. Release owner: prepare the draft PR and verify its exact-head remote CI after publication.
   Report any unrun or failed stage. A draft PR and accepted baseline do not establish CRM
   merge, deployment or production readiness.
5. Future shared-workspace integration: extend business-aware authorization/pagination and
   all type/money/projection dispatch points together, with component/browser coverage.
   Keep H5 review-only. Until then, retain the isolated-page scope explicitly.
