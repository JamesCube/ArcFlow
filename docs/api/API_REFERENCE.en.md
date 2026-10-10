# ArcFlow HTTP API Reference

<!-- Legacy fragments remain entry points after the language split. -->
<a id="1-宿主与边界--hosts-and-boundaries"></a>
<a id="10-http-错误与恢复--errors"></a>
<a id="11-若依原生差异--ruoyi-native-adapter"></a>
<a id="12-源码索引与变更检查--sources-and-change-checklist"></a>
<a id="2-独立示例调用约定--standalone-transport"></a>
<a id="21-base-url认证与请求头"></a>
<a id="22-json数字与版本"></a>
<a id="3-路由清单--endpoint-inventory"></a>
<a id="31-通用审批--generic-approval"></a>
<a id="32-六场景--registered-scenarios"></a>
<a id="33-报价折扣--dedicated-quote-host"></a>
<a id="4-写入-dto--command-payloads"></a>
<a id="41-旧请假--legacysubmission"></a>
<a id="42-类型化提交--documentsubmission"></a>
<a id="43-发布--publication"></a>
<a id="44-审批决定--decision"></a>
<a id="5-幂等与安全重试--idempotency-and-retries"></a>
<a id="6-流程与条件--process-definitions"></a>
<a id="7-成员收件箱--member-inbox"></a>
<a id="8-响应模型与读取详情--request-snapshots"></a>
<a id="9-业务文档完整字段--business-schemas"></a>
<a id="91-公共规范"></a>
<a id="910-contractapprovalcrm-contract"></a>
<a id="92-leave通用"></a>
<a id="93-procurement通用"></a>
<a id="94-quotediscountcrm"></a>
<a id="95-expenseoa-expense"></a>
<a id="96-traveloa-travel"></a>
<a id="97-sealuseoa-seal-use"></a>
<a id="98-receivingerp-receiving"></a>
<a id="99-paymentrequesterp-payment"></a>
<a id="arcflow-http-api-reference--http-接口参考"></a>

[简体中文](./API_REFERENCE.md) · [English](./API_REFERENCE.en.md) · [Developer guide](../development/README.en.md)

Source baseline: [`main` at `199db7548f6faba5dfef105eaaf7311972adb388`](https://github.com/JamesCube/ArcFlow/tree/199db7548f6faba5dfef105eaaf7311972adb388). This reference describes the example hosts implemented in this repository. It is not a specification for an unimplemented platform API. The Java `arcflow-core` library does not start an HTTP server.

- [Endpoint inventory JSON](./endpoint-inventory.json): 30 offline mappings from the four Controllers for detecting route drift; this is not OpenAPI.
- Static OpenAPI contracts: [standalone host](./openapi/standalone.openapi.json) (21 operations) and [RuoYi host](./openapi/ruoyi.openapi.json) (9 operations), with separate authentication, envelopes and status codes.
- [Executable request examples](./examples/README.en.md): use your own local configuration and synthetic data. Never commit passwords, Authorization headers or real business information.
- Controller, DTO and domain-validation source links at the end are authoritative. The static OpenAPI files and executable HTTP examples support inspection and verification. Numeric token precision, raw UTF-16 lengths, cross-field rules, authorization and concurrency remain server-enforced contracts; structural validation alone cannot guarantee that a request succeeds.

<!-- topic:hosts -->

## 1. Hosts and boundaries

| Host | Prefix | Identity and response | Implemented business |
| --- | --- | --- | --- |
| Standalone example | `/api` | HTTP Basic; direct JSON objects/arrays | Legacy leave, typed leave/procurement, member inbox |
| Standalone scenarios | `/api/scenarios` | Same Basic identity; separate process/store per scenario | Expense, travel, seal use, receiving, payment request, contract review |
| Dedicated quote example | `/api/crm` | Same Basic identity plus quote-revision ACL | Synthetic quote-discount review |
| Native RuoYi overlay | `/arcflow` | RuoYi identity/token/RBAC; `AjaxResult` | Legacy leave, typed leave/procurement, member inbox |

These APIs do not make payments, sign contracts, apply seals, place purchase orders, post inventory, download attachments, synchronize a live CRM or convert currencies. A business reference is a data field, not a downloadable file URL.

The following are **not implemented**: `/api/auth/me`, `/api/users`, `/api/login`, `/api/session`, `/api/csrf`, a separate process-validation endpoint, `GET /requests/{id}`, request editing/deletion/withdrawal, approval delegation, or a cross-host unified inbox. The application has no configured Swagger UI or generated `/v3/api-docs`; the OpenAPI files in this directory are version-controlled static contracts, not runtime endpoints. Publication validates a definition as part of the command. Frontend validation does not constitute an HTTP validation API.

<!-- topic:transport -->

## 2. Standalone transport

### 2.1 Base URL, authentication and headers

The default backend binds to `http://127.0.0.1:8080`; deployment configuration may change the address/port. The default allowed UI Origin is `http://localhost:5173`, configurable with `APPROVAL_UI_ORIGIN`. `localhost` and `127.0.0.1` are different Origins.

Every `/api/**` request requires HTTP Basic. Server credentials come from `APPROVAL_ALICE_PASSWORD`, `APPROVAL_BOB_PASSWORD` and `APPROVAL_CAROL_PASSWORD`. There is no universal default password or application login/token endpoint. The host is stateless, with form login and application logout disabled; there is no cookie-session flow. Use Basic only for local demonstrations or behind appropriate HTTPS protection. Do not print authentication headers on a shared terminal.

| Header | Contract |
| --- | --- |
| `Authorization: Basic …` | Authenticate every request. Use your HTTP client's Basic support rather than committing credentials. |
| `Content-Type: application/json` | Recommended for every JSON write. Seal-use submission accepts only this media type, with charset parameters allowed. |
| `X-Arcflow-Client: approval-demo` | Required with this exact value for every method except GET, HEAD and OPTIONS; otherwise 403. |
| `Origin` | A non-browser client may omit it. If present, it must exactly equal the configured UI Origin; otherwise 403. This does not enable cross-origin CORS. |
| `Sec-Fetch-Site` | `cross-site` is rejected with 403. Spoofing a header does not confer authorization. |
| `Idempotency-Key` | Used for submission only, with host-specific rules in §5. |

The browser example uses a frontend development proxy. Origin validation does not mean arbitrary sites can call the backend through CORS. Strict Origin/Fetch-Metadata checks and the non-simple client header protect writes; Spring's CSRF-token mechanism is disabled, so clients do not fetch a CSRF token first.

The demo directory contains active `alice`, `bob` and `carol`. Alice may publish; Bob and Carol are eligible approval assignees. All can read their identity and the active-person summary list. Being listed does not automatically imply assignment eligibility: publication/submission additionally check `canAssignApproval`. The applicant cannot appear in any approval stage in the full definition, even a conditional stage that would not run.

### 2.2 JSON, numbers and versions

- Input is strict JSON. Unknown properties, duplicate keys, trailing JSON, numeric/boolean-to-string coercions, numeric-string-to-number coercions, null primitive values and floating-point-to-integer coercions are rejected.
- Property names and enum values are case-sensitive. Days, quantities and versions use JSON integers. Money uses JSON numbers, not strings such as `"12.50"`.
- String limits use Java `String.length()`: raw UTF-16 code units, not bytes or necessarily visible characters. Validation runs before trimming.
- Money is processed using exact `BigDecimal`. Unless stated otherwise, its maximum is `1000000000` with at most two decimal places; JPY must be numerically whole. Do not rely on JavaScript/JSON floating-point rounding to repair invalid input. Excess lexical precision, such as `1.000`, can be rejected even when its mathematical value is an integer.
- Business `documentVersion`, process `schemaVersion` and publication `version`, frozen `routing.schemaVersion`, and the private persistence wrapper schema are separate version systems. The private file wrapper schema is not a submission property.
- Submission and decision bodies cannot supply server-generated request IDs, applicant IDs, status, history, definition snapshots, selected routing or calculated totals to override server state. Process publication separately accepts `Publication.definition` (§4.3).

<!-- topic:routes -->

## 3. Endpoint inventory

The four Controllers declare 30 mappings: 9 generic, 7 scenario, 5 quote and 9 RuoYi mappings. The scenario count includes the literal seal-use submission path, which takes precedence over the scenario template.

The success codes below are the actual Controller statuses. All standalone submissions return 201, including successful replays; no `Location` response header is promised. Other successful operations return 200. See §10 for errors.

### 3.1 Generic approval

Source: [ApprovalController.java](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/ApprovalController.java).

| Method | Path | Input | Success | Authorization |
| --- | --- | --- | --- | --- |
| GET | `/api/me` | None | 200 `Person` | Authenticated |
| GET | `/api/people` | None | 200 `Person[]` | Authenticated |
| GET | `/api/process` | None | 200 `ProcessDefinition` | Authenticated |
| POST | `/api/process` | `Publication` | 200 next `ProcessDefinition` | Alice/EDITOR plus directory publication permission |
| GET | `/api/requests` | No defined filters | 200 `Request[]` | Applicant or participant on the effective route only |
| GET | `/api/requests/inbox` | Queries in §7 | 200 `InboxPage` | Authenticated identity's pending/handled work |
| POST | `/api/requests` | `LegacySubmission` | 201 `Request` | Active applicant, absent from all approval stages |
| POST | `/api/documents` | `DocumentSubmission`; leave/procurement only | 201 `Request` | Same as above |
| POST | `/api/requests/{id}/decisions` | `Decision` | 200 `Request` | Participant assigned to that exact snapshotted stage |

A `Person` is `{ "id":"alice", "displayName":"Alice" }`. Standalone `/api/me` does **not** include `canPublish`; native `/arcflow/me` adds that field.

Lists already include complete request snapshots and history. Detail views use those returned objects; there is no separate detail endpoint. The list is unpaged, has no ordering guarantee, and does not turn arbitrary query parameters into filters. Prefer the bounded inbox for pending/handled work.

### 3.2 Registered scenarios

Sources: [ScenarioController.java](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/ScenarioController.java), [ScenarioConfiguration.java](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/ScenarioConfiguration.java).

| Method | Path | Input | Success |
| --- | --- | --- | --- |
| GET | `/api/scenarios` | None | 200 `ScenarioTemplate[]`, sorted by `id` |
| GET | `/api/scenarios/{scenarioId}/process` | Scenario ID | 200 `ProcessDefinition` |
| POST | `/api/scenarios/{scenarioId}/process` | `Publication` | 200 next definition; directory publication permission required |
| GET | `/api/scenarios/{scenarioId}/requests` | Scenario ID | 200 identity-filtered `ScenarioView[]` |
| POST | `/api/scenarios/{scenarioId}/documents` | `DocumentSubmission` and required key; seal use takes the dedicated mapping below | 201 `ScenarioView` |
| POST | `/api/scenarios/oa-seal-use/documents` | `DocumentSubmission` and required key; `application/json` only, raw-input limits in §9.7 | 201 `ScenarioView` |
| POST | `/api/scenarios/{scenarioId}/requests/{id}/decisions` | `Decision` | 200 `ScenarioView` |

Only these six scenario IDs are registered. An otherwise valid call for an unknown scenario returns 404 `Scenario not found`. The submitted business type must exactly match its scenario or it returns 400. Each scenario has an independent process and request file; it is not a tag filter over `/api/requests`. A request belonging to another scenario cannot be decided through the current scenario.

| scenarioId | `business.type` | Initial schema | Initial stages, in order |
| --- | --- | --- | --- |
| `oa-expense` | `expense` | 2 | `manager` Bob → `finance` Carol |
| `oa-travel` | `travel` | 2 | `tripReview` Bob → `budget` Carol |
| `oa-seal-use` | `sealUse` | 2 | `documentReview` Bob → `sealReview` Carol |
| `erp-receiving` | `receiving` | 3 | `receiving-inspection` ALL Bob/Carol → `procurement-review` Bob |
| `erp-payment` | `paymentRequest` | 3 | `payment-check` ALL Bob/Carol → `payment-final` ANY Bob/Carol |
| `crm-contract` | `contractApproval` | 3 | `commercial-review` Bob → `contract-review` ALL Bob/Carol |

These defaults initialize empty stores only. Fetch the current process; never assume version 1 or unchanged stages. All six scenarios support publishing schema 2/3. Only expense, receiving, payment and contract support schema-4 conditional definitions.

`ScenarioView` has this structure; the request placeholder represents the full model in §8:

```json
{
  "request":{"...":"Complete Request; see section 8"},
  "total":"120.00"
}
```

- `total` is a display string for expense total, travel estimated cost, payment net total or contract amount. It is JSON null for seal use and receiving.
- Receiving adds `summary:{kind:"receiving",lineCount,exceptionLineCount,quantities:[{unit,received,accepted,rejected}]}`. Quantities are grouped in PCS, BOX order and include only used units. Do not add different units together.
- Payment adds `paymentSummary:{type:"paymentRequest",declaredOutstanding,grossAllocation,deductionTotal,netTotal}`. All four amounts are display strings.
- Inapplicable `summary` and `paymentSummary` properties are omitted, not null. Display money uses zero decimals for JPY and two for the other supported currencies.

`ScenarioTemplate` contains `id,domain,documentType,documentVersion,formVersion,title,description,sections,lineItems`. Business and form versions are 1 in this catalog. Titles/descriptions are `{zh,en}`. Each section has `id,title,fields`; a field has `path,kind,label,required,maxLength,options`; an option has `{value,label:{zh,en}}`. `lineItems` is null or `{path,label,minItems,maxItems,fields}`. This is compiled form metadata, not an arbitrary JSON Schema or script executor. It does not list every required generated field, such as each line's `lineId`.

### 3.3 Dedicated quote-discount host

Sources: [QuoteDiscountController.java](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/QuoteDiscountController.java), [QuoteDiscountCase.java](../../examples/approval-domain/src/main/java/com/arcflow/approval/QuoteDiscountCase.java).

| Method | Path | Input | Success |
| --- | --- | --- | --- |
| GET | `/api/crm/process` | None | 200 fixed `quote-discount` definition |
| GET | `/api/crm/quotes` | None | 200 current readable `QuoteVersion[]` |
| GET | `/api/crm/requests` | None | 200 `QuoteView[]` satisfying approval visibility and quote ACL |
| POST | `/api/crm/documents` | `DocumentSubmission`; quoteDiscount only; no key header | 201 `QuoteView` |
| POST | `/api/crm/requests/{id}/decisions` | `Decision` | 200 `QuoteView` |

There is no quote publication endpoint. The process has fixed sequential `salesManager` → `finance` stages. The demo source supplies synthetic `Q-DEMO-001`, revision 1, owned by Alice and readable by Alice/Bob/Carol. Fetch `/api/crm/quotes` rather than hardcoding this fixture.

`QuoteVersion` contains `businessId,revision,customerRef,ownerId,readerIds[],item,quantity,listUnitPrice,currency,validUntil`. Only the owner may submit, and all initial reviewers must have read access to that revision. Submitted customer, item, quantity, list price, currency and validity date must match the saved immutable revision or the request returns 409. An absent/unreadable revision returns 404. An expired quote's initial submission returns 400; a superseded revision returns 409.

`QuoteView` contains `request,listTotal,requestedTotal,reductionTotal,discountPercent,thresholdReached,expired,quoteUpdated`. It has no `revision` field: the source quote version is `QuoteVersion.revision`, while the submitted document records `request.business.quoteRevision`. Totals and the percentage are strings. The three monetary totals are formatted by currency. The displayed percentage is rounded half-up to four decimal places with trailing zeros removed. `thresholdReached` means the exact discount is at least 10%; it **does not select the approval route**. Expiry is checked against the UTC calendar day; the `validUntil` day remains valid. After submission, expiry/source revision changes update informational flags only. They do not automatically approve/withdraw a request, rewrite its document or prevent an otherwise authorized vote.

<!-- topic:commands -->

## 4. Command payloads

The following structural examples contain no secrets. Read the matching host's process to obtain a valid version before use.

### 4.1 LegacySubmission

Only `POST /api/requests` and its native counterpart accept this shape:

```json
{"title":"Demo leave","reason":"Synthetic approval test","days":2,"processVersion":1}
```

Required: nonblank `title` up to 120 UTF-16 units, nonblank `reason` up to 2,000, integer `days` 1–365, and `processVersion` ≥1. This path retains the legacy response shape without a `business` property. It is a different idempotent intent from a typed leave submission.

### 4.2 DocumentSubmission

```json
{
  "business":{
    "type":"procurement",
    "businessId":"PO-DEMO-001",
    "title":"Demo procurement",
    "reason":"Synthetic procurement review",
    "item":"Office equipment",
    "quantity":3,
    "unitPrice":100.50,
    "currency":"CNY"
  },
  "processVersion":1
}
```

The only top-level properties are `business` and `processVersion`, both required. The required `business.type` must be supported by that endpoint. §9 lists every business field. Generic `/documents` accepts only leave/procurement, not specialized types.

### 4.3 Publication

```json
{
  "expectedVersion":1,
  "definition":{
    "schemaVersion":2,
    "id":"leave-approval",
    "version":1,
    "name":"Demo approval",
    "nodes":[
      {"id":"start","type":"start","name":"Submit","assigneeId":null},
      {"id":"manager","type":"approval","name":"Manager review","assigneeId":"bob"},
      {"id":"end","type":"end","name":"Complete","assigneeId":null}
    ]
  }
}
```

Both `expectedVersion` and `definition.version` must equal the current published version. Preserve `definition.id`. Success returns the definition with `version + 1`; stale versions return 409, as does reaching `Integer.MAX_VALUE`. Existing requests retain their original snapshots and voting policies. Publication has no idempotency-key semantics. After an uncertain response, GET the process to check whether publication already succeeded before retrying an old version.

### 4.4 Decision

```json
{"stepId":"manager","decision":"APPROVE","comment":"Synthetic data checked"}
```

- `stepId` is required, nonblank and at most 64 UTF-16 units. Use the request's actual snapshotted stage ID, not a guess from the latest global process.
- `decision` is exactly `APPROVE` or `REJECT`.
- `comment` may be omitted, null or empty, up to 2,000 units. It is trimmed before storage; null becomes `""`.
- There is no HTTP `expectedRevision`, `revision`, `If-Match` or client-selected actor. The server internally uses the recorded decision count for CAS, with at most 16 write attempts; unresolved contention returns 409.
- Repeating the same decision by the same actor for the same request/stage returns the current saved request without another event. A new comment does not replace the recorded comment. The opposite decision returns 409.
- A noncurrent stage, terminal request without that actor's prior vote, or stage outside the effective route returns 409. A visible request but wrong stage participant returns 403. An absent or invisible request returns 404.

<!-- topic:idempotency -->

## 5. Idempotency and safe retries

| Submission endpoint | `Idempotency-Key` |
| --- | --- |
| `/api/requests`, `/api/documents` | Optional; without it each successful call creates another request. Sending one is recommended. |
| `/arcflow/requests`, `/arcflow/documents` | Same behavior, scoped to the native numeric-string applicant ID. |
| `/api/scenarios/{scenarioId}/documents` | Exactly one header value is required. |
| `/api/crm/documents` | Forbidden; its presence returns 400. The host binds the quote revision itself. |

A key is case-sensitive and contains 1–128 ASCII characters matching `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. Blank values, comma-combined values, slashes and multiple header values are invalid. Keep tokens, names and sensitive business data out of keys.

The binding is authenticated applicant + key within the store boundary. The six scenarios currently use separate stores; this is not global cross-business deduplication. A `businessId` normally does not deduplicate submissions. The quote host is the exception: it generates a deterministic key from quote business ID/revision, so callers must omit their own header.

The same key and normalized content/original `processVersion` return the original request's **current** state, even after new publication or terminal approval. Standalone still returns 201. Reusing the key with a different type, fields, process version or other intent returns 409. The domain normalizes titles/reasons and each type's specified text/amounts before comparison; do not assume arbitrary client rewrites are equivalent.

Recommended client flow:

1. Read the target host's process and construct valid business data.
2. Generate and retain one key for a new intent, together with its original body, processVersion and endpoint.
3. After a network timeout or 503, inspect the list and retry the same key/body. Do not immediately generate a new key.
4. Use a new key only for a deliberate new intent. For a confirmed stale-version conflict, inspect the current process before deciding to create one.
5. Retry decisions against the same request/stage/decision; refresh history rather than resubmitting the application.

Quote replay for the same revision and intent similarly returns saved state. Changing the requested discount or other intent conflicts; the endpoint is not a way to create multiple requests for one revision.

<!-- topic:process-routing -->

## 6. Process definitions and conditions

Sources: [ProcessDefinition.java](../../examples/approval-domain/src/main/java/com/arcflow/approval/ProcessDefinition.java), [ConditionalRouting.java](../../examples/approval-domain/src/main/java/com/arcflow/approval/ConditionalRouting.java).

Required `ProcessDefinition` fields: `schemaVersion,id,version,name,nodes`. Process IDs match `[A-Za-z][A-Za-z0-9_-]{0,127}`; version is ≥1. Names are nonblank, at most 120 UTF-16 units and contain no ISO control characters. There are 3–10 total nodes, representing 1–8 ordered manual approval stages.

- First node: `{id:"start",type:"start",name,assigneeId:null}`. The last is the corresponding `end` node.
- Every node requires `id,type,name,assigneeId`. Node IDs match `[A-Za-z][A-Za-z0-9_-]{0,63}`, are unique within the definition, and reserve start/end for boundaries. Node names follow process-name rules.
- Schema 2: interior nodes are `approval` with one non-null `assigneeId`. Do not supply `assigneeIds` or `completionMode`.
- Schema 3: also permits `parallelApproval`, with `assigneeId:null`, 2–16 distinct active eligible `assigneeIds`, and `completionMode:ALL|ANY`.
- Schema 4: permits optional `runIf` on approval nodes in the four supported typed scenarios. Omit the field for unconditional nodes; do not use null. Start/end nodes cannot have conditions.

Sequential reviewers act in order. ALL requires every member to approve and rejects on one rejection. ANY completes the stage on one approval and rejects only when every member rejects. Partial votes keep the stage current. A person can belong to multiple stages and vote once in each.

Conditions select extra human review stages only at submission time. At least one unconditional manual stage must remain. No scripts, automatic approvals, dynamic assignees or arbitrary jumps are available. A rule is `{mode:ALL|ANY,predicates:[...]}`, with 1–8 predicates. The whole definition permits at most eight predicates, all belonging to its business family.

| Scenario | Exact predicate fields | Constraints |
| --- | --- | --- |
| oa-expense | `field:"expense.totalAmount",operator,currency,threshold` | operator `EQ/GT/GTE/LT/LTE`; numeric threshold 0–20000000000, at most two decimals, whole JPY; exact sum of validated expense lines |
| erp-payment | `field:"payment.netTotal",operator,currency,threshold` | operator `EQ/GT/GTE/LT/LTE`; numeric threshold 0–20000000000, at most two decimals, whole JPY |
| erp-receiving | `field:"receiving.hasRejectedLines",operator:"EQ",expected` | expected is a JSON boolean; the fact is derived from rejected line quantities |
| crm-contract | `field:"contract.termsKind",operator,values` | operator `EQ/IN`; unique `STANDARD/NONSTANDARD` values; exactly one for EQ, one or two for IN |

Expense and payment thresholds are decoded through Jackson JsonNode, which removes trailing decimal zeroes before the domain checks their scale: `threshold:1.000` is accepted. This differs from business-money DTOs, which preserve lexical scale. For those DTOs, scale is measured after applying the exponent; for example, `1.000e3` has scale 0.

The server derives `expense.totalAmount` from the immutable validated line amounts using exact decimal arithmetic. It accepts no client-supplied total. For a CNY 0.30 GTE rule, 0.10 + 0.19 skips the extra stage, while 0.10 + 0.20 and 0.10 + 0.21 include it. These are synthetic precision examples, not a suggested expense policy. The existing expense document version 1, definition schema 4, route schema 1, and JSON wrapper 13 are unchanged. Expense routing is standalone-only; RuoYi and H5 do not support expense submissions or expense conditions.

All money predicates in a definition must use the same currency. Submission currency must match **every** predicate, even inside an otherwise successful ANY rule. A mismatch rejects submission instead of silently removing review or converting currency. Unused predicate properties must be absent, not null.

Example condition on an optional payment review node:

```json
{"mode":"ALL","predicates":[{"field":"payment.netTotal","operator":"GTE","currency":"CNY","threshold":10000}]}
```

A schema-4 request saves its full original `definition` plus `routing:{schemaVersion:1,stepIds,evaluations}`. Selected IDs retain original order. Evaluations contain every conditional node and every atom's `{field,actualValue,result}`, without short-circuiting. Later publication or source changes do not reselect an existing request's route. Users assigned only to skipped stages gain no read, pending or voting rights from those skipped assignments.

<!-- topic:inbox -->

## 7. Member inbox

Available only at `GET /api/requests/inbox` and native `/arcflow/requests/inbox`. The scenario and quote Controllers expose no inbox endpoint.

| Query | Type/default | Constraints |
| --- | --- | --- |
| `box` | Default `PENDING` | Exactly `PENDING` or `HANDLED`, case-sensitive |
| `limit` | Integer, default 25 | 1–100; decimal digit string of at most ten digits within Java int range |
| `status` | Optional | `PENDING`, `APPROVED` or `REJECTED` |
| `processVersion` | Optional integer | ≥1; decimal digit string of at most ten digits within Java int range |
| `cursor` | Optional string | Exact previous-page value; at most 1,024 characters; URL-safe unpadded Base64 |

Unknown fields, including actor/userId, repeated parameters, empty numbers, signs, decimal/exponent numbers and invalid cursors return 400. The next page may use a different limit. Cursors bind the actor, box, status, processVersion and ordering position; restart from the first page if those other filters change.

```json
{"items":[],"nextCursor":null}
```

- PENDING includes all unvoted members of the current stage, not just the first legacy `approverId`.
- HANDLED requires that identity to have actually voted. Merely appearing in a definition or being an unvoted losing ANY member is insufficient.
- One request may appear in both a user's HANDLED and PENDING boxes, for example when a later stage assigns them again.
- Sort order is descending `createdAt`, then descending request ID for ties. `updatedAt` does not control order.
- At most limit items are returned. `nextCursor:null` means no current next page. A cursor is an ordering position, not authorization or a consistent-snapshot token. Real decisions can change membership; refresh from the first page.

<!-- topic:responses -->

## 8. Request snapshots and detail reading

Typical newly created legacy leave response; IDs/times are generated by the server:

```json
{
  "id":"server-generated-request-id",
  "title":"Demo leave",
  "reason":"Synthetic approval test",
  "days":2,
  "applicantId":"alice",
  "approverId":"bob",
  "status":"PENDING",
  "createdAt":"2026-10-09T00:00:00Z",
  "updatedAt":"2026-10-09T00:00:00Z",
  "decision":null,
  "comment":null,
  "processId":"leave-approval",
  "processVersion":1,
  "history":[{"actorId":"alice","action":"SUBMIT","comment":"","at":"2026-10-09T00:00:00Z","stepId":null}],
  "definition":{"schemaVersion":2,"id":"leave-approval","version":1,"name":"Leave approval","nodes":[
    {"id":"start","type":"start","name":"Submit leave","assigneeId":null},
    {"id":"manager","type":"approval","name":"Designated approver","assigneeId":"bob"},
    {"id":"end","type":"end","name":"Completed","assigneeId":null}
  ]},
  "currentStepId":"manager"
}
```

| Field | Meaning |
| --- | --- |
| `id` | Server-generated identity. Creation currently uses UUIDs; the contract permits `[A-Za-z0-9][A-Za-z0-9_-]{0,127}`. |
| `title,reason,days` | Compatibility fields. Typed leave keeps its days; other typed documents use days=0. |
| `business` | Present only for typed requests. Immutable normalized business snapshot from §9; absent for legacy leave. |
| `applicantId` | Taken from the authenticated principal, never client-selected. |
| `approverId` | Compatibility representative: first still-pending participant, or last voter after termination. Not the complete membership. |
| `status` | `PENDING/APPROVED/REJECTED`. |
| `createdAt,updatedAt` | UTC `Instant` strings, possibly including fractional seconds. |
| `decision,comment` | Null before any vote; otherwise the latest vote's action/comment, not every person's full history. |
| `processId,processVersion,definition` | Complete process snapshot from submission; later publication does not rewrite it. |
| `currentStepId` | Current approval-stage ID, null after termination. |
| `history` | Initial SUBMIT followed by append-only APPROVE/REJECT events. Each event has `actorId,action,comment,at,stepId`. |
| `routing` | Present only on schema-4 typed requests; the immutable selected route. Omitted otherwise. |

The server rechecks live active identity, assignment and applicable business ACLs. Renaming or deleting historical users does not rewrite saved IDs. Button visibility is not authorization; writes are checked server-side.

<!-- topic:business-models -->

## 9. Complete business-document schemas

Source: [BusinessDocument.java](../../examples/approval-domain/src/main/java/com/arcflow/approval/BusinessDocument.java). All fields listed for a business type or line are required. A blank-permitted explanation still requires a string, not omission/null. Unknown properties are rejected. The command-level optional decision comment is separate from these business fields.

### 9.1 Common rules

Every business has exact `type,businessId,title,reason`. References match `[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}` and are at most 128 characters. This applies to businessId and fields explicitly identified as references below. Titles are nonblank up to 120 UTF-16 units; reasons nonblank up to 2,000.

`leave`, `procurement` and `quoteDiscount` do **not** have documentVersion. All six scenario types require `documentVersion:1`. Supported currencies are only `CNY,USD,EUR,GBP,JPY`, without conversion. Dates must be real `YYYY-MM-DD` calendar dates; the six scenarios require years 0001–9999. Quote domain parsing uses Java LocalDate and additionally checks UTC validity on initial submission.

Seal use, receiving, payment and contract apply fixed Unicode White_Space/C0/BOM blank checks. Older types use Java `isBlank()` rules, which are not identical. Do not use invisible characters to satisfy required text. Text is trimmed where specified; invalid references are not automatically repaired by trimming. Expense-line description and travel title, reason and destination additionally reject text that becomes Java `isBlank()` after Java `trim()` removes leading/trailing U+0000–U+0020. This rejects NUL-only/C0-only input without treating NBSP or BOM as Java whitespace; it does not forbid every embedded control character.

### 9.2 `leave` — generic host

Complete fields: `type,businessId,title,reason,days`.

Days is an integer from 1 through 365 and businessId must be valid. Unlike legacy leave in §4.1, this is a typed `business` object; it cannot replace a legacy intent under the same key.

### 9.3 `procurement` — generic host

Complete fields: `type,businessId,title,reason,item,quantity,unitPrice,currency`.

- item: nonblank, at most 240 UTF-16 units.
- quantity: integer 1–100000.
- unitPrice: >0, ≤1000000000, at most two decimals; JPY must be numerically whole.
- Total is quantity × unitPrice. Input rejects a `total` property. The generic response does not add a total property; clients may calculate it with exact decimals.

### 9.4 `quoteDiscount` — CRM host

Complete fields: `type,businessId,title,reason,customerRef,quoteRevision,item,quantity,listUnitPrice,requestedUnitPrice,currency,validUntil`.

- customerRef: nonblank text up to 128 units, using text validation; quoteRevision ≥1.
- item, quantity, both prices and currency follow procurement bounds.
- requestedUnitPrice must be >0 and strictly below listUnitPrice.
- validUntil must be a real `YYYY-MM-DD` date; source-revision matching, expiry and ACL rules also apply (§3.3).

### 9.5 `expense` — oa-expense

Complete fields: `type,documentVersion,businessId,title,reason,costCenter,currency,lines`.

- costCenter: `ENGINEERING/SALES/OPERATIONS`; 1–20 lines.
- Every line requires `lineId,spentOn,category,description,amount,receiptRef`.
- lineId and receiptRef are references, each separately unique within this document. They do not reserve a receipt across requests.
- spentOn is a real date; category is `TRAVEL/MEALS/OFFICE/OTHER`; description is nonblank, at most 240 units.
- amount: >0, ≤1000000000, at most two decimals; whole JPY.
- Total is the sum of line amounts. Receipt references do not prove receipts exist or trigger retrieval/reimbursement/payment.

### 9.6 `travel` — oa-travel

Complete fields: `type,documentVersion,businessId,title,reason,destination,startDate,endDate,purpose,estimatedCost,currency,costCenter`.

- destination: nonblank, at most 160 units; costCenter: `ENGINEERING/SALES/OPERATIONS`.
- purpose: `CUSTOMER_VISIT/PROJECT_DELIVERY/TRAINING/CONFERENCE/OTHER`.
- startDate/endDate: real dates, spanning 1–90 days inclusive.
- estimatedCost: >0, ≤1000000000, at most two decimals; whole JPY.
- No lines, passenger details or live-booking endpoint are provided.

### 9.7 `sealUse` — oa-seal-use

Complete fields: `type,documentVersion,businessId,title,reason,documentName,documentRef,sealType,copyCount`.

- documentName: nonblank, at most 160 units; documentRef is a reference.
- sealType: `OFFICIAL/CONTRACT/FINANCE`; copyCount: integer 1–100.
- The HTTP submission endpoint requires `Content-Type: application/json` and valid UTF-8. The full raw submission JSON, including whitespace and escape syntax, is limited to 8,000,000 UTF-16 code units. Inputs exceeding 24,000,000 raw bytes are rejected before decoding; the decoded length is then checked. These failures return 400. This is not an attachment allowance or a limit on the entire saved store.
- A document reference does not mean a file has been uploaded or a seal applied. This API does not sign documents.

### 9.8 `receiving` — erp-receiving

Complete fields: `type,documentVersion,businessId,title,reason,purchaseOrderRef,warehouse,receivedOn,lines`.

- purchaseOrderRef is a reference; warehouse is `EAST/WEST`; receivedOn is a real date; 1–20 lines.
- Every line requires `lineId,orderLineRef,description,unit,ordered,received,accepted,rejected,exceptionReason`.
- lineId and orderLineRef are references, each separately unique in this document. Description is nonblank, at most 240 units.
- unit: `PCS/BOX`; ordered: integer 1–100000; received: 0–ordered; accepted/rejected: each 0–100000.
- `accepted + rejected == received`; at least one line must have received>0. These are not cumulative historical/cross-request balance checks.
- All four counts must be raw JSON integer tokens. `-0`, `1.0`, `1e0`, strings and null are rejected.
- exceptionReason is a required string up to 1,000 units. It must be nonblank when rejected>0; otherwise it may be `""`.
- The response supplies a per-unit summary, without currency, amounts or an additive mixed-unit total.

### 9.9 `paymentRequest` — erp-payment

Complete fields: `type,documentVersion,businessId,title,reason,supplierRef,currency,requestedPaymentOn,lines`.

- supplierRef is a reference; requestedPaymentOn is a real date; 1–20 lines.
- Every line requires `lineId,invoiceRef,description,invoiceAmount,previouslySettledAmount,allocationAmount,deductionAmount,deductionReason`.
- lineId/invoiceRef are references, each separately unique in this document; description is nonblank, at most 240 units.
- Each amount is ≤1000000000 with at most two decimals and whole JPY. invoiceAmount/allocationAmount are >0; previouslySettledAmount/deductionAmount are ≥0.
- `previouslySettledAmount <= invoiceAmount`.
- `allocationAmount <= invoiceAmount - previouslySettledAmount`.
- `deductionAmount <= allocationAmount`.
- deductionReason is a required string up to 1,000 units, nonblank for a positive deduction; otherwise it may be empty.
- Net total `sum(allocationAmount) - sum(deductionAmount)` must be >0.
- Summary: declaredOutstanding = Σ(invoiceAmount − previouslySettledAmount); grossAllocation = ΣallocationAmount; deductionTotal = ΣdeductionAmount; netTotal = grossAllocation − deductionTotal.
- Declared invoices and settled balances are synthetic inputs. This does not check bank balances, lock balances, reserve invoices across requests or make payments.

### 9.10 `contractApproval` — crm-contract

Complete fields: `type,documentVersion,businessId,title,reason,customerRef,contractRevision,contractCategory,currency,contractAmount,startOn,endOn,termsKind,deviationReason,documentRef,lines`.

- customerRef/documentRef are references; contractRevision is an integer ≥1; contractCategory is `PRODUCT/SERVICE`.
- contractAmount: >0, ≤1000000000, at most two decimals, whole JPY. startOn/endOn are real dates, with endOn not earlier than startOn.
- termsKind: `STANDARD/NONSTANDARD`; deviationReason is a required string up to 2,000 units. NONSTANDARD requires nonblank text. STANDARD requires it to be empty after trimming; put general remarks in reason.
- 1–20 lines, each requiring `lineId,milestoneRef,description,dueOn,amount,acceptanceCriteria`.
- lineId/milestoneRef are references, each separately unique within the document. Description is nonblank up to 240 units; acceptanceCriteria is nonblank up to 1,000.
- amount: >0, ≤1000000000, at most two decimals, whole JPY. Milestone amounts must sum exactly to contractAmount.
- dueOn dates must fall within the contract term and be nondecreasing in array order; same-day milestones are allowed.
- contractRevision is a declared field, not a quote-host-style source-revision lock. Approval does not sign/deliver a contract, create receivables or update CRM.

<!-- topic:errors -->

## 10. Errors and recovery

Controlled standalone errors use `{ "message":"…" }`, not a universal code/data envelope. Messages may be English or bilingual. Use HTTP status and context rather than treating English wording as stable machine error codes.

| HTTP | Typical implemented causes | Client response |
| --- | --- | --- |
| 400 | Invalid JSON/DTO/business fields; missing/invalid/forbidden key; unknown/repeated inbox query; currency/routing mismatch; self-review submission | Correct input; do not blindly rotate keys. |
| 401 | Missing/incorrect Basic authentication | Correct local credentials; do not assume an application login API. |
| 403 | Origin/client rejection; no publication permission; not assigned to that historical stage; inactive account; quote non-owner | Check host/configuration/authorization; do not bypass access checks. |
| 404 | Missing/invisible request, unknown scenario or unreadable quote revision | Check identity, host and ID; do not infer that a hidden resource exists. |
| 409 | Stale publication/submission version; reused key with different intent; terminal/noncurrent/opposite vote; concurrency contention; changed quote source/revision | Refresh process/history and reconcile the original intent. |
| 415 | Unsupported Content-Type, including seal submission without application/json | Use the correct media type. |
| 503 | Caught checked `IOException`; storage write or inbox I/O outcome not confirmed | Refresh and retry with the original key/intent; do not assume creation never happened. |

The standalone 503 message is `Storage unavailable; no change confirmed. Refresh before retrying.` It does not guarantee that nothing committed. Some read paths wrap I/O in `UncheckedIOException`, which this advice does not explicitly map. Unknown exceptions/error dispatch may be handled by Spring or the security chain. Do not assume all errors use the controlled envelope or all I/O failures are 503. Unimplemented paths/methods are not supported API operations.

<a id="ruoyi-native-host"></a>

<!-- topic:ruoyi -->

## 11. Native RuoYi adapter

Sources: [ArcFlowController.java](../../examples/ruoyi-vue3/backend/src/main/java/com/ruoyi/arcflow/ArcFlowController.java), [ArcFlowErrors.java](../../examples/ruoyi-vue3/backend/src/main/java/com/ruoyi/arcflow/ArcFlowErrors.java), [ArcFlowConfiguration.java](../../examples/ruoyi-vue3/backend/src/main/java/com/ruoyi/arcflow/ArcFlowConfiguration.java). See the [native integration README](../../examples/ruoyi-vue3/README.en.md) for setup, login and permissions.

| Method/path | Permission | Success HTTP/body |
| --- | --- | --- |
| GET `/arcflow/me` | `arcflow:request:read` | 200 `AjaxResult.data={id,displayName,canPublish}` |
| GET `/arcflow/people` | Same | 200 data=`Person[]` |
| GET `/arcflow/process` | Same | 200 data=`ProcessDefinition` |
| POST `/arcflow/process` | `arcflow:process:publish` | 200 data=next `ProcessDefinition` |
| GET `/arcflow/requests` | `arcflow:request:read` | 200 data=`Request[]` |
| GET `/arcflow/requests/inbox` | Same | 200 data=`InboxPage` |
| POST `/arcflow/requests` | `arcflow:request:submit` | **200** data=`Request`, unlike standalone 201 |
| POST `/arcflow/documents` | Same | **200** data=`Request`; leave/procurement only |
| POST `/arcflow/requests/{id}/decisions` | `arcflow:request:decide` | 200 data=`Request` |

A typical success envelope is `{ "code":200,"msg":"操作成功","data":… }`. Domain errors retain the actual HTTP status and use `AjaxResult.error(code,msg)`. Native authentication/permission failures belong to the host and are not guaranteed to look like standalone `{message}`. Do not infer business success for unrelated RuoYi APIs from HTTP 200 alone.

Important differences:

1. RuoYi owns login, JWT/Redis sessions, login CAPTCHA, roles and menus. The overlay adds no second Basic mechanism or login endpoint. Use its native request/token handling; do not send demo Basic credentials to `/arcflow`.
2. Actor IDs come from `SecurityUtils.getUserId()` as numeric **strings**, not login usernames. Accounts must be active and undeleted. Publish with real IDs returned by `/arcflow/people`, not alice/bob/carol.
3. The overlay does not add standalone X-Arcflow-Client/Origin requirements. Security behavior belongs to the configured RuoYi host. Frontend `/dev-api` and `/prod-api` prefixes are proxies, not this Controller's root path.
4. `@PreAuthorize` is the outer permission check; the shared domain still checks exact historical assignment. An administrator wildcard does not authorize voting for someone else. Native `/me` includes `canPublish`.
5. Strict decoding is scoped to ArcFlow endpoints, without replacing RuoYi's global ObjectMapper. Native DTOs do not have every standalone Bean Validation annotation; shared business/process/idempotency/state rules still apply. For example, malformed stage IDs are resolved against the domain request/stage and may not fail at the same earliest validation layer as standalone.
6. Both submission routes support the same optional key. Native keyed clients bypass only the host's short-window duplicate-submit interception so durable idempotency can resolve retries, not authentication or RBAC.
7. No `/arcflow/scenarios` or `/arcflow/crm` Controller exists. The overlay has no native six-scenario/schema-4 HTTP integration. Generic publication accepts schema 2/3 only.
8. Approval storage remains single-writer local JSON in this example. RuoYi's MySQL identity database does not imply JDBC approval storage or distributed business transactions.

<!-- topic:maintenance -->

## 12. Source index and change checklist

- Routes: [generic Controller](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/ApprovalController.java), [scenario Controller](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/ScenarioController.java), [quote Controller](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/QuoteDiscountController.java), [native Controller](../../examples/ruoyi-vue3/backend/src/main/java/com/ruoyi/arcflow/ArcFlowController.java)
- Authentication/transport: [SecurityConfig](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/SecurityConfig.java), [JsonConfig](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/JsonConfig.java), [application.properties](../../examples/approval-demo/backend/src/main/resources/application.properties)
- Domain: [ApprovalService](../../examples/approval-domain/src/main/java/com/arcflow/approval/ApprovalService.java), [BusinessDocument](../../examples/approval-domain/src/main/java/com/arcflow/approval/BusinessDocument.java), [ProcessDefinition](../../examples/approval-domain/src/main/java/com/arcflow/approval/ProcessDefinition.java), [InboxQuery](../../examples/approval-domain/src/main/java/com/arcflow/approval/InboxQuery.java)
- Specialized models: [ScenarioCatalog](../../examples/approval-domain/src/main/java/com/arcflow/approval/ScenarioCatalog.java), [ScenarioCase](../../examples/approval-domain/src/main/java/com/arcflow/approval/ScenarioCase.java), [QuoteDiscountCase](../../examples/approval-domain/src/main/java/com/arcflow/approval/QuoteDiscountCase.java), [ConditionalRouting](../../examples/approval-domain/src/main/java/com/arcflow/approval/ConditionalRouting.java)
- Detailed contracts: [idempotency](../SUBMISSION_IDEMPOTENCY.en.md), [member inbox](../MEMBER_INBOX.en.md), [business documents](../BUSINESS_DOCUMENTS.en.md), [conditional routing](../CONDITIONAL_ROUTING.en.md)

When changing an interface, update its Controller/DTO, domain validation, this reference, request examples and HTTP tests together. Record migrations and verification separately when changing form versions, persistence schemas or host integration. Documentation and examples are not claims of production readiness, deployment or acceptance across all hosts.

### 12.1 Contract and real-HTTP verification

From the repository root, run offline checks, then build and verify the real standalone host:

```sh
python3 scripts/check_api_contract.py
python3 scripts/verify_developer_docs.py
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml verify
python3 scripts/verify_api_examples.py \
  --jar examples/approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```

The offline check detects drift between Controller mappings, static OpenAPI contracts and examples. It does not replace real-host validation of numeric tokens, authorization or state transitions. The HTTP verifier starts its own temporary standalone host; it does not verify RuoYi login, MySQL, a live CRM or payment services. See the [executable examples](./examples/README.en.md) for the full scope and manual requests.
