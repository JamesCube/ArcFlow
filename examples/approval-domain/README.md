# Reusable approval domain

Plain Java 17 jar, `com.arcflow.examples:approval-domain:0.1.0-SNAPSHOT`. It has no executable Spring Boot entry point, authentication filter or demo users. The unchanged ArcFlow core performs the submission validation/normalization DAG; this module owns human approval sequencing and the `ApprovalStore` persistence boundary. The backward-compatible default is the single-process JSON store; [approval-jdbc](../approval-jdbc/README.md) supplies an optional transactional database adapter.

Install the core first, then this module:

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
```

## Host contract

Construct `ApprovalService(ObjectMapper, String filename, ActorDirectory, ProcessDefinition initialDefinition)`. Own its lifecycle and call `close()` (a Spring `@Bean(destroyMethod = "close")` works). Give each deployment its own data file. The supplied initial definition is used only when there is no schema-2 snapshot; `ProcessDefinition.legacy(assigneeId)` constructs the supported one-step leave definition. Process IDs remain `leave-approval` and supported structure remains a linear start → 1–8 approvals → end.

For database persistence, construct `ApprovalService(ApprovalStore, ActorDirectory)` with the optional JDBC adapter. This overload does not change the host controllers or request/response records. The service owns the store lifecycle; a host-provided `DataSource` remains host-owned. Stores provide live reads and atomic version-checked publication, creation and decision updates. A request's revision equals its number of decisions (`history.size() - 1`). Failed revision checks reload and reauthorize the exact step before returning an idempotent replay or a conflict. Request creation itself has no client idempotency key: retrying a submission can create a second request.

Methods that already declared `IOException` retain that contract. `process()` and `list()` wrap persistence read failures in `UncheckedIOException`; hosts should map these to a generic server error, never an empty list or stale success. Closed-store reads fail. JDBC closure prevents new operations but allows already-started transactions to finish; shut down request handling before closing.

Implement a thread-safe `ActorDirectory` for concurrent hosts:

- `findActive(String id)` returns only currently active, non-deleted identities, keyed by immutable host user ID, never display name.
- `listActive()` returns the host's permitted active identity directory for assignee selection.
- `canPublish(String id)` checks current host publication permission.
- `canAssignApproval(String id)` defaults to active membership; override for a narrower approver policy.

Use authenticated server-side identity for every service actor argument; never trust an actor in request JSON. Hosts own endpoint authentication/authorization and map `ResponseStatusException` to their API error format. Its Spring Web dependency is for these status-bearing exceptions, not for installed web routes. Call `ApprovalService.strictMapper` on a dedicated mapper or decoder to preserve strict request decoding; the store always makes a strict private mapper copy.

## Identity lifecycle and authorization

Publication, submission and decision recheck that the acting user is active. Publication and submission also recheck every assigned approver. Snapshot restoration validates IDs and history structurally, without consulting live directory membership: deletion or disabling must not make valid historical data unreadable. Inactive users cannot make decisions, including retries. A publisher can replace inactive future routing by publishing a new process; old requests retain their own exact definition and assignment. There is intentionally no reassignment or administrator override. Administrators must be the specific assigned approver to decide, and submissions assigning the applicant anywhere are rejected.

The default `JsonApprovalStore` remains a local demonstration store: process-exclusive file lock, serialized transitions, atomic replace, schema-1 migration backup and strict history replay. Use it only with one process and a local filesystem. The optional JDBC module has separate schema, transaction and scaling boundaries. Neither adapter provides tenant isolation or a general production workflow platform. Avoid exposing the store file or active user directory beyond the host's authorization scope.
