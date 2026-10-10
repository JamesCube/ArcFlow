# Persistence and migration

<!-- Legacy fragments remain entry points after the language split. -->
<a id="json-升级与恢复步骤"></a>
<a id="三套版本不要混用"></a>
<a id="可选-jdbc显式接线和迁移"></a>
<a id="存储与迁移--persistence-and-migration"></a>
<a id="验证不能相互替代"></a>
<a id="默认-json一个本地写者"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](PERSISTENCE.md) · [Documentation](../README.en.md)

<!-- topic:keep-three-version-systems-separate -->
## Keep three version systems separate

| Version | Current support | Meaning |
| --- | --- | --- |
| `ProcessDefinition.schemaVersion` | 2/3/4 | Sequential, group, and restricted conditional structure; its separate `version` increases on publication |
| Top-level JSON file `schemaVersion` | Strict readers for 1–13 | Snapshot envelope, submission keys, types, and retained conditional definitions; reading alone never upgrades it |
| JDBC SQL revision | 3 | Tables, submission keys, and member projection; unrelated to the JSON schema number |

Minimum JSON wrappers depend on saved content:

| Content | Minimum wrapper |
| --- | --- |
| Sequential/group definition | 2/3 |
| Durable submission keys | 4 |
| `leave`, `procurement` | 5 |
| `quoteDiscount` | 6 |
| `expense` | 7 |
| `travel` | 8 |
| `sealUse` | 9 |
| `receiving` | 10 |
| `paymentRequest` | 11 |
| `contractApproval` | 12 |
| Definition schema 4/frozen route | 13 |

Writes take the maximum required by the existing wrapper, current/saved definitions, all business types, and key bindings. They never downgrade. Publishing schema 4 requires wrapper 13 even without requests or remaining conditional nodes. Wrapper 13 retains `routingDefinitions`, including published schema-4 versions without requests. Current and request definitions must exactly match their retained versions.

`expense.totalAmount` reuses definition schema 4, routing schema 1 and wrapper 13. Its unconditional expense document still has minimum wrapper 7. Retain complete published definitions, unused schema-4 versions and each request's full original definition/route. A binary that already reads wrapper 13 but lacks this field must reject it, including publication-only stores. Wrapper support alone is not feature compatibility.

Sources: [BusinessDocumentSchema](../../examples/approval-domain/src/main/java/com/arcflow/approval/BusinessDocumentSchema.java), [JsonApprovalStore](../../examples/approval-domain/src/main/java/com/arcflow/approval/JsonApprovalStore.java), and [ConditionalRouting](../../examples/approval-domain/src/main/java/com/arcflow/approval/ConditionalRouting.java). Unknown versions, missing/extra fields, illegal type-wrapper combinations, and inconsistent history/derived state fail closed instead of being silently repaired.

<!-- topic:default-json-one-local-writer -->
## Default JSON: one local writer

`APPROVAL_DATA_FILE` selects the main leave/procurement file. Its default is `./data/requests.json`, relative to the backend working directory. Prefer an absolute path in a private directory. The standalone host also uses:

- Quote: base path + `.quotes.json`
- Six scenarios: base path + `.scenario-<scenarioId>.json`, with IDs `oa-expense`, `oa-travel`, `oa-seal-use`, `erp-receiving`, `erp-payment`, and `crm-contract`

Each file has its own `.lock`. Compiled configuration chooses paths; request URLs do not select filesystem paths. See [ScenarioConfiguration](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/ScenarioConfiguration.java) and [QuoteDiscountConfiguration](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/QuoteDiscountConfiguration.java). A full demo backup includes every existing data file, not just the main one.

The JSON store serializes publication, creation, and decisions. It writes a complete snapshot to a same-directory temporary file, forces it to disk, atomically replaces the target, and only then publishes in-memory state/indexes. Unsupported atomic moves fail. An exclusive file lock rejects another process opening the same store.

This is not clustering, network-filesystem support, multiple writers, high availability, or guaranteed power-loss recovery. Each write serializes the whole snapshot. Atomic replacement does not imply database-scale throughput or disaster recovery. Native RuoYi approval storage is also JSON by default; its MySQL user/menu database does not automatically store approvals.

<!-- topic:json-rollout-and-recovery -->
## JSON rollout and recovery

1. Identify the readable formats of every binary, stop/drain incompatible readers and writers, and prevent mixed old/new writers.
2. Back up main, quote, and scenario files; record the source revision, configuration, and paths, and restrict access. Do not assemble a cross-file backup while those files are changing.
3. Deploy compatible binaries. On a backup copy, verify strict restore, history, retries, and pending requests before enabling new business/conditional writes.
4. Opening an older file does not rewrite it. A successful mutation needing a higher wrapper first saves the **exact immediately preceding bytes** in `.schemaN.bak`; a collision preserves the existing backup and chooses another name. Schema-1 history migrates in memory until a real write occurs.
5. On failure, preserve originals, backups, and logs, stop further writes, and reconcile the format/recovery plan. Never lower schema numbers, delete history, or remove a lock file to bypass an active writer.

Before publishing an expense-total condition, take an operational backup even when the file is already wrapper 13. There is no wrapper-number increase to trigger an automatic upgrade backup for the new field alone. Deploy matching readers/writers together; do not mix pre-extension and expense-aware binaries. Follow the [expense-specific rollout case](../EXPENSE_ROUTING.en.md#rollout-and-recovery).

Upgrade backups do not replace operational backups. Restoring an old backup loses later requests/votes. It is neither lossless downgrade nor automatic JSON-to-JDBC import. Invalid money, types, routes, or projections are failures to investigate.

<!-- topic:optional-jdbc-explicit-wiring-and-migration -->
## Optional JDBC: explicit wiring and migration

Construct `JdbcApprovalStore(dataSource, mapper, initialDefinition)` and pass it to `ApprovalService(store, actorDirectory)`. Each adapter is permanently bound to one process ID. A database may hold multiple processes; this is not tenant isolation. Request operations are process-scoped, but `(applicant_id, submission_key)` remains unique across the database. Do not assume a key can be reused in another process.

SQL revision 3 has seven tables for retained versions, active heads, requests, audit events, submission keys, members, and projection readiness/backfill. Apply the matching `schema-h2.sql`, `schema-postgresql.sql`, or `schema-mysql.sql` only to an empty installation. Constructors execute no DDL and perform no automatic migration.

For revision 1/2, follow the [detailed JDBC upgrade](../../examples/approval-jdbc/README.en.md#bounded-member-inbox-and-explicit-sql-revision-3-upgrade):

1. Stop/drain all readers and writers, back up, and use a migration identity. Revision 1 needs its matching v1→v2 script first.
2. Apply the database-specific v2→v3 script. Never use a fresh-install script as an upgrade. MySQL DDL implicitly commits.
3. Explicitly call `JdbcApprovalStore.backfillMembers(dataSource, mapper, batchSize)` in batches of 1–100. Inspect `BackfillProgress.ready` after each call; keep writers stopped until ready.
4. Deploy matching domain/JDBC/host binaries and reopen traffic only after readiness. Constructors reject a missing or not-ready member projection.

New types and conditions reuse revision-3 JSON columns. They alone need no new DDL or rebuild of already-ready old indexes, but every reader must understand the new JSON contract. Genuine revision-2 databases still need migration; early unmerged projection drafts are not genuine revision-2 installations.

JDBC operations borrow independent connections and own their transactions. They do not join Spring `@Transactional`, XA, or business-table transactions. Publication/submission lock the process head; decisions lock the request and atomically update state, audit, and members. Reads use a consistent snapshot and verify audit, definitions, and projections. The host owns drivers, pool, timeouts, TLS, backups, and lifecycle. There is no general automatic deadlock retry or outbox. After a 503 or lost commit acknowledgement, reconcile durable state with the original key/intent rather than blindly creating a new key.

<!-- topic:verification-is-specific-to-its-environment -->
## Verification is specific to its environment

[JsonSchemaUpgradeTest](../../examples/approval-domain/src/test/java/com/arcflow/approval/JsonSchemaUpgradeTest.java), [UnifiedBusinessSchemaTest](../../examples/approval-domain/src/test/java/com/arcflow/approval/UnifiedBusinessSchemaTest.java), and [ConditionalRoutingStoreTest](../../examples/approval-domain/src/test/java/com/arcflow/approval/ConditionalRoutingStoreTest.java) cover file compatibility/restoration. See the [JDBC guide](../../examples/approval-jdbc/README.en.md) and [dedicated CI](../../.github/workflows/approval-jdbc.yml) for databases. PostgreSQL/MySQL tests skip when their environment is absent; H2 results do not establish either server's behavior. Reopening an adapter is not database-process crash-recovery testing.
