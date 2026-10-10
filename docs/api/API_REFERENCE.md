# ArcFlow HTTP 接口参考

<!-- Legacy fragments remain entry points after the language split. -->
<a id="1-hosts-and-boundaries"></a>
<a id="1-宿主与边界--hosts-and-boundaries"></a>
<a id="10-errors-and-recovery"></a>
<a id="10-http-错误与恢复--errors"></a>
<a id="11-native-ruoyi-adapter"></a>
<a id="11-若依原生差异--ruoyi-native-adapter"></a>
<a id="12-source-index-and-change-checklist"></a>
<a id="12-源码索引与变更检查--sources-and-change-checklist"></a>
<a id="2-standalone-transport"></a>
<a id="2-独立示例调用约定--standalone-transport"></a>
<a id="21-base-url-authentication-and-headers"></a>
<a id="21-base-url认证与请求头"></a>
<a id="22-json-numbers-and-versions"></a>
<a id="3-endpoint-inventory"></a>
<a id="3-路由清单--endpoint-inventory"></a>
<a id="31-generic-approval"></a>
<a id="31-通用审批--generic-approval"></a>
<a id="32-registered-scenarios"></a>
<a id="32-六场景--registered-scenarios"></a>
<a id="33-dedicated-quote-discount-host"></a>
<a id="33-报价折扣--dedicated-quote-host"></a>
<a id="4-command-payloads"></a>
<a id="4-写入-dto--command-payloads"></a>
<a id="41-legacysubmission"></a>
<a id="41-旧请假--legacysubmission"></a>
<a id="42-documentsubmission"></a>
<a id="42-类型化提交--documentsubmission"></a>
<a id="43-publication"></a>
<a id="43-发布--publication"></a>
<a id="44-decision"></a>
<a id="44-审批决定--decision"></a>
<a id="5-idempotency-and-safe-retries"></a>
<a id="5-幂等与安全重试--idempotency-and-retries"></a>
<a id="6-process-definitions-and-conditions"></a>
<a id="6-流程与条件--process-definitions"></a>
<a id="7-member-inbox"></a>
<a id="7-成员收件箱--member-inbox"></a>
<a id="8-request-snapshots-and-detail-reading"></a>
<a id="8-响应模型与读取详情--request-snapshots"></a>
<a id="9-complete-business-document-schemas"></a>
<a id="9-业务文档完整字段--business-schemas"></a>
<a id="91-common-rules"></a>
<a id="910-contractapproval--crm-contract"></a>
<a id="92-leave--generic-host"></a>
<a id="93-procurement--generic-host"></a>
<a id="94-quotediscount--crm-host"></a>
<a id="95-expense--oa-expense"></a>
<a id="96-travel--oa-travel"></a>
<a id="97-sealuse--oa-seal-use"></a>
<a id="98-receiving--erp-receiving"></a>
<a id="99-paymentrequest--erp-payment"></a>
<a id="arcflow-http-api-reference"></a>
<a id="arcflow-http-api-reference--http-接口参考"></a>

[简体中文](./API_REFERENCE.md) · [English](./API_REFERENCE.en.md) · [开发文档](../development/README.md)

源码基线：[`main` 提交 `199db7548f6faba5dfef105eaaf7311972adb388`](https://github.com/JamesCube/ArcFlow/tree/199db7548f6faba5dfef105eaaf7311972adb388)。本文描述仓库中已实现的示例宿主接口，不是尚未实现的平台 API。Java 核心 `arcflow-core` 本身不启动 HTTP 服务。

- [路由清单 JSON](./endpoint-inventory.json)：四个控制器的 30 项离线映射快照，供检查路由漂移；不是 OpenAPI。
- 静态 OpenAPI 契约：[独立宿主](./openapi/standalone.openapi.json)（21 项操作）、[若依宿主](./openapi/ruoyi.openapi.json)（9 项操作），按各自认证、响应包装和状态码分别描述。
- [可执行请求示例](./examples/README.md)：使用自己的本地配置和合成数据；不要把密码、Authorization 或真实业务资料写入仓库。
- 以文末链接的控制器、DTO 和领域校验为准。静态 OpenAPI 文件和可运行 HTTP 示例便于查阅与校验；金额词法精度、UTF-16 长度、跨字段约束、目录授权和并发规则仍由实际宿主验证，不能仅靠结构校验判断请求一定成功。

<!-- topic:hosts -->

## 1. 宿主与边界

| 宿主 | 路由前缀 | 身份与响应 | 已提供的业务 |
| --- | --- | --- | --- |
| 独立示例 | `/api` | HTTP Basic；直接返回 JSON 对象或数组 | 旧请假、类型化请假/采购、成员收件箱 |
| 独立六场景 | `/api/scenarios` | 同一 Basic 身份；每场景独立流程和存储 | 费用、出差、用印、收货、付款申请、合同审批 |
| 独立报价案例 | `/api/crm` | 同一 Basic 身份，加报价版本访问控制 | 合成报价折扣审批 |
| 若依原生集成层 | `/arcflow` | 若依身份/令牌/RBAC；`AjaxResult` | 旧请假、类型化请假/采购、成员收件箱 |

这些接口不执行付款、签约、用印、采购下单、入库、附件下载、真实 CRM 同步或汇率换算。业务引用是数据字段，不是可下载的文件地址。

以下接口**没有实现**，不要凭名称推断：`/api/auth/me`、`/api/users`、`/api/login`、`/api/session`、`/api/csrf`、独立流程校验端点、`GET /requests/{id}`、更新/删除/撤回申请、审批转交、全宿主统一收件箱。应用未配置 Swagger UI 或自动生成的 `/v3/api-docs`；本目录的 OpenAPI 文件是纳入版本控制的静态契约，不是运行时端点。流程校验在发布命令中执行；页面也有本地校验，但这不构成 HTTP 校验接口。

<!-- topic:transport -->

## 2. 独立示例调用约定

### 2.1 基础地址、认证与请求头

默认后端监听 `http://127.0.0.1:8080`，端口/监听地址可以由部署配置改变。默认允许的界面来源为 `http://localhost:5173`，可通过 `APPROVAL_UI_ORIGIN` 配置；`localhost` 与 `127.0.0.1` 是不同来源。

所有 `/api/**` 请求需要 HTTP Basic。凭据在服务端通过 `APPROVAL_ALICE_PASSWORD`、`APPROVAL_BOB_PASSWORD`、`APPROVAL_CAROL_PASSWORD` 配置；示例不提供固定通用密码、登录或令牌端点。服务无状态，不提供表单登录、应用退出登录或 Cookie 会话流程。Basic 应仅在本地演示或受 HTTPS 保护的宿主中使用，不要在共享终端输出认证头。

| 请求头 | 规则 |
| --- | --- |
| `Authorization: Basic …` | 每个请求认证；使用 HTTP 客户端的 Basic 支持，不要提交硬编码凭据 |
| `Content-Type: application/json` | 所有 JSON 写请求推荐使用；用印提交只接受该媒体类型（可带 `charset` 参数） |
| `X-Arcflow-Client: approval-demo` | 除 GET、HEAD、OPTIONS 外所有方法必须精确匹配；否则 403 |
| `Origin` | 非浏览器请求可省略；一旦出现必须精确等于配置的界面来源，否则 403；这不等于启用了跨域 CORS |
| `Sec-Fetch-Site` | 值为 `cross-site` 时一律 403；伪造这个头不能获得授权 |
| `Idempotency-Key` | 仅提交使用，各宿主规则不同，见 §5 |

浏览器示例通过前端开发代理访问后端；不要把上述来源检查理解为任意站点可跨域调用。这个宿主用严格来源与 Fetch Metadata 请求元数据检查和非简单客户端头保护写请求，Spring CSRF 令牌机制已禁用，不需先获取 CSRF 令牌。

示例目录中的启用用户为 `alice`、`bob`、`carol`。Alice 可发布；Bob/Carol 可作为审批人。所有人可读取自身身份与启用人员简表。读取人员列表不意味着每个人都可被分配审批，发布/提交时还会检查 `canAssignApproval`。申请人不能出现在完整流程的任何审批阶段，包括条件不命中的阶段。

### 2.2 JSON、数字与版本

- 输入是严格 JSON：未知字段、重复键、尾随 JSON、数字/布尔值强转字符串、数字字符串强转数字、基本类型字段为 null、浮点值强转整数均拒绝。
- JSON 属性名与枚举值区分大小写。`days`、`quantity`、版本等使用 JSON 整数；金额使用 JSON 数值，不能写成 `"12.50"`。
- 字符串上限按 Java `String.length()`，即原始 UTF-16 代码单元计数；不是字节数，也不一定等于用户看到的字符数。校验先于去除首尾空白。
- 输入金额用 `BigDecimal` 精确处理。除另有说明，最大 `1000000000`，最多两位小数；JPY 必须数值为整数。不要依赖 JSON/JavaScript 浮点舍入修复非法输入。词法上的过量小数（例如 `1.000`）可能被拒绝，即使数学上等于整数。
- 业务 `documentVersion`、流程 `schemaVersion`/`version`、冻结路由 `routing.schemaVersion` 和私有存储快照结构版本是不同版本域。私有 JSON 文件的结构版本不是 HTTP 请求体属性。
- 申请提交或审批决定的请求体不能提交 `request.id`、`applicantId`、`status`、`history`、`definition`、`routing` 或衍生合计来覆盖服务端状态；流程发布单独接受 `Publication.definition`（§4.3）。

<!-- topic:routes -->

## 3. 路由清单

四个控制器共声明 30 项路由映射：通用审批 9 项、场景 7 项、报价 5 项、若依 9 项。场景计数包含优先匹配的用印专用提交路径。

以下成功状态是实际控制器状态。独立宿主所有新建/重放提交均为 201；没有 `Location` 头契约。其他成功调用为 200。认证失败、状态冲突等见 §10。

### 3.1 通用审批

源码：[ApprovalController.java](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/ApprovalController.java)。

| 方法 | 路径 | 输入 | 成功响应 | 授权 |
| --- | --- | --- | --- | --- |
| GET | `/api/me` | 无 | 200 `Person` | 已认证 |
| GET | `/api/people` | 无 | 200 `Person[]` | 已认证 |
| GET | `/api/process` | 无 | 200 `ProcessDefinition` | 已认证 |
| POST | `/api/process` | `Publication` | 200 新版 `ProcessDefinition` | Alice/EDITOR，且目录允许发布 |
| GET | `/api/requests` | 无已定义过滤条件 | 200 `Request[]` | 仅自身申请或有效路径参与的申请 |
| GET | `/api/requests/inbox` | §7 查询参数 | 200 `InboxPage` | 当前身份的待办/已办 |
| POST | `/api/requests` | `LegacySubmission` | 201 `Request` | 启用的申请人，且不参与该流程审批 |
| POST | `/api/documents` | `DocumentSubmission`，仅 `leave`/`procurement` | 201 `Request` | 同上 |
| POST | `/api/requests/{id}/decisions` | `Decision` | 200 `Request` | 精确历史阶段的被分配参与人 |

`Person` 为 `{ "id": "alice", "displayName": "Alice" }`。独立 `/api/me` **不返回** `canPublish`；它是若依 `/arcflow/me` 的附加字段。

列表直接携带完整申请快照和历史；详情页面从这些对象中读取。列表不是分页接口，不承诺排序，也不会将任意查询参数自动变为过滤条件。只需待办/已办时优先使用有限页收件箱。

### 3.2 六场景

源码：[ScenarioController.java](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/ScenarioController.java)、[ScenarioConfiguration.java](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/ScenarioConfiguration.java)。

| 方法 | 路径 | 输入 | 成功响应 |
| --- | --- | --- | --- |
| GET | `/api/scenarios` | 无 | 200 `ScenarioTemplate[]`，按 `id` 排序 |
| GET | `/api/scenarios/{scenarioId}/process` | 场景 ID | 200 `ProcessDefinition` |
| POST | `/api/scenarios/{scenarioId}/process` | `Publication` | 200 新版 `ProcessDefinition`；目录允许发布 |
| GET | `/api/scenarios/{scenarioId}/requests` | 场景 ID | 200 `ScenarioView[]`，按当前身份过滤 |
| POST | `/api/scenarios/{scenarioId}/documents` | `DocumentSubmission` + 必需提交键；用印走下行专用映射 | 201 `ScenarioView` |
| POST | `/api/scenarios/oa-seal-use/documents` | `DocumentSubmission` + 必需提交键；仅 `application/json`，原始输入限制见 §9.7 | 201 `ScenarioView` |
| POST | `/api/scenarios/{scenarioId}/requests/{id}/decisions` | `Decision` | 200 `ScenarioView` |

有效 `scenarioId` 只有下表六个。其他输入有效的未知场景调用返回 404 `Scenario not found`。提交类型必须与场景精确匹配，否则 400。每个场景拥有独立流程/申请文件，并非通用 `/api/requests` 的标签过滤器；ID 属于另一个场景的申请不能通过当前场景审批。

| `scenarioId` | `business.type` | 初始流程结构版本 | 初始阶段（顺序） |
| --- | --- | --- | --- |
| `oa-expense` | `expense` | 2 | `manager` Bob → `finance` Carol |
| `oa-travel` | `travel` | 2 | `tripReview` Bob → `budget` Carol |
| `oa-seal-use` | `sealUse` | 2 | `documentReview` Bob → `sealReview` Carol |
| `erp-receiving` | `receiving` | 3 | `receiving-inspection` ALL Bob/Carol → `procurement-review` Bob |
| `erp-payment` | `paymentRequest` | 3 | `payment-check` ALL Bob/Carol → `payment-final` ANY Bob/Carol |
| `crm-contract` | `contractApproval` | 3 | `commercial-review` Bob → `contract-review` ALL Bob/Carol |

上表仅用于新空存储初始化；客户端应先读取流程，不要假定版本永远为 1 或阶段从未变更。全部六场景可发布结构版本 2/3，只有费用/收货/付款/合同场景可发布结构版本 4 条件流程。

`ScenarioView`：

```json
{
  "request": { "...": "完整申请对象，见 §8" },
  "total": "120.00"
}
```

- `total` 是显示字符串：费用总额、出差预计费用、付款净额、合同金额；用印/收货为 JSON null。
- 收货场景额外返回 `summary`，结构为 `{kind:"receiving", lineCount, exceptionLineCount, quantities:[{unit,received,accepted,rejected}]}`；按 PCS、BOX 分组，只出现已使用单位。数量不能混单位相加。
- 付款场景额外返回 `paymentSummary`，结构为 `{type:"paymentRequest", declaredOutstanding, grossAllocation, deductionTotal, netTotal}`，四个金额均为显示字符串。
- 不适用的 `summary`/`paymentSummary` 字段省略，不是 null。显示金额 JPY 为零位小数，其他支持币种为两位。

目录 `ScenarioTemplate` 字段：`id, domain, documentType, documentVersion, formVersion, title, description, sections, lineItems`。本版的业务/表单版本均为 1；`title/description` 是 `{zh,en}`。`sections[]` 包含 `id,title,fields`；字段包含 `path,kind,label,required,maxLength,options`；选项为 `{value,label:{zh,en}}`。`lineItems` 为 null 或 `{path,label,minItems,maxItems,fields}`。目录是编译时表单元数据，不是任意 JSON Schema/脚本执行器；它不会列出客户端生成的所有必需字段，例如每行 `lineId`。

### 3.3 报价折扣

源码：[QuoteDiscountController.java](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/QuoteDiscountController.java)、[QuoteDiscountCase.java](../../examples/approval-domain/src/main/java/com/arcflow/approval/QuoteDiscountCase.java)。

| 方法 | 路径 | 输入 | 成功响应 |
| --- | --- | --- | --- |
| GET | `/api/crm/process` | 无 | 200 固定 `quote-discount` 流程 |
| GET | `/api/crm/quotes` | 无 | 200 当前且可读的 `QuoteVersion[]` |
| GET | `/api/crm/requests` | 无 | 200 同时符合审批可见性与报价访问控制的 `QuoteView[]` |
| POST | `/api/crm/documents` | `DocumentSubmission`，仅 `quoteDiscount`；禁止提交键头 | 201 `QuoteView` |
| POST | `/api/crm/requests/{id}/decisions` | `Decision` | 200 `QuoteView` |

报价案例无发布接口；流程固定为 `salesManager` → `finance` 两个单人阶段。演示数据源为合成的 `Q-DEMO-001` 版本 1，由 Alice 持有，Alice/Bob/Carol 可读。客户端从 `/api/crm/quotes` 获取当前字段，不应硬编码该预设数据。

`QuoteVersion` 字段：`businessId, revision, customerRef, ownerId, readerIds[], item, quantity, listUnitPrice, currency, validUntil`。只有报价所有者能提交；所有初始审核人必须有该版本的读取权限。提交的客户、商品、数量、标价、币种、有效日期必须与保存的不可变版本一致，否则 409。不存在或不可读的版本返回 404；首次提交已过期报价返回 400，旧版本返回 409。

`QuoteView` 字段：`request, listTotal, requestedTotal, reductionTotal, discountPercent, thresholdReached, expired, quoteUpdated`。该视图没有 `revision` 字段：源报价版本位于 `QuoteVersion.revision`，已提交单据中的版本位于 `request.business.quoteRevision`。四个金额/比例值为字符串，前三个金额按币种格式化；百分比仅显示，四位小数四舍五入后去尾零。`thresholdReached` 表示精确折扣至少 10%，**不改变审批路径**。到期按 UTC 当日判断，`validUntil` 当日仍有效。已提交报价过期或源版本更新只改变提示标志，不会自动审批、撤回、变更历史单据或禁止已授权投票。

<!-- topic:commands -->

## 4. 写入 DTO

以下是结构示例，不含真实秘密；有效版本必须从相应宿主的流程读取接口获取。

### 4.1 旧请假

仅 `POST /api/requests` 或若依对应路由使用：

```json
{"title":"演示请假","reason":"合成数据验证审批流程","days":2,"processVersion":1}
```

必需字段：非空白 `title` ≤120、`reason` ≤2000，`days` 1–365，`processVersion` ≥1。该路径保留旧响应形状，响应没有 `business` 属性；与类型化 `leave` 不是同一个提交意图。

### 4.2 类型化提交

```json
{
  "business": {
    "type":"procurement",
    "businessId":"PO-DEMO-001",
    "title":"演示采购",
    "reason":"合成采购审批数据",
    "item":"办公设备",
    "quantity":3,
    "unitPrice":100.50,
    "currency":"CNY"
  },
  "processVersion":1
}
```

仅接受两个顶层字段 `business`、`processVersion`。`business.type` 必需且必须为该端点支持的文档类型；所有完整业务字段见 §9。通用 `/documents` 只接 `leave`/`procurement`，不能借此提交专属业务类型。

### 4.3 发布

```json
{
  "expectedVersion":1,
  "definition":{
    "schemaVersion":2,
    "id":"leave-approval",
    "version":1,
    "name":"演示审批",
    "nodes":[
      {"id":"start","type":"start","name":"提交","assigneeId":null},
      {"id":"manager","type":"approval","name":"经理审批","assigneeId":"bob"},
      {"id":"end","type":"end","name":"完成","assigneeId":null}
    ]
  }
}
```

`expectedVersion` 和 `definition.version` 必须同时等于当前已发布版本。不能更改 `definition.id`。服务端在成功时返回 `version + 1`；过期版本为 409，达到 `Integer.MAX_VALUE` 也为 409。已有申请保持其原流程快照和投票规则。发布没有幂等键语义；若响应不确定，先重新读取流程判断是否已经发布，不要盲目重发旧版本。

### 4.4 审批决定

```json
{"stepId":"manager","decision":"APPROVE","comment":"已核对合成数据"}
```

- `stepId` 必需、非空白、最多 64，使用该申请的实际历史阶段 ID；不要从最新全局流程猜测。
- `decision` 只能为 `APPROVE` 或 `REJECT`。
- `comment` 可省略/null/空串，最多 2000；存储前去除首尾空白，null 变为 `""`。
- 没有客户端 `expectedRevision`、`revision`、`If-Match` 或可指定操作人字段。服务端以历史决定数做内部 CAS，最多尝试 16 次写入；竞争未解决时返回 409。
- 同一操作人、同一申请、同一阶段重复相同决定返回当前已保存申请，不重复追加历史。新备注不覆盖已保存备注。相反决定返回 409。
- 未到当前阶段、已终态且该人未投过、不存在于有效路径的阶段为 409；可见但并非该阶段成员为 403；不存在或对本人不可见的申请为 404。

<!-- topic:idempotency -->

## 5. 幂等与安全重试

| 提交入口 | `Idempotency-Key` |
| --- | --- |
| `/api/requests`、`/api/documents` | 可省略；省略后每次成功都会新建，推荐发送 |
| `/arcflow/requests`、`/arcflow/documents` | 同上；作用域为当前若依数字字符串身份 |
| `/api/scenarios/{scenarioId}/documents` | 必须且只能有一个请求头值 |
| `/api/crm/documents` | 禁止出现该头，出现即 400；由宿主绑定报价版本 |

幂等键为大小写敏感的 1–128 个 ASCII 字符，正则 `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`。空白、逗号合并值、斜杠、多个请求头值均不合规。不要把令牌、姓名或敏感业务信息放进幂等键。

绑定按存储边界内的已认证申请人 + 幂等键隔离；六场景当前各有独立存储，不是跨业务全局去重。`businessId` 一般不是幂等键，也不自动去重业务单号。报价例外：宿主为每个报价 `businessId`/`revision` 生成确定性幂等键，调用方必须省略自己的头。

相同幂等键 + 相同规范化业务内容及原 `processVersion` 返回原申请的**当前**状态，即使流程已重新发布或申请已完成，独立宿主仍返回 201。相同幂等键的不同类型、字段、流程版本或其他不同提交意图为 409。标题/原因以及各业务规定的文本/金额按领域规则规范化后比较；不要依赖客户端任意改写被当作相同提交意图。

推荐客户端流程：

1. 读取目标宿主当前流程，构造业务数据。
2. 为新提交意图生成并保留一个幂等键，保留原请求体、原 `processVersion` 和原端点。
3. 网络超时或 503 后，先检查列表，使用同一个幂等键、同一个请求体重试。不要直接换幂等键。
4. 如确定需要不同业务提交意图，使用新幂等键；如收到流程版本过期的 409，读取当前流程后再决定是否新建。
5. 审批决定重试同一个 申请/阶段/决定；先刷新确认历史，不重复新建申请。

报价的同版本、同提交意图重放同样返回保存状态；更改请求折扣或其他提交意图会冲突。它不是允许为同一版本建多个请求的接口。

<!-- topic:process-routing -->

## 6. 流程与条件

源码：[ProcessDefinition.java](../../examples/approval-domain/src/main/java/com/arcflow/approval/ProcessDefinition.java)、[ConditionalRouting.java](../../examples/approval-domain/src/main/java/com/arcflow/approval/ConditionalRouting.java)。

`ProcessDefinition` 必需字段：`schemaVersion, id, version, name, nodes`。ID 正则 `[A-Za-z][A-Za-z0-9_-]{0,127}`；版本 ≥1；`name` 非空白、≤120 且无 ISO 控制字符。`nodes` 共 3–10 个，即 1–8 个有序审批阶段。

- 第一个必须 `{id:"start",type:"start",name,assigneeId:null}`；最后一个同理为 `end`。
- 每节点必需 `id,type,name,assigneeId`。ID 正则 `[A-Za-z][A-Za-z0-9_-]{0,63}`，全流程唯一；边界 ID 保留。`name` 规则与流程 `name` 相同。
- 结构版本 2：中间节点只能是 `approval`，使用单个非 null `assigneeId`；不可带 `assigneeIds`/`completionMode`。
- 结构版本 3：还可使用 `parallelApproval`，必须 `assigneeId:null`、`assigneeIds` 为 2–16 个唯一启用的合格身份、`completionMode` 为 `ALL` 或 `ANY`。
- 结构版本 4：在受支持的四个类型化场景中为审批阶段增加可选 `runIf`；无条件节点应省略此字段，不能写 null。开始/结束不能有条件。

单人依次审批。ALL 需全员同意，一个拒绝就终止为 REJECTED；ANY 一个同意就通过阶段，仅当所有成员拒绝才 REJECTED。部分票不会提前跳过阶段；同一人可以被不同阶段分配，并且每阶段投一次。

条件只在提交时选定额外人工审核步骤。始终至少有一个无条件人工阶段；无脚本、无自动批准、无动态审批人、无任意跳转。全流程最多八个谓词，单条规则包含 1–8 个谓词，`mode` 为 `ALL|ANY`。同一流程仅能使用相应业务类型的字段。

| 场景 | 谓词的精确 JSON 字段 | 限制 |
| --- | --- | --- |
| oa-expense | `field:"expense.totalAmount", operator, currency, threshold` | `operator` `EQ/GT/GTE/LT/LTE`；数值阈值 0–20000000000，最多两位，JPY 整数；来源为已校验费用明细的精确合计 |
| erp-payment | `field:"payment.netTotal", operator, currency, threshold` | `operator` `EQ/GT/GTE/LT/LTE`；`threshold` JSON 数值，0–20000000000，最多两位，JPY 整数 |
| erp-receiving | `field:"receiving.hasRejectedLines", operator:"EQ", expected` | `expected` JSON 布尔值，来源为不合格行数量 |
| crm-contract | `field:"contract.termsKind", operator, values` | `operator` `EQ/IN`；唯一 `STANDARD/NONSTANDARD` 数组，EQ 恰一项，IN 1–2 项 |

费用与付款阈值先经 Jackson JsonNode 解码，末尾小数零会在领域标度校验前归一化，因此 `threshold:1.000` 可以通过。这与保留词法标度的业务金额 DTO 不同。业务金额的标度按指数运算后的数值表示计算，例如 `1.000e3` 的标度为 0。

服务端以精确十进制运算，从已校验且不可变的费用行金额推导 `expense.totalAmount`，不接受客户端传入合计。对 CNY 0.30 的 GTE 规则，0.10 + 0.19 跳过额外阶段，0.10 + 0.20 与 0.10 + 0.21 都进入该阶段。这是合成精度示例，不是建议的报销制度。现有费用单据版本 1、流程结构版本 4、路线版本 1、JSON 包装版本 13 均不变。报销条件仅用于独立演示；若依与 H5 仍不支持报销发起或费用条件。

所有金额谓词必须同币种，申请币种必须匹配**每个**谓词；不匹配会拒绝提交，即使 ANY 的其他项已满足，也不会静默跳过审核或换汇。不适用的谓词字段必须省略，不能填入 null。

例：付款场景某个可选复核节点增加：

```json
{"mode":"ALL","predicates":[{"field":"payment.netTotal","operator":"GTE","currency":"CNY","threshold":10000}]}
```

结构版本 4 请求保存完整 `definition` 和 `routing:{schemaVersion:1,stepIds,evaluations}`。选定的 `stepIds` 依原顺序排列；`evaluations` 包含每个条件节点及每个原子条件的 `{field,actualValue,result}`，不短路。后续发布或源数据变化不重新选择历史申请的路线。仅被跳过阶段分配的用户不会因此获得读取、待办或投票权限。

<!-- topic:inbox -->

## 7. 成员收件箱

入口只有 `GET /api/requests/inbox` 和若依的 `/arcflow/requests/inbox`。六场景和 CRM 没有暴露此接口。

| 查询参数 | 类型/默认 | 规则 |
| --- | --- | --- |
| `box` | `PENDING` 默认 | 仅 `PENDING`、`HANDLED`，大小写敏感 |
| `limit` | 整数，默认 25 | 1–100；十进制数字字符串，最多十位且在 Java int 范围 |
| `status` | 可省略 | `PENDING`、`APPROVED`、`REJECTED` |
| `processVersion` | 可省略整数 | ≥1，十进制数字字符串，最多十位且在 Java int 范围 |
| `cursor` | 可省略字符串 | 使用上一页原值，最多 1024；URL 安全且无填充的 Base64 |

未知字段（包括 `actor`/`userId`）、重复查询参数、空数值、负号/加号、小数/指数数值、非法 `cursor` 都为 400。`limit` 的值可在续页时改变；`cursor` 绑定操作人、`box`、`status`、`processVersion` 与排序位置，改变其他这些条件需从第一页重新请求。

```json
{"items":[],"nextCursor":null}
```

- PENDING：当前阶段所有尚未投票的成员，不只 `approverId` 所指第一人。
- HANDLED：该身份至少实际投过一次票的申请；仅出现在流程中、未投票的 ANY 组落选成员不算已办。
- 一份申请可能同时在自己的 HANDLED 与 PENDING 中，例如前一阶段已投票、后一阶段再次轮到本人。
- 顺序是 `createdAt` 降序，再按申请 ID 降序打破时间平局；`updatedAt` 不参与排序。
- `items` 最多 `limit` 条，`nextCursor:null` 表示当前无下一页；`cursor` 是位置而非权限，也不是一致性快照令牌。列表会随真实审批变化，刷新应重新从第一页读取。

<!-- topic:responses -->

## 8. 响应模型与读取详情

一个新建旧请假申请的典型结构如下；时间和 ID 由服务器生成，示例省略实际流程内容的重复展开：

```json
{
  "id":"server-generated-request-id",
  "title":"演示请假",
  "reason":"合成数据验证审批流程",
  "days":2,
  "applicantId":"alice",
  "approverId":"bob",
  "status":"PENDING",
  "createdAt":"2026-10-09T00:00:00Z",
  "updatedAt":"2026-10-09T00:00:00Z",
  "decision":null,
  "comment":null,
  "processId":"leave-approval",
  "processVersion":1,
  "history":[{"actorId":"alice","action":"SUBMIT","comment":"","at":"2026-10-09T00:00:00Z","stepId":null}],
  "definition":{"schemaVersion":2,"id":"leave-approval","version":1,"name":"Leave approval","nodes":[
    {"id":"start","type":"start","name":"Submit leave","assigneeId":null},
    {"id":"manager","type":"approval","name":"Designated approver","assigneeId":"bob"},
    {"id":"end","type":"end","name":"Completed","assigneeId":null}
  ]},
  "currentStepId":"manager"
}
```

`Request` 字段语义：

| 字段 | 说明 |
| --- | --- |
| `id` | 服务器生成身份；当前创建为 UUID，但契约允许 `[A-Za-z0-9][A-Za-z0-9_-]{0,127}` |
| `title,reason,days` | 兼容字段；类型化请假的 `days` 为请假天数，其他类型化文档 `days`=0 |
| `business` | 仅类型化请求存在；保存规范化不可变单据（§9），旧请假省略 |
| `applicantId` | 来自已认证身份，客户端不可指定 |
| `approverId` | 兼容字段：待办时为第一个尚未投票成员；终态时为最后投票者；不可据此推断全体成员 |
| `status` | `PENDING/APPROVED/REJECTED` |
| `createdAt,updatedAt` | UTC `Instant` 时间字符串，可能含小数秒 |
| `decision,comment` | 尚无决定时为 null，之后为最近一票的动作/备注；不是每人全部历史 |
| `processId,processVersion,definition` | 提交时的完整流程版本快照；之后发布不改写它 |
| `currentStepId` | 当前阶段 ID；终态为 null |
| `history` | 第一条 SUBMIT，之后按追加顺序为 APPROVE/REJECT；每条含 `actorId,action,comment,at,stepId` |
| `routing` | 仅 结构版本 4 类型化请求存在的冻结路线；其他请求省略 |

当前角色/启用状态、流程参与和业务访问控制 会重新检查。目录改名或历史账号删除不重写已有身份 ID。不要只依赖按钮是否可见作为授权；所有写操作由服务端验证。

<!-- topic:business-models -->

## 9. 业务文档完整字段

源码：[BusinessDocument.java](../../examples/approval-domain/src/main/java/com/arcflow/approval/BusinessDocument.java)。以下字段均为必需，除 DTO 层已明确可选的备注；“可空说明”指必须提供空字符串，不代表可以省略/null。不存在的字段会被拒绝。

### 9.1 公共规范

每个业务对象都带精确 `type`、`businessId`、`title`、`reason`。引用值正则 `[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}`，最多 128；适用于 `businessId` 和下面明确标为引用值的字段。标题 ≤120，原因 ≤2000，且非空白。

`leave`、`procurement`、`quoteDiscount` **不带 `documentVersion`**；六场景必须 `documentVersion:1`。支持币种只为 `CNY,USD,EUR,GBP,JPY`，无换汇。日期使用真实 `YYYY-MM-DD`；六场景年份必须 0001–9999。报价的领域日期验证使用 Java LocalDate，首次提交另受 UTC 有效期检查。

用印、收货、付款、合同使用固定 Unicode White_Space/C0/BOM 非空校验；旧类型的 `isBlank()` 规则并不完全相同。不要用不可见字符满足必填。字符串按规定去除首尾空白，引用值不会自动去除首尾空白修复非法值。 费用明细的 description，以及出差的 title、reason、destination，还会在 Java `trim()` 去除首尾 U+0000–U+0020 后执行 `isBlank()`，因此拒绝仅含 NUL 或 C0 的文本；这不会把 NBSP 或 BOM 当作 Java 空白，也不是禁止所有内嵌控制字符。

### 9.2 `leave`（通用）

完整字段：`type,businessId,title,reason,days`。`days` 为 1–365 整数。`businessId` 必须合规。与 §4.1 的旧请假请求相比，多了类型化 `business` 对象，不能相互混用同一幂等键。

### 9.3 `procurement`（通用）

完整字段：`type,businessId,title,reason,item,quantity,unitPrice,currency`。

- `item` 非空白，≤240。
- `quantity` 整数 1–100000。
- `unitPrice` >0、≤1000000000、最多两位小数；JPY 数值必须整数。
- 合计为 `quantity` × `unitPrice`；请求不接受 `total`。通用响应没有独立 `total` 字段，客户端可用精确十进制计算。

### 9.4 `quoteDiscount`（CRM）

完整字段：`type,businessId,title,reason,customerRef,quoteRevision,item,quantity,listUnitPrice,requestedUnitPrice,currency,validUntil`。

- `customerRef` 非空白 ≤128（此字段使用文本校验）；`quoteRevision` ≥1。
- `quantity`、`item`、两个价格及 `currency` 继承 procurement 规则。
- `requestedUnitPrice` 必须严格低于 `listUnitPrice` 且 >0。
- `validUntil` 为真实 `YYYY-MM-DD`；还须符合源版本与有效期/访问控制 规则（§3.3）。

### 9.5 `expense`（oa-expense）

完整字段：`type,documentVersion,businessId,title,reason,costCenter,currency,lines`。

- `costCenter`：`ENGINEERING/SALES/OPERATIONS`；`lines` 1–20。
- 每行必需：`lineId,spentOn,category,description,amount,receiptRef`。
- `lineId`、`receiptRef` 均为引用值，且各自在该单据内唯一；不跨申请占用票据。
- `spentOn` 真实日期；`category` `TRAVEL/MEALS/OFFICE/OTHER`；`description` 非空白 ≤240。
- `amount` >0、≤1000000000、最多两位小数；JPY 整数。
- `total` = 所有 `amount` 之和。票据引用不证明票据存在，不触发读取或报销付款。

### 9.6 `travel`（oa-travel）

完整字段：`type,documentVersion,businessId,title,reason,destination,startDate,endDate,purpose,estimatedCost,currency,costCenter`。

- `destination` 非空白 ≤160；`costCenter` `ENGINEERING/SALES/OPERATIONS`。
- `purpose`：`CUSTOMER_VISIT/PROJECT_DELIVERY/TRAINING/CONFERENCE/OTHER`。
- `startDate`、`endDate` 真实日期，起止含首尾 1–90 天。
- `estimatedCost` >0、≤1000000000、最多两位，JPY 整数。
- 无 `lines`、旅客信息或真实预订接口。

### 9.7 `sealUse`（oa-seal-use）

完整字段：`type,documentVersion,businessId,title,reason,documentName,documentRef,sealType,copyCount`。

- `documentName` 非空白 ≤160，`documentRef` 引用值。
- `sealType`：`OFFICIAL/CONTRACT/FINANCE`；`copyCount` 整数 1–100。
- 该 HTTP 端点必须 `Content-Type: application/json`。完整提交原始 JSON 上限 8,000,000 UTF-16 代码单元，包含空白/转义语法；必须有效 UTF-8。超过 24,000,000 原始字节先拒绝，解码后再核对字符上限；均返回 400。不是附件额度，也不是整个存储文件大小限制。
- 同一个文件引用不代表附件已上传或印章已应用。此接口不签署文件。

### 9.8 `receiving`（erp-receiving）

完整字段：`type,documentVersion,businessId,title,reason,purchaseOrderRef,warehouse,receivedOn,lines`。

- `purchaseOrderRef` 引用值；`warehouse` `EAST/WEST`；`receivedOn` 真实日期；`lines` 1–20。
- 每行必需：`lineId,orderLineRef,description,unit,ordered,received,accepted,rejected,exceptionReason`。
- `lineId`、`orderLineRef` 均为引用值，各自在本单据唯一；`description` 非空白 ≤240。
- `unit` `PCS/BOX`；`ordered` 整数 1–100000；`received` 0–`ordered`；accepted/rejected 各为 0–100000。
- `accepted + rejected == received`；至少一行 `received`>0；不是历史/跨单据累计余额控制。
- 四个数量必须是原始 JSON 整数词法单元，拒绝 `-0`、`1.0`、`1e0`、字符串和 null。
- `exceptionReason` 必须为字符串 ≤1000；`rejected`>0 时非空白，否则可 `""`。
- 返回按单位分组的 `summary`，无 `currency`、`amount` 或可混合求和的 `total`。

### 9.9 `paymentRequest`（erp-payment）

完整字段：`type,documentVersion,businessId,title,reason,supplierRef,currency,requestedPaymentOn,lines`。

- `supplierRef` 引用值；`requestedPaymentOn` 真实日期；`lines` 1–20。
- 每行必需：`lineId,invoiceRef,description,invoiceAmount,previouslySettledAmount,allocationAmount,deductionAmount,deductionReason`。
- `lineId`、`invoiceRef` 引用值，各自在本单据唯一；`description` 非空白 ≤240。
- 所有金额 ≤1000000000、最多两位、JPY 整数。invoiceAmount/allocationAmount >0，previouslySettledAmount/deductionAmount ≥0。
- `previouslySettledAmount <= invoiceAmount`；`allocationAmount <= invoiceAmount - previouslySettledAmount`；`deductionAmount <= allocationAmount`。
- `deductionReason` 必须字符串 ≤1000；`deductionAmount`>0 时非空白，否则可空。
- 全单净额 `sum(allocationAmount) - sum(deductionAmount)` 必须 >0。
- `paymentSummary` 中 `declaredOutstanding` = Σ(`invoiceAmount` − `previouslySettledAmount`)，`grossAllocation` = ΣallocationAmount，`deductionTotal` = ΣdeductionAmount，`netTotal` = `grossAllocation` − `deductionTotal`。
- 声明的发票/已付余额为合成输入；不验证银行余额、不锁余额、不跨申请占用发票、不付款。

### 9.10 `contractApproval`（crm-contract）

完整字段：`type,documentVersion,businessId,title,reason,customerRef,contractRevision,contractCategory,currency,contractAmount,startOn,endOn,termsKind,deviationReason,documentRef,lines`。

- customerRef/documentRef 引用值；`contractRevision` 整数 ≥1；`contractCategory` `PRODUCT/SERVICE`。
- `contractAmount` >0、≤1000000000、最多两位，JPY 整数；startOn/endOn 真实日期，`endOn` 不早于 `startOn`。
- `termsKind` `STANDARD/NONSTANDARD`；`deviationReason` 必须字符串 ≤2000。NONSTANDARD 需非空白；STANDARD 去除首尾空白后必须为空，一般备注写入 `reason`。
- `lines` 1–20；每行必需：`lineId,milestoneRef,description,dueOn,amount,acceptanceCriteria`。
- lineId/milestoneRef 引用值，各自在本单据唯一；`description` 非空白 ≤240，`acceptanceCriteria` 非空白 ≤1000。
- `amount` >0、≤1000000000、最多两位，JPY 整数；所有里程碑合计必须精确等于 `contractAmount`。
- `dueOn` 在合同起止日期内，按数组顺序非递减（允许同日）。
- `contractRevision` 是声明字段，无报价宿主式源版本锁；不会签署、发送给客户、产生应收或更新 CRM。

<!-- topic:errors -->

## 10. HTTP 错误与恢复

独立 API 的受控错误是 JSON `{ "message": "…" }`，不是通用 `code/data` 响应包装；消息可中英混合，客户端以状态码和上下文处理，不要把英文文案当作稳定机器错误码。

| HTTP | 已实现的典型原因 | 客户端处理 |
| --- | --- | --- |
| 400 | JSON/DTO/业务规则不符；幂等键缺失/非法/禁止；未知/重复收件箱参数；币种/路由类型不符；自审流程提交 | 修正数据，不换幂等键盲重试 |
| 401 | 缺失或错误 Basic 认证 | 修正本地身份凭据，不假定有登录接口 |
| 403 | 来源/客户端头不符；无发布资格；非该历史阶段指定成员；账号失效；报价非所有者 | 检查宿主/权限；不绕过授权 |
| 404 | 不存在或对该身份不可见的申请；未知场景；不可读报价版本 | 检查所用宿主、身份和 ID；不推断资源存在 |
| 409 | 发布/提交版本过期；幂等键被不同提交意图使用；已终态/非当前阶段/相反重复决定；并发竞争；报价源字段/版本 冲突 | 刷新 流程/申请历史，按原提交意图确认后重试 |
| 415 | 不支持 Content-Type；用印非 application/json | 发送正确媒体类型 |
| 503 | 捕获到受检异常 `IOException`，存储写入或收件箱 I/O 无法确认 | 刷新后按原 幂等键/提交意图 检查重试，不把它当作确认未提交 |

`503` 独立消息为 `Storage unavailable; no change confirmed. Refresh before retrying.`，不保证事务完全未发生。部分读路径将 I/O 包装为 `UncheckedIOException`，并未被该异常处理器专门映射；未知异常/错误分发的响应可能由 Spring/安全链决定，不能声称所有错误均稳定为上述响应包装或所有 I/O 都为 503。未知路由和未实现方法也不构成约定 API。

<a id="ruoyi-native-host"></a>

<!-- topic:ruoyi -->

## 11. 若依原生差异

源码：[ArcFlowController.java](../../examples/ruoyi-vue3/backend/src/main/java/com/ruoyi/arcflow/ArcFlowController.java)、[ArcFlowErrors.java](../../examples/ruoyi-vue3/backend/src/main/java/com/ruoyi/arcflow/ArcFlowErrors.java)、[ArcFlowConfiguration.java](../../examples/ruoyi-vue3/backend/src/main/java/com/ruoyi/arcflow/ArcFlowConfiguration.java)。宿主准备、原生登录和权限见 [若依示例 README](../../examples/ruoyi-vue3/README.md)。

| 方法/路径 | 权限 | 成功 HTTP 状态/响应体 |
| --- | --- | --- |
| GET `/arcflow/me` | `arcflow:request:read` | 200 `AjaxResult.data={id,displayName,canPublish}` |
| GET `/arcflow/people` | 同上 | 200 data=`Person[]` |
| GET `/arcflow/process` | 同上 | 200 data=`ProcessDefinition` |
| POST `/arcflow/process` | `arcflow:process:publish` | 200 data=新 `ProcessDefinition` |
| GET `/arcflow/requests` | `arcflow:request:read` | 200 data=`Request[]` |
| GET `/arcflow/requests/inbox` | 同上 | 200 data=`InboxPage` |
| POST `/arcflow/requests` | `arcflow:request:submit` | **200** data=`Request`，不同于独立宿主的 201 |
| POST `/arcflow/documents` | 同上 | **200** data=`Request`，仅 `leave`/`procurement` |
| POST `/arcflow/requests/{id}/decisions` | `arcflow:request:decide` | 200 data=`Request` |

通常成功形状为 `{ "code":200, "msg":"操作成功", "data":… }`；业务异常保留真实 HTTP 状态并使用 `AjaxResult.error(code,msg)`。若依自身认证和权限异常由宿主处理，不保证与独立 `{message}` 一致，也不要仅靠 HTTP 200 判断其他若依 API 的业务成功。

关键差异：

1. 若依处理登录、JWT/Redis 会话、登录验证码、角色和菜单；ArcFlow 集成层不提供第二套 Basic 认证或新登录端点。通过原生请求封装传令牌，不向 `/arcflow` 发送演示宿主 Basic 凭据。
2. 操作人身份是 `SecurityUtils.getUserId()` 的数字**字符串**，不是登录用户名；必须为启用且未删除的用户。使用 `/arcflow/people` 中的真实 ID 发布流程，不能填 alice/bob/carol。
3. `X-Arcflow-Client`/独立宿主来源规则不是原生集成层新增要求；其请求安全规则由当前若依宿主决定。前端 `/dev-api` 或 `/prod-api` 是代理前缀，不是该控制器的根路径。
4. `@PreAuthorize` 是第一层，领域内仍检查历史分配成员。管理员通配符权限不让管理员代替任意审批人投票。`canPublish` 在原生 `/me` 返回。
5. 严格 JSON 解码器仅用于 ArcFlow 端点，不更改若依全局 ObjectMapper。原生 DTO 没有独立宿主的全部 Bean Validation 注解，核心业务/流程/幂等/状态规则仍由共享领域验证；例如非法 `stepId` 在领域按实际申请/阶段处理，不承诺与独立宿主相同的最早错误。
6. 两个提交路由支持同样可选幂等头；使用幂等键的原生客户端只绕过若依短时间重复提交拦截，让持久化幂等层解析，不关闭认证或 RBAC。
7. 没有 `/arcflow/scenarios` 或 `/arcflow/crm` 控制器；没有把六场景/结构版本 4 条件路由接入原生 HTTP 的实现。通用流程发布只接受结构版本 2/3。
8. 示例审批存储仍是单写者本地 JSON，若依 MySQL 用户库不代表审批已自动接入 JDBC 或分布式事务。

<!-- topic:maintenance -->

## 12. 源码索引与变更检查

- 路由：[通用审批控制器](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/ApprovalController.java)、[场景控制器](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/ScenarioController.java)、[报价控制器](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/QuoteDiscountController.java)、[若依控制器](../../examples/ruoyi-vue3/backend/src/main/java/com/ruoyi/arcflow/ArcFlowController.java)
- 认证与媒体/来源约束：[SecurityConfig](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/SecurityConfig.java)、[JsonConfig](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/JsonConfig.java)、[application.properties](../../examples/approval-demo/backend/src/main/resources/application.properties)
- 领域：[ApprovalService](../../examples/approval-domain/src/main/java/com/arcflow/approval/ApprovalService.java)、[BusinessDocument](../../examples/approval-domain/src/main/java/com/arcflow/approval/BusinessDocument.java)、[ProcessDefinition](../../examples/approval-domain/src/main/java/com/arcflow/approval/ProcessDefinition.java)、[InboxQuery](../../examples/approval-domain/src/main/java/com/arcflow/approval/InboxQuery.java)
- 专属模型：[ScenarioCatalog](../../examples/approval-domain/src/main/java/com/arcflow/approval/ScenarioCatalog.java)、[ScenarioCase](../../examples/approval-domain/src/main/java/com/arcflow/approval/ScenarioCase.java)、[QuoteDiscountCase](../../examples/approval-domain/src/main/java/com/arcflow/approval/QuoteDiscountCase.java)、[ConditionalRouting](../../examples/approval-domain/src/main/java/com/arcflow/approval/ConditionalRouting.java)
- 深入契约：[幂等](../SUBMISSION_IDEMPOTENCY.md)、[成员收件箱](../MEMBER_INBOX.md)、[业务文档](../BUSINESS_DOCUMENTS.md)、[条件路由](../CONDITIONAL_ROUTING.md)

改接口时同步控制器/DTO、领域校验、本参考、请求样例和 HTTP 测试；不要只改展示文案。更改表单版本、持久化结构版本或宿主集成范围时，分别记录迁移与实测证据。本文和请求示例的存在不代表生产就绪、部署完成或所有宿主已验收。

### 12.1 契约与真实 HTTP 校验

在仓库根目录先运行离线检查，再构建并验证真实独立宿主：

```sh
python3 scripts/check_api_contract.py
python3 scripts/verify_developer_docs.py
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml verify
python3 scripts/verify_api_examples.py \
  --jar examples/approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```

离线检查用于发现控制器映射、静态 OpenAPI 契约及示例之间的漂移，不能替代真实宿主对数字词法、权限和状态转换的验证。HTTP 校验会启动自己的临时独立宿主；它不验证若依登录、MySQL、真实 CRM 或付款服务。完整范围与手工调用步骤见[可执行示例](./examples/README.md)。
