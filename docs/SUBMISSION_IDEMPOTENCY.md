# Durable submission idempotency / 持久化提交幂等

This is a bounded contract for the existing leave-approval examples, not general workflow or external-side-effect exactly-once execution.
这是现有请假审批示例的有界提交契约，不是通用工作流或外部副作用的 exactly-once 保证。

## HTTP and identity / HTTP 与身份

Both `POST /api/requests` (standalone) and `POST /arcflow/requests` (native RuoYi) accept one optional `Idempotency-Key` header. A key contains 1–128 ASCII characters matching `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. Keys are exact and case-sensitive. Blank, malformed, oversized and multiple values are rejected, never treated as omitted. Use a cryptographically random UUID for a new logical submission; reuse it for retries.

独立与若依原生提交接口均支持可选 `Idempotency-Key` 请求头。键须满足上述格式，区分大小写；空值、非法值、超长值和多值请求头会被拒绝，不能静默退化成非幂等提交。新申请使用随机 UUID，重试必须沿用原键。

The namespace is `(authenticated applicant ID, key)` within the configured approval store. Identity comes from the host session, never request JSON. The same key used by another applicant is independent and cannot reveal the original applicant's request. The applicant must still be active on replay; store results are reauthorized before return. Existing endpoint permissions still apply. This is not tenant isolation: separate tenants need separate authorized storage/identity integration.

键的作用域是当前存储内的“已认证申请人 ID + 键”。不同用户互不共享映射，重放仍校验申请人有效状态和原有接口权限。该作用域不等于多租户隔离。

## Intent and replay / 请求意图与重放

- Intent consists of the submitted process version, integer days and existing domain-normalized title/reason (`String.trim()`). Raw validation limits still apply before normalization, including retries. No new Unicode/case normalization is introduced.
- Identical intent with the same scoped key returns the same request ID, its frozen definition and its **current** saved status/history. A later approval or publication may therefore change the returned state, but never create another submission or advance an approval step.
- Different normalized title, reason, days or process version with the same key returns HTTP 409. The existing request and binding remain unchanged.
- Successful historical replay works even if the published process changed, a former approver was disabled or the new definition would assign the applicant. These new-submission rules do not invalidate an already accepted request. Inactive applicants cannot replay.
- Missing keys deliberately preserve the old behavior: every successful call creates a request. Existing HTTP bodies, request/event JSON shapes and response envelopes are unchanged. Standalone returns 201 for both first submission and replay; native RuoYi keeps its HTTP/AjaxResult success format. Status codes do not identify whether a result was replayed.

意图包含提交时的流程版本、天数，以及领域层原有 trim 后的标题和原因。同键同意图返回原申请及其当前状态；同键不同意图返回 409。流程重新发布、原审批人停用或新流程改派不会阻断合法历史重放。缺少键时保留旧的每次创建行为；HTTP 正文、申请/事件 JSON、状态码和响应封装保持兼容。

The service overload is `submit(actor, title, reason, days, processVersion, key)`. The old overload passes no key. Third-party `ApprovalStore` implementations compile with default keyed methods but explicitly fail keyed traffic until they implement durable support; there is no in-memory fallback.

服务新增带 key 的重载，旧重载仍不提供幂等。第三方存储未实现持久化键接口时会明确失败，不会假装用内存缓存满足持久化保证。

## Atomicity, races and failures / 原子性、竞争与失败

The key binding, request and initial SUBMIT audit event become visible together. JSON serializes mutations and atomically replaces one file. JDBC takes the existing process-head lock, resolves a prior binding **before** the active-version check, and inserts all three records in one transaction. A replay inside that write transaction locks the request so request/history cannot tear across a concurrent decision; ordinary lookups use a repeatable-read snapshot.

映射、申请与首条提交事件一起保存。JSON 使用串行操作和单文件原子替换；JDBC 复用流程头行锁，先查已有映射再校验当前版本，并在同一事务中保存三项记录。并发同键只有一个创建结果；不同意图的竞争者得到冲突。

A commit may succeed even if its response/connection cleanup fails. Retry with the **same key and same intent**, including the original process version. Never rotate the key just because the response was lost. Errors do not promise rollback when commit outcome is uncertain. No expiry, eviction, deletion or key reuse is implemented; bindings remain as long as their retained requests. Host retention/import/restore tools must preserve this relationship and namespace.

提交可能成功但响应丢失。重试应保持原键、原意图和原流程版本，不能因为超时自动换键。当前不提供键的过期、淘汰、删除或复用；备份与恢复必须同时保留映射及申请。

This does not provide atomicity with business tables, notifications, external handlers or another database; there is no outbox/XA guarantee. JSON remains one process on a local filesystem and retains its existing file-force/atomic-replace limits. Tests prove process/store reopen recovery, not arbitrary host power-loss, storage-device failure or physical database restart/crash durability. Database durability also depends on the host's server configuration and backup practices.

本能力不覆盖业务表、通知、外部处理器或其他数据库的联合事务。JSON 仍仅支持单进程本地文件；重开恢复测试不代表任意断电、磁盘损坏或数据库物理崩溃恢复已验证。

## Upgrade and rollback / 升级与回退

### JSON

Process-definition schemas remain 2/3. Snapshot schema 4 adds a `submissions` collection; request/event JSON is unchanged. Schemas 1/2/3 are accepted. Reading causes no rewrite. The first successful keyed creation upgrades the snapshot and preserves a byte-exact `*.schemaN.bak` of the immediately preceding snapshot, without replacing an existing backup. After upgrade, unkeyed writes and publications retain schema 4 and all bindings. Duplicate/dangling bindings, multiple keys for one request and applicant mismatches fail closed on restore. Older binaries cannot read schema 4; stop traffic and back up before upgrade, and do not overwrite newer accepted requests with an old backup during rollback.

流程定义仍为 schema 2/3，持久化快照新增 schema 4 映射集合。读取旧文件不改写；首次成功带键提交才升级并备份紧邻升级前的原始字节。既有备份不会覆盖。旧程序无法读取 schema 4，回退需停流与完整数据计划，不能用旧备份丢弃新申请。

### JDBC

SQL revision 2 is separate from process JSON schemas. For a fresh database use the dialect's `schema-*.sql`; for an existing revision-1 database use the matching `upgrade-*-v1-to-v2.sql` exactly once. Stop all writers, back up and apply through a migration identity. Existing requests are not backfilled with invented keys. The constructor performs no DDL and requires the new table even for unkeyed traffic. MySQL uses InnoDB and exact `utf8mb4_0900_bin` identity comparison. See the [JDBC host contract](../examples/approval-jdbc/README.md).

SQL 升级使用独立的 revision 2。已有数据库须停写、备份并显式运行对应升级脚本；旧申请不会凭空补键。新程序启动前必须完成迁移，即使暂不发送幂等键。构造器不执行 DDL。

Upgrade all hosts together before enabling keyed clients. Old servers can ignore an unknown header and create duplicates; mixed old/new hosts and downgrade with ongoing traffic are unsupported.

所有服务端完成升级后再启用带键客户端。旧服务可能忽略未知请求头并重复创建，不支持新旧服务混跑。

## Client retry lifetime / 客户端重试范围

Standalone and native RuoYi forms retain an unresolved key and original payload/version in memory for the mounted form and authenticated account. Refreshing server data does not rewrite ambiguous pending intent. Editing normalized fields starts a new logical intent; a completed submission clears it. Only an exact stale-process HTTP 409 proves this version was never created; after that explicit rejection, a successful user-triggered Refresh clears the rejected attempt so the next Submit uses the refreshed version and a new key. Generic conflicts and ambiguous failures never trigger key rotation. No request text or credentials are written to browser storage. Page reload, tab close or logout loses the client key; after that, inspect the request list before creating a new submission. Server bindings remain durable regardless of the browser lifetime. There is no automatic network retry and no new submission UI in the review-only mobile client.

独立与若依表单在当前页面内存中保留未确认请求的原键、载荷和流程版本；刷新服务端数据不会改写不确定请求。更改规范化后的表单字段意味着新意图；成功后清空。刷新整个页面、关闭标签或退出会丢失客户端键，之后应先核对申请列表。服务端映射仍持久保存；不自动网络重试，纯审批移动端未增加发起页面。

## Verification / 验证

Tests cover canonical replay, changed-intent conflicts, applicant isolation, exact case, invalid keys, concurrent same/different intent, winner→publication races before validation and during creation, current-state replay, inactive applicants/approvers, lost acknowledgement, atomic rollback, old snapshot backups, malformed bindings and store reopen. The inherited JDBC contract runs on actual H2 and CI-provisioned PostgreSQL/MySQL; CI asserts zero skipped real-server cases. HTTP/client tests cover both envelopes and stable retry keys. Read the exact commit's workflow results before describing a candidate as verified.

测试覆盖意图比较、身份隔离、并发、重放顺序、响应丢失、回滚、迁移备份、损坏数据与重开恢复。H2 与真实 PostgreSQL/MySQL 分开验证，CI 禁止把跳过服务器测试当作成功；最终证据以精确提交的工作流为准。

## Typed business documents / 类型化业务单据

The additive typed-document path retains the same applicant/key scope. JDBC keys remain
global across configured process IDs; process identity and every immutable business field
now participate in replay conflict checks. Legacy leave submissions retain schema 4; typed
JSON writes use schema 5. See [business document compatibility](BUSINESS_DOCUMENTS.md).
