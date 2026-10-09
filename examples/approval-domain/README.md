# 共享审批领域

<!-- Legacy fragments remain entry points after the language split. -->
<a id="bounded-member-inbox"></a>
<a id="business-document-boundary--业务单据边界"></a>
<a id="explicit-snapshot-compatibility"></a>
<a id="host-contract"></a>
<a id="identity-lifecycle-and-authorization"></a>
<a id="reusable-approval-domain"></a>
<a id="synthetic-seal-use-scenario--合成用印申请"></a>

[English](README.en.md)


<!-- topic:scope -->
`com.arcflow.examples:approval-domain:0.1.0-SNAPSHOT` 是 Java 17 审批领域库。它管理人工审批、流程版本、参与人、不可变业务单据及 `ApprovalStore` 持久化，不包含启动服务器、认证过滤器或演示账号。内核负责同步 DAG 校验，人工等待由此模块管理。

当前支持九种业务类型、六个独立场景；注册类型不会自动向通用 HTTP 开放。完整范围见[架构](../../docs/development/ARCHITECTURE.md)与[业务单据](../../docs/BUSINESS_DOCUMENTS.md)。

<!-- topic:install -->
## 安装与宿主接线

从仓库根目录运行：

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
```

JSON 宿主构造 `ApprovalService(ObjectMapper, String filename, ActorDirectory, ProcessDefinition initialDefinition)`，关闭时调用 `close()`；Spring 可用 `@Bean(destroyMethod = "close")`。数据库宿主使用 `ApprovalService(ApprovalStore, ActorDirectory)`；[JDBC 适配器](../approval-jdbc/README.md)不会自动安装。

每个服务绑定一个稳定流程 ID，格式为 `[A-Za-z][A-Za-z0-9_-]{0,127}`。初始定义只用于没有版本快照的新存储，不能通过发布改名。流程有开始、1–8 个顺序审批步骤和结束；定义 schema 2 为单人、3 增加 2–16 人 ALL/ANY 分组、4 仅在付款/收货/合同宿主增加受限条件。通用与报价宿主不接受 schema 4。

服务拥有存储生命周期，宿主拥有 `DataSource`。先停止接收请求并排空工作，再关闭服务和连接池；关闭 JDBC 存储阻止新操作，但不取消已经开始的事务。

<!-- topic:identity -->
## 身份与授权

线程安全的 `ActorDirectory` 必须提供：

- `findActive(id)`：按不可变宿主 ID 返回仍启用、未删除的用户。
- `listActive()`：宿主允许用于选择审批人的活跃用户目录。
- `canPublish(id)`：查询当前发布权限。
- `canAssignApproval(id)`：默认要求活跃用户；可覆盖为更严格的指派策略。

所有 actor 参数必须来自服务端认证身份，不能信任请求正文。宿主负责端点认证、权限和错误格式。对专用 ObjectMapper 调用 `ApprovalService.strictMapper` 后再解码类型化请求，保留精确数字和严格字段校验。

发布、提交、决策都会重查操作人状态；发布和新提交还检查所有被指派者。已有提交的同键重试按原申请处理，不重新要求历史指派符合新流程资格。恢复快照只验证 ID 与历史结构，删除旧账号不能使历史不可读。管理员不能越过参与人限制。申请人出现在完整定义中，即使条件会跳过该步骤，也不能提交。

列表及决策读回存储后再次检查身份。这是有界重授权，不是身份目录与数据库的原子事务；需要提交时严格撤权的宿主必须自行协调。

<!-- topic:persistence -->
## 持久化与重试

- 默认 JSON 使用独占文件锁、串行状态转换、原子替换和升级前逐字节备份，只支持本地单进程写者。
- 当前读取 wrapper 1–13；流程定义 schema、文件 wrapper 和 SQL revision 是不同版本。完整矩阵、升级步骤和回退限制见[存储迁移](../../docs/development/PERSISTENCE.md)。
- 键控提交原子绑定申请人、键和不可变意图。相同意图返回原申请当前状态，变更意图冲突；无键则每次创建。第三方存储不支持该能力时明确失败。
- 决策重试在精确步骤上重载并重授权，避免重复历史或错误推进下一步。内部修订号为 `history.size() - 1`，不是 HTTP 返回字段。
- `process()`/`list()` 将读取错误包装为 `UncheckedIOException`；其他声明 `IOException` 的方法保留契约。宿主应返回一般服务错误，不能假装空列表或成功。关闭后读操作失败。

存储不提供租户隔离、业务系统事务、自动通知或生产运维保障。用印仅记录审核，不盖章或抓取文件；付款不转账，合同不签署，收货不入库。

<!-- topic:inbox -->
## 成员收件箱

`inbox(actor, box, limit, status, processVersion, cursor)` 返回申请级分页。PENDING 包含当前阶段尚未表决的全部合格成员；HANDLED 只包含实际留下决策事件的人，同一申请可以同时出现。默认 25、最大 100，按不可变创建时间/ID 排序，游标绑定身份与过滤条件。`list(actor)` 保持原语义，不能把兼容字段 `approverId` 当作分组授权或完整待办名单。

<!-- topic:verify -->
## 验证与扩展

```sh
mvn -f examples/approval-domain/pom.xml verify
```

更改领域契约后重新安装，再验证两个宿主、默认 JSON、可选 JDBC 与受影响客户端。不要用原型测试或单场景结果替代合并版本验收。

继续阅读：[架构与扩展](../../docs/development/ARCHITECTURE.md)、[接口参考](../../docs/api/API_REFERENCE.md)、[成员待办](../../docs/MEMBER_INBOX.md)、[条件路由](../../docs/CONDITIONAL_ROUTING.md)、[提交幂等](../../docs/SUBMISSION_IDEMPOTENCY.md)。
