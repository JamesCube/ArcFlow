# Optional JDBC approval persistence

ArcFlow 的可选 JDBC 审批存储。领域服务仍负责身份、可见性、顺序 / 并行分组审批和幂等重试；本模块负责数据库事务、版本比较和历史一致性。纯 Java DAG 内核没有新增第三方运行时依赖。默认 JSON 演示不会自动切换到数据库。

This separate module implements `ApprovalStore` with JDK JDBC, the existing approval domain and Jackson. It adds no Spring JDBC/ORM runtime dependency. The host chooses a JDBC driver, a connection pool, database credentials and explicit migrations. H2, PostgreSQL and MySQL Connector/J drivers are test-scoped only. The constructor explicitly detects H2, PostgreSQL or the MySQL 8 dialect; other database products are rejected.

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
- MySQL 8.0.17+ / 8.x: `src/main/resources/com/arcflow/approval/jdbc/schema-mysql.sql` (experimental target; real-server verification is required)

Classpath resources use the same names under `/com/arcflow/approval/jdbc/`. These are first-install scripts, not idempotent schema-upgrade or JSON-import tools. Apply migrations once with an appropriately privileged migration identity, and coordinate deployment separately. The constructor never executes DDL and fails if the required schema is absent. MySQL inspection also rejects unsupported versions, non-InnoDB tables, text-column collation mismatches and non-LONGTEXT JSON columns. This is a defensive compatibility check, not an exhaustive schema drift detector.

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
- Reads use a `REPEATABLE_READ` transaction so request state, events and retained process versions come from one consistent snapshot. Each read replays the request's complete stage/participant history, matches every event with the audit table, checks normalized columns and checks the retained definition. Missing, changed, extra or misordered audit events fail closed with `IOException` rather than silently repairing data.
- A stale process version or request revision returns `false` at the SPI. `ApprovalService` converts the appropriate races to conflict responses, and re-reads/re-authorizes decision retries to preserve its existing idempotency behavior. Duplicate request IDs are database errors, not successful submissions.
- The adapter does not automatically retry general database errors, deadlocks, timeouts or serialization errors. Only a known duplicate-key first-initialization race after a clean rollback/cleanup is reconciled by reading the committed head. PostgreSQL/H2 use SQLState `23505`; MySQL requires both SQLState `23000` and vendor code `1062`. Other integrity errors and any rollback/reset/close failure remain failures. A connection failure during commit may leave the outcome uncertain; inspect durable state before retrying. Pool or driver errors during cleanup are surfaced even if the transaction already committed.
- Publication timestamps come from the application's clock. Request decision timestamps and replay rules remain those of the domain. The adapter does not supply distributed clock synchronization.

## Boundaries

This is an experimental optional persistence layer, not a production-complete approval platform. It handles one `leave-approval` process per configured database schema. There is no tenant isolation, pagination, generalized process registry, scheduler, timer, outbox, notification delivery, business-transaction joining, XA, automatic JSON migration, encryption/key management or automatic schema migration. Operations read full request histories; the domain caps approval stages at eight and each parallel group at sixteen participants. Database deployment, backups, restore procedures, access controls, TLS, pool sizing, lock timeouts and capacity/load verification belong to the host.

Existing standalone and RuoYi examples keep their default JSON persistence unless explicitly integrated by the host. PostgreSQL and MySQL behavior must be established by the real-server integration checks, not inferred from H2, simulated metadata or the presence of a schema script.

## Parallel-group schema compatibility

[Schema-3 ALL/ANY groups](../../docs/PARALLEL_APPROVAL.md) reuse these tables and transactions without DDL changes. Existing schema-2 versions/requests/events keep their exact JSON shapes. Upgrade all application instances before publishing schema 3; mixed old/new binaries are unsupported. A pending `approver_id` is only the first undecided group participant, so its index cannot represent the full group inbox. Use the domain participant worklist and visibility checks. The standalone Vue demo supports schema 3 using JSON persistence. The RuoYi UI host remains sequential-only; neither host automatically switches to JDBC.


## MySQL 8 integration target

The MySQL dialect is implemented as an **experimental target, pending real MySQL execution for this revision**. The local verification record is [MYSQL_VERIFICATION.md](MYSQL_VERIFICATION.md). MySQL 5.7, MariaDB, non-InnoDB engines, MySQL 9 and vendor forks are outside this target. Do not describe a passing H2 or simulated-dialect test as a MySQL integration pass.

The SQL schema is revision 1 (separate from process-definition JSON schema 2/3). Apply `schema-mysql.sql` once through the host migration system. Do not run PostgreSQL/H2 DDL on MySQL or change existing production tables blindly. MySQL DDL implicitly commits; install/upgrade schemas outside approval transactions with a separate migration identity. There is no automatic upgrade or cross-database/JSON import. All application instances must understand process schema 3 before it is published.

Key choices:

- MySQL minimum 8.0.17 provides `utf8mb4_0900_bin`; it also includes enforced CHECK constraints introduced in 8.0.16. All four tables explicitly use InnoDB and DYNAMIC row format, independent of host defaults.
- `utf8mb4_0900_bin` preserves case, accents and trailing spaces in comparisons (NO PAD). The domain treats stable actor IDs as exact strings. The default case-insensitive collation and older `utf8mb4_bin` PAD SPACE behavior are unsuitable.
- JSON snapshots use LONGTEXT with prepared-string parameters. A valid 16-participant history with Unicode comments can exceed TEXT's 65,535-byte limit. Driver/server packet limits and application memory still apply; LONGTEXT does not provide unlimited capacity. Size the pool and `max_allowed_packet` for the workload and test representative maximum histories.
- Foreign keys use explicit table-level declarations, including event-to-request. MySQL ignores inline column `REFERENCES`. All identifiers are fixed lowercase nonreserved names; values are bound with prepared statements, without dialect-specific quote interpolation.
- Writes explicitly select READ_COMMITTED and lock the exact primary-key head/request with FOR UPDATE. State, revision and the append-only event commit together. Nonlocking REPEATABLE_READ reads inspect state, retained definitions and audit from one snapshot. No autocommit locking read, SKIP LOCKED, vendor upsert or implicit DDL is used in an operation.
- A new store uses database metadata for dialect selection. Keep one DataSource bound to one database/catalog with the supplied schema. The host owns pool lifecycle, strict SQL mode, TLS, credentials, lock/statement timeouts, backup/restore and database maintenance. The adapter does not change global server settings or silently retry deadlocks/lock timeouts.

For a **disposable** MySQL database server, provide a dedicated test identity allowed to create/drop temporary databases. Each test creates a UUID-named `arcflow_test_...` database, uses JDBC `setCatalog`, verifies the selected database with `SELECT DATABASE()` before any migration, and deletes only the database it successfully created. URLs with `databaseTerm=SCHEMA` that make catalog selection a no-op fail closed. Never use production credentials. Supply a properly secured JDBC URL and secrets via your environment:

```bash
export ARCFLOW_MYSQL_URL='jdbc:mysql://localhost:3306/arcflow_test?sslMode=VERIFY_IDENTITY'
export ARCFLOW_MYSQL_USER=arcflow_test
# Supply ARCFLOW_MYSQL_PASSWORD securely through the test environment.
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-jdbc/pom.xml -Dtest=MysqlApprovalStoreTest verify
```

`MysqlApprovalStoreTest` is skipped when `ARCFLOW_MYSQL_URL` is absent. It requires an actual MySQL 8 server; it never substitutes H2 compatibility mode. PostgreSQL and MySQL inherit the same server contract for independent-instance races, ALL/ANY mixed decisions, replay/idempotency, atomic rollback, publication/submission locking, snapshot consistency, corruption detection and adapter close/reopen. MySQL-specific cases check FK/CHECK enforcement, exact string comparisons, supplementary Unicode, >64-KiB histories, unsafe schema rejection and whole-operation rollback after an audit INSERT lock timeout. The timeout case requires the default `innodb_rollback_on_timeout=0` and checks it without changing it. Adapter reopen does **not** establish physical-server restart/crash durability.

The dedicated workflow adds MySQL 8.0 and 8.4 service jobs on Java 17/21. It records the actual server version and fails if any of the 29 MySQL tests are skipped or missing. The PostgreSQL job similarly requires its 23 inherited server tests. Mutable 8.0/8.4 image series keep CI on maintenance releases; review the recorded version and exact-commit result before advertising that release combination. This source change has not been published and those CI jobs have not run.

### Primary references

- [MySQL 8.0.17 collation introduction](https://dev.mysql.com/doc/relnotes/mysql/8.0/en/news-8-0-17.html)
- [Binary collations and NO PAD](https://dev.mysql.com/doc/refman/8.0/en/charset-binary-collations.html)
- [InnoDB locking reads](https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html)
- [Transaction isolation](https://dev.mysql.com/doc/refman/8.0/en/innodb-transaction-isolation-levels.html)
- [CREATE TABLE and foreign keys](https://dev.mysql.com/doc/refman/8.0/en/create-table.html)
- [InnoDB statement/transaction error handling](https://dev.mysql.com/doc/refman/8.0/en/innodb-error-handling.html)
- [MySQL string types](https://dev.mysql.com/doc/refman/8.0/en/string-type-syntax.html)
