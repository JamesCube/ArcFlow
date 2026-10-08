# 报价折扣审批 / Quote discount approval

本文说明**隔离的合成 CRM 报价案例**及其接入、验证边界。采购／成员待办接入基线为已合入 main 的
`caece22fb52e645f303c6adec73f19a027d38e66`，树
`1d3332659bc59f3c70f2ffb5954aed6aa383f522`。本文不替代当前分支或 PR 的合并、部署和验收状态。

仓库包含领域、宿主 HTTP、JSON/JDBC 恢复、model/DOM、真实浏览器及 PostgreSQL/MySQL 合同测试。
测试定义不是通过证明：请核对目标提交的实际执行报告、未跳过的数据库用例及双语截图。
原生若依 CRM 页面和三端共享列表不在本例已实现范围内。
验收门槛见 [CRM 兼容性与发布检查](CRM_COMPATIBILITY_READINESS.md)。

This document describes the isolated synthetic CRM case and its boundaries against the
accepted main baseline above. It does not assert the current branch's merge, deployment or
acceptance status. Browser and server-database test definitions are included; verify actual
exact-head reports, non-skipped database cases and screenshots before claiming those checks
passed. Local model/DOM checks and inherited baseline CI do not replace that evidence.

## 可以运行的边界

- 独立端新增 `/api/crm` 宿主示例及 `/quote-discount.html` 页面，中英文可切换。
- 使用合成客户引用 `CUSTOMER-DEMO-A`（演示客户 A）和 `Q-DEMO-001` 第 1 版。
- 10 套设备，目录单价 CNY 1,000.00，申请单价 CNY 850.00：申请总额 CNY 8,500.00，
  减少 CNY 1,500.00，折扣率 15%。示例有效期固定为 2099-12-31；宿主日历使用 UTC。
- Alice 为报价归属销售，Bob 为预设销售经理，Carol 为预设财务。所有折扣都先 Bob、后 Carol，
  不根据金额或折扣变更流程；这些称谓不是组织架构或角色解析引擎。
- 使用独立 `quote-discount` 流程和 `approval.data-file + ".quotes.json"` 文件。
  原请假/采购服务、默认 `/api/process` 和成员待办接口不因此合并或更换流程。
- 页面在窄屏仅提供查看和审批。新建表单使用桌面窗口；既有 H5 应用尚未接入 CRM。
- 不连接真实 CRM、客户账号、模型供应商、付款或库存接口；没有客户通知、签约、商机成交或回写。
  `APPROVED` 仅表示这份不可变快照通过人工审批。

This is a bounded local synthetic example. It adds an explicit typed document and host boundary,
not a condition gateway, CRM connector, organizational role resolver, or a business-system writeback.
No third-party credentials, customer records or external LLM calls are used.

## 本地启动

沿用 `docs/GETTING_STARTED.md` 的独立端 Java 17+、Maven、Node 安装与密码设置步骤。
先安装当前源码的 core 和 approval-domain，再运行后端与现有 approval-ui：

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml spring-boot:run
# 另一个终端，使用已安装且与 lockfile 一致的依赖
cd examples/approval-ui
npm run dev
```

打开 `http://localhost:5173/quote-discount.html`，使用原有演示账号密码。
密码只保留在当前页面内存，退出后清除；页面不写入 localStorage、sessionStorage 或 URL。
先 Alice 提交，再退出并以 Bob 登录审核，最后 Carol 复核。
列表会显示每笔审批的报价版本、金额、当前步骤和原始理由。

报价页面通过独立地址访问，尚未加入共享主导航或采购／成员待办工作区。
部署静态构建时须保留 `dist/quote-discount.html` 和 `dist/crm-quote/`，并将 `/api` 反向代理到后端；
Origin 配置和原有非简单客户端头校验继续生效。

## 单据与 HTTP 契约

新增 `BusinessDocument.QuoteDiscount`，wire type 为 `quoteDiscount`。所有字段必填：

```json
{
  "business": {
    "type": "quoteDiscount",
    "businessId": "Q-DEMO-001",
    "title": "设备报价折扣申请",
    "reason": "十套设备的合成报价，申请单价为 CNY 850.00。",
    "customerRef": "CUSTOMER-DEMO-A",
    "quoteRevision": 1,
    "item": "设备套装 / Equipment set",
    "quantity": 10,
    "listUnitPrice": 1000.00,
    "requestedUnitPrice": 850.00,
    "currency": "CNY",
    "validUntil": "2099-12-31"
  },
  "processVersion": 1
}
```

提交到 `POST /api/crm/documents`。身份只来自登录态，不能提交 applicantId、approverId 或 processId。
`GET /api/crm/quotes` 提供当前有权读取的源报价；`GET /api/crm/process` 返回固定流程；
`GET /api/crm/requests` 返回可见快照与派生显示金额；决策使用
`POST /api/crm/requests/{id}/decisions`（stepId、decision、comment）。

宿主响应包装为 `QuoteDiscountCase.View`：`request` 保持原 `ApprovalService.Request` 契约，
`listTotal/requestedTotal/reductionTotal/discountPercent` 是精确十进制的显示字符串。
`thresholdReached` 仅是 10% 核对提示；`expired` 和 `quoteUpdated` 不是新的审批状态。
领域 `Request.days` 对该类型为 0，任何消费者都必须按 `business.type` 分支，不能显示“0 天请假”。

通用 `POST /api/documents` 和若依 `POST /arcflow/documents` 明确拒绝该新类型，
防止绕过客户读权、归属销售及源报价版本核对。生产宿主应单独实现相同边界，而非放开通用入口。
原若依四项权限和请求包装保持原样；本次没有提供原生若依 CRM 适配器。

## 金额、时间与来源校验

- 公共 businessId/title/reason、item、quantity、currency 和两位小数/JPY 规则复用现有采购限制。
- customerRef 最多 128 字符；quoteRevision 为 1–2,147,483,647 的整数。
- 两种单价都必须大于 0、不超过 1,000,000,000，申请价严格小于目录价。
- Java 使用 BigDecimal，页面金额使用 BigInt 最小单位；0.10 × 3 为 0.30，最大合法总额完整保留。
- 总额与差额仅由服务端计算；请求中的派生金额、未知字段、重复 JSON key、数值字符串、
  小数整数、未知业务类型和不合法日期均拒绝。
- 百分比保留至四位小数作展示；阈值判断使用精确交叉乘法，不使用四舍五入百分比。
- validUntil 为真实 YYYY-MM-DD 日期；新提交不能早于宿主 UTC 当天。
  过期历史快照仍可恢复、读取和继续人工审批；过期提示不会自动驳回。
- 宿主按 businessId + quoteRevision 加载权威来源，验证 customerRef、目录价、物品、数量、
  币种和有效期。每位预设审批人必须对该版本有业务读权。

`QuoteSource` 是宿主契约：历史报价版本和归属销售必须不可变，当前读权每次查询时有效。
若接入有并发版本变更的真实系统，应在源系统事务或一致性令牌内完成读取和绑定；此示例不声称
在外部 CRM 并发变更下提供跨系统事务。生产级客户/附件/字段权限仍由宿主实现。

## 报价版本绑定与原幂等契约

独立宿主将报价编号和版本编码为确定性 SHA-256 提交键，由原 store 在提交快照时原子保存。
同版本、同意图返回原单当前状态；同版本改价格、理由、标题或流程版本返回 409。
刷新页面不丢失该版本绑定。新报价版本才会创建新申请；驳回后的同版本仍定位原驳回单。

该宿主入口**不接受自定义 Idempotency-Key**，收到该头返回 400，避免同时宣称两个不同的键范围。
领域 `ApprovalService.submitDocument(actor, document, processVersion, key)` 的任意可选键语义不变，
同键改任一报价字段以及跨 leave/procurement/quoteDiscount 的冲突均有测试。
这没有把所有 BusinessDocument 的 businessId 改成全局唯一约束。

宿主只有一个固定流程实例，没有多流程注册器。报价、请假及采购共用数据库时，JDBC 原有的
`(applicant_id, submission_key)` 全局唯一范围继续生效，跨流程重复键返回 409。
报价请求不能从请假接口读取或审批。历史审批完成后，宿主不对源报价执行任何写操作。
源系统当前版本不同会显示“报价已更新，请重新提交审批”，旧结果不会当作新版本授权。

## 存储格式与升级门槛

- JSON 1–5 继续严格读取；首次写入 quoteDiscount 使用 snapshot schema 6。
- schema5 中混入 quoteDiscount 会拒绝；schema6 不因后续请假或采购写入而降级。
- 第一次 5→6 升级保存紧邻升级前的完整 schema5 字节备份，即使同一进程内先完成了一次
  schema5 审批写入。失败的原子写入不发布内存状态；旧迁移备份行为保留。
- 流程定义 schema 2/3 不变；JDBC 沿用成员待办集成基线的 SQL schema revision 3；CRM 不新增 SQL 迁移。新类型保存在 request_json 中，成员投影必须完成既有 revision3 backfill 并处于 ready 状态。
- **仅支持 schema5 的 reader（包括已合并的采购／成员待办基线）不认识该新类型/schema6。**
  先部署所有兼容 reader，停止旧 writer，
  再启用报价提交；不能混合滚动写入。JDBC 没有新增自动 SQL 迁移或降级步骤。
- 备份仅用于受控恢复，直接恢复旧备份会丢失之后的申请和审批，不能作为无损降级。

Snapshot schema 6 is required only once quotes are written; schema-5 leave/procurement
readability and the existing SQL revision 3 contract are retained. Upgrade every reader and
stop incompatible writers before enabling quotes. The pre-upgrade backup is a recovery aid,
not a lossless downgrade path.

## 验收与下一步 / Verification and next steps

此前本地检查记录随交付包保存，不替代最终候选的回归。`examples/crm-quote/http_smoke.py` 使用随机、临时密码启动打包后的
真实 Spring Boot HTTP 服务，完成报价、两步审批、篡改拒绝、跨流程隔离与重启恢复。

```sh
mvn -f examples/approval-domain/pom.xml test
mvn -f examples/approval-demo/backend/pom.xml verify
mvn -f examples/approval-jdbc/pom.xml test
node --test examples/approval-ui/tests/crm-quote/*.test.mjs
python3 examples/crm-quote/http_smoke.py --inbox --jar examples/approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```

`mvn test` 没有配置真实数据库时会跳过 PostgreSQL/MySQL 合同；不能将其报告成数据库全绿。
页面 DOM 测试不能替代真实浏览器验收。`--inbox` 只检查真实 HTTP 的跨流程隔离，不模拟浏览器。
CRM 浏览器、桌面与 390px 双语截图和真实数据库检查均需核对目标提交的实际执行结果；
远端 exact-head CRM CI 尚未运行。通用若依构建通过也不表示若依已有 CRM 页面。

下一步清单：
1. CRM 负责人：在上述已接受 main 基线上核对最终增量和冲突处理，重新执行领域、MVC、JDBC、客户端构建及真实 HTTP 回归。
2. 验收负责人：完成最终树的真实 PostgreSQL/MySQL CRM 合同，以及中文／英文、桌面／390px、跨角色、刷新、退出和失败恢复的浏览器旅程，保存对应提交的结果与截图。
3. 发布负责人：完成草稿 PR 发布流程并核对 exact-head 远端 CI；发布候选不表示允许合并或部署，也不表示检查已通过。
4. 后续共享工作区接入：同步扩展独立端、若依和 H5 的 quoteDiscount 解析、金额精度、业务权限和只读详情，再单独验收；H5 继续不新建。

For this candidate, verify the final delta against the accepted baseline, rerun the local
regressions, then record actual browser/server-database results and exact-head remote CI.
The dedicated page remains the only quote UI in scope. Shared standalone/RuoYi/H5 quote
views require a separate integration; approval never sends a quote, charges a payment,
notifies a customer or writes to a CRM.
