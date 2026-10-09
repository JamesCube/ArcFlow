# 业务单据与审批生命周期解耦 / Business documents and approval lifecycle

## 本轮边界 / Scope

审批的路由、参与人、ALL/ANY 表决、状态、审计和并发控制继续共用原状态机。
不可变 `BusinessDocument` 边界明确支持 `leave`、`procurement`、`quoteDiscount`、`expense`、`travel`、`sealUse` 、`receiving`、`paymentRequest` 和 `contractApproval` 九类业务；
不把任意 JSON 当作已经通过业务验证的单据。核心 DAG 仍执行公共标题/理由的 validate → normalize。
业务规则在类型化单据中验证，存储恢复时再次验证，审批期间禁止重写。
报价只通过专用 `/api/crm` 宿主和独立合成页面暴露；共享独立端、若依及 H5 工作区尚不支持报价。

The approval lifecycle remains independent of business fields: routing, participants, votes,
status, audit and optimistic concurrency use the same reducer. A sealed `BusinessDocument`
boundary supports nine explicit, validated document schemas in this unified integration candidate. This is a bounded extraction,
not an arbitrary-schema plugin framework or a rewrite of the workflow engine.

Expense is exposed only by the dedicated `/api/scenarios/oa-expense` host and `/scenarios.html`.
It has versioned form metadata, real line-item validation and immutable expense data; receipt references
are synthetic and approval never pays. See [Expense scenario](EXPENSE_SCENARIO.md). First Expense
write requires JSON snapshot schema7; upgrade all readers and stop incompatible writers first.
SQL revision3 is unchanged. Generic standalone/native document endpoints allow only leave/procurement.

Travel is a distinct itinerary-and-budget document, exposed only by `/api/scenarios/oa-travel`
and the shared scenario page. It has required destination, start/end calendar dates, purpose,
exact estimated cost, currency and cost center; inclusive duration is 1–90 days. It performs
no booking, reimbursement or payment. First Travel write requires schema8-compatible readers.
See [Travel scenario, validation and rollout](TRAVEL_SCENARIO.md).

Seal-use is a non-monetary document with an inert document reference, synthetic seal category
and copy count. Its `/api/scenarios/oa-seal-use` host returns `{request,total:null}`; approval
applies no seal or signature. See [Seal-use contract](SEAL_USE_SCENARIO.md).

Receiving is a quantity-only document with a synthetic purchase-order reference and 1–20
validated lines. Its `/api/scenarios/erp-receiving` host returns
`{request,total:null,summary}` with per-unit quantities; approval does not post inventory.
See [Receiving contract](RECEIVING_SCENARIO.md). Expense and Travel keep exactly
`{request,total:string}`, without a receiving summary.

The shared catalog exposes all six compiled scenario entries. Their business types,
processes, fixed JSON file suffixes and browser drafts/retry intents remain isolated;
Receiving also keeps `/receiving.html`. Registration does not allow any new type through
legacy/generic/native hosts. These are fixed versioned forms and 1–8-stage reviewer flows,
without a dynamic conditional-routing or arbitrary-field form engine. See
[unified integration status and release gates](UNIFIED_SCENARIO_INTEGRATION.md).

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
- All document types require a stable business ID of 1–128 ASCII letters/digits and `._:/-`, beginning
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
leave endpoint does. Both reject `quoteDiscount`, `expense`, `travel`, `sealUse`, `receiving`, `paymentRequest` and `contractApproval`; domain type support does not bypass
the dedicated hosts and their authorization boundaries. Procurement example body:

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
flat projections and `days` is 0 for all non-leave documents, or the actual leave
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

The unified reader accepts known JSON snapshot wrapper schemas **1–12**, while retaining
the strict field shape of each older version. Empty or old-type-only snapshots at schemas
8, 9 and 10 are valid. Reading a valid snapshot does not rewrite it or create/replace a backup.
This is compatibility of the new reader with existing candidates, not future-format support.

| Business wire type | Minimum JSON wrapper schema |
| --- | --- |
| `leave`, `procurement` | 5 |
| `quoteDiscount` | 6 |
| `expense` | 7 |
| `travel` | 8 |
| `sealUse` | 9 |
| `receiving` | 10 |
| `paymentRequest` | 11 |
| `contractApproval` | 12 |

- Every non-null business payload must match an explicit wire type and Java record, satisfy
  its minimum schema and pass strict field/version/business validation. A higher supported
  wrapper may contain a lower-minimum type. Travel at 9/10 and Seal at 10 are legal;
  Receiving at 8/9 is not. Unknown types, case aliases, future document versions, wrapper
  13+, non-integer/overflow wrapper numbers and inconsistent projections fail closed.
- Legacy schemas 1–4 retain their original shapes; no typed payload may bypass those gates.
  Older leave/procurement/quote documents gain no artificial `documentVersion` field.
  Definition schemas remain 2 (sequential) and 3 (parallel).
- Every write takes the maximum of the current wrapper and all requirements: minimum 2,
  current/historical definitions, keyed submissions (4), typed business (5), and each
  document type's minimum. Opening a file never forces schema 10; the first Expense
  write still needs only 7. Later Travel, Seal, Expense, legacy, decision and publication
  writes never lower an already higher wrapper.
- Each real upgrade retains the byte-exact snapshot immediately before that upgrade,
  including earlier same-process writes, as a private `.schemaN.bak` (or a unique name on
  collision). Existing backups are not overwritten. A failed atomic replacement must
  publish neither an in-memory request nor a retry binding. Read/validation failures
  change neither snapshots nor existing backups.
- Each JSON file belongs to one configured process. Mixed-process history or opening a
  file under another process ID fails closed. Scenario hosts additionally require their
  exact business type; a domain migration fixture containing multiple business types does
  not authorize mixed scenario files. JSON remains single-writer/local-filesystem storage.
- Receiving's raw negative-zero guard remains active before polymorphic type-last/tree
  buffering. Scenario decisions recheck the target business type on every CAS attempt.
  Seal HTTP accepts only well-formed UTF-8 JSON and applies the 8,000,000 UTF-16-unit raw
  submission envelope bound; that bound is not an aggregate snapshot file-size limit.
- JDBC retains SQL revision 3, the existing `request_json` column and ready member
  projection. New type registration requires no DDL, new revision or rebuild of an
  already-ready member index. Databases still at revision 2 need the existing explicit
  stopped-writer migration/backfill. No automatic DDL or backfill is introduced.
- JDBC keys remain globally `(applicant_id, submission_key)` across processes. Stores
  still isolate list/get/decision/inbox operations by configured process, retaining each
  request's original definition version and actual-vote membership semantics.

Before new writes, stop incompatible writers, back up and deploy this unified codec to
**all** readers/writers of the affected JSON files or JDBC rows. Old main (schemas 1–7)
and the separate Travel/Seal/Receiving candidates are not interchangeable readers for
one another's payloads. SQL revision 3 alone does not make an old binary compatible.
Restoring a historical backup discards later submissions, decisions and publications;
it is point-in-time recovery, not lossless downgrade. Never lower a wrapper, delete a
business type or rebuild the member index as an automatic rollback technique.

## Verification / 验证

This is a local combined implementation candidate, with no merge, deployment or complete
exact-head CI/release pass claimed by this document. Individual candidate reports do not establish
joint compatibility. The [combined gates](UNIFIED_SCENARIO_INTEGRATION.md#verification-gates)
require fresh migration, host, browser and H2/PostgreSQL/MySQL results on the final head.
Original candidate screenshot downloads returned HTTP 403 / 1010; their image bytes and
independent pixel acceptance remain unverified, separately from automated CI.


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

## ERP payment and CRM contract extension

The independent payment request and contract review hosts, exact monetary rules, six-host envelopes, nine-type migration and synthetic-only boundaries are documented in [Payment and contract scenarios](PAYMENT_CONTRACT_SCENARIOS.md). Payment alone adds a typed `paymentSummary`; contract keeps `{request,total:string}`. The extension is an unmerged candidate.
