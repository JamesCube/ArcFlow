# 业务单据与审批生命周期解耦 / Business documents and approval lifecycle

## 本轮边界 / Scope

审批的路由、参与人、ALL/ANY 表决、状态、审计和并发控制继续共用原状态机。
不可变 `BusinessDocument` 边界明确支持 `leave`、`procurement`、`quoteDiscount` 和 `expense` 四类业务；
不把任意 JSON 当作已经通过业务验证的单据。核心 DAG 仍执行公共标题/理由的 validate → normalize。
业务规则在类型化单据中验证，存储恢复时再次验证，审批期间禁止重写。
报价只通过专用 `/api/crm` 宿主和独立合成页面暴露；共享独立端、若依及 H5 工作区尚不支持报价。

The approval lifecycle remains independent of business fields: routing, participants, votes,
status, audit and optimistic concurrency use the same reducer. A sealed `BusinessDocument`
boundary supports four explicit, validated document schemas. This is a bounded extraction,
not an arbitrary-schema plugin framework or a rewrite of the workflow engine.

Expense is exposed only by the dedicated `/api/scenarios/oa-expense` host and `/scenarios.html`.
It has versioned form metadata, real line-item validation and immutable expense data; receipt references
are synthetic and approval never pays. See [Expense scenario](EXPENSE_SCENARIO.md). First Expense
write requires JSON snapshot schema7; upgrade all readers and stop incompatible writers first.
SQL revision3 is unchanged. Generic standalone/native document endpoints allow only leave/procurement.

- `BusinessDocument.Leave(businessId, title, reason, days)` retains the 1–365 day rule.
- `BusinessDocument.Procurement(businessId, title, reason, item, quantity, unitPrice, currency)`
  requires a nonblank item (≤240 characters), quantity 1–100,000, positive unit price
  ≤1,000,000,000 with at most two decimal places, and CNY/USD/EUR/GBP/JPY. JPY prices
  must be whole amounts. These are example business rules, not exchange-rate or payment logic.
- `BusinessDocument.QuoteDiscount(businessId, title, reason, customerRef, quoteRevision, item,
  quantity, listUnitPrice, requestedUnitPrice, currency, validUntil)` freezes a single quote
  revision. It uses the procurement item/quantity/money/currency limits for both prices,
  requires the requested price to be below the list price, a nonblank customer reference
  (≤128 characters), a positive integer revision and a real `YYYY-MM-DD` date. The host
  checks ownership, source fields, current read access and validity on new submission.
  Exact totals are derived rather than accepted as input; see the [quote case](CRM_QUOTE_CASE.md).
- All three require a stable business ID of 1–128 ASCII letters/digits and `._:/-`, beginning
  with a letter/digit; title ≤120 and reason ≤2,000 characters remain mandatory.
- Common text and the item are trimmed. Prices are normalized with exact decimal arithmetic;
  no binary-floating rounding, currency conversion, purchase order transmission or payment occurs.
- `businessId` is the host's document reference. It is not a uniqueness constraint or an
  idempotency key in the generic domain API. The quote host adds its own durable
  quote-revision binding without changing that generic contract.

## Java 与 HTTP / Java and HTTP

Use `service.submitDocument(authenticatedActor, document, expectedProcessVersion, optionalKey)`.
When decoding typed requests in a Java client, use `ApprovalService.strictMapper(mapper)`:
its exact-decimal tree parsing is necessary before the strict request decoder runs. The
built-in JSON/JDBC stores and HTTP hosts already configure it. A service/store has one configured process. Generic stable process IDs (letter followed by
letters, digits, `_` or `-`, ≤128 characters) are accepted. The default demo continues to use
its existing `leave-approval` routing; a host can initialize `procurement-approval` with its own
participants. Routing does not infer business policy from the process name.

Generic endpoints accept typed leave and procurement: standalone `POST /api/documents`
and RuoYi `POST /arcflow/documents`, with the existing `arcflow:request:submit` permission.
Both use the authenticated principal and optional `Idempotency-Key` header exactly as the
leave endpoint does. Both reject `quoteDiscount`; domain type support does not bypass the
quote host's business authorization checks. Procurement example body:

```json
{
  "business": {
    "type": "procurement",
    "businessId": "PO-2026-001",
    "title": "Office chairs",
    "reason": "Team expansion",
    "item": "Ergonomic chair",
    "quantity": 3,
    "unitPrice": 199.50,
    "currency": "CNY"
  },
  "processVersion": 1
}
```

The returned request has an immutable `business` snapshot. Existing list/decision routes and
participant authorization apply. For source/wire compatibility, `title` and `reason` remain
flat projections and `days` is 0 for procurement and quote discounts, or the actual leave
days for typed leave.
Storage rejects inconsistent projections. Business consumers must inspect `business.type`;
`days: 0` alone is never accepted as a valid legacy leave submission.

旧 `POST .../requests` 请假 API 和原 Java 构造器不变，旧请求不新增 `business: null` 字段。
新入口只增加能力；后续采购体验在独立与若依工作区提供采购表单，H5 仅查看与审批。
新增采购单也可通过 API 或 Java 服务调用，再通过既有审批接口完成表决。参见[采购 UI 边界](PROCUREMENT_UI.md)。

The legacy leave API and 16-argument Request constructor are retained. Old responses keep
exactly their previous fields; `business` is omitted entirely. The procurement UI layer adds standalone/native RuoYi authoring and review-only H5 rendering;
see [procurement UI scope](PROCUREMENT_UI.md).

报价通过 `POST /api/crm/documents` 提交，查询与决策也留在 `/api/crm` 内，使用独立流程和存储文件。
宿主先核对源报价读权、归属销售、版本和字段，再调用领域服务；所有新报价固定经过销售经理、财务两步人工审批。
该入口不接受自定义 `Idempotency-Key`，按报价编号与不可变版本生成持久化提交键。
共享列表不混入报价，也没有真实 CRM、AI、付款、通知或业务回写。

The isolated quote page uses `POST /api/crm/documents` and dedicated `/api/crm` read/decision
routes. Its host checks source access, ownership, revision and fields before calling the
domain service, and uses a separate fixed sales-manager/finance process and JSON file.
The endpoint rejects a custom `Idempotency-Key` and instead binds each immutable quote
revision with a deterministic durable key. Generic worklists and shared clients do not
include quotes. There is no real CRM connection, AI call, payment, notification or writeback.

## 幂等与授权 / Idempotency and authorization

Keys remain exact, case-sensitive and applicant-scoped. In JDBC, the scope remains global
across all configured processes in the database: `(applicant_id, submission_key)`. No SQL
schema/key migration is needed. Use a new key for a new business or process intent.

Replay compares process ID, process version, normalized common fields, business type,
business ID and every business field. A matching key returns the current durable request
(including decisions); any different intent returns 409. This includes reusing a key between
legacy leave and typed leave, or between different process heads. Business IDs alone do not
deduplicate generic submissions. Missing keys keep the generic opt-out behavior; the quote
host always supplies its own revision key and rechecks current source access and ownership.

Live applicant eligibility is rechecked before replay. Historical replay does not require
current approvers or the latest process version to remain eligible. Publication cannot change
the configured process ID. JDBC list/get/decision/update operations are bound to their store's
process; an unrelated process request is not exposed through these APIs. Global key lookup
exists only to detect/reconcile collisions; the service never replays a foreign-process request.

Separate process-head locks can race on a global key. The loser is reconciled only after a
clean duplicate from the binding insert, full rollback, and a fresh durable lookup. Other
integrity, commit, rollback or connection-cleanup failures stay errors. No orphan request or
submission event is committed.

## 持久化兼容 / Storage compatibility

- JSON snapshots 1–4 retain their strict existing shape and remain readable. Reads do not
  rewrite files. The first typed leave/procurement mutation requires snapshot schema 5;
  a quote mutation requires schema 6; an Expense mutation requires schema 7. Process definitions still use schema 2 (sequential)
  or 3 (parallel).
- Schema 5 has `schemaVersion`, `definition`, `requests`, and `submissions`; unkeyed documents
  use an empty submissions array. It can contain unchanged legacy requests and typed leave
  or procurement requests. Schema 6 retains that envelope and adds `quoteDiscount` payloads;
  a quote payload inside a schema-5 snapshot is rejected.
- Before the first upgrade, the byte-exact old file is retained in a private
  `.schemaN.bak` backup (or a unique backup if that name exists). Atomic replacement failure
  does not publish in-memory state/bindings; a retry preserves the original backup.
- A schema-5 file never downgrades when a later legacy/keyed request is added. The first
  5→6 upgrade backs up the exact bytes immediately before that upgrade, including any
  schema-5 writes in the same session. Schema 6 remains in use after later leave/procurement
  writes; failed atomic writes expose neither a new request nor its submission binding.
- A JSON file belongs to one process ID. Mixed-process historical rows or opening an existing
  file using another configured process ID fail closed.
- Typed documents continue using the existing `request_json` column. The accepted member
  inbox baseline uses SQL revision 3 with explicit migration and bounded backfill. Quote
  support retains revision 3 and does not add an SQL migration.
  No automatic DDL or backfill runs. Old and new request JSON shapes are decoded strictly; explicit
  `business: null`, missing/unknown fields and invalid projections are rejected.
- Multiple JDBC store instances may bind different process IDs in one schema. Retained
  definitions and request snapshots are checked against each request's own process/version.

After writing typed documents, old application binaries cannot read the new payloads.
Schema6 readers cannot read Expense/schema7. Schema7 never downgrades after later legacy writes;
pre-upgrade byte backups are historical recovery and cannot provide a lossless downgrade.
Schema-5 readers do not understand quote documents or schema-6 files. Deploy quote-compatible
readers everywhere before enabling quote writes or backfilling rows containing quotes,
and stop old writers. A JSON backup is a historical recovery aid,
not a downgrade procedure: restoring it would discard later approvals/submissions. JDBC has
no automatic rollback migration; retain normal database backups and avoid mixed-version
writers after enabling typed documents.

## Verification / 验证

`BusinessDocumentTest` covers real procurement transitions, ALL/ANY behavior, authorization,
restart, immutable intent, strict numeric/type validation, concurrent retries, JSON 2/3/4→5
migration and failed writes. The shared JDBC contract runs procurement, per-process isolation,
global key collisions and forced cross-process races on H2, PostgreSQL and MySQL. The standalone
HTTP suite and RuoYi smoke flow exercise the additive endpoints without weakening old routes.
CI retains Java 17/21, PostgreSQL and MySQL 8.0/8.4 verification; actual server jobs assert
non-skipped contract counts. These existing procurement/member-inbox checks do not establish
that CRM server-database or browser coverage passed. Quote domain, host, JSON/JDBC-H2,
model/DOM and real-HTTP checks are described in [CRM release gates](CRM_COMPATIBILITY_READINESS.md).
New CRM browser/server-database coverage is being prepared; remote exact-head CRM CI has not
run. See the relevant commit's actual checks before making a release claim.

## 成员待办基线 / Member-inbox baseline

The procurement/member-inbox baseline is merged in main at
`caece22fb52e645f303c6adec73f19a027d38e66`, tree
`1d3332659bc59f3c70f2ffb5954aed6aa383f522`. SQL revision 3 adds a process-scoped member
projection and explicit stopped-writer migration/backfill. Follow the current
[JDBC installation guide](../examples/approval-jdbc/README.md), not an older revision-2-only
rollout. JSON snapshots use schema 5 for typed leave/procurement and schema 6 after a quote
write; these are independent of SQL revision 3. CRM remains a separate release candidate,
not a merged or fully verified part of that accepted baseline. See [CRM release gates](CRM_COMPATIBILITY_READINESS.md).

采购／成员待办基线已合入上述 main 提交；CRM 候选增量不在该合并范围内。启用报价前先升级读取端，
保留 SQL revision 3 的停写迁移与回填要求，并另行核对最终 CRM 提交的浏览器、真实数据库和远端 CI 结果。
