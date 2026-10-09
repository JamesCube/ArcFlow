# Reusable approval domain

[Developer architecture / 开发架构](../../docs/development/ARCHITECTURE.md) · [Persistence and migration / 存储迁移](../../docs/development/PERSISTENCE.md) · [API reference / 接口参考](../../docs/api/API_REFERENCE.md)

`com.arcflow.examples:approval-domain:0.1.0-SNAPSHOT` is a Java 17 library for approval stages, participant groups and persistence through `ApprovalStore`. ArcFlow’s core runs the submission validation/normalization DAG. This module handles the human decisions that follow. It has no Spring Boot entry point, authentication filter or demo users. The default store is still single-process JSON; [approval-jdbc](../approval-jdbc/README.md) provides an optional transactional database adapter.

Install the core first, then this module:

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
```

## Host contract

Create `ApprovalService(ObjectMapper, String filename, ActorDirectory, ProcessDefinition initialDefinition)` and call `close()` when the host shuts down. In Spring, `@Bean(destroyMethod = "close")` handles this. Give each deployment its own data file. The initial definition is used only when no versioned snapshot exists; `ProcessDefinition.legacy(assigneeId)` constructs the supported one-step leave definition. Each service/store is bound to one process ID matching `[A-Za-z][A-Za-z0-9_-]{0,127}`; an existing JSON file must belong to that ID. The demos keep `leave-approval`. Publication cannot rename the configured process. Definitions have an ordered start → 1–8 approval stages → end structure. Schema 2 keeps single-assignee sequential stages; schema 3 adds `ALL`/`ANY` groups of 2–16 participants. Schema 4 adds restricted frozen routing only for payment, receiving and contract document hosts; generic and quote publication do not accept it. See the [group semantics and rollout contract](../../docs/PARALLEL_APPROVAL.md).

For database persistence, construct `ApprovalService(ApprovalStore, ActorDirectory)` with the optional JDBC adapter. This overload does not change the host controllers or request/response records. The service owns the store lifecycle; a host-provided `DataSource` remains host-owned. Stores provide live reads and atomic version-checked publication, creation and decision updates. A request's revision equals its number of decisions (`history.size() - 1`). Failed revision checks reload and reauthorize the exact step before returning an idempotent replay or a conflict. Use the optional `submit(..., key)` overload to retry submissions with a durable key scoped to the applicant. Stores atomically bind the key to the new request; unsupported third-party stores fail explicitly. Without a key, each submission creates a separate request. See the [submission contract and migration boundary](../../docs/SUBMISSION_IDEMPOTENCY.md).

Methods that already declared `IOException` retain that contract. `process()` and `list()` wrap persistence read failures in `UncheckedIOException`; hosts should map these to a generic server error, never an empty list or stale success. Closed-store reads fail. JDBC closure prevents new operations but allows already-started transactions to finish; shut down request handling before closing.

Implement a thread-safe `ActorDirectory` for concurrent hosts:

- `findActive(String id)` returns only currently active, non-deleted identities, keyed by immutable host user ID, never display name.
- `listActive()` returns the host's permitted active identity directory for assignee selection.
- `canPublish(String id)` checks current host publication permission.
- `canAssignApproval(String id)` defaults to active membership; override for a narrower approver policy.

Use authenticated server-side identity for every service actor argument; never trust an actor in request JSON. Hosts own endpoint authentication/authorization and map `ResponseStatusException` to their API error format. Its Spring Web dependency is for these status-bearing exceptions, not for installed web routes. Call `ApprovalService.strictMapper` on a dedicated mapper before decoding typed requests. It preserves exact decimal values before strict field validation; the JSON/JDBC stores and HTTP hosts already use it.

## Identity lifecycle and authorization

Publishing, submitting and deciding each recheck that the acting user is active. Publication and new submissions also check every assigned approver. A keyed retry of an existing submission uses its saved request without rechecking whether its old assignments are eligible for a new process. Snapshot restoration validates IDs and history structurally, without consulting live directory membership: deletion or disabling must not make valid historical data unreadable. Inactive users cannot make decisions, including retries. A publisher can replace inactive future routing by publishing a new process; old requests retain their own exact definition and assignment. Reassignment and administrator overrides are not supported. Administrators must be the specific assigned approver to decide, and submissions assigning the applicant anywhere are rejected.

Legacy list reads and every decision reload also recheck the acting identity after storage returns, matching the inbox read boundary. If the directory reports deactivation during that read, the service rejects the operation before releasing the result or attempting a decision write, including an idempotent replay and the final retry observation. This is a bounded reauthorization check, not an atomic identity/storage transaction: a later revocation can still race with response delivery or a write already authorized or in progress. Hosts needing strict revocation at commit must coordinate their identity and transaction boundaries; this domain does not provide that guarantee.

The default `JsonApprovalStore` uses a process-exclusive file lock, serialized transitions, atomic replacement, byte-exact immediately-preupgrade backups for compatible schema-1 through schema-12 data and strict history replay. Use it only with one process and a local filesystem. The optional JDBC module has separate schema, transaction and scaling boundaries. Neither adapter provides tenant isolation or all the features needed for a production workflow service. Avoid exposing the store file or active user directory beyond the host's authorization scope.

The standalone Vue/HTTP and native RuoYi hosts support schema 3. Schema-3 hosts must use `ApprovalService.pendingApproverIds(request)` or derive the equivalent unvoted membership from the snapshotted current stage and history; the legacy `approverId` field names only one participant. Do not use it as group authorization or a full inbox filter.

## Business document boundary / 业务单据边界

Current `main` supports nine explicit immutable types: leave, procurement,
quoteDiscount, expense, travel, sealUse, receiving, paymentRequest and contractApproval, through the shared approval lifecycle.
The strict reader accepts JSON wrappers 1–13; minimum typed wrappers are 5 for leave and
procurement, 6 for quotes, 7 for Expense, 8 for Travel, 9 for Seal-use and 10 for Receiving, 11 for Payment and 12 for Contract.
Writes use a monotonic maximum; valid higher wrappers can hold lower-minimum types. Reads
never force files to the maximum wrapper. Legacy fields and process definitions (schema 2/3) keep their existing behavior. Definition schema 4 and frozen routes require wrapper 13, including publication without requests.
Unknown types/versions and invalid type-wrapper combinations remain rejected.

Type registration does not open generic hosts to every type. Generic standalone/native
HTTP still accepts only leave/procurement; CRM and all six compiled scenarios retain
separate exact-type/process/authorization boundaries. Expense and Travel views contain
`{request,total:string}`; Seal views `{request,total:null}`; Receiving alone adds its
unit-grouped `summary`. Restricted typed conditions are available only for payment, receiving and contract; no arbitrary expression or arbitrary-field form engine is provided.
See [business-document contract](../../docs/BUSINESS_DOCUMENTS.md) and
[combined integration history](../../docs/UNIFIED_SCENARIO_INTEGRATION.md).

## Bounded member inbox

`ApprovalService.inbox(actor, box, limit, status, processVersion, cursor)` is an additive authenticated request-level inbox. `PENDING` includes every current unvoted ALL/ANY participant; `HANDLED` includes only actors with actual decision events and may overlap pending in a later stage. The default limit is 25, maximum 100. Results use immutable creation-time/ID keyset order and actor/filter-bound cursors. Existing `list(actor)` remains unchanged. Unsupported third-party store adapters fail explicitly instead of replaying their full list. See the [complete contract and verification boundaries](../../docs/MEMBER_INBOX.md).

## Synthetic Seal-use scenario / 合成用印申请

The compiled ScenarioCatalog.sealUse(managerId, financeId) registers the oa-seal-use
process with documentReview and sealReview steps. Its version-1 BusinessDocument.SealUse
contains the business reference, title, business purpose (reason), document name, inert
document reference, synthetic OFFICIAL/CONTRACT/FINANCE category and 1–100 copies.
This is review state only: it does not apply a seal, sign, upload or fetch a document.
The current template DTO is unchanged: seven required visible fields, an integer count
widget with raw-input maxLength 16, and null lineItems. ScenarioCase.View.total
is explicitly null for Seal; Expense retains its exact monetary string.

Seal text lengths are checked before normalization in UTF-16 units (title 120, reason 2,000,
document name 160). Only edge U+0000–U+0020 is trimmed. Values consisting entirely of C0,
the fixed Unicode White_Space set and/or U+FEFF are invalid. References and categories are
never trimmed or case-folded. The strict mapper rejects unknown/missing fields, duplicate
JSON keys, trailing tokens, scalar coercions and floating-point count/version tokens.
Typed data is validated before submission and canonicalized before immutable snapshotting.
All normalized fields and the original process ID/version participate in applicant-scoped
idempotency. A changed intent conflicts; a same-intent retry returns the current durable
request, including after a decision or restart. References do not impose uniqueness.

### Explicit snapshot compatibility

The current reader supports JSON wrappers **1–13**, including valid Travel/schema-8 and
Seal/schema-9 data. Seal requires at least 9 and remains valid at 10; Receiving requires at
least 10. Every type retains strict wire name, exact Java record, field and version validation.
Unknown/future types, noninteger/overflow wrappers and wrappers above 13 fail closed. Wrapper 13 additionally retains published schema-4 definitions and validates frozen routes against their immutable business snapshots. See the [current storage matrix](../../docs/development/PERSISTENCE.md).

Compatible files are read without rewriting or touching backups. Every actual upgrade
retains the byte-exact immediately preceding snapshot before atomic replacement, including
same-session changes. Existing backups are preserved on collision. Failed replacement
publishes neither requests nor submission keys; later writes never lower the schema.
Historical backup restore loses later changes and is not a lossless downgrade. Deploy
unified readers everywhere and stop incompatible writers before new scenario writes.
SQL revision 3 and already-ready member indexes require no DDL or rebuild for these types.

Seal's tests retain the 65 reviewed data-only contract vectors without a prototype runtime
dependency. The combined suite must additionally cover legal 8/9/10 reads, each type's lower
schema rejection, all three new-type write orders, exact upgrade backups, strict Receiving
raw negative-zero decoding, failures/restart, authorization and scenario isolation. Existing
single-candidate reports do not establish that this integrated source passed those gates.

The payment and contract extension has dedicated exact-decimal allocation/milestone models and stores. See [complete model and migration contract](../../docs/PAYMENT_CONTRACT_SCENARIOS.md). Payment adds its typed `paymentSummary` response; the other five envelopes retain their scenario-specific shape.
