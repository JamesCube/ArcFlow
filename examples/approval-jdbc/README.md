# 可选 JDBC 存储

<!-- Legacy fragments remain entry points after the language split. -->
<a id="boundaries"></a>
<a id="bounded-member-inbox-and-explicit-sql-revision-3-upgrade"></a>
<a id="build-and-verify"></a>
<a id="durable-submission-retries-and-revision-2-upgrade"></a>
<a id="explicit-schema-installation"></a>
<a id="host-integration"></a>
<a id="mysql-8-integration-target"></a>
<a id="optional-jdbc-approval-persistence"></a>
<a id="parallel-group-schema-compatibility"></a>
<a id="primary-references"></a>
<a id="process-isolation-in-revision-3"></a>
<a id="transactions-concurrency-and-failures"></a>

[English](README.en.md)


<!-- topic:scope -->
适用范围：当前 `approval-jdbc:0.1.0-SNAPSHOT`。此模块实现 `ApprovalStore`，使用 JDK JDBC、共享领域及 Jackson，不引入 Spring JDBC 或 ORM。宿主提供驱动、连接池、凭据和迁移。默认示例继续用 JSON，只有显式接线才使用数据库。

构造器识别 H2、PostgreSQL 和实验性 MySQL 8 目标，拒绝其他数据库。MySQL 最低 8.0.17；5.7、MariaDB、9.x、非 InnoDB 和厂商分支不在验证目标中。真实版本支持应以对应提交的集成 CI 为准。

<!-- topic:build -->
## 构建与测试

从仓库根目录，使用完整 JDK 17+、Maven：

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-jdbc/pom.xml verify
```

默认执行真实 H2 连接及共享契约。未设置连接环境变量时，PostgreSQL/MySQL 测试会跳过，不算通过。仅在可丢弃测试库运行以下真实服务测试：

```sh
export ARCFLOW_PG_URL=jdbc:postgresql://localhost:5432/arcflow_test
export ARCFLOW_PG_USER=arcflow_test
mvn -f examples/approval-jdbc/pom.xml -Dtest=PostgresqlApprovalStoreTest verify

export ARCFLOW_MYSQL_URL='jdbc:mysql://localhost:3306/arcflow_test?sslMode=VERIFY_IDENTITY'
export ARCFLOW_MYSQL_USER=arcflow_test
mvn -f examples/approval-jdbc/pom.xml -Dtest=MysqlApprovalStoreTest verify
```

对应密码通过安全测试环境提供，不能写入源码。PostgreSQL 测试创建/删除唯一 schema；MySQL 创建 UUID 命名数据库并确认选中的 catalog，只删除自身创建的库。必须使用专用测试身份，不能连接生产。MySQL 的 `databaseTerm=SCHEMA` 等导致 catalog 选择失效的配置会失败。

<!-- topic:schema -->
## 显式安装和权限

使用宿主迁移系统选择一个 `src/main/resources/com/arcflow/approval/jdbc/schema-*.sql`：`schema-h2.sql`、`schema-postgresql.sql` 或 `schema-mysql.sql`。它们仅用于空库安装，不是升级脚本或 JSON 导入。构造器不会执行 DDL；缺表、未就绪的成员投影和已知不安全 MySQL 结构会被拒绝。

SQL revision 为 3，和流程定义 schema、JSON 文件 wrapper 无关。七张表分别保存：

| 表 | 职责 |
| --- | --- |
| `arc_process_version` | 不可变定义、发布人和时间；初始化人为 `bootstrap` |
| `arc_process_head` | 活跃版本以及发布/提交共享行锁 |
| `arc_request` | 请求 JSON 与规范化版本、流程、状态和时间 |
| `arc_request_event` | 追加历史；索引 0 为 SUBMIT |
| `arc_submission_key` | 全库申请人/键到唯一申请的绑定 |
| `arc_request_member` | 精确成员及待办/已办投影，包含流程 ID |
| `arc_member_projection_state` | 就绪状态与可恢复回填检查点 |

应用角色只需对版本、事件、键表 SELECT/INSERT，对 head/request/member 表 SELECT/INSERT/UPDATE，对迁移状态 SELECT。DDL、删除与修复由独立运维身份处理；回填身份另需更新成员/状态。数据库所有者仍可改写数据，此校验不是加密防篡改证明。

MySQL 使用 InnoDB、DYNAMIC、`utf8mb4_0900_bin` 的 NO PAD 精确比较和 LONGTEXT JSON。旧 PAD SPACE 排序、TEXT 容量或错误字符规则不能等价替代。主机负责严格 SQL 模式、TLS、超时、容量、`max_allowed_packet` 和备份。

<!-- topic:migration -->
## 升级到 revision 3

1. 停止并排空所有旧、新读取端和写入端，备份，准备迁移身份。不能混跑旧新应用。
2. revision 1 先执行对应 `upgrade-*-v1-to-v2.sql`；revision 2 执行一个匹配数据库的 `upgrade-*-v2-to-v3.sql`。MySQL DDL 隐式提交，不能放进审批事务。
3. 显式调用 `JdbcApprovalStore.backfillMembers(dataSource, objectMapper, batchSize)`，batchSize 为 1–100。每次只处理一批并返回 `BackfillProgress(processed, ready, lastRequestId)`；ready 为 false 时继续调用。
4. 回填检查保存的请求/历史/定义，同一事务写成员及检查点。失败批次回滚，可安全重试。保持写者停止，不手工编辑迁移状态。最终批次检查缺失覆盖后才设 ready=true。
5. 部署匹配的领域/JDBC/宿主，再开放流量。就绪后重复回填是无操作。已有草稿版投影不能冒充正式 revision 2，不能直接重跑升级脚本；需要新测试库或另行审阅的数据迁移。

构造器不自动回填，不隐藏地遍历历史。新安装脚本只因数据库为空而标记就绪。升级不改写历史 JSON、审计或幂等映射；恢复旧备份会丢失后来业务，不是无损降级。更高业务类型和 schema 4 即使不改 SQL 表，也要求全部应用理解新请求内容。

报销 `expense.totalAmount` 条件复用 SQL revision 3，无新 DDL；保存完整保留定义与申请路径，按有效路径派生成员。旧程序可能已懂 schema 4/wrapper 13，却仍拒绝新字段；须一起部署兼容程序并在发布前备份。已就绪的 schema 2/3 投影保持原路径。见[报销上线步骤](../../docs/EXPENSE_ROUTING.md#rollout-and-recovery)。

<!-- topic:integration -->
## 宿主接入和事务

```java
var store = new JdbcApprovalStore(dataSource, objectMapper, initialDefinition);
var service = new ApprovalService(store, actorDirectory);
```

类名为 `com.arcflow.approval.jdbc.JdbcApprovalStore`，领域类型在 `com.arcflow.approval`。每个适配器永久绑定 initialDefinition.id；同 schema 可保存不同流程。初始化仅在无活跃 head 时生效，并发初始化收敛到首个提交定义。普通查询、发布与写入限定该流程；这不是租户隔离。

- 每次操作独立借连接，要求初始 auto-commit=true，适配器自行控制并恢复设置。不要传共享连接或事务代理。它不加入 Spring `@Transactional`、XA 或业务表事务。
- 写入使用 READ_COMMITTED。发布/提交锁定流程 head；决策锁定申请、验证仅追加一条历史并比较版本，状态、审计和成员投影共同提交。失败全部回滚。
- 读取在 PostgreSQL/MySQL 使用 REPEATABLE_READ，H2 使用 SERIALIZABLE，完整核对请求、定义、审计和成员，不静默修复损坏。
- 不普遍重试死锁、超时或序列化失败。只在确定的初始化或键插入重复、且回滚清理完整时，用新事务读取胜者。PostgreSQL/H2 为 SQLState 23505；MySQL 还必须同时满足 23000/1062。其他完整性、链式错误或清理失败仍失败。
- commit 响应丢失时结果可能不确定，先查持久状态。清理失败即使发生于 commit 后也要报告。关闭存储阻止新操作但不取消进行中事务；宿主排空后自行关闭 DataSource。

<!-- topic:retry-inbox -->
## 幂等和成员分页

提交键格式为 `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`，不 trim、不折叠大小写。申请人来自认证。键在全 schema 按申请人绑定，不增加流程维度；跨流程或业务意图复用会冲突。请求、初始历史和键共同提交。决策后或重新发布后仍可用原键取原申请当前状态；新键加旧流程版本不能创建或占键。无键每次创建。

成员投影覆盖保存的有效路线中的所有不同成员，包括未来阶段和仍未投票的已选成员；schema 4 跳过阶段的独占参与者不被纳入，PENDING 只取当前未投票者，HANDLED 只取实际事件，可重叠。二进制精确 actor key、bucket、不可变秒/纳秒/ASCII ID 为有界 keyset 索引。非空页使用六次 SELECT，与页大小无关，只解码候选申请。游标不是授权凭据，后续页面是实时查询，不是跨请求冻结快照。

选中申请的投影、修订、规范化字段、定义或历史不一致会失败；它不是对全数据库的无限腐败扫描，删除完整候选行可能导致漏行，需要运维修复。兼容字段 `approver_id` 无法代表全部分组待办。

<!-- topic:limits -->
## 验证边界

真实服务器套件覆盖竞态、ALL/ANY、幂等、失败回滚、历史损坏、隔离、成员分页和重开适配器。重开适配器不等于数据库崩溃恢复。H2 或模拟方言不能证明 PostgreSQL/MySQL 通过，旧测试计数不代表当前提交。

此模块不提供自动迁移、租户隔离、任务调度、outbox、通知、跨业务事务、加密密钥管理或 JSON 导入。参考[存储迁移](../../docs/development/PERSISTENCE.md)、[幂等契约](../../docs/SUBMISSION_IDEMPOTENCY.md)、[成员收件箱](../../docs/MEMBER_INBOX.md)和[历史 MySQL 证据](MYSQL_VERIFICATION.md)，以目标提交的 CI 做验收。
