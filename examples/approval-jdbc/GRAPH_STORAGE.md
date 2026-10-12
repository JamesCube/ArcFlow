# 独立图流程持久化（定义 v5）

[English](GRAPH_STORAGE.en.md)

<!-- topic:scope -->
图存储是显式启用的新适配器，不迁移、改写或重新解释已有顺序 v2/v3、条件 v4 定义和实例。定义 schema 5、JSON 包装版本 14、SQL 安装版本 1、发布版本、草稿修订号、命令修订号和事件序号各自独立。

<!-- topic:installation -->
## 安装与连接所有权

由宿主数据库部署工具显式安装以下一份新脚本：

- H2：`src/main/resources/com/arcflow/approval/jdbc/graph-schema-h2.sql`
- PostgreSQL：同目录的 `graph-schema-postgresql.sql`
- Oracle MySQL 8.0.17 及以上 8.x：同目录的 `graph-schema-mysql.sql`

脚本只创建九张 `arc_graph_*` 表及索引，不修改原有 `arc_request`、流程、审计或成员表。它们是一次性新装脚本，不是可重复执行的迁移；已有图数据库不要重新执行。宿主操作员应先确认目标库并做好备份。构造器不执行 DDL；缺表、缺列、重复或未知 schema 元数据会在初始化写入前被拒绝。MySQL 还检查 InnoDB、二进制精确排序规则和 LONGTEXT JSON 列。MariaDB 或 H2 兼容模式不能代替真实 Oracle MySQL 验证。

使用 `new JdbcGraphApprovalStore(dataSource, mapper, GraphSamples.payment())`，再交给 `GraphApprovalService`。宿主拥有连接池；适配器每次借用独立的 auto-commit 连接，自己管理事务，不参加宿主/Spring 事务。关闭适配器不会关闭宿主连接池。

JSON 适配器要求单独提供 `<base>.graph.json` 文件名，以 `storageSchemaVersion:14` 包装。它持有进程文件锁，串行执行 CAS，将临时文件强制写盘后在同目录原子重命名，并同步父目录。没有非原子替换降级。第二个进程不能同时持有该文件。未知版本、缺少必填字段（包括应显式为 null 的字段）、重复或多余字段、错误标量类型、无法重放的快照都直接失败，不改写文件。包装版本检查后从原始数字 token 解码，重启保留精确小数。文件系统必须支持原子替换和目录同步；这是单进程演示存储，不是分布式数据库。

<!-- topic:transactions -->
## 事务与投影

- 已发布定义保存在 `arc_graph_version`；旧实例冻结的定义必须与该发布版本完全一致。
- `arc_graph_head` 保存当前发布版本和草稿。保存草稿按独立 revision 做 CAS；发布锁定流程头，要求内容与保存的草稿一致，并原子新增版本、重置草稿。
- 提交与发布锁定同一个流程头，一次性绑定精确的 `(process_id, applicant_id, submission_key)`。每个适配器绑定一个流程；请求 ID 在图表内全局唯一。版本过期、ID 或作用域内提交键重复均返回冲突，不生成第二个请求。
- 人工决定锁定并 CAS 整个请求的 `command_revision`。一次成功的人工作业只加一，不管同时产生多少激活、分支到达、汇合、取消或终态事件。多表读取使用一致性事务快照。
- 请求 JSON、追加事件、追加命令、任务 JSON、任务成员及请求成员在同一个事务内提交。审计、命令、任务或成员任何一步失败，前面的写入和请求状态更新全部回滚。
- `arc_graph_task_member` 主键是 `(request_id, task_id, actor_id)`，同一人在两条并行分支可以有两个独立任务。请求成员的 pending/handled 按所有任务分别取逻辑 OR；完成其中一个不会清除另一个待办。
- 已选路径的后续审批人拥有请求成员身份，但自己的任务激活前不是待办。未选分支不获得成员可见性。同一个人可以同时 pending 和 handled：前者表示还有 ACTIVE 任务未投票，后者表示至少一个任务已有投票。
- 终态拒绝在同一次 CAS 内取消其他 ACTIVE 任务并清除待办投影。并行 join 只在同一次 fork activation 的全部固定分支到齐后触发一次。
- 读取及重启检查定义身份、完整命令重放、事件/命令一致性、任务投影及成员汇总。损坏投影失败关闭，不静默修补。

<!-- topic:retries -->
## 重试与不确定提交

CAS 冲突后由服务重新检查权限、重读并归约。提交键限定于此流程内的申请人；命令键限定于整个请求。同键同 payload 可重放；修改 payload 或反向决定冲突。重试键不能给予其他人的请求访问权。已成功投票若用新键重试，会在一次 CAS 内追加无状态变化的命令和 `COMMAND_REPLAYED` 事件来持久绑定新键，命令修订号加一，原投票、任务和 fork 状态不变。这个新键此后不能用于另一个任务；用原键重试则不追加任何内容。

数据库可能已经提交，但确认响应丢失。适配器会返回 I/O 错误，不把不确定状态冒充成功或普通 CAS 失败。通过服务重读，并使用相同提交键或命令键重试；持久化命令、事件、任务、成员投影用于核实。不要仅因为响应丢失就生成新键。

<!-- topic:rollback -->
## 新旧二进制与回滚边界

- 老 JSON reader 拒绝包装版本 14。新旧适配器必须使用不同文件。禁止把老 writer 指向图文件、把图文件改名成老数据文件，或声称包装 14 是包装 13 的原地升级。
- 老 SQL 二进制继续访问旧 `arc_*` 表，不会读取、理解、保护或拒绝新 `arc_graph_*` 状态；表隔离使它不会覆盖图状态。这是隔离安全，不是图能力混合版本兼容。
- 回滚部署到老二进制时，必须停用或重新路由图接口和图提交入口，保持图表/文件不变。在恢复支持图的二进制之前，旧图实例不可操作。不能交给老归约器或复制进旧请求表。
- 并行部署的图节点必须对 schema 和执行语义达成一致。schema 1 不是未来语义协商机制；未来升级应协调图节点和入口并显式审核迁移。
- 本次没有迁移已有活动实例，原有定义、接口、存储快照和实例保持各自的原协议。

<!-- topic:verification -->
## 可复现验证

运行领域模块 `JsonGraphApprovalStoreTest` 与 JDBC `H2GraphApprovalStoreTest`。真实 PostgreSQL 测试 `PostgresqlGraphApprovalStoreTest` 读取 `ARCFLOW_PG_URL/USER/PASSWORD`；真实 MySQL 测试 `MysqlGraphApprovalStoreTest` 读取 `ARCFLOW_MYSQL_URL/USER/PASSWORD`。只使用允许创建/删除测试命名空间的专用一次性数据库，不能使用真实用户库。每个测试只创建和删除自己的 UUID schema/database；MySQL 在 DDL 前检查实际选中的 catalog。

共享合同覆盖重启、未知 schema、发布后保留旧实例、未完成草稿、草稿/发布冲突、重复/反向决定、同人双任务与 OR 汇总、并发分支只汇合一次、同意/拒绝竞争、成功 SQL 后注入审计/命令/任务/成员失败、提交/决定确认丢失、损坏快照/投影、服务层重试和 ANY 部分拒绝。环境未启用的测试是 skipped，不能算数据库验证。实际运行时应另外记录准确引擎版本和零 skip 结果。
