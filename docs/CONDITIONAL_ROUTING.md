# 受限条件路由

<!-- Legacy fragments remain entry points after the language split. -->
<a id="current-main-scope--当前主线范围"></a>
<a id="definition-and-safety-boundary"></a>
<a id="frozen-request-contract"></a>
<a id="historical-implementation-checkpoint--历史实现检查点"></a>
<a id="local-verification-checkpoint-2026-10-09"></a>
<a id="migration-and-database-contract"></a>
<a id="required-evidence"></a>
<a id="restricted-conditional-routing--受限条件路由"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](CONDITIONAL_ROUTING.en.md) · [文档目录](README.md)

<!-- topic:current-main-scope -->
## 当前主线范围

当前源码在独立端报销、付款、收货、合同提供定义 schema 4 路由，JSON wrapper 13，SQL revision 3 不变。[报销总额操作案例](EXPENSE_ROUTING.md)扩展现有 `runIf` 契约，不改上述版本号或原三场景证据。以下基线和本地验证为历史记录，失败、跳过与未取得渲染证据的事实保留；当前提交 CI 另查。[架构](development/ARCHITECTURE.md) · [迁移](development/PERSISTENCE.md)

<!-- topic:historical-implementation-checkpoint -->
## 历史实现检查点

基线 PR41 `a30bca2934472da4fbf1609ea5c9cfd1a27a2028`，tree `de619b40446a6d8076109332fa1a0ba1b673b12c`。当时仅本地实现，验证单列；契约本身不是通过或生产就绪声明。

<!-- topic:definition-and-safety-boundary -->
## 定义与安全边界

schema 4 为审批节点增加可选 `runIf`，开始/结束不能有。仍是 1–8 个有序固定成员阶段，至少一个无条件人工阶段。规则只选择额外审核，不决定业务通过/拒绝；SINGLE/ALL/ANY 表决不变。不执行脚本、嵌套表达式、反射、JSONPath、时间、网络、循环、任意跳转或动态指派。

规则为 `{mode: "ALL" | "ANY", predicates: [...]}`，每条 1–8 个原子，全定义最多八个；同一定义全部规则针对同一业务类型。原子字段严格为：

- 报销：`{field:"expense.totalAmount", operator:"EQ"|"GT"|"GTE"|"LT"|"LTE", currency, threshold}`。事实为 1–20 行不可变 `Expense` 明细的精确总额，不接受客户端提交总额。阈值为 0–20000000000（含端点）的精确 JSON 数字，最多两位小数，JPY 整数；币种为 CNY/USD/EUR/GBP/JPY，必须匹配每个金额谓词，包括 ANY 内全部原子。不符则拒绝提交，不换汇也不静默 false。以 `GTE CNY 10000` 为例，低于阈值仍需必审，达到或超过时再加财务复核。

- 付款：`{field:"payment.netTotal", operator:"EQ"|"GT"|"GTE"|"LT"|"LTE", currency, threshold}`。阈值为 0–20000000000 的精确 JSON 数字，最多两位，JPY 整数；币种 CNY/USD/EUR/GBP/JPY。业务币种必须匹配**每个**金额谓词，即使 ANY 中另一项已满足；不匹配明确拒绝提交，不换汇或暗中判 false 以绕过大额审核。
- 收货：`{field:"receiving.hasRejectedLines", operator:"EQ", expected:boolean}`。事实由不合格数量计算，不能由客户端另行提供。
- 合同：`{field:"contract.termsKind", operator:"EQ"|"IN", values:[...]}`。值为唯一 STANDARD/NONSTANDARD；EQ 恰一项，IN 一或两项。

发布必须匹配场景登记类，通用/报价宿主不能发布 4。schema 2/3 字段行为不变。编辑后 schema 4 可以没有条件节点，但每笔申请仍需显式 route。

<!-- topic:frozen-request-contract -->
## 冻结申请契约

完整原 `Request.definition` 与保留的发布版本完全一致，不筛除或重写。schema 4 申请必须有：

`routing = {schemaVersion:1, stepIds:[...], evaluations:[{stepId,result,predicates:[{field,actualValue,result}]}]}`

`stepIds` 为非空、按原序排列的被选审批 ID。evaluations 恰含所有条件节点、保持原序；其中每个原子的事实保持顺序，不短路。`actualValue` 为规范字符串，如 `CNY 10000`、`true`、`NONSTANDARD`；金额去小数尾零、用普通计数法。无条件节点必选，跳过节点不补审批事件。

路径只由不可变业务与定义决定；恢复重算并比较全部冻结路径、顺序和事实，不查当前定义或源业务。schema 2/3 禁止 routing。统一 effectiveApprovals 驱动投票重放、转移、当前/待决身份、授权和成员投影。仅出现在被跳过节点的人不能读、投票或进入待办/已办；完整定义任何位置都不能指派申请人自审。

先查提交键，再校验新意图资格/路由。配置改变后相同旧意图返回当前持久申请及原路径。创建前检查全部谓词；申请/路径/键/投影/审计按原存储契约原子提交。投票只追加一条有效事件，业务、定义和 routing 必须完全不变。

<!-- topic:migration-and-database-contract -->
## 迁移与数据库契约

JSON 13 要求 `routingDefinitions` 数组保存全部已发布 schema 4 定义，包括没有申请的版本；每笔 4 申请和当前定义都须精确匹配保留版本。重复、缺失、冲突、未来版本全部拒绝。这校验冗余快照一致性，不认证恶意重写整个未签名文件后的真实性。

每个 4 定义（包括无申请发布）及 route 都要求 wrapper 13。reader 保留 1–12 严格行为，拒绝低 wrapper 中 routing/定义 4，以及未知未来版本/类型/字段，不修改文件。升级原样备份紧邻之前字节，再原子替换；写者单调不降、读取不升级。13 之前的 reader 不能读 13；已懂 13 但早于 `expense.totalAmount` 的 reader 也必须拒绝未知字段，包括没有申请的已发布定义。启用前停旧写者并升级全部读取端，即使存储已经是 13 也要在发布前备份：新字段本身不改变 wrapper 数字，不会触发自动升级备份。旧备份恢复会丢失后续申请/票，不是无损降级。

SQL revision 3 已保存完整定义/申请 JSON 与成员投影，无新 DDL。新投影构建/校验均用 effectiveApprovals；必须测试旧 schema 2/3 路径及就绪成员行不变。SQL 未变不允许新旧程序混跑；保持原迁移/回填、保留版本身份、事务、全局申请人/键及审计检查。H2、PostgreSQL、MySQL 分开报告，跳过不得算通过。

<!-- topic:required-evidence -->
## 必需证据

领域规则/边界，有效路径投票/拒绝/重试，成员读写隔离，ALL/ANY/SINGLE 组合，发布后定义/路径冻结，CAS 与带键竞争，JSON 1–13/紧邻备份/篡改拒绝，JDBC 投影/回滚，严格 HTTP/跨场景，设计器模型/DOM，以及真实后端低额/临界/高额报销、低/高付款、正常/异常收货、标准/非标合同浏览器路径、中英说明和 390px。应分开说明本地、浏览器、CI、远端发布和部署。

<!-- topic:local-verification-checkpoint-2026-10-09 -->
## 历史本地验证（2026-10-09）

- 领域 660，零失败/错误/跳过，含旧格式及 schema 13 保留定义篡改。
- 独立 Boot 4.1.1/JDK17 HTTP/安全 99，零失败/错误/跳过。
- H2 共用 117、真实 MySQL 8.0.46 共用 123，均零失败/错误/跳过。无服务器的汇总另执行 43 项适配器检查，其中 PostgreSQL117/MySQL123 正确跳过；该本地检查点无 PostgreSQL/MySQL8.4。
- 前端 52 文件/1,628 测试，CRM26、若依模型 51、生产构建通过。
- 实际前端工作区 HTTP 完成付款/收货/合同不同路径、精确事实、真实投票、币种拒绝且不 POST、旧快照不变和发布后丢响应重试；这不是渲染证据。
- 独立审查修复保留定义不一致和布尔强转；复现探针及新增 31 后端边界通过，40,049 项精确十进制/路由审查无未解阻断/高/中问题。低风险零指数解析差异也修复并新增七项前端边界。
- 核心 Maven、24 纯 JDK、33 打包/构建 Python 通过。
- 浏览器渲染未验：Chromium 因受限 socket 启动失败，支持的云浏览器无法访问隔离 localhost。三个真实后端 Playwright 路径及精确来源截图门槛已准备，未通过，无截图充作证据。
- 未重跑若依服务器、移动运行时、PostgreSQL、MySQL8.4、远端 CI；仅三个专用独立场景启用，不声称新增若依/H5 路由。

该检查点全部本地，未推送、合并、部署，不证明生产财务/库存/合同安全。源检查点与清单标明精确本地 tree 和后端包；强制重建后，将内嵌领域 JAR 与最终测试产物逐字节比较。
