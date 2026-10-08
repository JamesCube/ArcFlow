# Durable submission idempotency / 持久化提交幂等

The approval examples can recognize a retried submission and return the original request. This document explains how the key is saved, how to retry, and what happens during upgrades. It does not guarantee exactly-once execution for a whole workflow or its external side effects.

审批示例可以识别重复提交，并返回原来的申请。下面说明提交键如何保存、失败后如何重试，以及升级时要注意什么。这项功能不保证整个工作流或外部操作恰好执行一次。

## HTTP and identity / HTTP 与身份

Both `POST /api/requests` (standalone) and `POST /arcflow/requests` (native RuoYi) accept one optional `Idempotency-Key` header. A key must contain 1–128 ASCII characters matching `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. Matching is exact and case-sensitive. Blank, malformed, oversized or multiple values cause an error; the server does not ignore an invalid header. Generate a cryptographically random UUID for each new submission and keep it for retries.

独立和若依原生接口都支持可选的 `Idempotency-Key` 请求头。键须符合上述格式，区分大小写。空值、格式错误、超长值或多个值都会报错，服务端不会忽略错误的键继续新建申请。新申请生成随机 UUID，重试时沿用原键。

Keys are scoped to `(authenticated applicant ID, key)`. A JSON file has one configured process. In JDBC, this key space is shared by all process IDs in the same database schema; it is not scoped separately by process. The host session supplies the identity; request JSON cannot choose it. Two applicants can use the same key independently, without revealing each other’s requests. Retries still require an active applicant and the endpoint’s existing permissions. Before returning stored results, the service checks authorization again. This scope does not provide tenant isolation; tenants need separately authorized storage and identity integration.

键按“已认证申请人 ID + 键”区分。JSON 文件只对应一个流程；JDBC 中，同一数据库 schema 的所有流程共享这个键空间，不能把流程 ID 当成键的另一层隔离。不同用户使用同一个键时，各自对应自己的申请。重试仍检查申请人是否有效、是否有接口权限。这不能代替多租户隔离。

## Intent and replay / 请求意图与重放

- For the legacy leave endpoint, the submission’s intent is its configured process ID, process version, integer days, and title/reason after the domain’s existing `String.trim()` normalization. Original validation limits apply before normalization, including on retries. Unicode and case handling are unchanged.
- Retrying the same intent with the same scoped key returns the original request ID and saved definition, with its **current** status and history. Later approvals may change that response. The retry itself creates no request and advances no approval step; later publication does not replace the saved definition.
- Reusing the key with a different normalized title, reason, days or process version returns HTTP 409. The existing request and key binding stay unchanged.
- An accepted submission can be retried after the process is republished, a former approver is disabled, or a new definition assigns the applicant. Those checks apply to new submissions and do not invalidate an accepted request. The applicant must still be active.
- Without a key, every successful call creates a request, as before. Legacy HTTP bodies, request/event JSON shapes and response envelopes are unchanged. Standalone returns 201 for both a new submission and a retry; native RuoYi keeps its HTTP/AjaxResult success format. You cannot tell from the status code whether the response came from a retry.

旧请假接口的“意图”包括配置的流程 ID、提交时的流程版本、天数，以及按原有规则 trim 后的标题和原因。同键、相同内容返回原申请及其当前状态；同键、不同内容返回 409。流程重新发布、原审批人停用或新流程改派，都不妨碍有权限的申请人重试已成功提交的申请。没有键时，每次成功调用仍会新建申请。旧接口的 HTTP 正文、申请/事件 JSON、状态码和响应封装保持兼容。类型化单据的比较范围见下文。

Use `submit(actor, title, reason, days, processVersion, key)` to submit with a key. The old overload passes no key. Third-party `ApprovalStore` implementations still compile because keyed methods have defaults, but those defaults reject keyed submissions until the store implements durable support. They do not fall back to an in-memory cache.

服务新增了带 key 的重载；旧重载不提供提交幂等。第三方存储如果还没实现持久化键接口，带键提交会明确报错，不会改用内存缓存。

## Atomicity, races and failures / 原子性、竞争与失败

The key binding, request and initial SUBMIT audit event are saved together. JSON processes writes serially and replaces one file atomically. JDBC takes the existing process-head lock, checks for a prior binding **before** checking the active version, and inserts all three records in one transaction. A retry inside that write transaction locks the request so a concurrent decision cannot leave the returned request and history out of sync. Ordinary lookups use a repeatable-read snapshot.

键映射、申请和首条提交事件一起保存。JSON 将写入排队后原子替换单个文件；JDBC 使用流程头行锁，先查已有映射，再检查当前版本，并在一个事务中保存三项记录。同时使用同一个键提交时，只会新建一份申请；如果内容不同，另一个请求会收到冲突。

A commit can succeed even if the response is lost or connection cleanup fails. Retry with the **same key and same intent**, including the original process version. Do not generate a new key just because you received no response. An error alone does not prove the commit was rolled back. Keys have no expiry, eviction, deletion or reuse mechanism; bindings stay with their retained requests. Host tools for retention, import and restore must preserve that relationship and key scope.

有时申请已经提交成功，只是响应没收到。请保留原键、原内容和原流程版本重试，不要因超时换键。当前没有键的过期、淘汰、删除或复用机制，备份和恢复时须同时保留映射与申请。

The transaction does not include business tables, notifications, external handlers or another database. There is no outbox or XA guarantee. JSON still requires one process on a local filesystem and has the same file-force and atomic-replacement limits as before. Tests cover reopening a process or store. They do not verify recovery from host power loss, device failure, or a physical database restart or crash. Database durability also depends on server configuration and backups.

这个事务不包含业务表、通知、外部处理器或其他数据库。JSON 仍只支持单进程本地文件。测试检查了重新打开存储后的恢复，尚未验证断电、磁盘损坏或数据库物理崩溃后的恢复。

## Upgrade and rollback / 升级与回退

### JSON

Process definitions keep schemas 2/3. Snapshot schema 4 adds a `submissions` collection without changing request/event JSON. The current store reads schemas 1–5 and leaves files untouched when reading. The first successful legacy keyed creation upgrades a schema-1/2/3 snapshot to schema 4 and saves a byte-for-byte `*.schemaN.bak` of the file just before the upgrade, without replacing an existing backup. Later unkeyed writes and publications keep at least schema 4 and all bindings. Typed-document writes use schema 5; see below. A schema-5 file never downgrades when a legacy request is added. Restore fails on duplicate or dangling bindings, multiple keys for one request, or applicant mismatches. Versions without submission-key support cannot read schema 4; versions without typed-document support cannot read schema 5. Stop traffic and back up before upgrading; a rollback must not overwrite newly accepted requests with an old backup.

流程定义仍用 schema 2/3，文件快照的 schema 4 新增键映射集合。类型化单据使用 schema 5；已经升级到 schema 5 的文件，后续写入旧请假申请也不会降级。读取旧文件不会改写它；旧请假接口首次成功的带键创建将 schema-1/2/3 升为 4，类型化写入则升为 5。升级前的文件会原样备份，不覆盖已有备份。不支持提交键的旧版本无法读取 schema 4；不支持类型化单据的版本无法读取 schema 5。升级前先停写并备份，回退时也要保留升级后已接受的新申请，不能直接用旧备份覆盖。

### JDBC

SQL revision 2 is independent of the process JSON schemas. For a new database, use its dialect’s `schema-*.sql`. For a revision-1 database, apply the matching `upgrade-*-v1-to-v2.sql` once. Stop all writers, back up, and run the migration with an account authorized for it. Old requests receive no invented keys. The constructor runs no DDL and needs the new table even if clients omit keys. MySQL uses InnoDB and exact `utf8mb4_0900_bin` identity comparison. See the [JDBC host contract](../examples/approval-jdbc/README.md).

SQL 使用独立的 revision 2。已有数据库要先停写、备份，再运行对应升级脚本；旧申请不会自动补键。即使暂时不用幂等键，也必须在启动新程序前完成迁移，构造器不会自动建表。

Upgrade every host before enabling keyed clients. An old server may ignore the header and create duplicates. Do not run old and new hosts together or downgrade while traffic is still running.

等所有服务端升级后，再启用带键客户端。旧服务可能忽略这个请求头并重复新建申请，因此不支持新旧服务混跑。

## Client retry lifetime / 客户端重试范围

The standalone and native RuoYi forms keep an unresolved submission’s key, payload and process version in memory while that form and authenticated account remain active. Refreshing server data leaves an uncertain submission unchanged. Editing the normalized fields starts a new intent; successful submission clears it.

Only the specific stale-process HTTP 409 proves that the attempted version created no request. After that rejection, a successful user-triggered Refresh clears the failed attempt, allowing the next Submit to use the refreshed process version and a new key. Other conflicts or uncertain failures never rotate the key automatically.

The forms write no request text or credentials to browser storage. Reloading the page, closing the tab or logging out loses the client key. If that happens, check the request list before submitting again. The server’s binding remains saved. Clients do not retry automatically, and the review-only mobile client has no submission form.

独立和若依表单在当前页面内存中保留未确认提交的键、内容和流程版本。刷新服务端数据不会改写它；更改规范化后的字段会开始一次新提交，成功后清空。只有明确的流程版本过期 409 才能确认这次没有创建申请；此时手动 Refresh 成功后，下次提交才会使用新版本和新键。其他冲突和不确定的失败不会自动换键。

刷新整个页面、关闭标签或退出登录会丢失客户端键，之后请先核对申请列表。服务端映射仍会保存。客户端不自动重试网络请求，只用于审批的移动端也没有发起表单。

## Verification / 验证

Tests cover canonical replay, changed-intent conflicts, applicant isolation, exact case, invalid keys, concurrent same/different intent, winner→publication races before validation and during creation, current-state replay, inactive applicants/approvers, lost acknowledgement, atomic rollback, old snapshot backups, malformed bindings and store reopen. The shared JDBC contract suite runs on H2 and on PostgreSQL/MySQL servers provisioned by CI, which requires zero skipped real-server cases. HTTP/client tests cover both response formats and stable retry keys. Check the workflow results for the exact commit you plan to use.

测试覆盖提交内容比较、身份隔离、并发、重试顺序、响应丢失、回滚、迁移备份、损坏数据和重新打开存储后的恢复。H2 和真实 PostgreSQL/MySQL 分开测试，CI 会检查真实服务器测试是否被跳过。使用某个版本前，请查看该提交的工作流结果。

## Typed business documents / 类型化业务单据

The typed endpoints, `POST /api/documents` and `POST /arcflow/documents`, share the legacy endpoint's applicant/key space. Replay compares process ID/version, business type, business ID and every normalized immutable business field. A key reused for legacy versus typed leave, another business type, another process or changed content returns conflict. A business ID is a reference, not a deduplication key.

Different JDBC processes lock different head rows and can race on a global key. Only a duplicate at the binding INSERT, followed by clean rollback and a fresh lookup of the durable winner, is reconciled. A foreign-process winner returns conflict; other database or cleanup failures stay errors.

Legacy keyed JSON writes require at least schema 4. The first typed write upgrades schema 1–4 to schema 5 and preserves a byte-exact backup; later writes never downgrade it. Deploy compatible readers before enabling typed writes and avoid mixed-version writers. SQL remains revision 2. Restoring an old JSON backup would lose later submissions and approvals; it is not a supported automatic downgrade. See [business-document compatibility](BUSINESS_DOCUMENTS.md).

类型化请假与采购入口共用原来的申请人键空间，重试比较流程 ID/版本、业务类型、业务 ID 及全部规范化业务字段。业务 ID 本身不去重。JDBC 跨流程抢占同一个键时，只有明确的键插入重复且完整回滚后，才会重新读取已提交结果并判断冲突。类型化 JSON 写入升级到 schema 5，原样备份旧文件；SQL 仍为 revision 2。先升级全部读取端，再启用新写入，不支持新旧版本混写或用旧备份直接回退。
