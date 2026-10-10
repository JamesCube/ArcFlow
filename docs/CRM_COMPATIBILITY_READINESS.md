# CRM 兼容性与发布门槛

<!-- Legacy fragments remain entry points after the language split. -->
<a id="1-keep-the-host-authorization-boundary"></a>
<a id="2-extend-lexical-money-decoding-with-type-dispatch"></a>
<a id="3-distinguish-json-schema-from-sql-revision"></a>
<a id="4-preserve-global-key-and-process-isolation"></a>
<a id="5-scope-future-cursor-caches-by-process"></a>
<a id="critical-interfaces"></a>
<a id="crm-兼容性与发布门槛--crm-compatibility-and-release-gates"></a>
<a id="历史基线与范围--historical-baseline-and-scope"></a>
<a id="后续修改与发布门槛--gates-for-subsequent-changes"></a>
<a id="已接受提交--accepted-crm-checkpoint--2026-10-08"></a>
<a id="覆盖范围与证据边界--coverage-and-evidence-boundaries"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](CRM_COMPATIBILITY_READINESS.en.md) · [文档目录](README.md)

独立 CRM 通过 [PR #20](https://github.com/JamesCube/ArcFlow/pull/20) 合入。本文保留已接受检查点、范围和后续门槛；采购/待办基线、合并或构建通过都不能代替 CRM 验收，也不是部署/生产就绪。

<a id="accepted-crm-checkpoint"></a>

<!-- topic:accepted-crm-checkpoint-2026-10-08 -->
## 已接受提交（2026-10-08）

- 已测 head：[`878a5659220aaf546d9d7f77abfa31f42b054938`](https://github.com/JamesCube/ArcFlow/commit/878a5659220aaf546d9d7f77abfa31f42b054938)；合并 main：[`66ec531270a513f884125065f19fe4e78762992f`](https://github.com/JamesCube/ArcFlow/commit/66ec531270a513f884125065f19fe4e78762992f)。两者 tree `12b173536f69b093fd2c9d4ecdd51ceb8e7f5071`，但 PR 运行/数量/图包归测试 head，树相同不把 PR 运行变为合并后运行。
- 六项 PR 工作流通过：[Java](https://github.com/JamesCube/ArcFlow/actions/runs/37723133834)、[审批](https://github.com/JamesCube/ArcFlow/actions/runs/37723133831)、[JDBC](https://github.com/JamesCube/ArcFlow/actions/runs/37723133862)、[H5](https://github.com/JamesCube/ArcFlow/actions/runs/37723133830)、[启动器](https://github.com/JamesCube/ArcFlow/actions/runs/37723133848)、[若依](https://github.com/JamesCube/ArcFlow/actions/runs/37723133896)。
- 真实数据库：PostgreSQL 每 JDK17/21 **77**；MySQL 每版本 8.0/8.4×JDK17/21 **83**，合计 **486**，零跳过/错误/失败，18 次新增报价用例执行全通过。
- 审批运行产出八张中英桌面/390px CRM 图，全部独立检查并核 hash。artifact `11526836399`，包 SHA-256 `b19c735e9df2a924b8db5ef49d77fafd02f23e7f534d528b076f5ac38cd4f0c5`，GitHub 产物有保留期。
- 同 head 的[另一次 push 浏览器运行](https://github.com/JamesCube/ArcFlow/actions/runs/37723130422)在测试前遇 CDN 地域 HTTP403，未重试/绕过。成功 PR 运行是另份证据，不声称每条 push/PR 都成功。
- 合并提交六项也通过：[Java](https://github.com/JamesCube/ArcFlow/actions/runs/37723815007)、[审批](https://github.com/JamesCube/ArcFlow/actions/runs/37723815076)、[JDBC](https://github.com/JamesCube/ArcFlow/actions/runs/37723815753)、[H5](https://github.com/JamesCube/ArcFlow/actions/runs/37723814962)、[启动器](https://github.com/JamesCube/ArcFlow/actions/runs/37723815211)、[若依](https://github.com/JamesCube/ArcFlow/actions/runs/37723815056)。Java 在 Maven 解析失败后第 2 次通过，其他第 1 次通过。

范围是隔离报价页和 `/api/crm`。后续提交须重查受影响结果，不包括共享工作区、若依/H5 报价、外部 CRM/AI、通知或回写。

<!-- topic:historical-baseline-and-scope -->
## 历史基线与范围

- 基线 main `caece22fb52e645f303c6adec73f19a027d38e66`，tree `1d3332659bc59f3c70f2ffb5954aed6aa383f522`，与最终 PR19 head `b6faef486db71d4bdda28a8c7f8b8d9038c14e58` 相同，含两处桌面选择器修复。
- 早期本地 CRM 预检 `2bccc99b0aa885bcf657cd69683365db5bae0e0d`，tree `ffd6baf376283716a26d3baf1b20627585143020` 只是比较点，不替代基线或最终候选检查。
- 范围是 `/api/crm` 与中英 `/quote-discount.html` 合成页，不含共享独立/若依/H5、真实 CRM、AI、付款、通知、回写。
- 浏览器/真实 PostgreSQL/MySQL 定义已纳入，上方为实际结果；新提交要自己的报告和图包。

<!-- topic:critical-interfaces -->
## 关键接口

### 1. 保持宿主授权边界

通用 `ApprovalService.inbox` 只查活动身份和快照成员，不查 CRM 当前业务读权；`QuoteDiscountCase` 检查源访问和归属。因此服务仅用于 `/api/crm`，不接入 `/api/requests/inbox`，两个通用提交端点均拒绝 quoteDiscount。组合真实 HTTP 在重启前后校验隔离。

未来共享工作区必须在释放载荷前检查 CRM 权限，不能把通用 inbox 指向报价库，或返回浏览器后才过滤。业务感知分页和源权限变化需单独设计/验收。

### 2. 按类型扩展金额词法解码

独立/若依 `business-document.js` 只显式允许 leave/procurement；`parseApprovalJson` 仅把 unitPrice 当精确金额，listUnitPrice/requestedUnitPrice 按整数 token 处理，会拒绝小数/科学计数法。H5 联合类型和 parser 也仅两类，days=0 目前只接受采购；共享报价渲染必须一起扩展。

相关文件：
- `examples/approval-ui/src/business-document.js`、`App.vue`、`locale.js`
- `examples/ruoyi-vue3/frontend/src/views/arcflow/approval/business-document.js`、`index.vue`、`locale.js`
- `examples/approval-mobile/src/domain/types.ts`、`business.ts`、`model.ts`、`workspace.ts`、`components/Workspace.vue`、`copy.ts`

验收要涵盖小数/科学记数 token、两个价格、JPY、最大总额、严格未知/缺字段、真实日期、报价版本边界、保存文本规范化、非请假 days=0，以及不可变客户/引用/版本/有效期显示。只读报价不能静默开放通用报价提交或 H5 新建。独立 CRM 有自身已验证模型/后端 view，此限制不破坏隔离案例，但不能声称三端共享支持。

### 3. 区分 JSON 与 SQL 版本

成员基线 SQL revision 3，CRM 不改变它，新增文件最低 schema 6。读取端须先认识报价，才能写入或回填；既有 revision3 回填停全部写者。JSON5→6 保存紧邻升级前原字节，覆盖同会话修改/原子失败情况。

### 4. 保持全局键与流程隔离

JDBC 键跨流程按申请人隔离；宿主确定性版本键将不可变报价版本绑定单申请，不是通用 businessId 唯一约束。报价/请假/采购仍按流程 list/inbox/decide，同时协调全局键冲突。

组合测试覆盖独立实例抢同键、唯一申请/映射、两名固定成员投影、真实票改变待办/已办、未来成员不提前待办及混合流程可恢复回填。

### 5. 未来游标缓存按流程隔离

当前游标绑定 actor、bucket、status、processVersion，但不含 processId，适合一端点一服务。未来多流程选择器不得因其他筛选相同就复用别流程游标；宣称统一分页前，应增加版本化流程绑定游标或明确端点/缓存隔离。

<!-- topic:coverage-and-evidence-boundaries -->
## 覆盖与证据边界

`QuoteDiscountInboxCompatibilityTest` 六项 JSON/领域检查：
1. 固定步骤待办/已办与重启保留快照。
2. 5→6 保留混合请假/采购/报价，键冲突不重复 inbox。
3. 原子失败不暴露报价绑定/待办，重试保留备份。
4. 分页精确保留总额并拒绝他人/bucket 游标。
5. 并发重试仅一个待办。
6. 拒绝不虚构未来财务的已办投票。

`QuoteDiscountMemberProjectionTest` 五项 JDBC/H2：
1. 三流程 inbox 隔离且全局键冲突。
2. revision3 每批一行回填恢复三流程和实际票状态。
3. 独立实例收敛一申请、一键、两成员行。
4. 损坏投影不能生成报价操作，通过他流程选中也拒绝。
5. 非法持久金额在返回 inbox 前拒绝。

`examples/crm-quote/http_smoke.py --inbox` 使用真实 `/api/requests/inbox`，分别在 Bob 待办、Bob 已办/Carol 待办、终审和重启后检查隔离，不模拟浏览器。审批 CI 将烟测接入两个 Java 作业，模型/DOM 接入前端；定义本身不是远端结果，需真实精确 head 证据。

旧领域/宿主、JSON/H2、DOM、HTTP 只对应原提交。H2 不是真实服务器，DOM 不是浏览器，采购/待办基线不覆盖 CRM。上方验收已单查实际浏览器/服务器/CI，不能转用到新提交；每个候选要实际报告、无跳过契约和图包。

<!-- topic:gates-for-subsequent-changes -->
## 后续修改与发布门槛

1. CRM 维护者从当前 main 开始，检查增量，重跑受影响领域/MVC/JDBC/客户端构建与 HTTP，保留历史而不复用旧测试结论。
2. 独立审查增量/冲突解决，覆盖授权、不可变源绑定、存储、精度和通用端点防护。
3. 新发布执行真实数据库和中英桌面/390px、跨角色、刷新、退出、恢复，保存精确报告/截图；可选或跳过不算通过。
4. 发布者准备新 draft PR、核验 exact-head CI，报告未跑/失败。PR20 已合并不证明部署或生产，也不授权后续发布。
5. 未来共享接入须一起扩展业务授权/分页、全部类型/金额/投影分派和组件/浏览器覆盖，H5 保持只审；此前继续明确隔离页范围。
