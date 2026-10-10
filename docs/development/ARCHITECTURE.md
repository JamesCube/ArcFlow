# 架构与扩展

<!-- Legacy fragments remain entry points after the language split. -->
<a id="module-boundaries"></a>
<a id="nine-types-six-catalog-scenarios"></a>
<a id="the-lifecycle-of-a-request"></a>
<a id="voting-and-conditional-paths"></a>
<a id="where-to-extend"></a>
<a id="架构与扩展--architecture-and-extension"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](ARCHITECTURE.en.md) · [文档目录](../README.md)

<!-- topic:module-boundaries -->
## 模块边界

| 层 | 源码入口 | 职责与边界 |
| --- | --- | --- |
| Java 内核 | [`src/main/java/com/arcflow`](../../src/main/java/com/arcflow/) | 校验 DAG、按拓扑顺序同步串行执行处理器、返回变量与事件；不保存人工等待或执行状态 |
| 审批领域 | [`examples/approval-domain`](../../examples/approval-domain/src/main/java/com/arcflow/approval/) | 身份目录接口、不可变业务数据、流程版本、表决状态机、幂等、冻结路由和存储 SPI |
| 默认存储 | [`JsonApprovalStore`](../../examples/approval-domain/src/main/java/com/arcflow/approval/JsonApprovalStore.java) | 单进程文件锁、原子快照、严格恢复与升级备份 |
| 可选存储 | [`examples/approval-jdbc`](../../examples/approval-jdbc/README.md) | JDBC 事务、保留版本、独立审计和成员索引；宿主管理 DataSource、驱动和迁移 |
| 独立宿主 | [`examples/approval-demo/backend`](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/) | Boot 4.1.1、HTTP Basic、固定演示目录、严格 JSON、三个端点家族及各自存储 |
| 独立界面 | [`examples/approval-ui`](../../examples/approval-ui/README.md) | Vue 工作区、设计器、报价页与场景页；不作为最终权限或金额校验依据 |
| 其他宿主／客户端 | [RuoYi](../../examples/ruoyi-vue3/README.md)、[H5](../../examples/approval-mobile/README.md) | 若依复用原生账号权限；H5 只读／审批请假与采购，不自动获得全部场景能力 |

根 POM 不聚合示例。运行依赖通常为宿主 → 领域 → 内核；JDBC 适配器依赖领域，不反向进入内核。领域有 Jackson 2 和 Spring Web 依赖（用于状态异常），不是“零依赖”模块；只有内核没有第三方运行时依赖。

<!-- topic:the-lifecycle-of-a-request -->
## 一笔申请怎样流转

1. 宿主认证请求，从服务端 Principal／会话取得 actor；不能接收客户端指定的申请人或投票人。
2. 控制器限制端点对应的业务类型、解码严格 JSON，将命令交给 `ApprovalService`、`QuoteDiscountCase` 或 `ScenarioCase`。
3. 领域检查活动身份、权限、流程版本与业务数据。核心 DAG 负责提交校验／规范化；人工审批不会让 DAG 线程挂起。
4. 提交保存完整业务、流程定义和首条 `SUBMIT` 历史；条件流程还会计算并保存冻结路径。存储把申请、提交键及派生索引作为同一操作提交。
5. 决定按保存的当前步骤和成员授权，追加一条历史，并用修订号保护并发更新。发布新版本只影响新申请。
6. 重放和恢复重新验证历史及派生状态。幂等重试返回当前申请状态，不重新投票，不保证返回第一次响应的旧字节。

阅读顺序：[ApprovalService](../../examples/approval-domain/src/main/java/com/arcflow/approval/ApprovalService.java) → [SubmissionWorkflow](../../examples/approval-domain/src/main/java/com/arcflow/approval/SubmissionWorkflow.java) → [ApprovalStore](../../examples/approval-domain/src/main/java/com/arcflow/approval/ApprovalStore.java)；HTTP 细节见[接口参考](../api/API_REFERENCE.md)。

<!-- topic:voting-and-conditional-paths -->
## 审批节点与条件路径

- 定义为固定 `start` → **1–8 个有序人工步骤** → 固定 `end`。这不是任意连线、循环或 BPMN 执行器。
- UI 的 **SINGLE** 对应 `type: "approval"` 和单个 `assigneeId`，不是 JSON 的 `completionMode: "SINGLE"`。
- **ALL**／**ANY** 对应 `type: "parallelApproval"`、`assigneeId: null`、2–16 个不同 `assigneeIds` 和 `completionMode`。独立演示只允许 Bob、Carol，因此其分组只能包含这两人。
- ALL 全员同意才推进，任一拒绝即结束；ANY 任一同意即推进，全部拒绝才结束。同一人跨步骤需要逐步表决。内核依然串行；这里的“并行”描述同一步骤中可独立投票的成员。
- 定义 schema 2 为单人顺序，3 增加分组，4 增加受限 `runIf`。仅报销、付款、收货、合同场景允许 schema 4，其他场景及通用／报价宿主不能发布它。
- 条件仅针对 `expense.totalAmount`、`payment.netTotal`、`receiving.hasRejectedLines`、`contract.termsKind`；全定义至多八个条件原子，至少一个无条件人工步骤。规则组合的 ALL／ANY 与成员表决的 ALL／ANY 是两套含义。
- 服务端按不可变业务和完整定义冻结路径与实际判定值。跳过的步骤不是已通过；只在跳过步骤中的人员不能据此读取或投票。禁止申请人出现在完整定义中，即使其步骤将被跳过。

详报销路由对保存的全部费用明细精确求和，币种必须显式匹配且不换汇。即使跳过财务，完整定义仍保留；routing schema 1 记录选中路径及每个谓词事实。不增加新 schema、宿主端点、业务类型、动态角色或租户边界。见[报销操作案例](../EXPENSE_ROUTING.md)。

见 [ProcessDefinition](../../examples/approval-domain/src/main/java/com/arcflow/approval/ProcessDefinition.java)、[ConditionalRouting](../../examples/approval-domain/src/main/java/com/arcflow/approval/ConditionalRouting.java)、[分组契约](../PARALLEL_APPROVAL.md)与[条件契约](../CONDITIONAL_ROUTING.md)。

<!-- topic:nine-types-six-catalog-scenarios -->
## 九种业务类型与六场景目录

领域的[显式注册表](../../examples/approval-domain/src/main/java/com/arcflow/approval/BusinessDocumentSchema.java)不等同于 HTTP 开放范围：

| 业务类型 | 独立端入口／宿主 |
| --- | --- |
| `leave`、`procurement` | `/` 主工作区；通用 `/api/documents`，另保留兼容请假 `/api/requests` |
| `quoteDiscount` | `/quote-discount.html`；专用 `/api/crm`，固定经理 → 财务流程 |
| `expense` | 场景 `oa-expense` |
| `travel` | 场景 `oa-travel` |
| `sealUse` | 场景 `oa-seal-use` |
| `receiving` | 场景 `erp-receiving`；另有 `/receiving.html` 入口 |
| `paymentRequest` | 场景 `erp-payment` |
| `contractApproval` | 场景 `crm-contract` |

六场景共用 `/scenarios.html` 目录和 `/api/scenarios/{scenarioId}/...` 路由模式，各自绑定准确类型、流程 ID 和数据文件。场景元数据由 [ScenarioCatalog](../../examples/approval-domain/src/main/java/com/arcflow/approval/ScenarioCatalog.java) 编译定义；不是任意 JSON Schema、拖拽表单发布或动态插件系统。报价另有源版本、归属和可见性校验。专用端点不会把记录合并到主工作区待办。

所有场景都只保存合成业务审批状态。引用不是附件上传；通过不会付款、签约、盖章、入库或回写 CRM／ERP。

<!-- topic:where-to-extend -->
## 接入或扩展时改哪里

- **接入企业身份：**实现 [ActorDirectory](../../examples/approval-domain/src/main/java/com/arcflow/approval/ActorDirectory.java)，使用不可变 ID、活动／删除状态及实时发布／指派权限；在宿主认证后调用领域。显示名不是身份键。
- **接入存储：**实现 `ApprovalStore` 的原子发布、创建、追加决定、持久提交键和有界成员查询。不能用内存缓存冒充持久幂等，也不能用全列表扫描静默替代有界 inbox。服务关闭存储；DataSource 生命周期仍归宿主。
- **增加业务类型：**增加严格类型与验证、显式类型／最低快照版本登记、宿主允许列表、必要的表单元数据、响应处理和隔离存储。先设计兼容迁移；只加注册项不会开放通用端点。
- **修改路由／投票：**同步测试完整定义与有效路径、成员授权、索引、重放、存储恢复和前端响应验证；不要只修改设计器显示。
- **增加外部副作用：**当前没有业务表联合事务、outbox 或可靠通知。必须另行设计失败恢复和幂等，不能把“审批通过”当成已执行外部操作。

测试入口包括 [ParallelApprovalTest](../../examples/approval-domain/src/test/java/com/arcflow/approval/ParallelApprovalTest.java)、[ConditionalRoutingStoreTest](../../examples/approval-domain/src/test/java/com/arcflow/approval/ConditionalRoutingStoreTest.java)、[UnifiedScenarioApiTest](../../examples/approval-demo/backend/src/test/java/com/arcflow/demo/UnifiedScenarioApiTest.java) 与[前端 E2E](../../examples/approval-ui/e2e/)。运行顺序见[开发环境](QUICKSTART.md#zh)。
