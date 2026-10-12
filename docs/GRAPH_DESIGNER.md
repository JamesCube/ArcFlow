<!-- topic:scope -->
# 结构化审批图工作区

[English](GRAPH_DESIGNER.en.md)

独立审批后端和 Vue 界面提供单独的付款审批图工作区。在“流程设计器”选择“图流程”，通过主导航的“图流程申请”提交模拟付款并处理任务。原顺序设计器、场景 API、RuoYi 集成和移动端保留原有契约，不会自动获得图流程能力。

这是有明确边界的审批解释器，并非通用 BPMN 编辑器。画布坐标只影响展示。发布的 schema 5 定义保存稳定节点 ID、稳定边 ID、有序分支和相互配对的分流/汇合节点；后端验证并执行这些语义。前端校验用于辅助编辑，不能代替后端发布校验或任务权限校验。

<!-- topic:limits -->
## 支持范围

- 一个开始节点、一个结束节点；单人审批；ALL/ANY 多人审批组；条件分支/汇合；并行分支/汇合。
- 最多 32 个节点、48 条边、16 个人工审批节点、每组 16 位参与者；最多两层嵌套区域；每个区域 2–4 个分支。整个定义最多 32 个条件原子，每条规则最多 8 个。
- 分支区域必须单入口、单出口且正确配对。不支持循环、游离节点、跨区域连线、跨分支共享节点、错配汇合，且每次完整成功执行必须包含人工审批。空分支可以直接到达自己配对的汇合节点；并行汇合仍必须等待其他所有分支完成。
- 条件分支按边数组顺序执行 FIRST_MATCH。必须有且仅有一个无条件默认分支，放在最后。条件可以重叠，顺序决定优先级，并不宣称它们互斥。
- 条件只使用 `payment.netTotal`，支持 `EQ`、`GT`、`GTE`、`LT`、`LTE` 和精确金额阈值；规则内使用 ALL/ANY。一个定义的金额条件必须使用同一币种。业务类型或币种不匹配会明确拒绝提交，不会偷偷走默认分支。

`GET /api/graphs/payment/capabilities` 返回节点类型、上述限制、事实字段和运算符、当前身份的发布权限以及宿主/存储边界。`GET /users` 返回当前可分配的审批人，界面不硬编码参与者。

<!-- topic:authoring -->
## 草稿、预览与发布

选择连线上的“+”，插入审批节点或完整配对的条件/并行区域。选择分支后，在属性面板修改名称、金额条件和顺序；上移条件会改变 FIRST_MATCH 优先级。默认分支固定最后，不允许单独删除。选择审批节点后，从当前可分配人员中选择参与者，并配置单人、ALL 或 ANY 投票规则。删除区域会一起移除分流、配对汇合和内部各分支；撤销会完整恢复这次操作。

窄画布将每个分流显示为有明确边界、分别编号的分支区域。这些分支是备选或同时执行的路径，不是顺序步骤：区域标题说明“按顺序首个命中”或“等待全部并行分支”，配对汇合显示在分支区域之外。桌面可选择“展开完整画布”，为并排分支腾出空间；返回属性时保留选择。手机可在流程图和属性之间切换，或按 Escape 返回选中的图项。Tab、Enter 操作不依赖拖拽；Ctrl/Cmd+Z 与 Ctrl/Cmd+Shift+Z 撤销/重做图编辑，不抢占输入框自身的撤销。

草稿允许保存和重新加载尚未连好的中间状态，但字段、ID 和数量上限必须有效。发布前必须通过完整的后端拓扑校验，并确认审批人当前仍可分配。草稿修订号、发布版本和定义 schema 是三个独立概念。

保存需要最近读到的草稿修订号；发布同时需要当前发布版本和草稿修订号。过期请求返回 409，不覆盖他人的修改。发布成功后，发布版本递增，草稿原子地重置为刚发布的定义，草稿修订号也递增。预览只计算传入的图和业务数据，不保存草稿、不创建申请，也不改变发布版本。

业务数据使用既有 `paymentRequest` 契约：供应商引用、币种、申请付款日期，以及 1–20 行发票分配明细。后端精确计算所有行的分配金额减扣减金额之和。提交不接受客户端提供的 `netTotal`、路由、任务、状态或申请人。这个模拟审批不占用发票、不转账、不签署文件，也不向银行下发指令。

<!-- topic:execution -->
## 运行与权限

提交时冻结流程定义、规范化业务数据和选择结果。后续发布只影响新申请。每个任务都有独立 ID、节点实例 ID、参与者、投票和状态；同一个人可以同时持有同一申请的多个任务。构造任务操作 URL 时必须编码任务 ID。

并行分流为每次激活保存预期分支边 ID。各分支结束时登记到达；配对汇合只在全部预期分支到达后触发一次，再激活下游。状态、任务、分支到达和事件通过申请修订号 CAS 一起保存。冲突时服务重新读取、重新校验权限并重新计算，因此不同任务的同时操作不会悄悄互相覆盖。

ALL 模式任一拒绝即拒绝申请。ANY 模式中，单人拒绝后任务仍保持活动，其他参与者可以通过；任一通过即完成该组，只有所有人均拒绝才拒绝。申请终止拒绝时，其他活动任务在同次原子写入中取消，重试不得恢复已取消任务。

只有申请人和冻结选中路径上的参与者可以查看申请，包括选中的后续审批人，不包括未选中分支的审批人。发布权限不等于全量申请读取权限，也不允许代别人审批。每个命令都从认证身份出发，检查当前有效目录和准确任务的参与者。

<!-- topic:http -->
## HTTP 契约

基础路径：`/api/graphs/payment`。全部接口使用独立后端的 Basic 认证。写请求还需要 `Content-Type: application/json`、`X-Arcflow-Client: approval-demo`，并遵守现有 Origin/Fetch Metadata 防护。身份始终由认证结果提供。

| 方法与后缀 | 请求体 | 返回值 |
| --- | --- | --- |
| GET `/capabilities` | 无 | 能力边界、事实字段、身份权限 |
| GET `/process` | 无 | 已发布 `GraphDefinition` |
| GET `/workspace` | 无 | `{storageSchemaVersion:14,definition,draft,requests:[]}`；仅发布者 |
| GET `/users` | 无 | 当前可分配的 `{id,displayName}` |
| PUT `/draft` | `{expectedRevision,definition}` | `{revision,baseVersion,definition}`；仅发布者 |
| POST `/validate` | `GraphDefinition` | `{diagnostics:[{code,message,nodeId,edgeId}]}`；仅发布者 |
| POST `/preview` | `{definition,business}` | 不持久化的 `GraphInstance`；仅发布者 |
| POST `/publish` | `{expectedVersion,expectedDraftRevision}` | 新发布定义；仅发布者 |
| GET `/requests` | 无 | 按可见权限过滤的 `GraphInstance[]` |
| GET `/requests/{id}` | 无 | 可见的 `GraphInstance` |
| POST `/requests` | `{expectedVersion,business}` | `GraphInstance`，HTTP 201；必须传 `Idempotency-Key` |
| POST `/requests/{id}/tasks/{taskId}/decision` | `{decision,comment}` | `GraphInstance`；必须传 `Idempotency-Key` |

`decision` 只允许 `APPROVE` 或 `REJECT`。`comment` 是必填字符串，最多 2,000 字符，允许空字符串。幂等键必须恰好一个请求头值，长度 1–128，使用允许的安全字符。响应不确定时，保留原幂等键和原始请求重试。相同键但不同内容返回 409。提交键按申请人隔离，审批命令键在申请内唯一；相同键和相同内容重放成功命令时，不增加投票或事件。同一人对同一任务以新键重试相同决定，会持久化 `COMMAND_REPLAYED` 收据来绑定新键，命令修订号增加一次，但保留原投票/意见和全部任务状态；此键以后不能用于不同内容。每笔申请最多接受 768 个新键重放收据，并为原始投票保留最多 256 个位置（合计最多 1,024 个命令键）。重放别名超过预算后返回 409 且不修改状态；别名重试不会占满尚未完成的真实投票位置。达到预算后，相同键重试仍可只读返回。同一人在同一任务改变已记录的决定也返回冲突。

定义、节点和边的全部属性都必须存在；可空属性须显式填写 `null`。未知字段、重复键、额外尾随 JSON 和错误的数字/标量转换均拒绝。

- 定义：`schemaVersion`、`id`、`version`、`name`、`nodes`、`edges`。
- 节点：`id`、`type`、`name`、`assigneeIds`、`completionMode`、`pairId`。
- 边：`id`、`source`、`target`、`label`、`condition`、`defaultBranch`。
- 实例：`id`、`submissionKey`、`applicantId`、`status`、`createdAt`、`updatedAt`、`commandRevision`、`definition`、`business`、`tasks`、`forks`、`routes`、`events`、`commands`。

付款业务输入沿用 [API 参考](api/API_REFERENCE.md) 的严格原始 JSON 契约。运行状态只供输出，不接受客户端回填。图流程没有单一 `currentStep` 投影。每个持久化人工命令令 `commandRevision` 增加一次，与事件数量无关。错误包括：400 输入无效、401 未认证、403 无权限、404 申请或任务不存在、409 过期/冲突、503 存储操作未确认。

<!-- topic:storage -->
## 持久化、重启与宿主边界

独立后端使用相邻的新文件 `<APPROVAL_DATA_FILE>.graph.json`，存储 schema 为 **14**，并使用单独写锁。空库以付款示例图初始化；不转换旧实例，也不覆盖旧文件。只支持 wrapper 1–13 的旧读取器不得打开该文件。读取时通过冻结定义、业务和命令重放校验保存状态，包括任务、分支和事件投影。

可选 JDBC 库提供单独的 `arc_graph_*` 表和图 schema 元数据版本 **1**。必须在明确选择、经过验证的数据库中手动安装对应 SQL。旧 `arc_request` 表和迁移版本不变。引入库或安装 SQL 不会让独立后端自动切换 JDBC；仍需明确的宿主装配与验收。本次交付不将 RuoYi 或移动端列为图流程宿主。

各版本轴互不替代：定义 schema 5、递增的发布版本、草稿修订号、JSON wrapper 14、JDBC 图 schema 1、申请命令修订号和事件序号。升级前应备份独立图文件/表、停止不兼容写入器，并保留兼容恢复程序。恢复备份会丢失备份后的更改。

<!-- topic:verification -->
## 构建与验证

在仓库根目录使用 JDK 17+、Maven 3.9+：

```bash
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml verify
```

运行方法沿用独立后端 [README](../examples/approval-demo/backend/README.md)。后端测试覆盖认证/Origin/严格 JSON、中间草稿与发布 CAS、多行付款后端预览及无写入、定义冻结和可见性、不同任务并发、汇合释放、拒绝取消，以及真实回环 HTTP 下完整停机重启。领域与 JDBC 测试独立覆盖解释器和存储边界。测试文件存在并不代表未经验证的环境或提交已经通过。
