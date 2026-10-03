# Optional JDBC approval persistence

ArcFlow 的可选 JDBC 审批存储。领域服务仍负责身份、可见性、顺序审批和幂等重试；本模块负责数据库事务、版本比较和历史一致性。纯 Java DAG 内核没有新增第三方运行时依赖。默认 JSON 演示不会自动切换到数据库。

This separate module implements `ApprovalStore` with JDK JDBC, the existing approval domain and Jackson. It adds no Spring JDBC/ORM runtime dependency. The host chooses a JDBC driver, a connection pool, database credentials and explicit migrations. H2 and PostgreSQL drivers are test-scoped only.

## Build and verify

From the repository root, with JDK 17+ and Maven:

```bash
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-jdbc/pom.xml verify
```

`JdbcApprovalStoreTest` uses real H2 JDBC connections, including a file-backed close/reopen test. It covers independent store instances, optimistic decision/publication conflicts, racing initialization, publication-versus-submission locking, immutable request/process snapshots, audit corruption and rollback when an audit insertion or publication update fails.

`PostgresqlApprovalStoreTest` runs against an actual PostgreSQL server only when `ARCFLOW_PG_URL` is present. Without it, those tests are skipped; a successful H2 run is not evidence of PostgreSQL compatibility. The dedicated `approval-jdbc.yml` CI workflow provisions PostgreSQL and runs the server tests. Check its result for the exact revision being used. To run them locally against a disposable database whose user can create/drop test schemas:

```bash
export ARCFLOW_PG_URL=jdbc:postgresql://localhost:5432/arcflow_test
export ARCFLOW_PG_USER=arcflow_test
# Supply ARCFLOW_PG_PASSWORD through your test environment, not source control.
mvn -f examples/approval-jdbc/pom.xml verify
```

The tests create uniquely named schemas and drop only those test schemas afterward. Do not point them at a production database.

## Explicit schema installation

Apply exactly one SQL resource through the host's normal migration tool before opening the store:

- H2: `src/main/resources/com/arcflow/approval/jdbc/schema-h2.sql`
- PostgreSQL: `src/main/resources/com/arcflow/approval/jdbc/schema-postgresql.sql`

Classpath equivalents are `/com/arcflow/approval/jdbc/schema-h2.sql` and `/com/arcflow/approval/jdbc/schema-postgresql.sql`. These are first-install scripts, not idempotent schema-upgrade or JSON-import tools. Apply migrations once with an appropriately privileged migration identity, and coordinate deployment separately. The constructor never executes DDL and fails if the required schema is absent.

The four `arc_` tables are:

- `arc_process_version`: retained immutable definition snapshots, publication actor and timestamp. Initial bootstrap is recorded with actor `bootstrap`.
- `arc_process_head`: the single active version and the shared row lock for publication and submission.
- `arc_request`: request JSON plus normalized revision, process, participant, status, step and timestamp columns. Indexes support participant/status queries, although this small SPI currently lists all requests.
- `arc_request_event`: append-only event JSON, keyed by request ID and zero-based event index. Index 0 is `SUBMIT`; request revision is `history.size() - 1`.

The adapter inserts process versions and events but never rewrites or deletes them. For defense in depth, restrict the application role to `SELECT`/`INSERT` on those two tables; reserve schema changes, destructive operations and repairs for a separate operator role. It also needs `SELECT`/`INSERT`/`UPDATE` on the head and request tables. Database owners can still rewrite data: this is consistency checking, not cryptographic tamper-proof storage.

## Host integration

Add `com.arcflow.examples:approval-jdbc:0.1.0-SNAPSHOT` to the host after installing/building the domain and JDBC modules. Create the store from an externally managed `javax.sql.DataSource` and pass it to the shared domain service:

```java
var store = new JdbcApprovalStore(dataSource, objectMapper, initialDefinition);
var service = new ApprovalService(store, actorDirectory);
```

Use `com.arcflow.approval.jdbc.JdbcApprovalStore`; domain types remain in `com.arcflow.approval`. Every host must resolve the authenticated actor from its own session and enforce its own surrounding endpoint permissions. Do not accept actor identity from an untrusted client body.

`initialDefinition` is validated and inserted only when the database has no active process. Concurrent initializers safely converge on the first committed definition, even if supplied defaults differ. Later opens use persisted data, not the supplied default. Publication retains the old version and records the publishing actor/time with the new version. Existing requests always continue using the definition captured at submission.

The service owns the store lifecycle. Closing it prevents new store operations, but does not cancel in-flight transactions or close the host's DataSource. The host must shut down its pool itself after draining requests.

## Transactions, concurrency and failures

- Each operation acquires a fresh connection. The connection must initially be in auto-commit mode. The adapter owns its transaction and restores connection settings before returning it. Use a regular, independently borrowed DataSource connection, not a transaction-aware proxy or a shared connection.
- There is no participation in Spring `@Transactional`, no XA transaction and no atomicity with a host business-table transaction. If approval and business writes must commit together, this adapter is not that integration contract.
- Writes run at JDBC `READ_COMMITTED`. Publication and submission lock the same process-head row with `SELECT ... FOR UPDATE`. Submission therefore cannot insert using a version invalidated between its version check and its commit.
- Decision updates lock the request, replay the existing saved state, enforce an exact append-one history prefix and immutable request identity/definition, then compare-and-set its revision. The request state update and event insertion commit together. A failed event insertion rolls back the state and revision; submission failures also roll back the inserted request.
- Reads use a `REPEATABLE_READ` transaction so request state, events and retained process versions come from one consistent snapshot. Each read replays the request's complete linear history, matches every event with the audit table, checks normalized columns and checks the retained definition. Missing, changed, extra or misordered audit events fail closed with `IOException` rather than silently repairing data.
- A stale process version or request revision returns `false` at the SPI. `ApprovalService` converts the appropriate races to conflict responses, and re-reads/re-authorizes decision retries to preserve its existing idempotency behavior. Duplicate request IDs are database errors, not successful submissions.
- The adapter does not automatically retry general database errors, deadlocks, timeouts or serialization errors. Only a known duplicate-key first-initialization race is reconciled by reading the committed head. A connection failure during commit may leave the outcome uncertain; inspect durable state before retrying. Pool or driver errors during cleanup are surfaced even if the transaction already committed.
- Publication timestamps come from the application's clock. Request decision timestamps and replay rules remain those of the domain. The adapter does not supply distributed clock synchronization.

## Boundaries

This is an experimental optional persistence layer, not a production-complete approval platform. It handles one `leave-approval` process per configured database schema. There is no tenant isolation, pagination, generalized process registry, scheduler, timer, outbox, notification delivery, business-transaction joining, XA, automatic JSON migration, encryption/key management or automatic schema migration. Operations read full request histories; the domain currently caps sequential approval steps at eight. Database deployment, backups, restore procedures, access controls, TLS, pool sizing, lock timeouts and capacity/load verification belong to the host.

Existing standalone and RuoYi examples keep their default JSON persistence unless explicitly integrated by the host. PostgreSQL behavior must be established by the real-server integration checks, not inferred from H2 or the presence of a PostgreSQL schema script.
