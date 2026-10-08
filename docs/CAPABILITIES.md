# 审批能力与边界 / Approval capabilities and limits

[简体中文](#zh) · [English](#en) · [README](../README.md) · [运行示例 / Run the demo](GETTING_STARTED.md)

<a id="zh"></a>

## 简体中文

这份清单帮助你判断 ArcFlow 是否适合当前业务，以及接入时还需要补什么。范围按 `0.1.0-SNAPSHOT` 源码核对；首次核对基线为 [`25465f2`](https://github.com/JamesCube/ArcFlow/commit/25465f29388d3dd393f9b35d9fb1cb92122025fc)。表内链接指向实现、测试或专项契约。测试存在不等于任意版本已通过；验收应查看所用提交的 CI 结果。

**状态：** ✅ 已实现，限于所述范围；🟡 部分或示例级支持，接入仍有工作；— 当前未实现；◇ 路线图方向，同样尚未实现，没有发布日期或交付承诺。

### 先分清三个层次

| 层次 | 已有能力 | 使用边界 |
| --- | --- | --- |
| **Java DAG 内核** | 无第三方运行时依赖；校验图、按依赖顺序同步串行执行处理器；Handler / Event SPI | 不保存运行状态，不等待人工任务，不提供异步调度；重跑会重新执行节点，外部副作用不自动回滚。[实现][core] · [测试][core-tests] |
| **审批领域与存储** | 顺序人工审批、固定成员组、版本快照、权限、幂等、历史及可替换存储 | 在独立的 `examples/approval-domain` 和 `approval-jdbc` 模块中；有各自的框架／序列化／数据库依赖。“零依赖”仅指 DAG 内核。[领域][domain] · [存储][jdbc] |
| **宿主与界面示例** | Spring Boot + Vue、原生若依、H5、独立 CRM 报价页 | 演示如何接入身份、HTTP 和页面；各入口支持范围不同。默认持久化是单写者 JSON，当前没有完整生产服务的就绪保证。 |

页面能力附真实截图链接；并发、幂等、JDBC 事务等非视觉能力仍以源码、契约与测试为依据，截图不能证明这些保证。

### 人工审批与流程设计

| 能力 | 状态 | 精确范围与依据 |
| --- | --- | --- |
| 顺序多级审批 | ✅ | 固定开始 → 1–8 个审批步骤 → 固定结束。当前步骤完成后才进入下一步；同一人可出现在不同步骤，须逐步分别审批。[定义校验][definition] · [审批状态机][service]  · [截图 / Screen](DESIGNER_GALLERY.md#sequential) |
| 单人审批（SINGLE） | ✅ | 每步一个指定用户；同意后推进，拒绝则整笔申请结束。SINGLE 是界面的模式名称；存储使用 `approval` 节点，不是 `completionMode: "SINGLE"`。[定义][definition]  · [截图 / Screen](DESIGNER_GALLERY.md#sequential) |
| 会签（ALL） | ✅ | 每组 2–16 个不同的固定参与人；全员同意才推进，任一拒绝即结束。组内每个人各自投票，后续步骤仍按顺序执行。[规则][parallel] · [测试][parallel-tests]  · [截图 / Screen](DESIGNER_GALLERY.md#all) |
| 或签（ANY） | ✅ | 任一参与人同意即推进；部分拒绝后仍可由其他人同意，只有全员拒绝才结束。提前完成后未投票成员无需再处理，不会为其补造已办记录。[规则][parallel] · [测试][parallel-tests]  · [截图 / Screen](DESIGNER_GALLERY.md#any) |
| 可视化设计器 | ✅ | 独立 Vue 支持插入、删除、排序、名称／人员／ALL／ANY 配置、校验、发布与本地撤销／重做；若依提供原生流程编辑与真实用户选择。不是任意图形或 BPMN 编辑器。[设计器测试][designer-tests] · [若依编辑器][ruoyi-editor]  · [截图 / Screen](DESIGNER_GALLERY.md#reorder) |
| 流程定义校验 | ✅ | 服务端校验 schema、版本、固定边界、节点 ID 唯一性、名称、步骤数及组成员；发布／提交还检查账号可用性，申请人不能同时是该流程的审批人。内核 DAG 另行检查未知依赖、重复节点与环。[定义][definition] · [服务][service] · [DAG 校验][workflow]  · [截图 / Screen](DESIGNER_GALLERY.md#validation) |
| 版本与业务快照 | ✅ | 申请固定提交时的流程版本、参与人、规则和业务数据；后续发布不改动已有申请。发布使用期望版本检查；不提供运行中实例迁移或审批中修改单据。[服务][service] · [业务单据测试][business-tests]  · [截图 / Screen](DESIGNER_GALLERY.md#versions) |
| 待办／已办分页 | ✅ | 按服务端当前登录人查询，覆盖每位组成员；每页 1–100 条，游标绑定成员及筛选条件。已办指真实保存的投票，一笔申请可仍在审批中；跨页是实时查询，不是冻结的全局快照。[契约][inbox] · [测试][inbox-tests]  · [截图 / Screen](CASE_GALLERY.md#oa-inbox) |
| 审批意见与历史 | ✅ | 保存逐人决定、意见、步骤及时间；同一步骤的历史不可通过审批接口改写。意见随决定提交，不是独立评论／聊天；记录也不是密码学防篡改审计系统。[服务][service] · [存储契约][store]  · [截图 / Screen](CASE_GALLERY.md#oa-approved) |
| 身份与权限 | 🟡 | `ActorDirectory` 接口、活动账号检查、本人可见范围及当前步骤成员校验；若依复用其登录和菜单／按钮权限。人员组是固定 ID 列表，不会动态解析角色或部门，管理员通配权限也不能替别人投票。[身份测试][identity-tests] · [若依控制器][ruoyi-controller] |
| 提交幂等 | ✅ | 通用提交接口可选申请人作用域的键；同键同内容返回原申请当前状态，同键不同内容冲突，无键仍每次新建。JSON／JDBC 持久化键绑定；页面刷新或退出会丢失内存中的客户端重试键。CRM 专用入口由报价版本生成绑定键。[契约][idempotency] · [测试][idempotency-tests] · [报价宿主][quote-host] |
| 决定幂等与并发 | ✅ | 同一申请／步骤／参与人的相同决定重试返回已保存状态，不追加事件，也不改写原意见；相反决定冲突。修订号 CAS 与存储原子更新防止覆盖并发结果。保障限于审批状态，不涵盖付款、消息或业务回写的恰好一次执行。[重试测试][retry-tests] · [并发测试][race-tests] |

### 存储、恢复与数据库

| 选项 | 状态 | 支持范围与限制 |
| --- | --- | --- |
| 本地 JSON | 🟡 | 保存定义、申请、历史和幂等绑定，可在服务重启后重读；原子文件替换，要求一个写者。两个通用宿主默认使用它，不可共享文件运行多个实例；不保证断电恢复或任意文件系统的持久性。[实现][json-store] · [升级测试][json-tests] |
| JDBC 事务存储 | ✅ | 审批数据、审计、成员索引及提交键在相应事务中提交；条件更新、短事务行锁协调独立实例；写入失败会尝试回滚，提交或连接清理出错时须检查持久状态后再重试。宿主显式提供 DataSource 并接入 `JdbcApprovalStore`；不自动切换演示存储，不加入业务表事务或 Spring `@Transactional`。[实现][jdbc-store] · [事务契约][jdbc] |
| 数据库目标 | 🟡 | H2 契约测试，PostgreSQL 17.6、MySQL 8.0／8.4 真实服务器 CI 矩阵。已有通过记录；H2 通过不能代替服务器结果，具体提交仍须检查非跳过的报告。MySQL 适配为实验性，不覆盖 MariaDB、MySQL 5.7／9 或所有 8.x 配置。[CI 定义][jdbc-ci] · [已接受服务器结果][accepted-crm] |
| 数据升级 | 🟡 | JSON 在需要更高 schema 的写入时升级并保留备份；SQL 迁移与分批回填须显式执行。类型化请假／采购至少使用 JSON schema 5，首次报价写入升级到 schema 6；成员 SQL revision 3 是另一套版本号。先备份、停止旧写者并升级兼容读取端，不支持混合新旧写者或自动 JSON→SQL 导入。[业务契约][business] · [成员迁移][jdbc] |

### 哪个入口能直接用

| 入口 | 可运行的内容 | 尚不包含 |
| --- | --- | --- |
| **独立 Spring Boot + Vue** | 中英文工作台；设计、发布、请假／采购提交、审批、成员分页、快照与历史；固定演示身份。[组件测试][standalone-tests] | 生产账号体系；共享报价工作区；默认 JDBC 接线 |
| **原生 RuoYi-Vue + Vue3** | 复用真实若依用户、登录、菜单、权限；流程编辑、请假／采购表单、审批与成员分页。[后端][ruoyi-controller] · [真实宿主测试][ruoyi-tests] | 角色／部门动态选人；若依报价页；默认 SQL 审批存储。若依自身的 MySQL 用户库不等于审批已入库 |
| **H5 手机浏览器** | 中英文待办／已办、请假／采购详情、只读流程、意见与同意／拒绝。[客户端契约][mobile] · [状态模型][mobile-model] | 发起申请、设计流程、报价详情；原生 App／小程序；企业 SSO。飞书／企微／钉钉接口占位会明确拒绝未配置的调用。[适配器][mobile-adapters] |
| **CRM 报价折扣** | 独立 `/api/crm` 与 `/quote-discount.html`，合成数据、销售经理 → 财务两步；校验源报价版本、归属销售及业务读权。报价窄屏页面仅审批。[实现][quote-host] · [HTTP 测试][quote-tests] · [页面测试][quote-ui-tests] | 通用单据／待办入口与若依／H5 报价支持；真实 CRM／AI 连接；客户通知、业务回写、付款 |
| **领域库中的业务单据** | 类型化请假、采购、报价折扣；不可变快照与精确金额校验。可以给宿主实现提供基础。[类型与校验][business-model] · [测试][business-tests] | 任意业务插件、通用表单构建器；类型存在不代表所有客户端都已接入 |

### 未实现与路线图方向

| 能力 | 状态 | 当前结论 |
| --- | --- | --- |
| 条件路由、任意分支／汇聚 | ◇ | 路线图方向；现有人工审批只支持顺序步骤中的固定人员组。ALL／ANY 不代表通用并行网关 |
| 动态角色／部门选人、领取、撤回、退回指定节点、加签、转办 | ◇ | 通用模型的候选工作，当前没有可用的相应操作或生命周期契约 |
| 持久化异步 DAG、调度、自动重试、超时／取消 | ◇ | 内核演进方向；当前同步执行，不提供可恢复的后台任务系统 |
| 定时催办、逾期升级、消息推送、附件 | — | 未提供可运行的审批能力；有截止日期展示或适配器接口，也不等于有调度／通知／附件服务 |
| 租户隔离、outbox、业务表联合事务、自动业务回写 | — | 当前没有；流程 ID 隔离和成员权限不能替代多租户安全边界 |
| BPMN 导入／导出／兼容执行 | — | 当前不兼容，路线图也未承诺完整 BPMN 实现 |

依据：[路线图][roadmap]、[存储边界][jdbc]、[移动适配器][mobile-adapters]、[CRM 接入边界][accepted-crm]。规划条目不是当前功能，也没有承诺上线日期。

**接下来怎么试：** [一键本地运行](TRYOUT.md)，从请假走通发起 → 审批 → 查看记录，再试[采购](PROCUREMENT_UI.md)或[报价](CRM_QUOTE_CASE.md)。已有若依项目可以看[原生接入说明][ruoyi]。如果业务需要缺失的能力，欢迎[提交 issue](https://github.com/JamesCube/ArcFlow/issues)，写清审批人数、流转规则、存储／身份环境和失败时希望如何处理，请勿附真实个人数据或密码。

<a id="en"></a>

## English

Use this checklist to decide whether ArcFlow fits your application and what integration work remains. It describes the `0.1.0-SNAPSHOT` source, initially checked at [`25465f2`](https://github.com/JamesCube/ArcFlow/commit/25465f29388d3dd393f9b35d9fb1cb92122025fc). Links point to implementation, tests or focused contracts. Having a test does not establish that every revision passed it; check CI for the commit you use.

**Status:** ✅ Implemented within the stated scope; 🟡 partial or example-level support; — not implemented; ◇ a roadmap direction, still unimplemented, with no release date or delivery commitment.

### Three separate layers

| Layer | What exists | Boundary |
| --- | --- | --- |
| **Java DAG core** | No third-party runtime dependencies; graph validation, dependency-ordered synchronous serial handlers, Handler / Event SPI | No durable execution state, human waits or async scheduler. Rerunning executes nodes again; external side effects are not rolled back. [Implementation][core] · [Tests][core-tests] |
| **Approval domain and storage** | Human stages, fixed groups, version snapshots, authorization, retries, history and replaceable storage | Separate `examples/approval-domain` and `approval-jdbc` modules have their own framework/serialization/database dependencies. “Zero dependencies” applies only to the DAG core. [Domain][domain] · [Storage][jdbc] |
| **Hosts and UI examples** | Spring Boot + Vue, native RuoYi, H5 and a separate CRM quote page | Reference identity, HTTP and UI integrations with different scopes. Single-writer JSON is the default; no complete production-service readiness guarantee. |

Visible features link to real captures. Concurrency, idempotency and JDBC transaction guarantees remain grounded in code, contracts and tests; screenshots cannot establish them.

### Human approvals and process design

| Capability | Status | Exact scope and evidence |
| --- | --- | --- |
| Ordered stages | ✅ | Fixed start → 1–8 approval stages → fixed end. Only the current stage can act. A person may appear in multiple stages and must decide separately in each. [Validation][definition] · [State machine][service]  · [截图 / Screen](DESIGNER_GALLERY.md#sequential) |
| Single reviewer (SINGLE) | ✅ | One assigned user per stage; approval advances, rejection ends the request. SINGLE is a UI label: storage uses an `approval` node, not `completionMode: "SINGLE"`. [Definition][definition]  · [截图 / Screen](DESIGNER_GALLERY.md#sequential) |
| ALL groups | ✅ | 2–16 distinct fixed participants; every approval is required, and any rejection ends the request. Members vote individually; later stages remain sequential. [Rules][parallel] · [Tests][parallel-tests]  · [截图 / Screen](DESIGNER_GALLERY.md#all) |
| ANY groups | ✅ | The first approval advances. Some rejections can still be followed by an approval; only unanimous rejection ends the request. Early completion does not fabricate votes or handled entries for remaining members. [Rules][parallel] · [Tests][parallel-tests]  · [截图 / Screen](DESIGNER_GALLERY.md#any) |
| Visual designer | ✅ | Standalone Vue supports insert/delete/reorder, names, people, ALL/ANY rules, validation, publication and local undo/redo. RuoYi has a native process editor with real-user selection. No arbitrary graph or BPMN editor. [Designer tests][designer-tests] · [RuoYi editor][ruoyi-editor]  · [截图 / Screen](DESIGNER_GALLERY.md#reorder) |
| Definition validation | ✅ | Server checks schema/version, fixed boundaries, unique node IDs, names, stage/member limits. Publication/submission also check active accounts; the applicant cannot be a reviewer anywhere in the process. The DAG core separately rejects missing dependencies, duplicate nodes and cycles. [Definition][definition] · [Service][service] · [DAG validation][workflow]  · [截图 / Screen](DESIGNER_GALLERY.md#validation) |
| Versions and business snapshots | ✅ | Each request retains the submitted definition, participants, rules and business data. Later publication cannot reroute it. Publication uses an expected-version check; no running-instance migration or in-review document editing. [Service][service] · [Business tests][business-tests]  · [截图 / Screen](DESIGNER_GALLERY.md#versions) |
| Pending/handled pagination | ✅ | Server-authenticated actor scope, including every group member; 1–100 items per page, with actor/filter-bound cursors. Handled means an actual saved vote, even if the request is still pending. Pages are live queries, not a frozen cross-page snapshot. [Contract][inbox] · [Tests][inbox-tests]  · [截图 / Screen](CASE_GALLERY.md#oa-inbox) |
| Notes and history | ✅ | Per-person decision, note, stage and timestamp; decision endpoints cannot rewrite prior history. Notes accompany votes, rather than being standalone comments/chat. History is not a cryptographically tamper-proof audit system. [Service][service] · [Store contract][store]  · [截图 / Screen](CASE_GALLERY.md#oa-approved) |
| Identity and permissions | 🟡 | `ActorDirectory`, active-account checks, request visibility and current-stage membership. RuoYi reuses login and menu/button permissions. Groups contain fixed IDs, with no dynamic role/department resolution; administrator wildcard permissions do not allow voting for others. [Identity tests][identity-tests] · [RuoYi controller][ruoyi-controller] |
| Submission idempotency | ✅ | Generic endpoints accept an optional applicant-scoped key. Same key/content returns the original request's current state; changed content conflicts; unkeyed calls create new requests. JSON/JDBC persist bindings, but reload/logout loses the browser's in-memory retry key. CRM's dedicated host binds the key to a quote revision. [Contract][idempotency] · [Tests][idempotency-tests] · [Quote host][quote-host] |
| Decision retries and concurrency | ✅ | Repeating the same request/stage/member decision returns saved state without a new event or comment change; an opposite decision conflicts. Revision CAS and atomic store updates prevent lost updates. These guarantees cover approval state, not exactly-once payments, messages or business writeback. [Retry tests][retry-tests] · [Race tests][race-tests] |

### Persistence and databases

| Option | Status | Scope and limits |
| --- | --- | --- |
| Local JSON | 🟡 | Definitions, requests, history and retry bindings survive a service reopen; atomic file replacement with one writer. Both general hosts default to it. Do not share the file across instances; power-loss recovery and arbitrary filesystem durability are not guaranteed. [Implementation][json-store] · [Upgrade tests][json-tests] |
| Transactional JDBC | ✅ | Approval state, audit, member projections and submission keys commit in their corresponding transactions. Conditional updates and short row locks coordinate independent instances. Write failures trigger rollback; commit or connection-cleanup errors may require checking durable state before retrying. The host must supply a DataSource and wire `JdbcApprovalStore`. It neither switches demo storage automatically nor joins business-table/Spring `@Transactional` transactions. [Implementation][jdbc-store] · [Contract][jdbc] |
| Database targets | 🟡 | H2 contracts plus real PostgreSQL 17.6 and MySQL 8.0/8.4 CI matrices, with recorded passing checkpoints. Check non-skipped reports for the exact revision; H2 is not server verification. MySQL remains experimental and does not cover MariaDB, MySQL 5.7/9 or every 8.x configuration. [CI definition][jdbc-ci] · [Accepted server results][accepted-crm] |
| Upgrades | 🟡 | JSON upgrades on qualifying writes with preserved backups; SQL migration and bounded backfill require explicit operator steps. Typed leave/procurement need at least JSON schema 5; the first quote write upgrades to schema 6. Member SQL revision 3 is a separate version. Back up, stop old writers and upgrade readers first; no mixed-version writers or automatic JSON→SQL import. [Business contract][business] · [Member migration][jdbc] |

### Runnable entry points

| Entry point | What you can run | Not included |
| --- | --- | --- |
| **Standalone Spring Boot + Vue** | Chinese/English design, publication, leave/procurement submission, review, paginated worklists, snapshots and history with fixed demo identities. [Component tests][standalone-tests] | Production identity; a shared quote workspace; default JDBC wiring |
| **Native RuoYi-Vue + Vue3** | Real RuoYi users, login, menus and permissions; process editor, leave/procurement forms, review and member pages. [Backend][ruoyi-controller] · [Real-host tests][ruoyi-tests] | Dynamic role/department assignment; quote pages; default SQL approval persistence. RuoYi's own MySQL user database does not store approvals automatically |
| **H5 mobile browser** | Chinese/English pending/handled lists, leave/procurement details, read-only process, notes and approve/reject. [Client contract][mobile] · [State model][mobile-model] | Submission, process design or quote details; native apps/mini-programs; enterprise SSO. Feishu/WeCom/DingTalk placeholders explicitly reject unconfigured calls. [Adapters][mobile-adapters] |
| **CRM quote discounts** | Separate `/api/crm` and `/quote-discount.html`, synthetic data and fixed manager → finance steps; source revision, salesperson ownership and business read-access checks. Narrow-screen quote UI is review-only. [Host][quote-host] · [HTTP tests][quote-tests] · [Page tests][quote-ui-tests] | Shared document/inbox routes or RuoYi/H5 quote support; real CRM/AI connections; customer notifications, writeback or payments |
| **Domain business documents** | Typed leave, procurement and quote-discount snapshots, with exact-money validation, as a foundation for host integrations. [Types and validation][business-model] · [Tests][business-tests] | Arbitrary business plugins or a general form builder. A domain type does not mean every client supports it |

### Missing features and roadmap directions

| Capability | Status | Current position |
| --- | --- | --- |
| Conditional routing, arbitrary forks/joins | ◇ | A roadmap direction. Human approvals currently use fixed groups within sequential stages; ALL/ANY is not a general parallel gateway |
| Dynamic role/department assignment, task claiming, withdrawal, return-to-step, added reviewers, delegation | ◇ | Candidate work for the general model, with no current operations/lifecycle contract |
| Durable async DAG execution, scheduling, automatic retries, timeouts/cancellation | ◇ | Core evolution ideas; today's runner is synchronous, without a recoverable background-job system |
| Timed reminders, escalation, push notifications, attachments | — | No runnable approval capability. A displayed date or adapter interface does not provide a scheduler, notification service or attachment service |
| Tenant isolation, outbox, business-table transactions, automatic writeback | — | Not implemented. Process scoping and member permissions do not establish multi-tenant isolation |
| BPMN import/export/compatible execution | — | Unsupported; the roadmap does not commit to a full BPMN implementation |

Sources: [roadmap][roadmap], [storage boundaries][jdbc], [mobile adapters][mobile-adapters], [CRM boundaries][accepted-crm]. Roadmap entries are not shipped capabilities or promised release dates.

**Try it:** [run locally](TRYOUT.md), complete leave submission → review → history, then try [procurement](PROCUREMENT_UI.md) or [quotes](CRM_QUOTE_CASE.md). Existing RuoYi users can follow the [native integration guide][ruoyi]. If a missing feature matters, [open an issue](https://github.com/JamesCube/ArcFlow/issues) with reviewer counts, routing rules, storage/identity setup and expected failure handling. Do not include real personal data or credentials.

[core]: ../src/main/java/com/arcflow/ArcFlowEngine.java
[core-tests]: ../src/test/java/com/arcflow/EngineChecks.java
[workflow]: ../src/main/java/com/arcflow/Workflow.java
[domain]: ../examples/approval-domain/README.md
[definition]: ../examples/approval-domain/src/main/java/com/arcflow/approval/ProcessDefinition.java
[service]: ../examples/approval-domain/src/main/java/com/arcflow/approval/ApprovalService.java
[store]: ../examples/approval-domain/src/main/java/com/arcflow/approval/ApprovalStore.java
[parallel]: PARALLEL_APPROVAL.md
[parallel-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/ParallelApprovalTest.java
[designer-tests]: ../examples/approval-ui/src/ProcessDesigner.test.js
[ruoyi-editor]: ../examples/ruoyi-vue3/frontend/src/views/arcflow/approval/index.vue
[business]: BUSINESS_DOCUMENTS.md
[business-model]: ../examples/approval-domain/src/main/java/com/arcflow/approval/BusinessDocument.java
[business-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/BusinessDocumentTest.java
[inbox]: MEMBER_INBOX.md
[inbox-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/InboxQueryTest.java
[identity-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/ActorDirectoryTest.java
[idempotency]: SUBMISSION_IDEMPOTENCY.md
[idempotency-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/SubmissionIdempotencyTest.java
[retry-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/ApprovalRetryBoundaryTest.java
[race-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/ApprovalStoreRaceTest.java
[json-store]: ../examples/approval-domain/src/main/java/com/arcflow/approval/JsonApprovalStore.java
[json-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/JsonSchemaUpgradeTest.java
[jdbc]: ../examples/approval-jdbc/README.md
[jdbc-store]: ../examples/approval-jdbc/src/main/java/com/arcflow/approval/jdbc/JdbcApprovalStore.java
[jdbc-ci]: ../.github/workflows/approval-jdbc.yml
[accepted-crm]: CRM_COMPATIBILITY_READINESS.md#accepted-crm-checkpoint
[standalone-tests]: ../examples/approval-ui/src/App.procurement.test.js
[ruoyi]: ../examples/ruoyi-vue3/README.md
[ruoyi-controller]: ../examples/ruoyi-vue3/backend/src/main/java/com/ruoyi/arcflow/ArcFlowController.java
[ruoyi-tests]: ../examples/ruoyi-vue3/tests/smoke.py
[mobile]: ../examples/approval-mobile/README.md
[mobile-model]: ../examples/approval-mobile/src/domain/model.ts
[mobile-adapters]: ../examples/approval-mobile/src/platform/adapters.ts
[quote-host]: ../examples/approval-domain/src/main/java/com/arcflow/approval/QuoteDiscountCase.java
[quote-tests]: ../examples/approval-demo/backend/src/test/java/com/arcflow/demo/QuoteDiscountApiTest.java
[quote-ui-tests]: ../examples/approval-ui/tests/crm-quote/page.test.mjs
[roadmap]: ROADMAP.md
