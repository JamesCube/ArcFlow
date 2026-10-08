# Sequential approval demo backend

Local-only Spring Boot 3.5.16 / Java 17+ example. Spring Boot 3.5 has reached the end of open-source support; this requested Boot 3 baseline is **not a production recommendation**. Use an appropriately supported framework release and production security/persistence before deployment. Source: https://spring.io/blog/2026/06/25/spring-boot-3-5-16-available-now/

## Run

From the ArcFlow repository root, install the unchanged core and shared approval domain first:

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
export APPROVAL_ALICE_PASSWORD='replace-with-your-unique-alice-password'
export APPROVAL_BOB_PASSWORD='replace-with-your-unique-bob-password'
export APPROVAL_CAROL_PASSWORD='replace-with-your-unique-carol-password'
mvn -f examples/approval-demo/backend/pom.xml spring-boot:run
```

No default passwords. All three passwords must have at least 12 characters; startup fails otherwise. Set real unique values locally and do not commit them. Backend binds 127.0.0.1:8080, and the frontend's Vite development proxy forwards `/api`. Passwords are held in the browser's page memory only by the UI. Basic credentials are sent explicitly on each call. Use HTTPS for any non-loopback deployment (this demo should remain local).

`APPROVAL_DATA_FILE` defaults to `./data/requests.json` relative to the backend working directory; set an absolute path for predictable restarts. `APPROVAL_UI_ORIGIN` defaults to `http://localhost:5173`; set it to the exact frontend origin if using another port/hostname. No wildcard origins or CORS are enabled.

## Authentication and browser protection

Every endpoint requires HTTP Basic authentication. Demo identities are `alice`, `bob`, and `carol`. Only Alice may publish a process; Bob and Carol receive 403, including before publication-body parsing. Every actor comes from the authenticated principal. Only Bob and Carol may be assigned approval steps. Any user may submit if **none** of the steps assigns that user. This hard-coded editor/approver policy is not a production role system.

Every POST must include `Content-Type: application/json` and `X-Arcflow-Client: approval-demo`, as well as Authorization. Browser requests from foreign Origin / cross-site Fetch Metadata are rejected. The custom header prevents simple cross-origin forms from changing state even if a browser caches Basic credentials. No form login, cookie/session authentication, or Basic challenge dialog is used. Basic being stateless alone does not prevent CSRF: https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html

JSON is strict: unknown properties, duplicate keys, trailing content, fractional integers and scalar coercions are rejected. Do not include `applicantId`, an approver override, edges, layout, scripts, expressions or unsupported node attributes.

## HTTP contract

- `GET /api/me`: `{id, displayName}`
- `GET /api/people`: array of the three demo identities
- `GET /api/process`: the current executable published definition
- `POST /api/process`: `{expectedVersion, definition}`; Alice only; returns the newly published full definition (200)
- `GET /api/requests`: requests visible to the applicant or **any** assignee in each request's immutable definition
- `POST /api/requests`: `{title, reason, days, processVersion}`; starts from the exact current published version (201)
- `POST /api/documents`: `{business:{type,...}, processVersion}`; typed leave or procurement, using the same configured process and approval lifecycle (201)
- `POST /api/requests/{id}/decisions`: `{stepId, decision:"APPROVE"|"REJECT", comment?}`; authorizes the specified step against the request's saved definition

### Executable definition (schema 2, with schema-3 groups)

```json
{
  "schemaVersion": 2,
  "id": "leave-approval",
  "version": 1,
  "name": "Leave approval",
  "nodes": [
    {"id": "start", "type": "start", "name": "Submit leave", "assigneeId": null},
    {"id": "manager", "type": "approval", "name": "Designated approver", "assigneeId": "bob"},
    {"id": "end", "type": "end", "name": "Completed", "assigneeId": null}
  ]
}
```

Schema 3 also accepts `parallelApproval` nodes with `assigneeId: null`, `assigneeIds` containing distinct participants, and `completionMode: "ALL" | "ANY"`. This fixed-account host permits only Bob and Carol, so its groups contain both. The standalone Vue designer exposes these fields and participant-level votes. See the [parallel contract](../../../docs/PARALLEL_APPROVAL.md).

The array is the entire execution order: exactly one `start`, **1–8 approvals**, then exactly one `end`. Start/end IDs are fixed to `start`/`end` and cannot have assignees. Approval nodes require `bob` or `carol`. Repeating an approver across distinct steps is allowed; each step needs its own decision. Node IDs are unique and match `[A-Za-z][A-Za-z0-9_-]{0,63}`. Process/node names are nonblank, at most 120 characters, and contain no control characters. All definition/node properties shown above must be present, including nullable `assigneeId` on start/end.

Process ID is fixed to `leave-approval`. To publish, send a full definition with its `version` equal to `expectedVersion`, both equal to the current server version. The server validates it, increments the version and atomically saves it. Stale publication, even an identical retry, returns 409. A stale submission `processVersion` also returns 409; refresh and review before submitting again. Publishing does not modify any existing request.

A fresh store starts with the single-Bob-approval definition above. `src/main/resources/process.json` is the matching schema example. The live process comes from `ApprovalService` and persisted publication; editing that resource does not publish a process.

### Requests and transitions

Submission constraints: nonblank title (at most 120 characters), nonblank reason (at most 2000), integer days (1–365), positive current process version. Title/reason are validated and trimmed by the real ArcFlow DAG integration.

Response fields are `id,title,reason,days,applicantId,approverId,status,createdAt,updatedAt,decision,comment,processId,processVersion,history,definition,currentStepId`. The full `definition` is an immutable snapshot bound at submission. `status` is `PENDING`, `APPROVED`, or `REJECTED`. While pending, `currentStepId` identifies the current stage; `approverId` is the first undecided participant in definition order. For groups, derive the full pending worklist from saved participants minus that group’s history voters. It is not a complete group inbox field. At terminal states, `currentStepId` is null and `approverId` is the last deciding assignee. `decision`/`comment` are null before a decision, then represent the latest step decision, including while the request remains pending.

Ordered immutable history entries are `{actorId,action,comment,at,stepId}`. The first `SUBMIT` event has null `stepId`; each subsequent `APPROVE`/`REJECT` event identifies the exact approval node. Missing decision comments become empty strings; supplied comments are trimmed and limited to 2000 characters.

For a single-assignee step, APPROVE advances **one** step. Only the final approval makes the request APPROVED. REJECT on a current single-assignee step is terminal. ALL groups advance only after every participant approves and reject on any rejection. ANY groups advance on the first approval and reject only when all participants reject. Decision identity is `(requestId, stepId, authenticated actorId)`; one member’s replay cannot record or advance another member’s vote. A future-step attempt returns 409 even if the same person is assigned the current and future steps. A participant using someone else's step receives 403. An unrelated user receives 404 to conceal the request's existence.

A same-decision replay for an already decided step is authorized **before** the replay lookup against that step's saved assignee. It returns the **current request state**, adds no history, preserves the original step comment/time, and never advances another step. It may therefore include later decisions that were not in the original response. Opposite decisions return 409. Replays remain valid after later approvals/rejection and after restart. A new decision after a terminal state returns 409.

Errors use `{message}`. Validation errors return 400, authorization failures 401/403, missing or concealed requests 404, version/state conflicts 409, and storage failures 503. Submission accepts one optional `Idempotency-Key` header, using the authenticated applicant ID as its scope. Same key plus normalized title/reason, days and original process version returns the current original request (201); changed intent returns 409. Missing keys still create on each call. Keep the original key and payload after an uncertain response. See [submission semantics and migration](../../../docs/SUBMISSION_IDEMPOTENCY.md).

### Typed business documents

The additive `POST /api/documents` endpoint separates business fields from approval state. It accepts a required `business` object and positive current `processVersion`; it uses the same Basic principal, `X-Arcflow-Client`, optional `Idempotency-Key`, list endpoint and `/api/requests/{id}/decisions` endpoint described above. For example:

```json
{
  "business": {
    "type": "procurement",
    "businessId": "PO-001",
    "title": "Equipment",
    "reason": "New team member",
    "item": "Laptop",
    "quantity": 2,
    "unitPrice": 1299.50,
    "currency": "USD"
  },
  "processVersion": 1
}
```

The closed business types are `leave` (`businessId,title,reason,days`) and `procurement` (`businessId,title,reason,item,quantity,unitPrice,currency`). Every field is required. IDs match `[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}`. Title/reason retain the existing limits. Procurement requires a nonblank item up to 240 characters, integer quantity 1–100000, a positive numeric unit price no greater than 1000000000.00 with at most two decimal places, and `CNY`, `USD`, `EUR`, `GBP` or `JPY`; JPY requires a whole amount. Decimal strings, fractional/overflowing integers, missing/null values, unknown types/fields and duplicate JSON keys are rejected.

Typed responses append the immutable `business` object to the approval request. The top-level title/reason remain compatibility fields; typed leave also retains its days, while procurement uses top-level `days: 0`. Use `business.type` and its fields for business-aware presentation. The existing leave UI is unchanged. `/api/requests` keeps its original leave submission body, and legacy-created requests still omit `business` entirely. A key is scoped to the applicant across both submission endpoints: changing the business type, ID, any business field or original process version returns 409. Text and price representations are normalized before replay comparison.

The configured process is reused; a caller cannot select or deploy an arbitrary process through this endpoint. Typed requests upgrade the JSON snapshot to schema 5, preserving a byte-exact backup of the preceding schema on its first upgrade write. Upgrade the host and back up the data before adoption; older binaries cannot read schema 5. Business records and approval history remain immutable across decisions, replays and restart.

## Persistence, restart and schema-1 migration

JSON store mutations serialize on its store monitor, including publication, request creation and decision updates. The store takes a process-exclusive file lock and writes the published definition **and all requests** in one schema-2/3 JSON snapshot, or schema 4 with durable submission-key bindings through a same-directory temporary file, forced to disk before atomic replace. Unsupported atomic moves fail closed. New in-memory state is published only after replacement. Startup validates complete stored definitions, fields, actors, ordered step history, timestamps and derived request state. Corrupt, unsupported, extra-field or inconsistent snapshots fail startup without being rewritten. The lock prevents a second process from opening the same store on a supported local filesystem.

Existing schema-1 single-approval snapshots are explicitly validated and migrated in memory. Each request gets a one-step definition assigned to its original approver, so Bob and Carol legacy requests retain their own behavior. Original IDs, fields, decisions, actors, comments and timestamps are retained; decision events gain `stepId: "manager"`. Reading or replaying a prior decision does not rewrite the old file. The first mutation preserves the original bytes in `requests.json.schema1.bak` (or a unique `.schema1-*.bak` if that backup already exists), then writes the schema needed by the mutation (2/3, or 4 for a keyed creation). Existing backups are never overwritten/deleted. New named backups use owner-only read/write permissions on POSIX filesystems; other filesystems use inherited permissions. A failed mutation leaves the active file and in-memory state unchanged; a backup may already have been written. Keep backups under the same OS-account access restrictions as the data file. Do not alternate old/new binaries against this store: older backends cannot read later snapshots; schema-4 state requires the keyed-submission release. Existing schema-2/3 data also gets a byte-exact backup on its first keyed write, while request/event JSON and process-definition schemas remain unchanged.

This is a small **single-JVM/local-filesystem** demo, not a database: no distributed coordination, bounded retention, encryption at rest, secure multi-tenant audit, automated backup rotation, or directory fsync/power-loss guarantee. Network filesystems and multiple replicas are unsupported. OS/process crashes after rename can leave a committed action whose response was lost; same-step decisions and same-key/same-intent submissions reconcile through the saved state. Abrupt power loss may lose the latest directory entry. Do not store real personnel/health data. Restrict the local data directory to your OS account.

## Architecture and boundaries

`SubmissionWorkflow` calls the real dependency-free `ArcFlowEngine` with a synchronous `validate → normalize` DAG. The core is **unchanged**; human waits and durable instance state remain in this example-specific backend.

`ProcessDefinition` validates the small, executable sequential model. `ApprovalService` publishes it, snapshots it at submission and advances its ordered steps. There is no arbitrary graph deployment, BPMN, general parallel graph engine, expression execution, delegation, reassignment, cancellation, timers, enterprise identity provider, RuoYi integration or production audit store. Fixed ALL/ANY groups are stages in the ordered approval model. See [the sequential contract](../../../docs/SEQUENTIAL_APPROVAL.md).

## Verification

```sh
mvn -f examples/approval-demo/backend/pom.xml verify
```

Tests cover real Basic authentication, editor-only publication, strict JSON/definition validation, forged actor/approver rejection, browser-origin/client-header protection, version conflicts, all-assignee visibility, ordered and repeated-assignee steps, authorization before replay, immutable instance definitions, reject-terminal behavior, duplicate/opposite decision concurrency, optimistic concurrent publication, persistence-failure rollback, restart continuation, lossless schema-1 migration/byte-exact backup, second-writer refusal, and malformed saved-state refusal. Test credentials are test-only and never apply to a normal run.

## Reusable domain

The executable backend depends on `com.arcflow.examples:approval-domain`; it no longer owns approval persistence or transitions. `ApprovalConfiguration` supplies the demo actor directory and initial Bob process. Other hosts supply their own `ActorDirectory` and initial definition. The shared jar contains no application entry point or security filter.
