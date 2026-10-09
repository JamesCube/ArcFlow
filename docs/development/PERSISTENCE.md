# 存储与迁移 / Persistence and migration

[开发文档 / Developer guide](README.md) · [简体中文](#zh) · [English](#en)

<a id="zh"></a>
## 简体中文

### 三套版本，不要混用

| 版本 | 当前支持 | 表示什么 |
| --- | --- | --- |
| `ProcessDefinition.schemaVersion` | 2／3／4 | 流程结构：顺序、分组、受限条件；定义的 `version` 则是每次发布递增的业务版本 |
| JSON 文件顶层 `schemaVersion` | 严格读取 1–13 | 文件包裹格式、提交键、业务类型和保留的条件定义；不会因为读取就升级 |
| JDBC SQL revision | 3 | 数据表、提交键及成员投影；与 JSON 字段版本不是同一编号 |

JSON 快照最低版本取决于实际内容：

| 内容 | 最低 wrapper |
| --- | --- |
| 顺序定义／分组定义 | 2／3 |
| 持久提交键 | 4 |
| `leave`、`procurement` | 5 |
| `quoteDiscount` | 6 |
| `expense` | 7 |
| `travel` | 8 |
| `sealUse` | 9 |
| `receiving` | 10 |
| `paymentRequest` | 11 |
| `contractApproval` | 12 |
| 定义 schema 4／冻结路由 | 13 |

写入选择已有 wrapper、当前／保存定义、所有业务类型和提交键需求的最大值，绝不降级。发布 schema 4 时即需要 wrapper 13，即使还没有申请或定义已不含条件。schema 13 保存 `routingDefinitions`，包括尚无申请的已发布 schema-4 版本；当前定义与每笔条件申请必须和保留版本完全一致。

依据：[BusinessDocumentSchema](../../examples/approval-domain/src/main/java/com/arcflow/approval/BusinessDocumentSchema.java)、[JsonApprovalStore](../../examples/approval-domain/src/main/java/com/arcflow/approval/JsonApprovalStore.java)、[ConditionalRouting](../../examples/approval-domain/src/main/java/com/arcflow/approval/ConditionalRouting.java)。未知版本、缺失／额外字段、非法类型组合、历史或派生状态不一致均拒绝读取，不静默修复。

### 默认 JSON：一个本地写者

`APPROVAL_DATA_FILE` 对应主请假／采购文件；未设置时为相对后端工作目录的 `./data/requests.json`。推荐使用私有目录下的绝对路径。独立宿主另外使用：

- 报价：主路径 + `.quotes.json`
- 六场景：主路径 + `.scenario-<scenarioId>.json`，ID 为 `oa-expense`、`oa-travel`、`oa-seal-use`、`erp-receiving`、`erp-payment`、`crm-contract`

每个文件有自己的 `.lock`。路径由编译期配置选定，不由 URL 拼接选择。相关源码为 [ScenarioConfiguration](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/ScenarioConfiguration.java) 与 [QuoteDiscountConfiguration](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/QuoteDiscountConfiguration.java)。完整演示备份要覆盖全部已有数据文件，不能只复制主文件。

JSON 存储把发布、创建和决定串行化，先把完整快照写入同目录临时文件并强制刷盘，再原子替换目标，成功后才发布内存状态与索引。不支持原子移动时直接失败。文件锁拒绝同一文件的第二个进程。

这不提供集群、共享网络文件系统、多写者、高可用或断电恢复保证。它每次写完整快照；不要把“原子替换”理解为数据库级规模或灾备能力。若依默认审批存储也是 JSON；若依 MySQL 中的用户／菜单数据不会自动接管审批。

### JSON 升级与恢复步骤

1. 确认新旧二进制能读哪些格式，停止并排空不兼容读写端；禁用混用旧／新写者。
2. 备份主文件及所有报价／场景文件，保存来源提交、配置和数据路径，限制备份访问权限。不要在文件仍变化时拼出跨文件快照。
3. 用兼容新版部署，先在备份副本上验证严格恢复、历史、幂等与未完成申请，再开放新业务／条件写入。
4. 打开旧文件本身不会改写。成功变更需要更高 wrapper 时，先保存**紧接本次升级之前的原始字节**到 `.schemaN.bak`；同名备份存在时保留原文件并创建不同名称。schema-1 历史在内存中迁移，直到实际写入才落盘。
5. 出错时保留原件、备份和日志，停止继续写入，核对版本与恢复计划。不要手改 schema、删除历史或移除锁文件来绕过活动写者。

自动升级备份不能替代运营备份。恢复旧备份会丢失其后的申请与表决，既不是无损降级，也不是自动 JSON→JDBC 导入。金额、类型、路由或索引验证失败必须按故障处理。

### 可选 JDBC：显式接线和迁移

宿主创建 `JdbcApprovalStore(dataSource, mapper, initialDefinition)`，再交给 `ApprovalService(store, actorDirectory)`。每个适配器绑定一个不可更名的流程 ID；同库可有多个流程，但这不是租户隔离。申请／查询按流程隔离，提交键仍按整个数据库的 `(applicant_id, submission_key)` 唯一，不能假设流程间可复用同一键。

SQL revision 3 有七张表：流程版本、当前流程头、申请、审计事件、提交键、成员投影、投影就绪／回填状态。仅空库使用对应 `schema-h2.sql`、`schema-postgresql.sql` 或 `schema-mysql.sql`；构造器不执行 DDL，不自动迁移。

已有 revision 1／2 的升级必须遵循 [JDBC 详细流程](../../examples/approval-jdbc/README.md#bounded-member-inbox-and-explicit-sql-revision-3-upgrade)：

1. 停止并排空所有读写实例，备份，使用迁移身份；revision 1 先执行对应 v1→v2 脚本。
2. revision 2 执行匹配数据库的 v2→v3 脚本；不要把空库脚本当升级脚本。MySQL DDL 会隐式提交。
3. 显式调用 `JdbcApprovalStore.backfillMembers(dataSource, mapper, batchSize)`，每批 1–100 条；逐次检查 `BackfillProgress.ready`，完成之前保持写者停止。
4. 确认投影 ready，再部署匹配的新领域／存储／宿主代码开放流量。构造器会拒绝缺失或未就绪的成员投影。

新类型和条件路由继续使用 revision-3 JSON 列，无需仅为它们新增 DDL 或重建已 ready 的旧索引；但所有读取端仍须理解新 JSON 契约。原有 revision-2 数据仍需要上述迁移，早期未合并投影草稿不能冒充真实 revision 2。

JDBC 每次操作使用独立连接与自有事务，不加入 Spring `@Transactional`、XA 或宿主业务表事务。发布／提交锁流程头；决定锁申请并原子更新状态、审计和成员投影。读操作使用一致快照并核对审计／定义／投影。宿主负责驱动、连接池、超时、TLS、备份和生命周期；没有通用死锁自动重试或 outbox。503／提交确认丢失时应核对持久状态，保留原键与意图，不盲目换新键再提交。

### 验证不能相互替代

[JsonSchemaUpgradeTest](../../examples/approval-domain/src/test/java/com/arcflow/approval/JsonSchemaUpgradeTest.java)、[UnifiedBusinessSchemaTest](../../examples/approval-domain/src/test/java/com/arcflow/approval/UnifiedBusinessSchemaTest.java) 和 [ConditionalRoutingStoreTest](../../examples/approval-domain/src/test/java/com/arcflow/approval/ConditionalRoutingStoreTest.java)覆盖文件兼容与恢复。数据库验证见 [JDBC 指南](../../examples/approval-jdbc/README.md)及[专用 CI](../../.github/workflows/approval-jdbc.yml)。没有设置 PostgreSQL／MySQL 测试环境变量时，对应真机测试会跳过；H2 通过不能证明它们通过。重开适配器也不等于数据库进程崩溃恢复验证。

<a id="en"></a>
## English

### Keep three version systems separate

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

Sources: [BusinessDocumentSchema](../../examples/approval-domain/src/main/java/com/arcflow/approval/BusinessDocumentSchema.java), [JsonApprovalStore](../../examples/approval-domain/src/main/java/com/arcflow/approval/JsonApprovalStore.java), and [ConditionalRouting](../../examples/approval-domain/src/main/java/com/arcflow/approval/ConditionalRouting.java). Unknown versions, missing/extra fields, illegal type-wrapper combinations, and inconsistent history/derived state fail closed instead of being silently repaired.

### Default JSON: one local writer

`APPROVAL_DATA_FILE` selects the main leave/procurement file. Its default is `./data/requests.json`, relative to the backend working directory. Prefer an absolute path in a private directory. The standalone host also uses:

- Quote: base path + `.quotes.json`
- Six scenarios: base path + `.scenario-<scenarioId>.json`, with IDs `oa-expense`, `oa-travel`, `oa-seal-use`, `erp-receiving`, `erp-payment`, and `crm-contract`

Each file has its own `.lock`. Compiled configuration chooses paths; request URLs do not select filesystem paths. See [ScenarioConfiguration](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/ScenarioConfiguration.java) and [QuoteDiscountConfiguration](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/QuoteDiscountConfiguration.java). A full demo backup includes every existing data file, not just the main one.

The JSON store serializes publication, creation, and decisions. It writes a complete snapshot to a same-directory temporary file, forces it to disk, atomically replaces the target, and only then publishes in-memory state/indexes. Unsupported atomic moves fail. An exclusive file lock rejects another process opening the same store.

This is not clustering, network-filesystem support, multiple writers, high availability, or guaranteed power-loss recovery. Each write serializes the whole snapshot. Atomic replacement does not imply database-scale throughput or disaster recovery. Native RuoYi approval storage is also JSON by default; its MySQL user/menu database does not automatically store approvals.

### JSON rollout and recovery

1. Identify the readable formats of every binary, stop/drain incompatible readers and writers, and prevent mixed old/new writers.
2. Back up main, quote, and scenario files; record the source revision, configuration, and paths, and restrict access. Do not assemble a cross-file backup while those files are changing.
3. Deploy compatible binaries. On a backup copy, verify strict restore, history, retries, and pending requests before enabling new business/conditional writes.
4. Opening an older file does not rewrite it. A successful mutation needing a higher wrapper first saves the **exact immediately preceding bytes** in `.schemaN.bak`; a collision preserves the existing backup and chooses another name. Schema-1 history migrates in memory until a real write occurs.
5. On failure, preserve originals, backups, and logs, stop further writes, and reconcile the format/recovery plan. Never lower schema numbers, delete history, or remove a lock file to bypass an active writer.

Upgrade backups do not replace operational backups. Restoring an old backup loses later requests/votes. It is neither lossless downgrade nor automatic JSON-to-JDBC import. Invalid money, types, routes, or projections are failures to investigate.

### Optional JDBC: explicit wiring and migration

Construct `JdbcApprovalStore(dataSource, mapper, initialDefinition)` and pass it to `ApprovalService(store, actorDirectory)`. Each adapter is permanently bound to one process ID. A database may hold multiple processes; this is not tenant isolation. Request operations are process-scoped, but `(applicant_id, submission_key)` remains unique across the database. Do not assume a key can be reused in another process.

SQL revision 3 has seven tables for retained versions, active heads, requests, audit events, submission keys, members, and projection readiness/backfill. Apply the matching `schema-h2.sql`, `schema-postgresql.sql`, or `schema-mysql.sql` only to an empty installation. Constructors execute no DDL and perform no automatic migration.

For revision 1/2, follow the [detailed JDBC upgrade](../../examples/approval-jdbc/README.md#bounded-member-inbox-and-explicit-sql-revision-3-upgrade):

1. Stop/drain all readers and writers, back up, and use a migration identity. Revision 1 needs its matching v1→v2 script first.
2. Apply the database-specific v2→v3 script. Never use a fresh-install script as an upgrade. MySQL DDL implicitly commits.
3. Explicitly call `JdbcApprovalStore.backfillMembers(dataSource, mapper, batchSize)` in batches of 1–100. Inspect `BackfillProgress.ready` after each call; keep writers stopped until ready.
4. Deploy matching domain/JDBC/host binaries and reopen traffic only after readiness. Constructors reject a missing or not-ready member projection.

New types and conditions reuse revision-3 JSON columns. They alone need no new DDL or rebuild of already-ready old indexes, but every reader must understand the new JSON contract. Genuine revision-2 databases still need migration; early unmerged projection drafts are not genuine revision-2 installations.

JDBC operations borrow independent connections and own their transactions. They do not join Spring `@Transactional`, XA, or business-table transactions. Publication/submission lock the process head; decisions lock the request and atomically update state, audit, and members. Reads use a consistent snapshot and verify audit, definitions, and projections. The host owns drivers, pool, timeouts, TLS, backups, and lifecycle. There is no general automatic deadlock retry or outbox. After a 503 or lost commit acknowledgement, reconcile durable state with the original key/intent rather than blindly creating a new key.

### Verification is specific to its environment

[JsonSchemaUpgradeTest](../../examples/approval-domain/src/test/java/com/arcflow/approval/JsonSchemaUpgradeTest.java), [UnifiedBusinessSchemaTest](../../examples/approval-domain/src/test/java/com/arcflow/approval/UnifiedBusinessSchemaTest.java), and [ConditionalRoutingStoreTest](../../examples/approval-domain/src/test/java/com/arcflow/approval/ConditionalRoutingStoreTest.java) cover file compatibility/restoration. See the [JDBC guide](../../examples/approval-jdbc/README.md) and [dedicated CI](../../.github/workflows/approval-jdbc.yml) for databases. PostgreSQL/MySQL tests skip when their environment is absent; H2 results do not establish either server's behavior. Reopening an adapter is not database-process crash-recovery testing.
