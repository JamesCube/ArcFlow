# Reusable approval domain

`com.arcflow.examples:approval-domain:0.1.0-SNAPSHOT` is a Java 17 library for approval stages, participant groups and persistence through `ApprovalStore`. ArcFlow’s core runs the submission validation/normalization DAG. This module handles the human decisions that follow. It has no Spring Boot entry point, authentication filter or demo users. The default store is still single-process JSON; [approval-jdbc](../approval-jdbc/README.md) provides an optional transactional database adapter.

Install the core first, then this module:

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
```

## Host contract

Create `ApprovalService(ObjectMapper, String filename, ActorDirectory, ProcessDefinition initialDefinition)` and call `close()` when the host shuts down. In Spring, `@Bean(destroyMethod = "close")` handles this. Give each deployment its own data file. The initial definition is used only when no schema-2/schema-3/schema-4 snapshot exists; `ProcessDefinition.legacy(assigneeId)` constructs the supported one-step leave definition. The process ID must be `leave-approval`, with an ordered start → 1–8 approval stages → end structure. Schema 2 keeps single-assignee sequential stages; schema 3 adds `ALL`/`ANY` groups of 2–16 participants. See the [group semantics and rollout contract](../../docs/PARALLEL_APPROVAL.md).

For database persistence, construct `ApprovalService(ApprovalStore, ActorDirectory)` with the optional JDBC adapter. This overload does not change the host controllers or request/response records. The service owns the store lifecycle; a host-provided `DataSource` remains host-owned. Stores provide live reads and atomic version-checked publication, creation and decision updates. A request's revision equals its number of decisions (`history.size() - 1`). Failed revision checks reload and reauthorize the exact step before returning an idempotent replay or a conflict. Use the optional `submit(..., key)` overload to retry submissions with a durable key scoped to the applicant. Stores atomically bind the key to the new request; unsupported third-party stores fail explicitly. Without a key, each submission creates a separate request. See the [submission contract and migration boundary](../../docs/SUBMISSION_IDEMPOTENCY.md).

Methods that already declared `IOException` retain that contract. `process()` and `list()` wrap persistence read failures in `UncheckedIOException`; hosts should map these to a generic server error, never an empty list or stale success. Closed-store reads fail. JDBC closure prevents new operations but allows already-started transactions to finish; shut down request handling before closing.

Implement a thread-safe `ActorDirectory` for concurrent hosts:

- `findActive(String id)` returns only currently active, non-deleted identities, keyed by immutable host user ID, never display name.
- `listActive()` returns the host's permitted active identity directory for assignee selection.
- `canPublish(String id)` checks current host publication permission.
- `canAssignApproval(String id)` defaults to active membership; override for a narrower approver policy.

Use authenticated server-side identity for every service actor argument; never trust an actor in request JSON. Hosts own endpoint authentication/authorization and map `ResponseStatusException` to their API error format. Its Spring Web dependency is for these status-bearing exceptions, not for installed web routes. Call `ApprovalService.strictMapper` on a dedicated mapper or decoder to preserve strict request decoding; the store always makes a strict private mapper copy.

## Identity lifecycle and authorization

Publishing, submitting and deciding each recheck that the acting user is active. Publication and new submissions also check every assigned approver. A keyed retry of an existing submission uses its saved request without rechecking whether its old assignments are eligible for a new process. Snapshot restoration validates IDs and history structurally, without consulting live directory membership: deletion or disabling must not make valid historical data unreadable. Inactive users cannot make decisions, including retries. A publisher can replace inactive future routing by publishing a new process; old requests retain their own exact definition and assignment. Reassignment and administrator overrides are not supported. Administrators must be the specific assigned approver to decide, and submissions assigning the applicant anywhere are rejected.

The default `JsonApprovalStore` uses a process-exclusive file lock, serialized transitions, atomic replacement, migration backups for schema-1/schema-2/schema-3 data and strict history replay. Use it only with one process and a local filesystem. The optional JDBC module has separate schema, transaction and scaling boundaries. Neither adapter provides tenant isolation or all the features needed for a production workflow service. Avoid exposing the store file or active user directory beyond the host's authorization scope.

The standalone Vue/HTTP and native RuoYi hosts support schema 3. Schema-3 hosts must use `ApprovalService.pendingApproverIds(request)` or derive the equivalent unvoted membership from the snapshotted current stage and history; the legacy `approverId` field names only one participant. Do not use it as group authorization or a full inbox filter.
