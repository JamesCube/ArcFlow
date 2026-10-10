# Optional JDBC persistence

<!-- Legacy fragments remain entry points after the language split. -->
<a id="boundaries"></a>
<a id="bounded-member-inbox-and-explicit-sql-revision-3-upgrade"></a>
<a id="build-and-verify"></a>
<a id="durable-submission-retries-and-revision-2-upgrade"></a>
<a id="explicit-schema-installation"></a>
<a id="host-integration"></a>
<a id="mysql-8-integration-target"></a>
<a id="optional-jdbc-approval-persistence"></a>
<a id="parallel-group-schema-compatibility"></a>
<a id="primary-references"></a>
<a id="process-isolation-in-revision-3"></a>
<a id="transactions-concurrency-and-failures"></a>

[简体中文](README.md)


<!-- topic:scope -->
Applies to current `approval-jdbc:0.1.0-SNAPSHOT`. This `ApprovalStore` implementation uses JDK JDBC, the shared domain and Jackson, without Spring JDBC or an ORM. Hosts supply drivers, pools, credentials and migrations. Existing demos remain on JSON unless explicitly wired to this adapter.

The constructor recognizes H2, PostgreSQL and the experimental MySQL 8 target, rejecting other products. MySQL requires at least 8.0.17; 5.7, MariaDB, 9.x, non-InnoDB and vendor forks are outside the target. Use exact-commit integration CI to establish actual server-version acceptance.

<!-- topic:build -->
## Build and test

From the repository root with a full JDK 17+ and Maven:

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-jdbc/pom.xml verify
```

Default checks use real H2 connections and the shared contract. PostgreSQL/MySQL tests skip when their environment URLs are absent; a skip is not a pass. Run actual server tests only against disposable databases:

```sh
export ARCFLOW_PG_URL=jdbc:postgresql://localhost:5432/arcflow_test
export ARCFLOW_PG_USER=arcflow_test
mvn -f examples/approval-jdbc/pom.xml -Dtest=PostgresqlApprovalStoreTest verify

export ARCFLOW_MYSQL_URL='jdbc:mysql://localhost:3306/arcflow_test?sslMode=VERIFY_IDENTITY'
export ARCFLOW_MYSQL_USER=arcflow_test
mvn -f examples/approval-jdbc/pom.xml -Dtest=MysqlApprovalStoreTest verify
```

Supply matching passwords through the secured test environment, never source control. PostgreSQL creates and removes unique schemas. MySQL creates UUID-named databases, verifies the selected catalog and removes only databases it created. Use a dedicated test identity, never production. Configurations such as MySQL `databaseTerm=SCHEMA` that defeat catalog selection fail closed.

<!-- topic:schema -->
## Install the schema and grant access

Choose one `src/main/resources/com/arcflow/approval/jdbc/schema-*.sql` through the host migration system: `schema-h2.sql`, `schema-postgresql.sql` or `schema-mysql.sql`. These are empty-installation scripts, not upgrades or JSON imports. The constructor performs no DDL and rejects absent tables, unready member projections and known unsafe MySQL structures.

SQL revision 3 is separate from process-definition schemas and JSON wrappers. Its seven tables are:

| Table | Purpose |
| --- | --- |
| `arc_process_version` | Immutable definitions, publisher and time; initialization actor `bootstrap` |
| `arc_process_head` | Active version and shared publication/submission lock |
| `arc_request` | Request JSON and normalized revision, process, status and time |
| `arc_request_event` | Append-only history; index 0 is SUBMIT |
| `arc_submission_key` | Schema-global applicant/key binding to one request |
| `arc_request_member` | Exact membership and pending/handled projection, including process ID |
| `arc_member_projection_state` | Readiness and resumable backfill checkpoint |

The application role needs SELECT/INSERT on versions, events and keys; SELECT/INSERT/UPDATE on heads, requests and members; and SELECT on migration state. Keep DDL, deletion and repairs under a separate operator identity. Backfill also needs member/state updates. Database owners can still rewrite data; these checks are not cryptographic tamper evidence.

MySQL uses InnoDB, DYNAMIC rows, exact NO PAD comparison through `utf8mb4_0900_bin`, and LONGTEXT JSON. Older PAD SPACE collations, TEXT limits or other comparison rules are not equivalent. Hosts own strict SQL mode, TLS, timeouts, capacity, `max_allowed_packet` and backups.

<!-- topic:migration -->
## Upgrade to revision 3

1. Stop and drain every old/new reader and writer, back up, and prepare a migration identity. Mixed application binaries are unsupported.
2. From revision 1, first apply the matching `upgrade-*-v1-to-v2.sql`; from revision 2, apply one database-specific `upgrade-*-v2-to-v3.sql`. MySQL DDL implicitly commits and must stay outside approval transactions.
3. Explicitly call `JdbcApprovalStore.backfillMembers(dataSource, objectMapper, batchSize)`, with batchSize 1–100. Each call handles one chunk and returns `BackfillProgress(processed, ready, lastRequestId)`; repeat while ready is false.
4. Backfill validates saved requests, history and definitions, committing members and checkpoint atomically. Failed chunks roll back and can be retried. Keep writers stopped and do not edit migration state. The last chunk checks missing coverage before setting ready=true.
5. Deploy matching domain/JDBC/host code before reopening traffic. Backfill after readiness is a no-op. An earlier draft projection is not a genuine revision-2 installation: do not rerun the upgrade over it. Use a fresh test database or a separately reviewed data migration.

The constructor neither backfills nor secretly walks history. Fresh-install scripts mark readiness only for an empty database. Migration does not rewrite historical JSON, audit or key mappings. Restoring an old backup loses later activity; it is not a lossless downgrade. New business types and schema 4 still require compatible application readers even when SQL tables are unchanged.

<!-- topic:integration -->
## Wire the host and respect transaction boundaries

```java
var store = new JdbcApprovalStore(dataSource, objectMapper, initialDefinition);
var service = new ApprovalService(store, actorDirectory);
```

Use `com.arcflow.approval.jdbc.JdbcApprovalStore`; domain types remain in `com.arcflow.approval`. Each adapter permanently binds to initialDefinition.id; one schema can hold several processes. Initialization applies only without an active head, and concurrent initializers converge on the first committed definition. Ordinary reads, publication and writes are process-scoped; this is not tenancy.

- Each operation borrows an independent connection initially in auto-commit mode, owns its transaction and restores settings. Do not supply a shared connection or transaction-aware proxy. The adapter does not join Spring `@Transactional`, XA or business-table transactions.
- Writes use READ_COMMITTED. Publication/submission lock the process head. Decisions lock the request, enforce append-one history and compare revisions; state, audit and members commit together or roll back.
- Reads use REPEATABLE_READ on PostgreSQL/MySQL and SERIALIZABLE on H2, checking request, definition, audit and member consistency without silent repair.
- General deadlocks, timeouts and serialization errors are not retried. Only known initialization/key-insert duplicates, after clean rollback and cleanup, reconcile a durable winner in a fresh transaction. PostgreSQL/H2 require SQLState 23505; MySQL requires both 23000 and vendor code 1062. Other integrity, chained or cleanup errors remain failures.
- Lost commit acknowledgements leave an uncertain outcome; inspect durable state first. Cleanup failures remain visible even after commit. Closing prevents new operations but does not cancel in-flight transactions. Hosts drain requests and close their own DataSource.

<!-- topic:retry-inbox -->
## Idempotency and member paging

Submission keys match `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}` without trimming or case folding. Authentication supplies the applicant. Keys bind globally by applicant across the schema, not by process; reuse for another process or intent conflicts. Request, initial history and key commit together. Original keys still return the current request after decisions or publication; a fresh key with a stale process version neither creates nor reserves anything. Unkeyed calls create independently.

Members include every distinct actor in the saved effective route, including future selected stages and unvoted selected members; schema-4 skipped-only participants are excluded. PENDING means current and unvoted; HANDLED requires an actual event and can overlap. Binary-exact actor keys, bucket flags and immutable seconds/nanoseconds/ASCII IDs support bounded keyset indexes. A nonempty page uses six SELECTs regardless of size and decodes only candidates. Cursors are not authorization; later pages are live queries, not a cross-request frozen snapshot.

Mismatched selected projections, revisions, normalized fields, definitions or history fail closed. This is not an unbounded corruption scan: deleting a complete candidate row can hide a result and requires operator repair. The compatibility `approver_id` cannot represent every pending group member.

<!-- topic:limits -->
## Verification limits

Real-server suites cover races, ALL/ANY, idempotency, rollback, corrupted history, isolation, member paging and adapter reopening. Reopening does not test database crash recovery. H2 or simulated dialects do not establish PostgreSQL/MySQL acceptance, and historical test counts do not describe the current commit.

The module provides no automatic migration, tenancy, scheduler, outbox, notifications, business-transaction joining, encryption-key management or JSON import. See [persistence and migration](../../docs/development/PERSISTENCE.en.md), [idempotency](../../docs/SUBMISSION_IDEMPOTENCY.en.md), [member inbox](../../docs/MEMBER_INBOX.en.md) and [historical MySQL evidence](MYSQL_VERIFICATION.en.md). Accept the target commit only on its own CI results.
