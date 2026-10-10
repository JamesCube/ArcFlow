# 付款申请与合同审批

<!-- Legacy fragments remain entry points after the language split. -->
<a id="crm-合同审批--contract-approval"></a>
<a id="current-main-scope--当前主线范围"></a>
<a id="erp-payment-requests-and-crm-contract-approvals"></a>
<a id="erp-付款申请--payment-request-review"></a>
<a id="historical-implementation-checkpoint--历史实现检查点"></a>
<a id="nine-type-json-compatibility-and-jdbc"></a>
<a id="shared-strictness-immutability-and-retries"></a>
<a id="verification-and-screenshots"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](PAYMENT_CONTRACT_SCENARIOS.en.md) · [文档目录](README.md)

<!-- topic:current-scope -->
## 当前范围

当前 main 的六项独立目录已包含付款和合同，均为不付款、不签约、不回写的合成内部审批。当前 reader 支持 wrapper 1–13；以下 wrapper 12 上限及本地/未合并状态来自条件路由之前的历史候选。按[当前迁移指南](development/PERSISTENCE.md)上线，并核对精确提交 CI；架构见[当前说明](development/ARCHITECTURE.md)。

<!-- topic:historical-implementation-checkpoint -->
## 历史实现检查点

该扩展在统一 Travel/Seal-use/Receiving 候选上增加两种独立合成场景，当时尚未合并，不是部署或生产财务/法律集成。两者均位于 `/scenarios.html`，沿用认证演示身份与发布权限。

<!-- topic:payment-request-review -->
## 付款申请

`erp-payment` 只接受 `paymentRequest`、`documentVersion: 1`；文件为 `approval.data-file + ".scenario-erp-payment.json"`，路由 `/api/scenarios/erp-payment`，请求参数不能选择文件路径。

表单记录供应商引用、期望付款日期、币种和 1–20 项发票分配。发票都是显式合成声明，不是真实核验发票或 ERP 应付余额，不收集银行信息。每行包含：

- 唯一行 ID、发票引用及说明
- 声明发票金额与此前已结算金额
- 本次分配金额及其中扣减
- 扣减为正时必填的解释

每项输入为精确十进制，≤1,000,000,000。发票和分配金额必须为正，已结算与扣减可为零；已结算≤发票，分配≤发票减已结算，扣减≤分配，至少一行净申请额为正。全部明细使用头部 CNY/USD/EUR/GBP/JPY，最多两位小数，JPY 整数；日期为年份 0001–9999 的真实日期。

服务端从冻结单据派生：

| 字段 | 计算 |
| --- | --- |
| `declaredOutstanding` | 发票减此前已结算之和 |
| `grossAllocation` | 本次分配之和 |
| `deductionTotal` | 扣减之和 |
| `netTotal` | 分配减扣减 |

响应恰为 `{request,total,paymentSummary}`，`total` 是净申请金额；`paymentSummary` 含 `type:"paymentRequest"` 与上述四个精确十进制字符串。不接受派生总额输入，其他场景不增加此成员。

示例两张发票 10,000/4,000，已结算 4,000/0，分配 4,500/2,500，扣减 500/0，得到声明待结算 10,000、分配 7,000、扣减 500、**净申请 6,500**。这不预留余额，另一键仍可引用同一发票。

默认流程：

1. `payment-check`：Bob、Carol 的 ALL
2. `payment-final`：Bob、Carol 的 ANY

ALL 第一票同意后仍等另一人，两人在第二步都须重新投票。ANY 中一人拒绝不构成否决，仍等另一人；一人同意即通过，全员拒绝才驳回。ALL 任一拒绝立即终止。历史/已办只记录实际决定。两个步骤使用同一 Bob/Carol，不是四个独立组织角色。

通过只表示“付款申请审批通过”，不支付、核验或查询发票、不占用余额、不生成凭证或更新 ERP。期望日期不是自动付款计划，声明金额不提供跨申请防重付或余额锁定。

<!-- topic:contract-approval -->
## 合同审批

`crm-contract` 只接受 `contractApproval`、`documentVersion: 1`；文件为 `approval.data-file + ".scenario-crm-contract.json"`，路由 `/api/scenarios/crm-contract`。不继承报价宿主的源归属校验；客户/文档引用和声明合同版本均为合成输入，不是可信 CRM 源记录。

表单含独立合同草稿、条款审核与付款里程碑。头字段为客户引用、声明版本（1–2,147,483,647）、PRODUCT/SERVICE 分类、币种、合同金额、起止日期、STANDARD/NONSTANDARD 条款、偏差解释、文档引用及普通审核备注。

1–20 项里程碑各有唯一行 ID 和里程碑引用、描述、到期日、正精确金额和明确交付/验收标准。总和必须精确等于合同金额，一分钱误差也失败；日期在含首尾的合同期限内，按显示顺序不递减，不同里程碑可同日。金额/币种/日期规则同付款，合同总额本身 ≤1,000,000,000。

NONSTANDARD 必须说明偏差；STANDARD 必须将此字段留空，普通备注仍可写入 `reason`。界面解释区别，切换条款时不静默删除解释草稿。历史候选中该标志仅供人工审核，不自动选步骤；当前专用合同场景可显式配置[受限条件](CONDITIONAL_ROUTING.md)。

示例 CNY 100,000 服务合同分 30,000/40,000/30,000，并写明确验收条件。响应保持 `{request,total}`，总额为精确字符串。草稿界面另计算里程碑合计与未分配额，不是客户端权威输入。

默认流程：

1. `commercial-review`：Bob 审核商务草稿
2. `contract-review`：Bob、Carol 的 ALL

Bob 在联合步骤需要第二次独立决定，前一步不抵扣；Carol 可在 ALL 拒绝。设计器可为后续版本添加 ANY 终审，旧申请保留两步快照。声明合同版本不是源唯一锁，新幂等键可对同一版本建立新审核意图。

通过只代表内部合同审核，不签名、盖章、发送客户、激活合同、建立应收、修改商机或付款。文档引用不下载文件或验证签名，不提供法律意见或效力认证。

<!-- topic:shared-strictness-immutability-and-retries -->
## 严格输入、不可变性与重试

- 两个入口都恰需一个 `Idempotency-Key`，绑定认证申请人。
- 完整规范化单据、行顺序、流程 ID 与原版本绑定意图；改变则 HTTP 409，相同则在部分投票、终态和重启后返回同一申请的当前状态。
- 合同行重排须仍按日期有序；有效新顺序也属新意图，无效顺序在幂等比较前按无效输入拒绝。
- 引用为 1–128 ASCII 标识；标题 ≤120 UTF-16 单元、普通原因/偏差说明 ≤2,000、行描述 ≤240、扣减解释/验收标准 ≤1,000。先检查原始长度再做既有 C0 边缘 trim，必填纯 Unicode 空白拒绝。
- 缺少/未知字段、派生输入、重复 JSON 键、字符串金额、浮点/字符串版本、不支持单据版本均拒绝。
- 提交冻结业务与完整定义，表单/后续发布不能改旧申请。新版本意图需新申请；驳回不会编辑或静默重提合同。
- 六个编译期宿主严格隔离类/流程，通用请假/采购路由仍拒绝这些类型。浏览器接受异步结果前也验证精确封装及当前身份/场景。
- 该历史扩展未增加任意 schema、表达式、条件路由、动态组织角色、源余额预留、付款或签约。当前受限路由另见条件契约。

<!-- topic:historical-nine-type-json-and-jdbc-compatibility -->
## 历史九类型 JSON 与 JDBC 兼容

该检查点支持九类与 wrapper 1–12，当前上限为 13：

| 类型 | 最低快照 wrapper |
| --- | --- |
| leave / procurement | 5 |
| quoteDiscount | 6 |
| expense | 7 |
| travel | 8 |
| sealUse | 9 |
| receiving | 10 |
| paymentRequest | 11 |
| contractApproval | 12 |

写者取已有 wrapper、定义、幂等和全部已存单据最低值的最大值。合法读取不改写或升级，高兼容 wrapper 可只含旧类型。该历史 reader 拒绝 wrapper 13+；未知类型、不满足最低版本及无效载荷也拒绝。当前未来版本限制见迁移指南。

真实升级保存紧邻之前原始字节，重名保留旧备份，原子替换失败不发布申请、键或内存成功。备份是历史恢复，不是无损降级。读写者兼容部署、停旧写者后再启用；PR39 的 schema 10 reader 不能读新格式，即使其他文件没变，也不能用旧备份覆盖新写入来假装兼容。

JDBC 保持 SQL revision 3 和就绪成员投影，不增加 DDL、索引重建、跨场景键空间或流程隔离例外；键仍跨流程按申请人全局隔离。SQL 未变不代表旧程序能读新载荷。

<!-- topic:verification-and-screenshots -->
## 验证与截图

领域测试含五种新类型（Travel 至 Contract）的全部 120 种写入顺序、只读 wrapper 1–12、九种最低版本边界、紧邻备份失败、严格输入、精确金额和真实生命周期/版本快照。宿主/JDBC 测试使用真实 API、独立存储、并发重试、回滚及成员投影。CI 分别要求声明的 Boot 4.1.1 HTTP/浏览器、H2 和零跳过真实 PostgreSQL/MySQL 矩阵。

新浏览器套件在认证合成数据下采集中英桌面/390px 状态，记录实际源码版本、干净/修改状态、后端 JAR hash、运行时、工作流身份与图片 hash。采集不是独立视觉验收，兼容运行器输出只能标为补充。此前候选产物下载遇 403/1010，未绕过限制，新采集不等于旧原图验收。

原候选的最终数量、精确 head 和未完成门槛随当时草案记录。本页不是执行合并、自动合并或部署的授权；当前验收应核对目标提交。
