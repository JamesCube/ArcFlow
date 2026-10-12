# Isolated graph persistence (definition v5)

[简体中文](GRAPH_STORAGE.md)

<!-- topic:scope -->
Graph storage is an opt-in adapter. It does not migrate, rewrite, or reinterpret existing sequential v2/v3 or conditional v4 definitions or requests. Graph definition schema 5, JSON wrapper 14, SQL installation schema 1, publication version, draft revision, command revision, and event sequence are separate counters/contracts.

<!-- topic:installation -->
## Installation and ownership

Install exactly one new resource explicitly with your normal database deployment tooling:

- H2: `src/main/resources/com/arcflow/approval/jdbc/graph-schema-h2.sql`
- PostgreSQL: `graph-schema-postgresql.sql` in that directory
- Oracle MySQL 8.0.17+ within 8.x: `graph-schema-mysql.sql`

These scripts create only nine `arc_graph_*` tables and indexes. They do not alter any existing `arc_request`, process, audit, or member table. They are fresh-install scripts, not repeatable migrations; do not rerun them on an existing graph installation. Back up and review the target database before the host operator applies DDL. The application constructor never runs DDL and rejects missing, malformed, duplicate, or unknown schema metadata before initial data writes. MySQL additionally verifies InnoDB, exact binary collations, and LONGTEXT JSON columns. MariaDB and compatibility-mode evidence are not substitutes for Oracle MySQL verification.

Construct `new JdbcGraphApprovalStore(dataSource, mapper, GraphSamples.payment())` and pass it to `GraphApprovalService`. The host owns the DataSource; the store borrows independently owned auto-commit connections and performs its own transactions. Ambient/Spring transactions are rejected. Closing a store prevents new operations without closing the host pool.

The JSON adapter uses a separately supplied `<base>.graph.json` filename, wrapper `storageSchemaVersion:14`, a held process lock, synchronized compare-and-set, forced temporary-file writes, atomic same-directory rename, and a parent-directory flush. It never falls back to non-atomic replacement. A second owner is rejected. Unexpected schemas, missing required fields (including nullable fields), duplicate fields, unknown fields, invalid scalar shapes, and snapshots that cannot replay fail closed without rewriting the file. Original numeric tokens are decoded after the wrapper probe so exact decimal scale survives restart. Use a filesystem that supports atomic replacement and directory synchronization; the JSON adapter is a single-process demonstration, not a distributed database.

<!-- topic:transactions -->
## Transactional model

- Published definitions are retained in `arc_graph_version`; instances freeze and validate the exact retained version.
- `arc_graph_head` contains current publication and saved draft. Draft edits CAS their revision. Publishing locks the head, requires the exact saved draft, appends one version, and resets the draft atomically.
- Submission locks the same head as publication and binds the exact `(process_id, applicant_id, submission_key)` once. The application store is bound to one process. Request IDs are globally unique within the graph tables. A stale version, existing ID, or existing scoped key is a conflict, not a second request.
- Human decisions lock and CAS the entire `arc_graph_request.command_revision`. An accepted human command increases it by one, regardless of how many activation, branch arrival, join, cancellation, and terminal events are emitted. Readers use a consistent multi-table snapshot.
- Request JSON, appended `arc_graph_event`, appended `arc_graph_command`, task JSON, task membership, and request membership commit together. Any audit, command, task, or member failure rolls back the request update and every earlier statement.
- `arc_graph_task_member` is keyed by `(request_id, task_id, actor_id)`. One actor may have multiple simultaneous tasks. `arc_graph_request_member.pending` and `.handled` are logical OR aggregates across those tasks. Completing one task never clears another pending task. Selected future participants have request membership but do not become pending until their own task activates. Unselected branches get no read membership.
- A request member may simultaneously be pending and handled. Pending means at least one ACTIVE task has their uncast vote; handled means at least one task contains their vote.
- Terminal rejection cancels other ACTIVE tasks and clears all their pending projections in the same CAS. A paired parallel join fires exactly once after every expected branch of its frozen fork activation arrives.
- Reads and constructor restart validate definition identity, deterministic command replay, event/command equality, task projections, and membership aggregates. Corrupt projections are rejected, not silently repaired.

<!-- topic:retries -->
## Retries and uncertain outcomes

The service owns reauthorization and re-reduction after a CAS conflict. Submission keys are scoped to the applicant within this process; decision command IDs are request-wide. An exact command/payload replay is safe; changed payload or an opposite decision conflicts. Reusing a key does not grant access to another actor's request. An already accepted vote retried with a fresh key binds that key durably using a no-op command and `COMMAND_REPLAYED` event in one CAS. Its command revision increases once while its original vote, task and fork state stay unchanged; the fresh key cannot later decide another task. Retrying the same original key adds nothing.

A lost commit acknowledgement can mean the transaction committed. The adapter reports the I/O failure and never converts an ambiguous failure into success or a false CAS. Reread through the service and retry the same submission/command key. The persisted command, event, task and member projections provide the reconciliation evidence. Never invent a new key solely because the first response was lost.

<!-- topic:rollback -->
## Old/new binary and rollback safety

- Old JSON readers reject wrapper 14. Old and graph adapters must retain different filenames. Never point an old writer at a graph file, rename a graph file to the old storage name, or claim wrapper 14 is an in-place upgrade of wrapper 13.
- Old SQL binaries continue using their old `arc_*` tables. They do not read, understand, protect, or reject the new `arc_graph_*` state; table isolation prevents them from rewriting it. This is isolation safety, not mixed-version graph compatibility.
- A deployment rollback to an old binary must disable/reroute graph endpoints and graph submissions and preserve the graph tables/file unchanged. Existing graph instances remain unavailable until a graph-capable binary is restored. Do not feed graph instances to the old reducer or copy graph rows into old request tables.
- Concurrent graph-capable nodes must agree on schema/semantics. Unknown metadata is rejected, but schema 1 alone does not negotiate future semantic changes. Upgrade graph workers/endpoints as a coordinated deployment and review future migrations explicitly.
- No migration of active legacy requests is included. The existing legacy definitions, APIs, stored snapshots and instances keep their original behavior.

<!-- topic:verification -->
## Reproducible tests

Run the domain `JsonGraphApprovalStoreTest` and JDBC `H2GraphApprovalStoreTest`. Actual server suites are opt-in: `PostgresqlGraphApprovalStoreTest` uses `ARCFLOW_PG_URL`, `ARCFLOW_PG_USER`, `ARCFLOW_PG_PASSWORD`; `MysqlGraphApprovalStoreTest` uses `ARCFLOW_MYSQL_URL`, `ARCFLOW_MYSQL_USER`, `ARCFLOW_MYSQL_PASSWORD`. Use dedicated disposable servers and accounts permitted to create/drop test namespaces, never a real user database. Each test creates and drops only its UUID-named schema/database. MySQL verifies catalog selection before DDL.

The common suite covers restart, strict unknown schema, immutable old instances across publication, incomplete draft reload, draft/publication conflicts, duplicate/opposite decisions, two same-actor task rows, OR membership, concurrent completion/join once, approval/rejection race, injected failures after successful audit/command/task/member statements, lost create/decision commit acknowledgement, and corrupt audit/task/member/command state. Environment-disabled tests are skipped, not verified server evidence. Record exact engine versions and zero-skip results separately when executing the server matrix.
