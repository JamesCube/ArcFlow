# Optional JDBC approval persistence

这个模块让审批示例可以用 JDBC 保存数据。审批领域服务负责身份校验、可见范围、顺序和 ALL/ANY 分组审批，以及幂等重试；这里负责数据库事务、版本检查和历史记录的一致性。ArcFlow 的 Java DAG 内核没有新增第三方运行时依赖，现有示例也不会自动从 JSON 切换到数据库。

This module implements `ApprovalStore` using JDK JDBC, the shared approval domain and Jackson. It has no Spring JDBC or ORM runtime dependency. Your host supplies the JDBC driver, connection pool, credentials and migrations. H2, PostgreSQL and MySQL Connector/J drivers are included only for tests. The constructor detects H2, PostgreSQL or MySQL 8 and rejects other database products.

## Build and verify

From the repository root, with JDK 17+ and Maven:

```bash
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-jdbc/pom.xml verify
```

`JdbcApprovalStoreTest` uses real H2 JDBC connections, including a file-backed close/reopen test. `H2ApprovalStoreContractTest` runs the full shared server contract on H2, without a compatibility mode. It covers independent store instances, optimistic decision/publication conflicts, racing initialization, publication-versus-submission locking, immutable request/process snapshots, audit corruption and rollback when an audit insertion or publication update fails.

`PostgresqlApprovalStoreTest` runs against an actual PostgreSQL server only when `ARCFLOW_PG_URL` is present. Without that variable, the PostgreSQL tests are skipped. An H2 pass does not verify PostgreSQL behavior. The dedicated `approval-jdbc.yml` CI workflow provisions PostgreSQL and runs the server tests. Check its result for the revision you are using. To run them locally against a disposable database whose user can create/drop test schemas:

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

Classpath resources use the same names under `/com/arcflow/approval/jdbc/`. These scripts are for the first installation. They cannot be rerun as schema upgrades or used to import JSON data. Apply migrations once with an appropriately privileged migration identity, and coordinate deployment separately. The constructor never executes DDL and fails if the required schema is absent. MySQL inspection also rejects unsupported versions, non-InnoDB tables, text-column collation mismatches and non-LONGTEXT JSON columns. These checks catch known incompatibilities; they do not detect every possible schema change.

The five `arc_` tables are:

- `arc_process_version`: retained immutable definition snapshots, publication actor and timestamp. Initial bootstrap is recorded with actor `bootstrap`.
- `arc_process_head`: the single active version and the shared row lock for publication and submission.
- `arc_request`: request JSON plus normalized revision, process, participant, status, step and timestamp columns. Indexes support participant/status queries, although this small SPI currently lists all requests.
- `arc_request_event`: append-only event JSON, keyed by request ID and zero-based event index. Index 0 is `SUBMIT`; request revision is `history.size() - 1`.
- `arc_submission_key`: durable `(applicant_id, submission_key)` primary key referencing one unique request. Keys are exact and case-sensitive; requests submitted without a key have no row.

The adapter inserts process versions and events but never rewrites or deletes them. Restrict the application role to `SELECT`/`INSERT` on those two tables and `arc_submission_key`; reserve schema changes, destructive operations and repairs for a separate operator role. It also needs `SELECT`/`INSERT`/`UPDATE` on the head and request tables. Database owners can still rewrite data. The adapter checks consistency but cannot cryptographically prove that stored data has not been changed.

## Durable submission retries and revision-2 upgrade

Pass an optional `Idempotency-Key` through the host to the service's keyed `submit` overload. The grammar is `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}` (1–128 ASCII characters), without trimming or case folding. Authentication determines the applicant scope; never trust an applicant ID from a request body. The same applicant/key, process ID/version and normalized business intent returns the same request with its current validated approval state. Legacy leave intent retains title, reason and days; typed documents also compare their complete immutable business snapshot. Reusing a key for different intent returns conflict. A replay still works after later publication; a fresh key using a stale process version cannot create a request or reserve the key. Omitting the key preserves independent submissions.

New keyed submissions for the same process serialize on its process-head lock. Keys remain database-global by `(applicant_id, submission_key)` for compatibility with existing installations; they are not scoped by process. Different processes can race under independent head locks. Only a clean duplicate from the key INSERT is reconciled, after rollback, by reading the durable winner in a fresh transaction; the service then rejects a different process or business intent with conflict. Ordinary request lookup/listing is process-scoped; key lookup deliberately resolves the global winner. Request, initial `SUBMIT` event and key mapping commit in one transaction. Lookup checks the stored applicant/key exactly, resolves the referenced request, verifies applicant ownership, and validates its full snapshot, retained definition and audit. Public lookup uses `REPEATABLE_READ`; keyed creation's replay locks the request while reading its current state and audit under `READ_COMMITTED`. This prevents a concurrent decision from mixing an older request state with newer audit events in one response. The service compares the submitted intent; the immutable request fields are the stored canonical intent, so no payload hash or duplicate snapshot is stored.

For an existing revision-1 installation, stop/drain all application writers, back up, and explicitly apply exactly one matching migration with your migration identity:

- H2: `upgrade-h2-v1-to-v2.sql`
- PostgreSQL: `upgrade-postgresql-v1-to-v2.sql`
- MySQL: `upgrade-mysql-v1-to-v2.sql`

These resources are beside the fresh schema scripts under `/com/arcflow/approval/jdbc/`. They add only the key table and do not assign historical requests any key or rewrite request/event/process JSON. Use the revision-2 `schema-*.sql` only for an empty installation, never on an existing schema. New constructors reject a missing key table before initialization; they do not migrate automatically or accept keys without saving them durably. MySQL additionally inspects the key table's InnoDB engine and `utf8mb4_0900_bin` collation. MySQL DDL implicitly commits, so run upgrades outside application transactions.

Deploy all instances on the matching new domain/JDBC code before accepting keyed traffic. Mixed old/new application binaries are unsupported: an old host may silently ignore the header and create duplicates, so a coordinated application rollout is required. Rollback requires an operator plan; do not drop the key table while retained requests may be retried. The adapter does not delete or expire mappings. If the commit result is uncertain, retry with the original key and intent to read the saved result. A new key or changed intent can create a different outcome.

The shared contract tests cover procurement round trips and decisions, immutable business snapshots, multiple-process isolation, forced cross-process global-key races, strict legacy/new request decoding; cross-instance identical/changed-intent races; normalized, scoped and case-sensitive keys; replay after partial/final decisions, publication and adapter reopen; unkeyed behavior; rollback before/during/after a real key insert; durable replay after a lost real commit acknowledgement; mapping/audit corruption; key PK/unique/FK constraints; snapshot and locked replay races; and explicit upgrade of a database containing legacy requests.

## Host integration

Add `com.arcflow.examples:approval-jdbc:0.1.0-SNAPSHOT` to the host after installing/building the domain and JDBC modules. Create the store from an externally managed `javax.sql.DataSource` and pass it to the shared domain service:

```java
var store = new JdbcApprovalStore(dataSource, objectMapper, initialDefinition);
var service = new ApprovalService(store, actorDirectory);
```

Use `com.arcflow.approval.jdbc.JdbcApprovalStore`; domain types remain in `com.arcflow.approval`. Each host must get the authenticated actor from its own session and check endpoint permissions. Do not accept actor identity from an untrusted client body.

`initialDefinition.id()` permanently binds each adapter to one process. The definition is validated and inserted only when that process has no active head. Separate adapters can use different stable process IDs in the same schema. Concurrent initializers for the same ID safely converge on the first committed definition, even if supplied defaults differ. Later opens use persisted data, not the supplied default. Publication retains the old version and records the publishing actor/time with the new version. Existing requests always continue using the definition captured at submission. List/read/create/update/publication operations cannot cross the configured process; publication cannot rename it. Typed leave and procurement business snapshots are persisted in the existing `request_json` column, without new tables or a schema migration. Legacy request JSON without a `business` field remains readable; missing required fields and unknown business fields fail closed.

Before enabling typed business writes, upgrade every reader and writer to code that understands the new `request_json` payloads. SQL revision 2 is unchanged, but old binaries cannot decode typed documents. There is no automatic rollback migration; keep database backups and do not mix old/new writers. See the [business-document compatibility rules](../../docs/BUSINESS_DOCUMENTS.md).

The service owns the store lifecycle. Closing it prevents new store operations, but does not cancel in-flight transactions or close the host's DataSource. The host must shut down its pool itself after draining requests.

## Transactions, concurrency and failures

- Each operation acquires a fresh connection. The connection must initially be in auto-commit mode. The adapter owns its transaction and restores connection settings before returning it. Use a regular, independently borrowed DataSource connection, not a transaction-aware proxy or a shared connection.
- The adapter does not join Spring `@Transactional`, XA or host business-table transactions. If approval and business writes must commit together, you will need a different integration.
- Writes run at JDBC `READ_COMMITTED`. Publication and submission lock the same process-head row with `SELECT ... FOR UPDATE`. Submission therefore cannot insert using a version invalidated between its version check and its commit.
- Decision updates lock the request, replay the existing saved state, enforce an exact append-one history prefix and immutable request identity/definition, then compare-and-set the revision. The request state update and event insertion commit together. A failed event insertion rolls back the state and revision; submission failures also roll back the inserted request.
- Reads use a `REPEATABLE_READ` transaction so request state, events and retained process versions come from one consistent snapshot. Each read replays the request's complete stage/participant history, matches every event with the audit table, checks normalized columns and checks the retained definition. Missing, changed, extra or misordered audit events fail closed with `IOException` rather than silently repairing data.
- A stale process version or request revision returns `false` at the original SPI; keyed creation returns `null` for a stale version with no existing key. `ApprovalService` converts the appropriate races to conflict responses, and reloads the request and rechecks authorization for decision retries to preserve its existing idempotency behavior. Duplicate request IDs are database errors, not successful submissions.
- The adapter does not automatically retry general database errors, deadlocks, timeouts or serialization errors. Only a known duplicate-key first-initialization race or submission-key INSERT race after a clean rollback/cleanup is reconciled by reading the committed head or key binding in a fresh transaction. A missing durable winner is still an error; duplicate request IDs never become successful replays. PostgreSQL/H2 use SQLState `23505`; MySQL requires both SQLState `23000` and vendor code `1062`. Other integrity errors, chained SQL errors and any rollback/reset/close failure remain failures. A connection failure during commit may leave the outcome uncertain; inspect durable state before retrying. Pool or driver errors during cleanup are surfaced even if the transaction already committed.
- Publication timestamps come from the application's clock. Request decision timestamps and replay rules remain those of the domain. The adapter does not supply distributed clock synchronization.

## Boundaries

This optional adapter is experimental and has not been verified as a complete production approval service. Each adapter handles one configured process ID; a schema can hold multiple processes. Process scoping is not tenant isolation, and applicant/key identity remains shared across the schema. There is no tenant isolation, pagination, process-discovery API, scheduler, timer, outbox, notification delivery, business-transaction joining, XA, automatic JSON migration, encryption/key management or automatic schema migration. Operations read full request histories; the domain caps approval stages at eight and each parallel group at sixteen participants. The host must handle database deployment, backups, restore procedures, access controls, TLS, pool sizing, lock timeouts and capacity/load tests.

Existing standalone and RuoYi examples keep their default JSON persistence unless explicitly integrated by the host. Verify PostgreSQL and MySQL with the real-server integration tests. H2 runs, simulated metadata checks and schema scripts alone do not verify either server.

## Parallel-group schema compatibility

[Schema-3 ALL/ANY groups](../../docs/PARALLEL_APPROVAL.md) reuse these tables and transactions without DDL changes. Existing schema-2 versions/requests/events keep their exact JSON shapes. Upgrade all application instances before publishing schema 3; mixed old/new binaries are unsupported. A pending `approver_id` is only the first undecided group participant, so its index cannot represent the full group inbox. Use the domain participant worklist and visibility checks. The standalone Vue demo supports schema 3 using JSON persistence. The native RuoYi host also supports groups using real-directory participants and JSON persistence; neither host automatically switches to JDBC.


## MySQL 8 integration target

The MySQL dialect is experimental. At merged source `e1ee9c6`, all 29 tests passed against **MySQL 8.0.46 and 8.4.11 on Java 17 and 21**. Those tests predate submission keys; check CI for the revision you use to verify the expanded contract. The [verification record](MYSQL_VERIFICATION.md#verified-server-acceptance-2026-10-05) links each job and records its versions and limits. MySQL 5.7, MariaDB, non-InnoDB engines, MySQL 9 and vendor forks are outside this target. Do not describe a passing H2 or simulated-dialect test as a MySQL integration pass.

The SQL schema is revision 2 (separate from process-definition JSON schema 2/3). Apply `schema-mysql.sql` once through the host migration system. Do not run PostgreSQL/H2 DDL on MySQL or change existing production tables blindly. MySQL DDL implicitly commits; install/upgrade schemas outside approval transactions with a separate migration identity. There is no automatic upgrade or cross-database/JSON import. All application instances must understand process schema 3 before it is published.

MySQL-specific details:

- MySQL minimum 8.0.17 provides `utf8mb4_0900_bin`; it also includes enforced CHECK constraints introduced in 8.0.16. All five tables explicitly use InnoDB and DYNAMIC row format, independent of host defaults.
- `utf8mb4_0900_bin` preserves case, accents and trailing spaces in comparisons (NO PAD). The domain treats stable actor IDs as exact strings. The default case-insensitive collation and older `utf8mb4_bin` PAD SPACE behavior are unsuitable.
- JSON snapshots use LONGTEXT with prepared-string parameters. A valid 16-participant history with Unicode comments can exceed TEXT's 65,535-byte limit. Driver/server packet limits and application memory still apply; LONGTEXT does not provide unlimited capacity. Size the pool and `max_allowed_packet` for the workload and test representative maximum histories.
- Foreign keys use explicit table-level declarations, including event-to-request. MySQL ignores inline column `REFERENCES`. All identifiers are fixed lowercase nonreserved names; values are bound with prepared statements, without dialect-specific quote interpolation.
- Writes explicitly select READ_COMMITTED and lock the exact primary-key head/request with FOR UPDATE. State, revision and the append-only event commit together. Nonlocking REPEATABLE_READ reads inspect state, retained definitions and audit from one snapshot. No autocommit locking read, SKIP LOCKED, vendor upsert or implicit DDL is used in an operation.
- A new store uses database metadata for dialect selection. Keep one DataSource bound to one database/catalog with the supplied schema. The host owns pool lifecycle, strict SQL mode, TLS, credentials, lock/statement timeouts, backup/restore and database maintenance. The adapter does not change global server settings or silently retry deadlocks/lock timeouts.

Use a **disposable** MySQL server and a dedicated test identity that can create and drop temporary databases. Each test creates a UUID-named `arcflow_test_...` database, uses JDBC `setCatalog`, verifies the selected database with `SELECT DATABASE()` before any migration, and deletes only the database it successfully created. URLs with `databaseTerm=SCHEMA` that make catalog selection a no-op fail closed. Never use production credentials. Set a secured JDBC URL and credentials through your environment:

```bash
export ARCFLOW_MYSQL_URL='jdbc:mysql://localhost:3306/arcflow_test?sslMode=VERIFY_IDENTITY'
export ARCFLOW_MYSQL_USER=arcflow_test
# Supply ARCFLOW_MYSQL_PASSWORD securely through the test environment.
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-jdbc/pom.xml -Dtest=MysqlApprovalStoreTest verify
```

`MysqlApprovalStoreTest` is skipped when `ARCFLOW_MYSQL_URL` is absent. It requires an actual MySQL 8 server; it never substitutes H2 compatibility mode. PostgreSQL and MySQL inherit the same server contract for independent-instance races, ALL/ANY mixed decisions, replay/idempotency, atomic rollback, publication/submission locking, snapshot consistency, corruption detection and adapter close/reopen. MySQL-specific cases check FK/CHECK enforcement, exact string comparisons, supplementary Unicode, >64-KiB histories, unsafe schema rejection and whole-operation rollback after an audit INSERT lock timeout. The timeout case requires the default `innodb_rollback_on_timeout=0` and checks it without changing it. Reopening the adapter does **not** test how the database recovers from a server restart or crash.

The dedicated workflow runs MySQL 8.0 and 8.4 on Java 17/21. It records actual server versions and requires all 53 MySQL tests with zero skips; PostgreSQL requires all 47 shared server tests, which also run on H2. The [typed-document matrix at merged commit `9143f3d`](https://github.com/JamesCube/ArcFlow/actions/runs/37710417628) passed all six server jobs. The older [October 5 matrix](https://github.com/JamesCube/ArcFlow/actions/runs/37258262111) covered 29 MySQL and 23 PostgreSQL tests before submission keys and typed documents were added. The 8.0/8.4 image tags can move to newer maintenance releases. Check the exact commit and recorded versions; neither run establishes every MySQL 8.x version or production readiness.

### Primary references

- [MySQL 8.0.17 collation introduction](https://dev.mysql.com/doc/relnotes/mysql/8.0/en/news-8-0-17.html)
- [Binary collations and NO PAD](https://dev.mysql.com/doc/refman/8.0/en/charset-binary-collations.html)
- [InnoDB locking reads](https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html)
- [Transaction isolation](https://dev.mysql.com/doc/refman/8.0/en/innodb-transaction-isolation-levels.html)
- [CREATE TABLE and foreign keys](https://dev.mysql.com/doc/refman/8.0/en/create-table.html)
- [InnoDB statement/transaction error handling](https://dev.mysql.com/doc/refman/8.0/en/innodb-error-handling.html)
- [MySQL string types](https://dev.mysql.com/doc/refman/8.0/en/string-type-syntax.html)
