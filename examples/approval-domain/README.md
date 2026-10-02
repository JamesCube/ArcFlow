# Reusable approval domain

Plain Java 17 jar, `com.arcflow.examples:approval-domain:0.1.0-SNAPSHOT`. It has no executable Spring Boot entry point, authentication filter or demo users. The unchanged ArcFlow core performs the submission validation/normalization DAG; this module owns human approval sequencing and the single-process JSON store.

Install the core first, then this module:

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
```

## Host contract

Construct `ApprovalService(ObjectMapper, String filename, ActorDirectory, ProcessDefinition initialDefinition)`. Own its lifecycle and call `close()` (a Spring `@Bean(destroyMethod = "close")` works). Give each deployment its own data file. The supplied initial definition is used only when there is no schema-2 snapshot; `ProcessDefinition.legacy(assigneeId)` constructs the supported one-step leave definition. Process IDs remain `leave-approval` and supported structure remains a linear start → 1–8 approvals → end.

Implement `ActorDirectory`:

- `findActive(String id)` returns only currently active, non-deleted identities, keyed by immutable host user ID, never display name.
- `listActive()` returns the host's permitted active identity directory for assignee selection.
- `canPublish(String id)` checks current host publication permission.
- `canAssignApproval(String id)` defaults to active membership; override for a narrower approver policy.

Use authenticated server-side identity for every service actor argument; never trust an actor in request JSON. Hosts own endpoint authentication/authorization and map `ResponseStatusException` to their API error format. Its Spring Web dependency is for these status-bearing exceptions, not for installed web routes. Call `ApprovalService.strictMapper` on a dedicated mapper or decoder to preserve strict request decoding; the store always makes a strict private mapper copy.

## Identity lifecycle and authorization

Publication, submission and decision recheck that the acting user is active. Publication and submission also recheck every assigned approver. Snapshot restoration validates IDs and history structurally, without consulting live directory membership: deletion or disabling must not make valid historical data unreadable. Inactive users cannot make decisions, including retries. A publisher can replace inactive future routing by publishing a new process; old requests retain their own exact definition and assignment. There is intentionally no reassignment or administrator override. Administrators must be the specific assigned approver to decide, and submissions assigning the applicant anywhere are rejected.

This remains a local demonstration store: process-exclusive file lock, serialized transitions, atomic replace, schema-1 migration backup and strict history replay. It is not a multi-instance database or production workflow persistence implementation. Avoid exposing the store file or active user directory beyond the host's authorization scope.
