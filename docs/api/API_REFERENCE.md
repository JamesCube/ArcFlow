# ArcFlow HTTP API Reference / HTTP 接口参考

[简体中文](./API_REFERENCE.md) · [English](./API_REFERENCE.en.md) · [开发文档](../development/README.md)

源码基线：[`main` at `666ff64b280157e44a86f07a15fcb42f859ec11a`](https://github.com/JamesCube/ArcFlow/tree/666ff64b280157e44a86f07a15fcb42f859ec11a)。本文描述仓库中已实现的示例宿主接口，不是尚未实现的平台 API。Java 核心 `arcflow-core` 本身不启动 HTTP 服务。

- [路由清单 JSON](./endpoint-inventory.json)：四个 Controller 的离线映射快照，供检查路由漂移；不是 OpenAPI。
- [可执行请求示例](./examples/README.md)：使用自己的本地配置和合成数据；不要把密码、Authorization 或真实业务资料写入仓库。
- 以文末链接的 Controller、DTO 和领域校验为准。本轮提供人工核对的静态参考与可运行 HTTP 示例，未附 OpenAPI/Swagger 描述；金额词法精度、UTF-16 长度、跨字段约束、目录授权和并发规则由实际宿主验证。

## 1. 宿主与边界 / Hosts and boundaries

| 宿主 | 路由前缀 | 身份与响应 | 已提供的业务 |
| --- | --- | --- | --- |
| 独立示例 | `/api` | HTTP Basic；直接返回 JSON 对象或数组 | 旧请假、类型化请假/采购、成员收件箱 |
| 独立六场景 | `/api/scenarios` | 同一 Basic 身份；每场景独立流程和存储 | 费用、出差、用印、收货、付款申请、合同审批 |
| 独立报价案例 | `/api/crm` | 同一 Basic 身份，加报价 revision ACL | 合成报价折扣审批 |
| 若依原生 overlay | `/arcflow` | 若依身份/令牌/RBAC；`AjaxResult` | 旧请假、类型化请假/采购、成员收件箱 |

这些接口不执行付款、签约、用印、采购下单、入库、附件下载、真实 CRM 同步或汇率换算。业务 reference 是数据字段，不是可下载的文件地址。

以下接口**没有实现**，不要凭名称推断：`/api/auth/me`、`/api/users`、`/api/login`、`/api/session`、`/api/csrf`、独立流程校验端点、`GET /requests/{id}`、更新/删除/撤回申请、审批转交、全宿主统一收件箱。应用未配置 Swagger UI 或自动生成的 `/v3/api-docs`，本目录也未提供 OpenAPI 文件。流程校验在发布命令中执行；页面也有本地校验，但这不构成 HTTP validate API。

## 2. 独立示例调用约定 / Standalone transport

### 2.1 Base URL、认证与请求头

默认后端监听 `http://127.0.0.1:8080`，端口/监听地址可以由部署配置改变。默认允许的 UI Origin 为 `http://localhost:5173`，可通过 `APPROVAL_UI_ORIGIN` 配置；`localhost` 与 `127.0.0.1` 是不同 Origin。

所有 `/api/**` 请求需要 HTTP Basic。凭据在服务端通过 `APPROVAL_ALICE_PASSWORD`、`APPROVAL_BOB_PASSWORD`、`APPROVAL_CAROL_PASSWORD` 配置；示例不提供固定通用密码或登录/token 端点。服务是 stateless，无表单登录、应用 logout 或 cookie session 流程。Basic 应仅在本地演示或受 HTTPS 保护的宿主中使用，不要在共享终端输出认证头。

| 请求头 | 规则 |
| --- | --- |
| `Authorization: Basic …` | 每个请求认证；使用 HTTP 客户端的 Basic 支持，不要提交硬编码凭据 |
| `Content-Type: application/json` | 所有 JSON 写请求推荐使用；用印提交只接受该媒体类型（可带 charset 参数） |
| `X-Arcflow-Client: approval-demo` | 除 GET、HEAD、OPTIONS 外所有方法必须精确匹配；否则 403 |
| `Origin` | 非浏览器请求可省略；一旦出现必须精确等于配置的 UI Origin，否则 403；这不等于启用了跨域 CORS |
| `Sec-Fetch-Site` | 值为 `cross-site` 时一律 403；伪造这个头不能获得授权 |
| `Idempotency-Key` | 仅提交使用，各宿主规则不同，见 §5 |

浏览器示例通过前端开发代理访问后端；不要把上述 Origin 检查理解为任意站点可跨域调用。这个宿主用严格 Origin/Fetch-Metadata 检查和非简单客户端头保护写请求，Spring CSRF token 机制已禁用，不需先获取 CSRF token。

示例目录中的 active 用户为 `alice`、`bob`、`carol`。Alice 可发布；Bob/Carol 可作为审批人。所有人可读取自身身份与 active 人员简表。读取人员列表不意味着每个人都可被分配审批，发布/提交时还会检查 `canAssignApproval`。申请人不能出现在完整流程的任何审批阶段，包括条件不命中的阶段。

### 2.2 JSON、数字与版本

- 输入是严格 JSON：未知字段、重复键、尾随 JSON、数字/布尔值强转字符串、数字字符串强转数字、null primitive、浮点值强转整数均拒绝。
- JSON 属性名与 enum 值区分大小写。`days`、`quantity`、版本等使用 JSON integer；金额使用 JSON number，不能写成 `"12.50"`。
- 字符串上限按 Java `String.length()`，即原始 UTF-16 code units 计数；不是字节数，也不一定等于用户看到的字符数。校验先于 trim。
- 输入金额用 `BigDecimal` 精确处理。除另有说明，最大 `1000000000`，最多两位小数；JPY 必须数值为整数。不要依赖 JSON/JavaScript 浮点舍入修复非法输入。词法上的过量小数（例如 `1.000`）可能被拒绝，即使数学上等于整数。
- 业务 `documentVersion`、流程 `schemaVersion`/`version`、冻结路由 `routing.schemaVersion` 和私有存储快照 schema 是不同版本域。私有 JSON 文件的 schema 不是 HTTP body 属性。
- 申请提交或审批决定的 body 不能提交 `request.id`、`applicantId`、`status`、`history`、`definition`、`routing` 或衍生合计来覆盖服务端状态；流程发布单独接受 `Publication.definition`（§4.3）。

## 3. 路由清单 / Endpoint inventory

以下成功状态是实际 Controller 状态。Standalone 所有新建/重放提交均为 201；没有 `Location` 头契约。其他成功调用为 200。认证失败、状态冲突等见 §10。

### 3.1 通用审批 / Generic approval

源码：[ApprovalController.java](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/ApprovalController.java)。

| Method | Path | 输入 | 成功响应 | 授权 |
| --- | --- | --- | --- | --- |
| GET | `/api/me` | 无 | 200 `Person` | 已认证 |
| GET | `/api/people` | 无 | 200 `Person[]` | 已认证 |
| GET | `/api/process` | 无 | 200 `ProcessDefinition` | 已认证 |
| POST | `/api/process` | `Publication` | 200 新版 `ProcessDefinition` | Alice/EDITOR，且目录允许发布 |
| GET | `/api/requests` | 无已定义 filter | 200 `Request[]` | 仅自身申请或有效路径参与的申请 |
| GET | `/api/requests/inbox` | §7 query | 200 `InboxPage` | 当前身份的待办/已办 |
| POST | `/api/requests` | `LegacySubmission` | 201 `Request` | active 申请人，且不参与该流程审批 |
| POST | `/api/documents` | `DocumentSubmission`，仅 leave/procurement | 201 `Request` | 同上 |
| POST | `/api/requests/{id}/decisions` | `Decision` | 200 `Request` | 精确历史阶段的被分配参与人 |

`Person` 为 `{ "id": "alice", "displayName": "Alice" }`。独立 `/api/me` **不返回** `canPublish`；它是若依 `/arcflow/me` 的附加字段。

列表直接携带完整申请快照和历史；详情页面从这些对象中读取。列表不是分页接口，不承诺排序，也不会将任意 query 自动变为过滤条件。只需待办/已办时优先使用有限页收件箱。

### 3.2 六场景 / Registered scenarios

源码：[ScenarioController.java](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/ScenarioController.java)、[ScenarioConfiguration.java](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/ScenarioConfiguration.java)。

| Method | Path | 输入 | 成功响应 |
| --- | --- | --- | --- |
| GET | `/api/scenarios` | 无 | 200 `ScenarioTemplate[]`，按 `id` 排序 |
| GET | `/api/scenarios/{scenarioId}/process` | 场景 ID | 200 `ProcessDefinition` |
| POST | `/api/scenarios/{scenarioId}/process` | `Publication` | 200 新版 `ProcessDefinition`；目录允许发布 |
| GET | `/api/scenarios/{scenarioId}/requests` | 场景 ID | 200 `ScenarioView[]`，按当前身份过滤 |
| POST | `/api/scenarios/{scenarioId}/documents` | `DocumentSubmission` + 必需提交键 | 201 `ScenarioView` |
| POST | `/api/scenarios/{scenarioId}/requests/{id}/decisions` | `Decision` | 200 `ScenarioView` |

有效 `scenarioId` 只有下表六个。有效的未知场景调用返回 404 `Scenario not found`。提交类型必须与场景精确匹配，否则 400。每个场景拥有独立流程/申请文件，并非通用 `/api/requests` 的标签过滤器；ID 属于另一个场景的申请不能通过当前场景审批。

| scenarioId | `business.type` | 初始流程 schema | 初始阶段（顺序） |
| --- | --- | --- | --- |
| `oa-expense` | `expense` | 2 | `manager` Bob → `finance` Carol |
| `oa-travel` | `travel` | 2 | `tripReview` Bob → `budget` Carol |
| `oa-seal-use` | `sealUse` | 2 | `documentReview` Bob → `sealReview` Carol |
| `erp-receiving` | `receiving` | 3 | `receiving-inspection` ALL Bob/Carol → `procurement-review` Bob |
| `erp-payment` | `paymentRequest` | 3 | `payment-check` ALL Bob/Carol → `payment-final` ANY Bob/Carol |
| `crm-contract` | `contractApproval` | 3 | `commercial-review` Bob → `contract-review` ALL Bob/Carol |

上表仅用于新空存储初始化；客户端应先 GET process，不要假定 version 永远为 1 或阶段从未变更。全部六场景可发布 schema 2/3，只有 receiving/payment/contract 可发布 schema 4 条件流程。

`ScenarioView`：

```json
{
  "request": { "...": "完整 Request，见 §8" },
  "total": "120.00"
}
```

- `total` 是显示字符串：expense 总额、travel 预计费用、payment 净额、contract 合同额；seal/receiving 为 JSON null。
- Receiving 额外返回 `summary`，结构为 `{kind:"receiving", lineCount, exceptionLineCount, quantities:[{unit,received,accepted,rejected}]}`；按 PCS、BOX 分组，只出现已使用单位。数量不能混单位相加。
- Payment 额外返回 `paymentSummary`，结构为 `{type:"paymentRequest", declaredOutstanding, grossAllocation, deductionTotal, netTotal}`，四个金额均为显示字符串。
- 不适用的 `summary`/`paymentSummary` 字段省略，不是 null。显示金额 JPY 为零位小数，其他支持币种为两位。

目录 `ScenarioTemplate` 字段：`id, domain, documentType, documentVersion, formVersion, title, description, sections, lineItems`。本版的业务/表单版本均为 1；`title/description` 是 `{zh,en}`。`sections[]` 包含 `id,title,fields`；field 包含 `path,kind,label,required,maxLength,options`；option 为 `{value,label:{zh,en}}`。`lineItems` 为 null 或 `{path,label,minItems,maxItems,fields}`。目录是编译时表单元数据，不是任意 JSON Schema/脚本执行器；它不会列出客户端生成的所有必需字段，例如每行 `lineId`。

### 3.3 报价折扣 / Dedicated quote host

源码：[QuoteDiscountController.java](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/QuoteDiscountController.java)、[QuoteDiscountCase.java](../../examples/approval-domain/src/main/java/com/arcflow/approval/QuoteDiscountCase.java)。

| Method | Path | 输入 | 成功响应 |
| --- | --- | --- | --- |
| GET | `/api/crm/process` | 无 | 200 固定 `quote-discount` 流程 |
| GET | `/api/crm/quotes` | 无 | 200 当前且可读的 `QuoteVersion[]` |
| GET | `/api/crm/requests` | 无 | 200 同时符合审批可见性与报价 ACL 的 `QuoteView[]` |
| POST | `/api/crm/documents` | `DocumentSubmission`，仅 quoteDiscount；禁止提交键头 | 201 `QuoteView` |
| POST | `/api/crm/requests/{id}/decisions` | `Decision` | 200 `QuoteView` |

报价案例无发布接口；流程固定为 `salesManager` → `finance` 两个单人阶段。demo source 为合成的 `Q-DEMO-001` revision 1，由 Alice 持有，Alice/Bob/Carol 可读。客户端从 `/api/crm/quotes` 获取当前字段，不应硬编码该 fixture。

`QuoteVersion` 字段：`businessId, revision, customerRef, ownerId, readerIds[], item, quantity, listUnitPrice, currency, validUntil`。只有报价 owner 能提交；所有初始审核人必须有该 revision 的读取权限。提交的客户、商品、数量、标价、币种、有效日期必须与保存的不可变 revision 一致，否则 409。不存在或不可读的 revision 返回 404；首次提交已过期报价返回 400，旧 revision 返回 409。

`QuoteView` 字段：`request, listTotal, requestedTotal, reductionTotal, discountPercent, thresholdReached, expired, quoteUpdated`。四个金额/比例值为字符串，前三个金额按币种格式化；百分比仅显示，四位小数四舍五入后去尾零。`thresholdReached` 表示精确折扣至少 10%，**不改变审批路径**。到期按 UTC 当日判断，`validUntil` 当日仍有效。已提交报价过期或源 revision 更新只改变提示标志，不会自动审批、撤回、变更历史单据或禁止已授权投票。

## 4. 写入 DTO / Command payloads

以下是结构示例，不含真实秘密；有效版本必须从相应宿主 GET process 获取。

### 4.1 旧请假 / LegacySubmission

仅 `POST /api/requests` 或若依对应路由使用：

```json
{"title":"演示请假","reason":"合成数据验证审批流程","days":2,"processVersion":1}
```

必需字段：非空白 `title` ≤120、`reason` ≤2000，`days` 1–365，`processVersion` ≥1。该路径保留旧响应形状，响应没有 `business` 属性；与类型化 leave 不是同一个幂等 intent。

### 4.2 类型化提交 / DocumentSubmission

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

仅接受两个顶层字段 `business`、`processVersion`。`business.type` 必需且必须为该端点支持的文档类型；所有完整业务字段见 §9。generic `/documents` 只接 leave/procurement，不能借此提交专属业务类型。

### 4.3 发布 / Publication

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

`expectedVersion` 和 `definition.version` 必须同时等于当前已发布版本。不能更改 `definition.id`。服务端在成功时返回 `version + 1`；过期版本为 409，达到 `Integer.MAX_VALUE` 也为 409。已有申请保持其原流程快照和投票规则。发布没有幂等键语义；若响应不确定，先重新 GET process 判断是否已经发布，不要盲目重发旧版本。

### 4.4 审批决定 / Decision

```json
{"stepId":"manager","decision":"APPROVE","comment":"已核对合成数据"}
```

- `stepId` 必需、非空白、最多 64，使用该申请的实际历史阶段 ID；不要从最新全局流程猜测。
- `decision` 只能为 `APPROVE` 或 `REJECT`。
- `comment` 可省略/null/空串，最多 2000；存储前 trim，null 变为 `""`。
- 没有客户端 `expectedRevision`、`revision`、`If-Match` 或可指定 actor 字段。服务端以历史决定数做内部 CAS，最多尝试 16 次写入；竞争未解决时返回 409。
- 同一 actor、同一 request、同一 step 重复相同 decision 返回当前已保存申请，不重复追加历史。新 comment 不覆盖已保存 comment。相反 decision 返回 409。
- 未到当前阶段、已终态且该人未投过、不存在于有效路径的阶段为 409；可见但并非该阶段成员为 403；不存在或对本人不可见的申请为 404。

## 5. 幂等与安全重试 / Idempotency and retries

| 提交入口 | `Idempotency-Key` |
| --- | --- |
| `/api/requests`、`/api/documents` | 可省略；省略后每次成功都会新建，推荐发送 |
| `/arcflow/requests`、`/arcflow/documents` | 同上；作用域为当前若依数字字符串身份 |
| `/api/scenarios/{scenarioId}/documents` | 必须且只能有一个 header value |
| `/api/crm/documents` | 禁止出现该头，出现即 400；由宿主绑定报价 revision |

Key 为大小写敏感的 1–128 个 ASCII 字符，正则 `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`。空白、逗号合并值、斜杠、多个 header value 均不合规。不要把 token、姓名或敏感业务信息放进 key。

绑定按存储边界内的 authenticated applicant + key 隔离；六场景当前各有独立存储，不是跨业务全局去重。`businessId` 一般不是幂等键，也不自动去重业务单号。报价例外：宿主为每个报价 businessId/revision 生成确定性 key，调用方必须省略自己的头。

相同 key + 相同规范化业务内容/旧 `processVersion` 返回原申请的**当前**状态，即使流程已重新发布或申请已完成，standalone 仍返回 201。相同 key 的不同类型、字段、流程版本或其他不同 intent 为 409。标题/原因以及各业务规定的文本/金额按领域规则规范化后比较；不要依赖客户端任意改写被当作相同 intent。

推荐客户端流程：

1. 读取目标宿主当前 process，构造业务数据。
2. 为新 intent 生成并保留一个 key，保留原 body、原 processVersion 和原 endpoint。
3. 网络超时或 503 后，先检查列表，使用同一个 key、同一个 body 重试。不要直接换 key。
4. 如确定需要不同业务 intent，使用新 key；如收到 stale-version 409，读取当前 process 后再决定是否新建。
5. 审批决定重试同一个 request/step/decision；先刷新确认历史，不重复新建申请。

报价的同 revision、同 intent 重放同样返回保存状态；更改请求折扣或其他 intent 会冲突。它不是允许为同一 revision 建多个请求的接口。

## 6. 流程与条件 / Process definitions

源码：[ProcessDefinition.java](../../examples/approval-domain/src/main/java/com/arcflow/approval/ProcessDefinition.java)、[ConditionalRouting.java](../../examples/approval-domain/src/main/java/com/arcflow/approval/ConditionalRouting.java)。

`ProcessDefinition` 必需字段：`schemaVersion, id, version, name, nodes`。ID 正则 `[A-Za-z][A-Za-z0-9_-]{0,127}`；version ≥1；name 非空白、≤120 且无 ISO control。nodes 共 3–10 个，即 1–8 个有序审批阶段。

- 第一个必须 `{id:"start",type:"start",name,assigneeId:null}`；最后一个同理为 `end`。
- 每节点必需 `id,type,name,assigneeId`。ID 正则 `[A-Za-z][A-Za-z0-9_-]{0,63}`，全流程唯一；边界 ID 保留。name 规则与流程 name 相同。
- schema 2：中间节点只能是 `approval`，单个非 null `assigneeId`；不可带 `assigneeIds`/`completionMode`。
- schema 3：还可使用 `parallelApproval`，必须 `assigneeId:null`、`assigneeIds` 为 2–16 个唯一 active 合格身份、`completionMode` 为 `ALL` 或 `ANY`。
- schema 4：在受支持的三个 typed 场景中为审批阶段增加可选 `runIf`；无条件节点应省略此字段，不能写 null。开始/结束不能有条件。

单人依次审批。ALL 需全员同意，一个拒绝就终止为 REJECTED；ANY 一个同意就通过阶段，仅当所有成员拒绝才 REJECTED。部分票不会提前跳过阶段；同一人可以被不同阶段分配，并且每阶段投一次。

条件只在提交时选定额外人工审核步骤。始终至少有一个无条件人工阶段；无脚本、无自动批准、无动态审批人、无任意跳转。全流程最多八个 predicate，单个 rule 1–8 个，`mode` 为 `ALL|ANY`。同一流程仅能使用相应业务类型的字段。

| 场景 | predicate 的精确 JSON 字段 | 限制 |
| --- | --- | --- |
| erp-payment | `field:"payment.netTotal", operator, currency, threshold` | operator `EQ/GT/GTE/LT/LTE`；threshold JSON number，0–20000000000，最多两位，JPY 整数 |
| erp-receiving | `field:"receiving.hasRejectedLines", operator:"EQ", expected` | expected JSON boolean，来源为不合格行数量 |
| crm-contract | `field:"contract.termsKind", operator, values` | operator `EQ/IN`；唯一 `STANDARD/NONSTANDARD` 数组，EQ 恰一项，IN 1–2 项 |

所有金额 predicate 必须同币种，申请币种必须匹配**每个** predicate；不匹配会拒绝提交，即使 ANY 的其他项已满足，也不会静默跳过审核或换汇。Unused predicate 字段必须省略，不能填 null。

例：付款场景某个可选复核节点增加：

```json
{"mode":"ALL","predicates":[{"field":"payment.netTotal","operator":"GTE","currency":"CNY","threshold":10000}]}
```

schema-4 请求保存完整 `definition` 和 `routing:{schemaVersion:1,stepIds,evaluations}`。selected stepIds 依原顺序排列；evaluations 包含每个条件节点及每个 atom 的 `{field,actualValue,result}`，不短路。后续发布或源数据变化不重新选择历史申请的路线。仅被跳过阶段分配的用户不会因此获得读取、待办或投票权限。

## 7. 成员收件箱 / Member inbox

入口只有 `GET /api/requests/inbox` 和若依的 `/arcflow/requests/inbox`。六场景和 CRM 没有暴露此接口。

| Query | 类型/默认 | 规则 |
| --- | --- | --- |
| `box` | `PENDING` 默认 | 仅 `PENDING`、`HANDLED`，大小写敏感 |
| `limit` | integer，默认 25 | 1–100；十进制数字字符串，最多十位且在 Java int 范围 |
| `status` | 可省略 | `PENDING`、`APPROVED`、`REJECTED` |
| `processVersion` | 可省略 integer | ≥1，十进制数字字符串，最多十位且在 Java int 范围 |
| `cursor` | 可省略 string | 使用上一页原值，最多 1024；URL-safe unpadded Base64 |

未知字段（包括 actor/userId）、重复 query、空数值、负号/加号、小数/指数数值、非法 cursor 都为 400。`limit` 的值可在续页时改变；cursor 绑定 actor、box、status、processVersion 与排序位置，改变其他这些条件需从第一页重新请求。

```json
{"items":[],"nextCursor":null}
```

- PENDING：当前阶段所有尚未投票的成员，不只 `approverId` 所指第一人。
- HANDLED：该身份至少实际投过一次票的申请；仅出现在流程中、未投票的 ANY 组落选成员不算已办。
- 一份申请可能同时在自己的 HANDLED 与 PENDING 中，例如前一阶段已投票、后一阶段再次轮到本人。
- 顺序是 `createdAt` 降序，再按 request ID 降序打破时间平局；`updatedAt` 不参与排序。
- `items` 最多 limit 条，`nextCursor:null` 表示当前无下一页；cursor 是位置而非权限，也不是一致性快照令牌。列表会随真实审批变化，刷新应重新从第一页读取。

## 8. 响应模型与读取详情 / Request snapshots

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
| `title,reason,days` | 兼容字段；typed leave 的 days 为请假天数，其他 typed 文档 days=0 |
| `business` | 仅 typed 请求存在；保存规范化不可变单据（§9），旧请假省略 |
| `applicantId` | 来自 authenticated principal，客户端不可指定 |
| `approverId` | 兼容字段：待办时为第一个尚未投票成员；终态时为最后投票者；不可据此推断全体成员 |
| `status` | `PENDING/APPROVED/REJECTED` |
| `createdAt,updatedAt` | UTC `Instant` 时间字符串，可能含小数秒 |
| `decision,comment` | 尚无决定时为 null，之后为最近一票的 action/comment；不是每人全部历史 |
| `processId,processVersion,definition` | 提交时的完整流程版本快照；之后发布不改写它 |
| `currentStepId` | 当前阶段 ID；终态为 null |
| `history` | 第一条 SUBMIT，之后按追加顺序为 APPROVE/REJECT；每条含 `actorId,action,comment,at,stepId` |
| `routing` | 仅 schema-4 typed 请求存在的冻结路线；其他请求省略 |

当前角色/active 状态、流程参与和业务 ACL 会重新检查。目录改名或历史账号删除不重写已有身份 ID。不要只依赖按钮是否可见作为授权；所有写操作由服务端验证。

## 9. 业务文档完整字段 / Business schemas

源码：[BusinessDocument.java](../../examples/approval-domain/src/main/java/com/arcflow/approval/BusinessDocument.java)。以下字段均为必需，除 DTO 层已明确可选的 comment；“可空说明”指必须提供空字符串，不代表可以省略/null。不存在的字段会被拒绝。

### 9.1 公共规范

每个 business 都带精确 `type`、`businessId`、`title`、`reason`。Reference 正则 `[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}`，最多 128；适用于 businessId 和下面明确标为 reference 的字段。标题 ≤120，原因 ≤2000，且非空白。

`leave`、`procurement`、`quoteDiscount` **不带 documentVersion**；六场景必须 `documentVersion:1`。支持币种只为 `CNY,USD,EUR,GBP,JPY`，无换汇。日期使用真实 `YYYY-MM-DD`；六场景年份必须 0001–9999。报价的领域日期验证使用 Java LocalDate，首次提交另受 UTC 有效期检查。

Seal、receiving、payment、contract 使用固定 Unicode White_Space/C0/BOM 非空校验；旧类型的 `isBlank()` 规则并不完全相同。不要用不可见字符满足必填。字符串按规定 trim，references 不会自动 trim 修复非法值。

### 9.2 `leave`（通用）

完整字段：`type,businessId,title,reason,days`。`days` 为 1–365 integer。`businessId` 必须合规。与 §4.1 的旧请假请求相比，多了类型化 business，不能相互混用同一 key。

### 9.3 `procurement`（通用）

完整字段：`type,businessId,title,reason,item,quantity,unitPrice,currency`。

- `item` 非空白，≤240。
- `quantity` integer 1–100000。
- `unitPrice` >0、≤1000000000、最多两位小数；JPY 数值必须整数。
- 合计为 quantity × unitPrice；请求不接受 `total`。通用响应没有独立 total 字段，客户端可用精确十进制计算。

### 9.4 `quoteDiscount`（CRM）

完整字段：`type,businessId,title,reason,customerRef,quoteRevision,item,quantity,listUnitPrice,requestedUnitPrice,currency,validUntil`。

- customerRef 非空白 ≤128（此字段使用文本校验）；quoteRevision ≥1。
- quantity、item、两个价格及 currency 继承 procurement 规则。
- requestedUnitPrice 必须严格低于 listUnitPrice 且 >0。
- validUntil 为真实 `YYYY-MM-DD`；还须符合源 revision 与有效期/ACL 规则（§3.3）。

### 9.5 `expense`（oa-expense）

完整字段：`type,documentVersion,businessId,title,reason,costCenter,currency,lines`。

- costCenter：`ENGINEERING/SALES/OPERATIONS`；lines 1–20。
- 每行必需：`lineId,spentOn,category,description,amount,receiptRef`。
- lineId、receiptRef 均为 reference，且各自在该单据内唯一；不跨申请占用票据。
- spentOn 真实日期；category `TRAVEL/MEALS/OFFICE/OTHER`；description 非空白 ≤240。
- amount >0、≤1000000000、最多两位小数；JPY 整数。
- total = 所有 amount 之和。票据引用不证明票据存在，不触发读取或报销付款。

### 9.6 `travel`（oa-travel）

完整字段：`type,documentVersion,businessId,title,reason,destination,startDate,endDate,purpose,estimatedCost,currency,costCenter`。

- destination 非空白 ≤160；costCenter `ENGINEERING/SALES/OPERATIONS`。
- purpose：`CUSTOMER_VISIT/PROJECT_DELIVERY/TRAINING/CONFERENCE/OTHER`。
- startDate、endDate 真实日期，起止含首尾 1–90 天。
- estimatedCost >0、≤1000000000、最多两位，JPY 整数。
- 无 lines、旅客信息或真实预订接口。

### 9.7 `sealUse`（oa-seal-use）

完整字段：`type,documentVersion,businessId,title,reason,documentName,documentRef,sealType,copyCount`。

- documentName 非空白 ≤160，documentRef reference。
- sealType：`OFFICIAL/CONTRACT/FINANCE`；copyCount integer 1–100。
- 该 HTTP endpoint 必须 `Content-Type: application/json`。完整提交原始 JSON 上限 8,000,000 UTF-16 code units，包含空白/转义语法；必须有效 UTF-8。超过 24,000,000 原始字节先拒绝，解码后再核对字符上限；均返回 400。不是附件额度，也不是整个存储文件大小限制。
- 同一个文件引用不代表附件已上传或印章已应用。此接口不签署文件。

### 9.8 `receiving`（erp-receiving）

完整字段：`type,documentVersion,businessId,title,reason,purchaseOrderRef,warehouse,receivedOn,lines`。

- purchaseOrderRef reference；warehouse `EAST/WEST`；receivedOn 真实日期；lines 1–20。
- 每行必需：`lineId,orderLineRef,description,unit,ordered,received,accepted,rejected,exceptionReason`。
- lineId、orderLineRef 均为 reference，各自在本单据唯一；description 非空白 ≤240。
- unit `PCS/BOX`；ordered integer 1–100000；received 0–ordered；accepted/rejected 各为 0–100000。
- `accepted + rejected == received`；至少一行 received>0；不是历史/跨单据累计余额控制。
- 四个数量必须是原始 JSON integer token，拒绝 `-0`、`1.0`、`1e0`、字符串和 null。
- exceptionReason 必须为字符串 ≤1000；rejected>0 时非空白，否则可 `""`。
- 返回分单位 summary，无 currency、amount 或可混合求和的 total。

### 9.9 `paymentRequest`（erp-payment）

完整字段：`type,documentVersion,businessId,title,reason,supplierRef,currency,requestedPaymentOn,lines`。

- supplierRef reference；requestedPaymentOn 真实日期；lines 1–20。
- 每行必需：`lineId,invoiceRef,description,invoiceAmount,previouslySettledAmount,allocationAmount,deductionAmount,deductionReason`。
- lineId、invoiceRef reference，各自在本单据唯一；description 非空白 ≤240。
- 所有金额 ≤1000000000、最多两位、JPY 整数。invoiceAmount/allocationAmount >0，previouslySettledAmount/deductionAmount ≥0。
- `previouslySettledAmount <= invoiceAmount`；`allocationAmount <= invoiceAmount - previouslySettledAmount`；`deductionAmount <= allocationAmount`。
- deductionReason 必须字符串 ≤1000；deductionAmount>0 时非空白，否则可空。
- 全单净额 `sum(allocationAmount) - sum(deductionAmount)` 必须 >0。
- paymentSummary 中 declaredOutstanding = Σ(invoiceAmount − previouslySettledAmount)，grossAllocation = ΣallocationAmount，deductionTotal = ΣdeductionAmount，netTotal = grossAllocation − deductionTotal。
- 声明的发票/已付余额为合成输入；不验证银行余额、不锁余额、不跨申请占用发票、不付款。

### 9.10 `contractApproval`（crm-contract）

完整字段：`type,documentVersion,businessId,title,reason,customerRef,contractRevision,contractCategory,currency,contractAmount,startOn,endOn,termsKind,deviationReason,documentRef,lines`。

- customerRef/documentRef reference；contractRevision integer ≥1；contractCategory `PRODUCT/SERVICE`。
- contractAmount >0、≤1000000000、最多两位，JPY 整数；startOn/endOn 真实日期，endOn 不早于 startOn。
- termsKind `STANDARD/NONSTANDARD`；deviationReason 必须字符串 ≤2000。NONSTANDARD 需非空白；STANDARD trim 后必须为空，一般备注写入 reason。
- lines 1–20；每行必需：`lineId,milestoneRef,description,dueOn,amount,acceptanceCriteria`。
- lineId/milestoneRef reference，各自在本单据唯一；description 非空白 ≤240，acceptanceCriteria 非空白 ≤1000。
- amount >0、≤1000000000、最多两位，JPY 整数；所有里程碑合计必须精确等于 contractAmount。
- dueOn 在合同起止日期内，按数组顺序非递减（允许同日）。
- contractRevision 是声明字段，无报价宿主式源 revision 锁；不会签署、发送给客户、产生应收或更新 CRM。

## 10. HTTP 错误与恢复 / Errors

独立 API 的受控错误是 JSON `{ "message": "…" }`，不是通用 code/data envelope；消息可中英混合，客户端以状态码和上下文处理，不要把英文文案当作稳定机器错误码。

| HTTP | 已实现的典型原因 | 客户端处理 |
| --- | --- | --- |
| 400 | JSON/DTO/业务规则不符；key 缺失/非法/禁止；未知/重复 inbox 参数；currency/routing 类型不符；自审流程提交 | 修正数据，不换 key 盲重试 |
| 401 | 缺失或错误 Basic 认证 | 修正本地身份凭据，不假定有 login API |
| 403 | Origin/client 头不符；无发布资格；非该历史阶段指定成员；账号失效；报价非 owner | 检查宿主/权限；不绕过授权 |
| 404 | 不存在或对该身份不可见的申请；未知场景；不可读报价 revision | 检查所用宿主、身份和 ID；不推断资源存在 |
| 409 | 发布/提交版本过期；key 被不同 intent 使用；已终态/非当前阶段/相反重复决定；并发竞争；报价源字段/revision 冲突 | 刷新 process/请求历史，按原 intent 确认后重试 |
| 415 | 不支持 Content-Type；用印非 application/json | 发送正确媒体类型 |
| 503 | 捕获到 checked `IOException`，存储写入或 inbox I/O 无法确认 | 刷新后按原 key/intent 检查重试，不把它当作确认未提交 |

`503` 独立消息为 `Storage unavailable; no change confirmed. Refresh before retrying.`，不保证事务完全未发生。部分读路径将 I/O 包装为 `UncheckedIOException`，并未被该 advice 专门映射；未知异常/错误 dispatch 的响应可能由 Spring/安全链决定，不能声称所有错误均稳定为上述 envelope 或所有 I/O 都为 503。未知路由和未实现方法也不构成约定 API。

<a id="ruoyi-native-host"></a>

## 11. 若依原生差异 / RuoYi native adapter

源码：[ArcFlowController.java](../../examples/ruoyi-vue3/backend/src/main/java/com/ruoyi/arcflow/ArcFlowController.java)、[ArcFlowErrors.java](../../examples/ruoyi-vue3/backend/src/main/java/com/ruoyi/arcflow/ArcFlowErrors.java)、[ArcFlowConfiguration.java](../../examples/ruoyi-vue3/backend/src/main/java/com/ruoyi/arcflow/ArcFlowConfiguration.java)。宿主准备、原生登录和权限见 [若依示例 README](../../examples/ruoyi-vue3/README.md)。

| Method/Path | 权限 | 成功 HTTP/body |
| --- | --- | --- |
| GET `/arcflow/me` | `arcflow:request:read` | 200 `AjaxResult.data={id,displayName,canPublish}` |
| GET `/arcflow/people` | 同上 | 200 data=`Person[]` |
| GET `/arcflow/process` | 同上 | 200 data=`ProcessDefinition` |
| POST `/arcflow/process` | `arcflow:process:publish` | 200 data=新 `ProcessDefinition` |
| GET `/arcflow/requests` | `arcflow:request:read` | 200 data=`Request[]` |
| GET `/arcflow/requests/inbox` | 同上 | 200 data=`InboxPage` |
| POST `/arcflow/requests` | `arcflow:request:submit` | **200** data=`Request`，非 standalone 的 201 |
| POST `/arcflow/documents` | 同上 | **200** data=`Request`，仅 leave/procurement |
| POST `/arcflow/requests/{id}/decisions` | `arcflow:request:decide` | 200 data=`Request` |

通常成功形状为 `{ "code":200, "msg":"操作成功", "data":… }`；业务异常保留真实 HTTP 状态并使用 `AjaxResult.error(code,msg)`。若依自身认证和权限异常由宿主处理，不保证与独立 `{message}` 一致，也不要仅靠 HTTP 200 判断其他若依 API 的业务成功。

关键差异：

1. 若依处理登录、JWT/Redis session、登录 CAPTCHA、角色和菜单；ArcFlow overlay 不提供第二套 Basic 认证或新登录端点。通过原生请求封装传令牌，不向 `/arcflow` 发送 demo Basic 凭据。
2. actor 是 `SecurityUtils.getUserId()` 的数字**字符串**，不是登录用户名；必须为 active、未删除用户。使用 `/arcflow/people` 中的真实 IDs 发布流程，不能填 alice/bob/carol。
3. `X-Arcflow-Client`/standalone Origin 规则不是 native overlay 新增要求；其请求安全规则由当前若依宿主决定。前端 `/dev-api` 或 `/prod-api` 是代理前缀，不是该 Controller 的根路径。
4. `@PreAuthorize` 是第一层，领域内仍检查历史分配成员。管理员 wildcard 权限不让管理员代替任意审批人投票。`canPublish` 在 native `/me` 返回。
5. 严格 JSON decoder 仅用于 ArcFlow endpoints，不更改若依全局 ObjectMapper。native DTO 没有 standalone 的全部 Bean Validation 注解，核心业务/流程/幂等/状态规则仍由共享领域验证；例如非法 stepId 在领域按实际申请/阶段处理，不承诺与 standalone 相同的最早错误。
6. 两个提交路由支持同样可选幂等头；native keyed 客户端只绕过若依短时间重复提交拦截，让持久化幂等层解析，不关闭认证或 RBAC。
7. 没有 `/arcflow/scenarios` 或 `/arcflow/crm` Controller；没有把六场景/schema-4 条件路由接入 native HTTP 的实现。generic 发布只接受 schema 2/3。
8. 示例 approval 存储仍是 single-writer 本地 JSON，若依 MySQL 用户库不代表审批已自动接入 JDBC 或分布式事务。

## 12. 源码索引与变更检查 / Sources and change checklist

- 路由：[generic Controller](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/ApprovalController.java)、[scenario Controller](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/ScenarioController.java)、[quote Controller](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/QuoteDiscountController.java)、[native Controller](../../examples/ruoyi-vue3/backend/src/main/java/com/ruoyi/arcflow/ArcFlowController.java)
- 认证与媒体/来源约束：[SecurityConfig](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/SecurityConfig.java)、[JsonConfig](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/JsonConfig.java)、[application.properties](../../examples/approval-demo/backend/src/main/resources/application.properties)
- 领域：[ApprovalService](../../examples/approval-domain/src/main/java/com/arcflow/approval/ApprovalService.java)、[BusinessDocument](../../examples/approval-domain/src/main/java/com/arcflow/approval/BusinessDocument.java)、[ProcessDefinition](../../examples/approval-domain/src/main/java/com/arcflow/approval/ProcessDefinition.java)、[InboxQuery](../../examples/approval-domain/src/main/java/com/arcflow/approval/InboxQuery.java)
- 专属模型：[ScenarioCatalog](../../examples/approval-domain/src/main/java/com/arcflow/approval/ScenarioCatalog.java)、[ScenarioCase](../../examples/approval-domain/src/main/java/com/arcflow/approval/ScenarioCase.java)、[QuoteDiscountCase](../../examples/approval-domain/src/main/java/com/arcflow/approval/QuoteDiscountCase.java)、[ConditionalRouting](../../examples/approval-domain/src/main/java/com/arcflow/approval/ConditionalRouting.java)
- 深入契约：[幂等](../SUBMISSION_IDEMPOTENCY.md)、[成员收件箱](../MEMBER_INBOX.md)、[业务文档](../BUSINESS_DOCUMENTS.md)、[条件路由](../CONDITIONAL_ROUTING.md)

改接口时同步 Controller/DTO、领域校验、本参考、请求样例和 HTTP 测试；不要只改展示文案。更改表单版本、持久化 schema 或宿主集成范围时，分别记录迁移与实测证据。本文和请求示例的存在不代表生产就绪、部署完成或所有宿主已验收。
