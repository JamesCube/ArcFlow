# Shared approval domain

<!-- Legacy fragments remain entry points after the language split. -->
<a id="bounded-member-inbox"></a>
<a id="business-document-boundary--业务单据边界"></a>
<a id="explicit-snapshot-compatibility"></a>
<a id="host-contract"></a>
<a id="identity-lifecycle-and-authorization"></a>
<a id="reusable-approval-domain"></a>
<a id="synthetic-seal-use-scenario--合成用印申请"></a>

[简体中文](README.md)


<!-- topic:scope -->
`com.arcflow.examples:approval-domain:0.1.0-SNAPSHOT` is a Java 17 library for human review, versioned processes, participants, immutable business documents and `ApprovalStore` persistence. It has no server entry point, authentication filter or demo accounts. The core runs synchronous validation DAGs; this module owns the human-review lifecycle.

Current source supports nine business types and six dedicated scenarios. Registering a type does not expose it through generic HTTP routes. See [architecture](../../docs/development/ARCHITECTURE.en.md) and [business documents](../../docs/BUSINESS_DOCUMENTS.en.md).

<!-- topic:install -->
## Install and wire a host

From the repository root:

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
```

For JSON, construct `ApprovalService(ObjectMapper, String filename, ActorDirectory, ProcessDefinition initialDefinition)` and call `close()` on shutdown; Spring hosts can use `@Bean(destroyMethod = "close")`. Database hosts use `ApprovalService(ApprovalStore, ActorDirectory)` with the optional [JDBC adapter](../approval-jdbc/README.en.md), which is never installed automatically.

Each service binds to one stable process ID matching `[A-Za-z][A-Za-z0-9_-]{0,127}`. The initial definition applies only to a new store with no versioned snapshot. Publication cannot rename the process. Definitions contain start, 1–8 ordered approval stages and end: schema 2 has single reviewers, 3 adds ALL/ANY groups of 2–16 participants, and 4 adds restricted conditions only in expense, payment, receiving and contract hosts. Generic and quote hosts reject schema 4.

The service owns the store; the host owns its `DataSource`. Stop accepting requests and drain work before closing the service and pool. JDBC closure prevents new operations but does not cancel transactions already in progress.

<!-- topic:identity -->
## Identity and authorization

A thread-safe `ActorDirectory` provides:

- `findActive(id)`: active, non-deleted users keyed by immutable host ID.
- `listActive()`: the active directory the host allows for assignee selection.
- `canPublish(id)`: current publication permission.
- `canAssignApproval(id)`: active membership by default, with an override for stricter assignment policy.

Resolve every actor argument from authenticated server-side identity, never a request body. Hosts own endpoint authentication, permissions and error formats. Apply `ApprovalService.strictMapper` to a dedicated ObjectMapper before decoding typed requests to retain exact numbers and strict field validation.

Publication, submission and decisions recheck the actor. Publication and new submission also check every assignment. Same-key retries use the existing request without requiring old assignments to remain eligible for a new process. Snapshot restoration validates identity and history structure without consulting live membership; deleting an account must not make history unreadable. Administrators have no participant bypass. An applicant appearing anywhere in the full definition cannot submit, even if a condition would skip that stage.

List and decision paths recheck identity after storage reads. This is bounded reauthorization, not an atomic identity-directory/database transaction; hosts requiring revocation at commit must coordinate that boundary.

<!-- topic:persistence -->
## Persistence and retries

- Default JSON storage uses an exclusive local lock, serialized transitions, atomic replacement and byte-exact pre-upgrade backups. It supports one local writer.
- Readers accept wrappers 1–13. Definition schemas, file wrappers and SQL revisions are separate version systems. Follow [persistence and migration](../../docs/development/PERSISTENCE.en.md) for the matrix, rollout and rollback limits.
- Keyed submissions atomically bind applicant, key and immutable intent. Equal intent returns the current original request; changed intent conflicts. Without a key, every call creates a request. Unsupported third-party stores fail explicitly.
- Decision retries reload and reauthorize the exact stage, preventing duplicate history or accidental progress to a later stage. The internal revision is `history.size() - 1`; it is not an HTTP response field.
- `process()` and `list()` wrap read failures in `UncheckedIOException`; methods declaring `IOException` retain that contract. Hosts must return a generic server failure, never an empty list or false success. Reads fail after closure.

Neither adapter provides tenancy, business-system transactions, automatic notifications or production operations. Seal review never stamps or fetches files; payment does not transfer money, contracts are not signed, and receiving does not post stock.

<!-- topic:inbox -->
## Member inbox

`inbox(actor, box, limit, status, processVersion, cursor)` provides request-level paging. PENDING includes every eligible, unvoted member of the current stage; HANDLED requires a saved decision event. A request can appear in both. The default limit is 25, maximum 100, with immutable creation-time/ID order and actor/filter-bound cursors. `list(actor)` retains its existing semantics. The compatibility `approverId` field is neither group authorization nor a complete inbox membership list.

<!-- topic:verify -->
## Verify and extend

```sh
mvn -f examples/approval-domain/pom.xml verify
```

After changing the domain, reinstall it and verify both hosts, default JSON, optional JDBC and affected clients. Prototype or individual-scenario results do not establish acceptance of the integrated source.

Continue with [architecture and extension](../../docs/development/ARCHITECTURE.en.md), [API reference](../../docs/api/API_REFERENCE.en.md), [member inbox](../../docs/MEMBER_INBOX.en.md), [restricted conditions](../../docs/CONDITIONAL_ROUTING.en.md) and [submission idempotency](../../docs/SUBMISSION_IDEMPOTENCY.en.md).
