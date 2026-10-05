# MySQL implementation verification record

## Verified server acceptance (2026-10-05)

Merged source: [`e1ee9c6bdb971949c4f8746fe88b9ff49e6d4c36`](https://github.com/JamesCube/ArcFlow/commit/e1ee9c6bdb971949c4f8746fe88b9ff49e6d4c36). The [JDBC workflow](https://github.com/JamesCube/ArcFlow/actions/runs/37258262111) completed successfully against real database services:

| Database | Java 17 | Java 21 | Executed server tests per job |
| --- | --- | --- | --- |
| MySQL 8.0.46 | [Passed](https://github.com/JamesCube/ArcFlow/actions/runs/37258262111/job/111599834615) | [Passed](https://github.com/JamesCube/ArcFlow/actions/runs/37258262111/job/111599834619) | 29, zero failures/errors/skips |
| MySQL 8.4.11 | [Passed](https://github.com/JamesCube/ArcFlow/actions/runs/37258262111/job/111599834610) | [Passed](https://github.com/JamesCube/ArcFlow/actions/runs/37258262111/job/111599834528) | 29, zero failures/errors/skips |
| PostgreSQL 17.6 | [Passed](https://github.com/JamesCube/ArcFlow/actions/runs/37258262111/job/111599834449) | [Passed](https://github.com/JamesCube/ArcFlow/actions/runs/37258262111/job/111599834632) | 23, zero failures/errors/skips |

The PostgreSQL jobs also passed 31 H2 integration tests per Java version. Their MySQL tests are intentionally skipped because MySQL executes in its four dedicated jobs; those dedicated jobs reject skips or missing tests. Counts are per job, not distinct tests multiplied by the matrix. Actual server versions and report-gate results are in each job log.

These runs close the earlier Java 17, Maven and real-server execution gaps documented below. The tested MySQL contract includes ALL/ANY races, state/audit rollback, exact identity comparisons, Unicode and >64-KiB history, and adapter close/reopen. Physical-server crash/restart recovery, capacity, tenant isolation and host-business-transaction integration remain outside this acceptance. The adapter is experimental and optional; both demo hosts still default to JSON. RuoYi was sequential-only at this acceptance commit; its current group UI is documented [separately](../ruoyi-vue3/README.md#configure-and-vote-in-groups).

## Historical implementation record (2026-10-04)

The remaining sections preserve the original local-only findings and blockers as of October 4. Their “not run” statements are historical and superseded by the exact-commit server acceptance above.

Date: 2026-10-04. Base: combined local ArcFlow source `b39787e8dc0d3877b4903821df699461ab6a9641` (includes parallel approval domain and designer work).

## Acceptance boundary

The optional approval JDBC adapter now has a MySQL 8.0.17+ / 8.x dialect target, explicit InnoDB migration, strict identity collation, LONGTEXT snapshots and precise initialization-race recovery. This is **implemented but not real-MySQL-verified**. It is not a production-support declaration. Core Java remains dependency-free, and neither the standalone nor RuoYi demo automatically switches away from its JSON store.

## Executed locally

- Main core/domain/JDBC source compilation succeeded using the installed Java 21 compiler module and the already available Spring/Jackson runtime dependencies.
- `JdbcDialectChecks`: 37 plain-JDK checks passed for database selection, version boundaries, table/column compatibility, exact duplicate classification and failure-preserving initialization recovery. These use **simulated JDBC metadata**, not a database.
- Core `EngineChecks`: 24 checks passed.
- Existing supplemental standalone domain harness: 110 cases passed after compiling the combined source. This covers domain ALL/ANY permutations, retries and JSON recovery, not JDBC integration.
- A separately executed valid 16-participant Unicode approval generated **104,553 UTF-8 bytes**, 17 events, and survived JSON-adapter reopen. This establishes that a valid payload exceeds TEXT's 65,535-byte limit; it does not validate LONGTEXT on a server.
- Syntax parsing of all 32 Java files in core/domain/JDBC succeeded. This is not dependency-aware test compilation.
- Workflow YAML, Maven POM XML and static MySQL DDL shape checks passed; `git diff --check` was clean.
- Independent read-only source review found and corrected an exception expectation in the corruption test. It also led to a deterministic bootstrap insert barrier, table-level FK declarations, the 8.0.17 minimum, DYNAMIC row format and preservation of suppressed cleanup failures.

Compilation used `-source 17 -target 17` on Java 21. `--release 17` and a Java 17 runtime were unavailable, so these results **do not establish Java 17 platform/API compatibility**.

## Authored but not executed

`MysqlApprovalStoreTest` inherits 23 real-server contract tests and adds 6 MySQL-specific tests (29 total). They cover:

- Explicit schema installation, actual FK/CHECK enforcement and safe-schema rejection
- Forced simultaneous first initialization with differing defaults
- Independent-instance decisions, CAS races and exact idempotent audit history
- ALL/ANY closing/nonclosing decisions and four ordered mixed-vote races
- Both ALL and ANY audit rollback, membership/revision rollback and later retry
- Publication rollback and both publication/submission lock orderings
- Nonlocking snapshot consistency across a committed decision
- Retained definitions, partial-group close/reopen and corrupt-audit failure
- Case-sensitive request IDs, trailing-space lookup behavior, Unicode actors/comments
- A complete >64-KiB history round-trip and adapter reopen

The dedicated CI adds MySQL 8.0/8.4 on Java 17/21 and rejects a missing/skipped MySQL report. These jobs have not run for this source. PostgreSQL inherits the expanded contract; its existing real-server suite and all H2/JUnit suites were **not rerun** here. There is no claim of full test compilation, Maven verification, physical MySQL restart/crash recovery, load testing or host-business-transaction integration.

## Blocker and next acceptance step

No usable Maven, JUnit/database-driver artifacts, MySQL server/client or Docker executable was present in the inspected local environment. No new software was installed and no system, credential or server security settings were changed. No remote push, PR or deployment was attempted.

Run the [module's documented build and real-server commands](README.md#mysql-8-integration-target) on a disposable MySQL 8 server. Acceptance requires all 29 MySQL tests to execute with zero failures/errors/skips for the exact revision, plus the existing core/domain/H2/PostgreSQL checks. Physical restart/restore and deployment-specific capacity/security checks remain host acceptance work.

## Reproducing the focused standalone checks

With a normal JDK, the dialect checks alone need only JDK JDBC classes:

```bash
mkdir -p /tmp/arcflow-dialect-checks
javac -d /tmp/arcflow-dialect-checks \
  examples/approval-jdbc/src/main/java/com/arcflow/approval/jdbc/JdbcDialect.java \
  examples/approval-jdbc/src/test/java/com/arcflow/approval/jdbc/JdbcDialectChecks.java
java -cp /tmp/arcflow-dialect-checks com.arcflow.approval.jdbc.JdbcDialectChecks
```

The delivery archive retains source, a patch against the combined base, file hashes, standalone harness sources and execution logs. The archive is a local implementation handoff, not a published release.


## Follow-up acceptance audit (2026-10-04)

The follow-up audited the unexecuted server-test path, rather than rerunning earlier domain checks as new database evidence. It corrected three harness gaps and added a fourth failure scenario:

- Connector/J can ignore `setCatalog` when `databaseTerm=SCHEMA`. Every MySQL test connection now verifies `SELECT DATABASE()` equals its generated UUID catalog before any migration/data operation. Eight new plain-JDK regression cases pass using simulated no-op connections; they do not run database SQL.
- Both publication/submission lock-order tests now wait for the contender to reach its `FOR UPDATE` statement, after initialization, before checking that it remains blocked. This avoids a sequential false pass caused by a worker that never started.
- PostgreSQL CI now requires all 23 inherited tests with zero skips/failures/errors, matching MySQL's gate. Twelve synthetic-XML checks confirm that both report gates reject missing reports/tests, skips, errors and failures. These are checks of gate logic, not CI/server execution.
- The 29th MySQL test forces an audit INSERT lock timeout after the request UPDATE. It requires server default `innodb_rollback_on_timeout=0`, checks error 1205 and unchanged state/revision/audit, then retries after releasing the blocker. The server setting is read only; the test does not change it. Its eventual passing result would establish an end-to-end full-operation rollback outcome, not independently identify which JDBC cleanup method caused it.

The two affected JDK-only support sources compile on the installed Java 21 compiler; all 34 core/domain/JDBC Java sources parse syntactically. Main production code is unchanged from the earlier compilation. Dependency-aware JUnit compilation and all real database execution remain outstanding. Independent review checked these corrections.

### Concrete execution prerequisites

For the first real MySQL acceptance pass, provide a full JDK 17, Apache Maven 3.x, Maven Central dependency access, and one disposable Oracle MySQL 8.0.17+ / 8.x server with an existing connection database. A local MySQL client and Docker are optional if a server is already available. Keep the exact source revision, runtime version, server version and Surefire XML reports together.

The current Spring Boot 3.5.16 parent manages Connector/J 9.7.0, H2 2.3.232, PostgreSQL JDBC 42.7.11 and JUnit Jupiter 5.12.2. The original core POM separately pins JUnit Jupiter 5.11.4. Maven should resolve each module's declared dependency graph without manual jar substitution. Full cross-database regression additionally needs a disposable PostgreSQL 17 server; the full CI matrix also needs JDK 21 and both MySQL 8.0/8.4 series.

Official sources checked for provisioning: [Temurin JDK](https://adoptium.net/temurin/releases/?version=17), [Apache Maven](https://maven.apache.org/download.cgi), [MySQL 8.0](https://dev.mysql.com/downloads/mysql/8.0.html), [MySQL 8.4](https://dev.mysql.com/downloads/mysql/8.4.html). Generic Linux MySQL binaries require compatible native libraries such as libaio. Provision into an isolated workspace or a dedicated test machine after obtaining the necessary installation permission; do not alter a production server or assume Debian's MariaDB default satisfies this test target.

Supporting primary documentation: [Connector/J catalog behavior](https://dev.mysql.com/doc/connector-j/en/connector-j-connp-props-connection.html#cj-conn-prop_databaseTerm), [timeout rollback behavior](https://dev.mysql.com/doc/refman/8.0/en/innodb-parameters.html#sysvar_innodb_rollback_on_timeout), [Boot 3.5 dependency coordinates](https://docs.spring.io/spring-boot/3.5/appendix/dependency-versions/coordinates.html), [Connector/J 9.7 supports MySQL 8.0+](https://dev.mysql.com/doc/relnotes/connector-j/en/news-9-7-0.html).
