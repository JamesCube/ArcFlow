# 业务审批图：出差、收货与报价折扣

[English](GRAPH_BUSINESS_SCENARIOS.en.md) · [开发文档](development/README.md) · [图工作区契约](GRAPH_DESIGNER.md)

<!-- topic:scope-and-identity -->
## 范围与固定身份

独立后端与 Vue 图工作区在既有付款图之外，提供出差、收货和报价折扣三种业务图。它们共用有界图解释器：付款保留定义 schema 5，三种新业务使用字段形状相同的 schema 6；各自使用固定流程 ID、严格业务模型、草稿、发布版本和隔离存储。选择业务类型不是给同一份付款单改标题，也不开放任意业务类型。

| 图 API 基础路径 | 流程 ID | `business.type` | 可用条件事实 |
| --- | --- | --- | --- |
| `/api/graphs/payment` | `payment-graph` | `paymentRequest` | `payment.netTotal` |
| `/api/graphs/travel` | `travel-graph` | `travel` | `travel.estimatedCost` |
| `/api/graphs/receiving` | `receiving-graph` | `receiving` | `receiving.hasRejectedLines` |
| `/api/graphs/quote` | `quote-graph` | `quoteDiscount` | `quote.reductionTotal`、`quote.discountPercent` |

端点、流程 ID、事实字段与业务类型必须一致；即使定义没有条件，也不能提交另一类型的单据。`GraphScenarios` 同时绑定 schema 与流程身份。所有历史 schema 5 定义仍仅限付款，包括恰好名为 `travel-graph`、`receiving-graph`、`quote-graph` 的自定义 ID。schema 6 才明确启用新的固定业务；新业务宿主不能把定义降为 schema 5。这是固定演示格式，不是任意可移植的多业务图格式。原顺序/分组场景 API、原报价页、付款图 URL、RuoYi 原生页面和 H5 契约不变；RuoYi 与 H5 没有因此获得图宿主能力。

<!-- topic:travel -->
## 出差：费用分支之前保留经理审批

出差业务保留 `documentVersion: 1`、`businessId`、`title`、`reason`，以及 `destination`、`startDate`、`endDate`、`purpose`、`estimatedCost`、`currency`、`costCenter`。开始/结束日期合计 1–90 天。用途为 `CUSTOMER_VISIT`、`PROJECT_DELIVERY`、`TRAINING`、`CONFERENCE` 或 `OTHER`；成本中心为 `ENGINEERING`、`SALES` 或 `OPERATIONS`。

`estimatedCost` 是申请人填写、后端校验的预计费用，并非从外部预订系统生成的实际费用。金额规则沿用出差 DTO：严格 JSON 数字、币种精度和范围，JPY 不允许小数。后端将规范化后的预计费用作为 `travel.estimatedCost`，不接受客户端提供路由结果。

初始图先由 Bob 经理审批；预计费用达到 10,000 CNY 后，再同时激活 Bob 的运营复核与 Carol 的财务复核，并等待两条分支完成。低于阈值的默认路径直接经过配对汇合到结束；经理审批仍必需。这一空默认分支不代表整个申请可以没有人工审批。阈值和节点可以在图工作区修改并发布。

<!-- topic:receiving -->
## 收货：逐行数量与质量异常

收货业务使用 `documentVersion: 1`、`businessId`、`title`、`reason`、`purchaseOrderRef`、`warehouse`（`EAST`/`WEST`）、`receivedOn`，以及 1–20 行 `lines`。每行包括 `lineId`、`orderLineRef`、`description`、`unit`、`ordered`、`received`、`accepted`、`rejected`、`exceptionReason`。

后端要求逐行满足 `accepted + rejected = received <= ordered`，至少一行已收货，行 ID 与采购单行引用分别唯一。拒收数量大于零时必须填写异常原因；不同单位的数量不能相加成为一个业务总量。

`receiving.hasRejectedLines` 由后端检查全部行是否存在 `rejected > 0` 得出；谓词仅允许 `EQ` 和布尔 `expected`。初始图中，有拒收行进入质量复核（Bob）与采购复核（Carol）的并行路径，无拒收行进入 Bob 的常规收货审核。并行汇合等待两条路径，不把第一条完成当作全部完成。

<!-- topic:quote-source-and-pricing -->
## 报价折扣：源版本、权限与精确计算

先读取 `/api/graphs/quote/quotes`，获得当前身份可读的当前 `QuoteVersion[]`。提交业务为 `quoteDiscount`：`businessId`、`title`、`reason`、`customerRef`、`quoteRevision`、`item`、`quantity`、`listUnitPrice`、`requestedUnitPrice`、`currency`、`validUntil`。这个既有类型没有 `documentVersion` 字段。源列表的 `revision` 对应提交的 `quoteRevision`。

客户引用、商品、数量、标价、币种和有效期必须与指定源版本相符。申请人只能修改标题、理由和申请单价；申请单价必须大于零且严格低于标价。后端以 `BigDecimal` 计算减让总额 `(listUnitPrice - requestedUnitPrice) * quantity`。百分比条件通过交叉相乘比较 `(listUnitPrice - requestedUnitPrice) * 100` 与 `listUnitPrice * threshold`。运行页将精确比值显示为易读的百分比；显示精度无法完整表达时，用“约”或“小于／大于”提示。冻结 JSON 快照仍保留原始精确比值；显示格式不会改变条件判定，也不会参与路径选择。

- 只有源报价负责人可以提交。发布权限本身不赋予源报价可读权限。
- 预览要求可读源版本、源字段一致、当前版本且未过期，并要求选中路径上的全部审批人可读该版本。
- 首次提交还要求当前源版本、UTC 当日未过期，以及选中审批人的源权限；`validUntil` 当日仍有效。
- 列表、详情和任务命令除图申请可见性外，还检查当前源报价访问权限。撤销源权限会影响后续访问与投票。
- 已保存申请仍冻结原定义和业务；报价后来更新或过期不重选路径，也不单独禁止仍有权限的任务审批或原意图重放。源版本必须仍存在且可读。

初始图以折扣至少 20% 进入 Bob 的商业复核与 Carol 的财务复核，等待全部完成后进入 Carol 的最终确认；低折扣走 Bob 的常规审核后再最终确认。也可在本业务图中使用 `quote.reductionTotal` 金额条件。百分比阈值为 0–100，最多两位小数；无 `currency` 字段。图接口返回 `GraphInstance`，不是旧 `QuoteView`；运行页展示冻结的修订号和有效期，没有实时过期/源版本更新标志。

<!-- topic:authoring-and-http -->
## 编辑、预览与调用

在图工作区选择业务后，分别读取该路径的 `/capabilities`、`/process`、`/workspace` 和 `/users`。能力返回的是本业务的事实，不是所有图事实的并集。保存 `/draft`、校验 `/validate`、预览 `/preview`、发布 `/publish`、提交 `/requests` 和任务 `/decision` 沿用[图 HTTP 契约](GRAPH_DESIGNER.md#http-契约)。控制器映射为 `/api/graphs/{scenario}`，仅允许上述四个键；未知键返回 404。`/quotes` 仅对 `quote` 可用，其他已知业务返回 400。

提交使用 `{expectedVersion,business}`；预览使用 `{definition,business}`。所有写操作仍需要认证、JSON 与 `X-Arcflow-Client: approval-demo`；提交和任务决定必须恰好传一个合法 `Idempotency-Key`。运行状态、任务、申请人、汇合状态、派生金额和路由均由服务端产生，不能回填为命令字段。预览不创建申请、不保存草稿、不修改发布版本。

报价图要求请求头使用确定的修订键：`quote:` 加 UTF-8 `businessId + "\\n" + 十进制修订号` 的小写 SHA-256。分隔符是反斜杠与 `n` 两个字面字符，不是换行符；其他请求头值返回 400。持久提交键按申请人隔离：同一负责人不能通过换键重复创建同一报价版本。相同原始版本与规范化业务重放返回已保存申请的当前状态；同版本修改价格或其他提交内容返回 409。它与旧 `/api/crm/documents` 禁止幂等头的契约不同。

<!-- topic:frozen-runtime-and-retries -->
## 冻结实例、并行汇合与重试

所有业务使用同一个 `GraphInstance` 结构，冻结提交时的图定义、规范化业务和 FIRST_MATCH 选择结果。新发布只影响新申请。每个并行激活保存预期分支边 ID，只有全部分支到达时才释放配对汇合一次；节点上的 ALL/ANY 人员投票不改变并行汇合的 ALL 语义。

申请修订号 CAS 将任务、投票、分支到达与事件原子保存。冲突时重新读取并重新校验权限。终态拒绝会取消其他活动任务，重放不能恢复它们。响应不确定时保留原端点、原版本、原业务、原任务与原幂等键重试；不要通过新建申请规避冲突。精确命令重放不增加投票/事件，新键同决定重放及其限额见[完整契约](GRAPH_DESIGNER.md#http-契约)。

<!-- topic:persistence-and-boundaries -->
## 持久化与明确边界

付款保留 `<APPROVAL_DATA_FILE>.graph.json`。新增文件为 `<APPROVAL_DATA_FILE>.travel.graph.json`、`.receiving.graph.json`、`.quote.graph.json`；每份文件独立持有写锁、草稿、版本和实例。付款定义仍为 schema 5；出差、收货、报价使用 schema 6。JSON wrapper 仍为 14，JDBC 图表 schema 仍为 1。存储 schema 数字不变不代表旧二进制认识 schema 6 定义、新业务或事实；旧图读取器会拒绝 schema 6，不会静默按付款解释。升级前备份全部文件并停止不兼容读取器/写入器。

恢复校验依据冻结业务与命令，不依赖当时在线的 CRM 源权限；实时源授权在访问和命令边界检查。可选 JDBC 仍需宿主显式装配与数据库验收，不会随独立 JSON 宿主自动启用。

所有源数据为演示数据，存储的是审批状态。没有外部 CRM 连接/报价写回、库存入账、采购订单占用、差旅预订、报销付款、银行指令或跨业务事务。也没有通用 BPMN、动态业务插件、撤回/返工、循环、补偿或 RuoYi 原生图审批能力。

<!-- topic:sources-and-verification -->
## 来源与验证

核心入口为 [GraphScenarios](../examples/approval-domain/src/main/java/com/arcflow/approval/graph/GraphScenarios.java)、[GraphSamples](../examples/approval-domain/src/main/java/com/arcflow/approval/graph/GraphSamples.java)、[GraphQuotePolicy](../examples/approval-domain/src/main/java/com/arcflow/approval/graph/GraphQuotePolicy.java)、[GraphApprovalService](../examples/approval-domain/src/main/java/com/arcflow/approval/graph/GraphApprovalService.java) 与 [GraphController](../examples/approval-demo/backend/src/main/java/com/arcflow/demo/GraphController.java)。严格业务字段参见 [JSON Schema](api/openapi/schemas.json) 和 [API 参考](api/API_REFERENCE.md)。

在仓库根目录执行静态资料检查，再按[开发环境与验证](development/QUICKSTART.md)构建领域、后端与 UI：

```sh
python3 scripts/check_api_contract.py
python3 scripts/test_api_contract.py
python3 scripts/verify_developer_docs.py
python3 scripts/check_documentation.py
```

测试覆盖与实际通过结果应以相应提交的日志为准。HTTP、领域恢复、浏览器交互与真实数据库各自证明不同边界；本页不把存在的测试、截图或 H2 结果当作生产验收。
