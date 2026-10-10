# 业务单据与审批生命周期

<!-- Legacy fragments remain entry points after the language split. -->
<a id="erp-payment-and-crm-contract-extension"></a>
<a id="java-与-http--java-and-http"></a>
<a id="verification--验证"></a>
<a id="业务单据与审批生命周期解耦--business-documents-and-approval-lifecycle"></a>
<a id="幂等与授权--idempotency-and-authorization"></a>
<a id="成员待办基线--member-inbox-baseline"></a>
<a id="持久化兼容--storage-compatibility"></a>
<a id="本轮边界--scope"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](BUSINESS_DOCUMENTS.en.md) · [文档目录](README.md)

<!-- topic:scope -->
## 范围

审批生命周期与业务字段独立：路由、参与人、ALL/ANY 投票、状态、审计和乐观并发继续使用同一状态机。当前 main 的封闭 `BusinessDocument` 边界明确支持 `leave`、`procurement`、`quoteDiscount`、`expense`、`travel`、`sealUse`、`receiving`、`paymentRequest`、`contractApproval` 九类经过验证的业务单据，不是任意 JSON schema 插件或引擎重写。内核 DAG 仍对公共标题/原因执行 validate → normalize；类型化单据校验业务规则，恢复时再次校验，审批期间不可重写。

报销仅通过 `/api/scenarios/oa-expense` 和 `/scenarios.html` 暴露，提供版本化表单元数据、真实明细校验和不可变数据；票据引用为合成文本，通过不付款。首次写入最低 JSON schema 7，应先升级全部读取端并停止不兼容写者，SQL revision 3 不变，见[报销场景](EXPENSE_SCENARIO.md)。通用独立/若依接口只接受请假与采购。

出差有独立行程/预算类型，使用 `/api/scenarios/oa-travel` 与共享场景页。必填目的地、起止日期、目的、精确预计金额、币种和成本中心，含首尾日期共 1–90 天；不预订、报销或付款。首次写入要求 schema 8 读取能力，见[出差契约与上线](TRAVEL_SCENARIO.md)。

用印是非金额单据，保存惰性文档引用、合成印章类别与份数。`/api/scenarios/oa-seal-use` 返回 `{request,total:null}`，审批不盖章或签名，见[用印契约](SEAL_USE_SCENARIO.md)。

收货只记录数量、合成采购单引用和 1–20 条明细。`/api/scenarios/erp-receiving` 返回 `{request,total:null,summary}`，按单位汇总数量，通过不入库，见[收货契约](RECEIVING_SCENARIO.md)。报销和出差始终返回 `{request,total:string}`，没有收货 summary。

共享目录提供六个编译期场景；业务类型、流程、固定 JSON 后缀和浏览器草稿/重试意图各自隔离，收货另保留 `/receiving.html`。登记类型不会使旧接口、通用接口或若依自动接受新类型。这些是固定版本表单与 1–8 阶段审批，不是任意字段引擎。付款/收货/合同可用[受限冻结路由](CONDITIONAL_ROUTING.md)，见[统一集成历史和验证门槛](UNIFIED_SCENARIO_INTEGRATION.md)。报价仅通过专用 `/api/crm` 及独立合成页面，不进入共享独立/若依/H5 工作区。

- `BusinessDocument.Leave(businessId, title, reason, days)` 保持 1–365 天规则。
- `BusinessDocument.Procurement(businessId, title, reason, item, quantity, unitPrice, currency)`：物品非空且 ≤240 字符，数量 1–100,000，单价为正且 ≤1,000,000,000、最多两位小数，币种 CNY/USD/EUR/GBP/JPY；JPY 必须整数。这是示例业务规则，不是汇率或付款逻辑。
- `BusinessDocument.QuoteDiscount(businessId, title, reason, customerRef, quoteRevision, item, quantity, listUnitPrice, requestedUnitPrice, currency, validUntil)` 冻结单个报价版本。两种价格沿用采购的物品/数量/金额/币种限制，申请价低于标价；客户引用非空且 ≤128 字符，版本为正整数，有效期为真实 `YYYY-MM-DD`。新提交校验归属、源字段、当前读权和有效期；精确总额派生而非输入，见[报价场景](CRM_QUOTE_CASE.md)。
- 所有类型需要稳定业务 ID：1–128 个 ASCII 字母/数字及 `._:/-`，首字符为字母/数字；标题 ≤120、原因 ≤2,000 字符，均必填。
- 公共文本与物品 trim，价格按精确十进制规范化；不进行二进制浮点舍入、换汇、采购单发送或付款。
- `businessId` 是宿主单据引用，不是通用领域的唯一约束或幂等键。报价宿主另加持久报价版本绑定，不改变通用契约。

<!-- topic:java-and-http -->
## Java 与 HTTP

调用 `service.submitDocument(authenticatedActor, document, expectedProcessVersion, optionalKey)`。Java 客户端解码类型化申请前应使用 `ApprovalService.strictMapper(mapper)`，让严格请求解码器拿到精确十进制树；内置 JSON/JDBC 与 HTTP 宿主已经配置。一个服务/存储对应一个流程；稳定流程 ID 首字母为字母，后跟字母、数字、`_` 或 `-`，总长 ≤128。默认仍为 `leave-approval`；宿主可为 `procurement-approval` 配置成员。流程名不会隐式决定业务策略。

通用类型化入口为独立端 `POST /api/documents` 和若依 `POST /arcflow/documents`，后者沿用 `arcflow:request:submit`。两者使用认证身份与可选 `Idempotency-Key`，和旧请假一致；仅接受请假/采购，明确拒绝其他七类，不能用领域类型支持绕过专用宿主授权。采购请求示例：

```json
{
  "business": {
    "type": "procurement",
    "businessId": "PO-2026-001",
    "title": "Office chairs",
    "reason": "Team expansion",
    "item": "Ergonomic chair",
    "quantity": 3,
    "unitPrice": 199.50,
    "currency": "CNY"
  },
  "processVersion": 1
}
```

返回申请含不可变 `business` 快照；已有列表/决定接口和成员权限继续适用。为兼容源码和载荷，`title`、`reason` 保留平铺投影，类型化请假 `days` 为实际天数，其他类型为 0。不一致投影会被存储拒绝，消费方必须检查 `business.type`，不能把 `days: 0` 当有效旧请假。

旧 `POST .../requests` 与 16 参数 Request 构造器保留。旧响应字段完全不变，省略 `business`，不会添加 `business: null`。采购 UI 支持独立端/原生若依发起，H5 仅展示与审批，也可通过 API/Java 发起后使用原审批接口，见[采购界面](PROCUREMENT_UI.md)。

报价使用 `POST /api/crm/documents` 及独立读取/决定路由。宿主先检查源读权、归属、版本与字段，再调用领域；独立流程固定销售经理→财务，使用独立 JSON 文件。拒绝自定义 `Idempotency-Key`，以不可变报价版本生成确定性持久键。通用待办和共享客户端不混入报价；没有真实 CRM、AI 调用、付款、通知或回写。

<!-- topic:idempotency-and-authorization -->
## 幂等与授权

键精确、区分大小写、按申请人隔离。JDBC 仍在整个数据库全部流程间共享 `(applicant_id, submission_key)`，不需 SQL 键迁移。新业务或流程意图使用新键。

重放比较流程 ID/版本、规范化公共字段、业务类型/ID 和全部业务字段。匹配则返回当前持久申请（包括决定），任一不同则 409，包括旧请假与类型化请假之间或不同流程间复用。通用接口不按业务 ID 去重，不带键仍可退出幂等；报价宿主总提供自己的版本键，并重查源读权与归属。

重放前检查申请人当前资格，但不要求历史审批人仍有效或流程仍为最新。发布不能更改配置流程 ID。JDBC 的 list/get/decision/update 均绑定存储流程，不暴露其他流程；全局键查找仅用于检测和协调冲突，不重放其他流程申请。

不同流程头锁可竞争一个全局键。仅映射插入明确重复、完整回滚后，才重新读取持久获胜记录协调；其他完整性、提交、回滚或连接清理失败仍为错误，不提交孤立申请或提交事件。

<!-- topic:storage-compatibility -->
## 持久化兼容

统一读取端接受 JSON wrapper **1–13**，保留每个旧版本的严格字段形状。schema 8/9/10 的空快照或仅旧类型快照有效；读取不改写、不新建或替换备份。这是已知格式兼容，不支持任意未来格式。

| 业务载荷类型 | 最低 JSON wrapper |
| --- | --- |
| `leave`、`procurement` | 5 |
| `quoteDiscount` | 6 |
| `expense` | 7 |
| `travel` | 8 |
| `sealUse` | 9 |
| `receiving` | 10 |
| `paymentRequest` | 11 |
| `contractApproval` | 12 |

- 每个非空业务载荷必须匹配显式 wire type 与 Java record，满足最低版本、严格字段/版本和业务规则。高 wrapper 可含低最低版本类型：Travel 可在 9/10、Seal 可在 10，Receiving 不可在 8/9。未知类型、大小写别名、未来单据版本、wrapper 14+、非整数/溢出版本或不一致投影全部拒绝。
- schema 1–4 保持原形状，不能夹带类型化载荷；旧请假/采购/报价不凭空增加 `documentVersion`。定义 2（顺序）与 3（分组）不变；定义 4 增加[受限冻结路由](CONDITIONAL_ROUTING.md)，需要 wrapper 13 和保留路由定义。
- 写入版本取当前 wrapper 与全部需求的最大值：至少 2、当前/历史定义、带键提交（4）、类型化业务（5）及各类型最低值。打开不强制升到 10，首次报销只需 7。之后任何出差/用印/报销/旧请求/决定/发布都不降低版本。
- 每次真实升级将紧邻升级前快照逐字节私密保存为 `.schemaN.bak`，包含此前同进程写入；重名另取唯一名，不覆盖旧备份。原子替换失败不能发布内存申请或键映射；读取/校验失败不改快照或备份。
- 每个 JSON 文件只属于一个流程；混合流程历史或用另一流程打开均拒绝。场景宿主还要求准确业务类型；领域混合类型迁移夹具不能授权混用场景文件。JSON 保持单写者/本地文件系统。
- 收货的原始负零防护在多态类型后置/树缓冲之前生效；场景决定每次 CAS 都重查目标业务类型。用印 HTTP 只接受有效 UTF-8 JSON，并限制原始提交外层为 8,000,000 个 UTF-16 单元；不是整个快照文件大小限制。
- JDBC 保留 SQL revision 3、现有 `request_json` 与就绪成员投影。新类型不需 DDL、新 revision 或重建已就绪索引。revision 2 仍需原有停写显式迁移/回填，不自动执行。
- JDBC 全局键仍为跨流程 `(applicant_id, submission_key)`，list/get/decision/inbox 仍按配置流程隔离，保留原定义版本与实际投票成员语义。

新写入前先停不兼容写者、备份，并给相关 JSON 文件或 JDBC 行的**全部**读取/写入端部署统一编解码器。旧 schema 1–7 主线及独立 Travel/Seal/Receiving 候选不能互读所有载荷；SQL revision 3 不代表旧程序兼容。恢复历史备份会丢失后续提交、决定和发布，是时间点恢复，不是无损降级。不能通过调低 wrapper、删除业务类型或重建成员索引自动回退。

<!-- topic:verification-and-historical-evidence -->
## 验证与历史证据

以下说明来自合入前的组合候选；当前 main 已包含上述九类和条件路由，但历史本地结果不证明当前提交验收。单项候选报告不证明组合兼容。[组合门槛](UNIFIED_SCENARIO_INTEGRATION.md#verification-gates)要求最终 head 的迁移、宿主、浏览器及 H2/PostgreSQL/MySQL 新结果。原候选截图下载遇 HTTP 403/1010，其图片字节与独立像素验收未取得，与自动 CI 分开记录。

`BusinessDocumentTest` 覆盖真实采购状态变化、ALL/ANY、授权、重启、不可变意图、严格数字/类型、并发重试、JSON 2/3/4→5 与失败写入。共享 JDBC 契约在 H2/PostgreSQL/MySQL 检查采购、流程隔离、全局键冲突和强制跨流程竞争。独立 HTTP 与若依烟测验证新增端点不削弱旧路由。CI 保留 Java 17/21、PostgreSQL、MySQL 8.0/8.4，真实服务器作业要求契约数非跳过。

既有采购/待办测试不能证明 CRM 数据库或浏览器通过。报价领域、宿主、JSON/JDBC-H2、模型/DOM/真实 HTTP 检查见 [CRM 发布门槛](CRM_COMPATIBILITY_READINESS.md)。该历史检查点的新增 CRM 浏览器/服务器覆盖尚在准备，远端精确 head CRM CI 尚未执行；发布主张应查对应提交实际结果。

<!-- topic:historical-member-inbox-baseline -->
## 历史成员待办基线

采购/待办基线合入 main `caece22fb52e645f303c6adec73f19a027d38e66`，tree `1d3332659bc59f3c70f2ffb5954aed6aa383f522`。SQL revision 3 增加按流程隔离的成员投影与停写迁移/回填，应遵循[当前 JDBC 安装](../examples/approval-jdbc/README.md)，不能沿用仅 revision 2 的旧上线方式。请假/采购最低 JSON 5，报价写入后 6，与 SQL revision 3 独立。当时 CRM 是单独候选，不属于该基线的已合并/验证范围；启用前需升级读取端并单查最终 CRM 的浏览器、真实数据库和远端 CI，见 [CRM 门槛](CRM_COMPATIBILITY_READINESS.md)。

<!-- topic:erp-payment-and-crm-contract-extension -->
## 付款与合同扩展

独立付款/合同宿主、精确金额规则、六宿主封装、九类型迁移与合成边界见[付款与合同场景](PAYMENT_CONTRACT_SCENARIOS.md)。只有付款增加类型化 `paymentSummary`，合同保持 `{request,total:string}`。原扩展是独立候选，当前 main 已包含两种宿主；历史验收仍绑定其源码提交。
