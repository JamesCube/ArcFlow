# Approval capabilities and scenario catalog

<!-- Legacy fragments remain entry points after the language split. -->
<a id="zh-design"></a>
<a id="zh-forms"></a>
<a id="zh-integration"></a>
<a id="zh-next"></a>
<a id="zh-people"></a>
<a id="zh-reliability"></a>
<a id="zh-rules"></a>
<a id="zh-scenarios"></a>
<a id="zh-tasks"></a>
<a id="业务模板进度已合并统一集成与后续候选"></a>
<a id="业务表单与场景"></a>
<a id="人员身份与权限"></a>
<a id="任务处理与记录"></a>
<a id="候选业务模板逐项标明尚未实现"></a>
<a id="先分清三个层次"></a>
<a id="可靠性存储与恢复"></a>
<a id="审批能力与场景目录--approval-capabilities-and-scenario-catalog"></a>
<a id="审批规则与表决"></a>
<a id="已有场景与逐步截图"></a>
<a id="建议建设顺序场景库可视化表单与配置"></a>
<a id="流程设计与版本"></a>
<a id="集成客户端与内核"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](CAPABILITIES.md) · [Documentation](README.en.md)

This checklist separates runnable features, bounded integrations and missing capabilities, retaining all original 91 entries. Current scope is checked against main [`666ff64b`](https://github.com/JamesCube/ArcFlow/commit/666ff64b280157e44a86f07a15fcb42f859ec11a), version `0.1.0-SNAPSHOT`: nine business types, six standalone catalog scenarios, and restricted payment/receiving/contract routing are merged in source. Merge is not deployment or production readiness. Code/test links locate evidence; check CI, real-browser and database results for the exact revision you use.

✅ Implemented within the stated scope; 🟡 bounded support with integration, client or verification limits; — not implemented. The proposed sequence below does not change these statuses or promise release dates.

<!-- topic:three-separate-layers -->
## Three separate layers

| Layer | Responsibility | Boundary |
| --- | --- | --- |
| Java DAG core | Graph validation, synchronous handlers, variables and events | No third-party runtime dependencies; no durable execution state, human waits or async scheduling |
| Approval domain and storage | Ordered human stages, fixed groups, permissions, snapshots, history and persistence | Separate examples modules with their own Spring/Jackson/database dependencies |
| Hosts and UI | Standalone Vue, native RuoYi, H5, isolated CRM page and six-scenario workspace | Different entry-point scopes; single-writer JSON by default, with no complete production-service readiness guarantee |

The flow designer configures approval stages. A business-form designer is still missing: all nine document types are defined in code. The six scenarios render compiled, versioned ScenarioCatalog metadata, without arbitrary-field drag/drop or form-schema publishing. Visible capabilities link real captures; concurrency, authorization, idempotency and transactions require code/test evidence rather than screenshots.


[Flow design and versions](#en-design) · [Approval rules and voting](#en-rules) · [People, identity and permissions](#en-people) · [Task handling and history](#en-tasks) · [Business forms and scenarios](#en-forms) · [Reliability, storage and recovery](#en-reliability) · [Integration, clients and core](#en-integration) · [Scenarios and next steps](#en-scenarios)

<a id="en-design"></a>

<!-- topic:flow-design-and-versions -->
## Flow design and versions

| Capability | Status | Scope and limits | Evidence |
| --- | --- | --- | --- |
| Ordered stages | ✅ | Fixed start, 1–8 approval stages and fixed end; only the current stage can act. | [定义 / Definition][definition] · [Screen](DESIGNER_GALLERY.en.md#sequential) |
| Insert a stage | ✅ | Insert at a chosen connector in the standalone designer; no arbitrary edges. | [测试 / Tests][designer-tests] · [Screen](DESIGNER_GALLERY.en.md#all) |
| Remove a stage | ✅ | Remove a stage while retaining at least one; existing requests keep their saved definition. | [测试 / Tests][designer-tests] |
| Reorder stages | ✅ | Move-up/down controls preserve node IDs; this is not a freeform drag canvas. | [测试 / Tests][designer-tests] · [Screen](DESIGNER_GALLERY.en.md#reorder) |
| Stage inspector | ✅ | Edit the selected stage name, people and SINGLE/ALL/ANY mode; process/node names are limited to 120 characters. | [定义 / Definition][definition] · [Screen](DESIGNER_GALLERY.en.md#any) |
| Draft undo/redo | 🟡 | Standalone tab-local history; publication/sign-out clears it. No durable draft or collaborative editing. | [测试 / Tests][designer-tests] · [Screen](DESIGNER_GALLERY.en.md#undo) |
| Definition validation | ✅ | Validate schema, boundaries, unique IDs, names and stage/member counts; UI errors locate fields, and the server validates again. | [定义 / Definition][definition] · [测试 / Tests][designer-tests] · [Screen](DESIGNER_GALLERY.en.md#validation) |
| Publication conflicts | ✅ | Publication requires permission and an expected version; a conflicting publication cannot silently overwrite the current version. | [服务 / Service][service] · [Screen](DESIGNER_GALLERY.en.md#publish) |
| Pinned process version | ✅ | Submission freezes order, people and rules. Later publications apply to new requests; running instances are not migrated. | [服务 / Service][service] · [Screen](DESIGNER_GALLERY.en.md#versions) |
| Restricted conditional routing | 🟡 | Current main includes typed payment/receipt/contract conditions selecting extra human stages, using definition schema 4 and JSON wrapper 13 with frozen routes. Only three standalone scenarios support them; no arbitrary expressions. Check browser/database CI for the exact commit. | [合同 / Contract](CONDITIONAL_ROUTING.en.md) |
| Arbitrary forks/joins | — | Human stages remain sequential; ALL/ANY reviewer groups are not general parallel gateways. | [定义 / Definition][definition] |
| Running-instance migration | — | No operation migrates an existing request to a new process version. | [服务 / Service][service] |
| BPMN import/export/execution | — | No BPMN-compatible implementation or commitment to the full specification. | [路线图 / Roadmap][roadmap] |

<a id="en-rules"></a>

<!-- topic:approval-rules-and-voting -->
## Approval rules and voting

| Capability | Status | Scope and limits | Evidence |
| --- | --- | --- | --- |
| Single reviewer | ✅ | One assigned user; approval advances, rejection ends the request. SINGLE is a UI label for an approval node. | [定义 / Definition][definition] · [Screen](DESIGNER_GALLERY.en.md#sequential) |
| ALL groups | ✅ | 2–16 distinct fixed members; every approval is required, and any rejection ends the request. | [规则 / Rules][parallel] · [测试 / Tests][parallel-tests] · [Screen](DESIGNER_GALLERY.en.md#votes) |
| ANY groups | ✅ | One approval advances; partial rejection leaves others able to approve, and only unanimous rejection ends the request. | [测试 / Tests][parallel-tests] · [Screen](CASE_GALLERY.en.md#other-clients) |
| Mixed single/group stages | ✅ | Mix single, ALL and ANY stages in one sequence; unfinished group voting does not activate later stages. | [测试 / Tests][parallel-tests] · [Screen](DESIGNER_GALLERY.en.md#all) |
| Same reviewer in later stages | ✅ | The same person may appear in different stages and must vote in each; earlier votes do not auto-complete later stages. | [重试测试 / Retry tests][retry-tests] · [Screen](DESIGNER_GALLERY.en.md#votes) |
| Unvoted members after closure | ✅ | After early ANY approval or ALL rejection, that group no longer awaits unvoted members, without fabricated votes/handled entries. A later stage may still require them. | [收件箱测试 / Inbox tests][inbox-tests] · [Screen](DESIGNER_GALLERY.en.md#votes) |
| Majority/percentage voting | — | No N-of-M, percentage threshold or weighted voting rule. | [定义 / Definition][definition] |
| Automatic decisions | — | No automatic decision for missing reviewers, thresholds or elapsed time; reviewers must act explicitly. | [服务 / Service][service] |
| Add/remove active reviewers | — | Submitted membership is immutable; no commands add pre/post reviewers or remove active members. | [服务 / Service][service] |

<a id="en-people"></a>

<!-- topic:people-identity-and-permissions -->
## People, identity and permissions

| Capability | Status | Scope and limits | Evidence |
| --- | --- | --- | --- |
| Host identity directory | 🟡 | ActorDirectory resolves active accounts and publication/assignment eligibility; the host owns account management. | [接口 / Interface][identity] · [测试 / Tests][identity-tests] |
| Standalone demo picker | 🟡 | The default applicant is Alice; the designer offers Bob and Carol. The domain group limit does not supply 16 demo accounts. | [后端 / Backend][backend] · [Screen](DESIGNER_GALLERY.en.md#all) |
| Native RuoYi users | ✅ | The native editor selects fixed users from RuoYi and reuses its login, menus and button permissions. | [控制器 / Controller][ruoyi-controller] · [Screen](CASE_GALLERY.en.md#other-clients) |
| Request visibility | ✅ | Applicants and effective-path participants can see a request; skipped-only assignments grant no access. Pending membership is narrower. Administrator wildcard permissions never permit proxy voting. | [服务 / Service][service] · [权限测试 / Tests][identity-tests] |
| Applicant cannot review own request | ✅ | New submission rejects the applicant appearing anywhere in the approval sequence, not only in the current stage. | [服务 / Service][service] · [测试 / Tests][identity-tests] |
| Active-identity rechecks | ✅ | Domain list/inbox reads recheck active identity after storage I/O; historical actor IDs remain in records. | [读取边界测试 / Read tests][read-identity-tests] |
| Quote access and ownership | ✅ | The dedicated host checks source revision access and sales ownership; approval membership does not bypass business access. | [宿主 / Host][quote-host] · [测试 / Tests][quote-domain-tests] |
| Dynamic role resolution | — | No runtime candidate rule resolves a stored role name. | [人员接口 / Directory][identity] · [定义 / Definition][definition] |
| Department/manager resolution | — | No automatic organization-tree, direct-manager or management-chain resolution. | [人员接口 / Directory][identity] |
| Delegation/substitution | — | No reassignment or absence-substitute operation; voting as another identity is unsupported. | [服务 / Service][service] |
| Tenant isolation | — | Process scoping and participant authorization do not establish a tenant boundary. | [存储契约 / Storage][jdbc] · [H5 边界 / H5 scope][mobile] |

<a id="en-tasks"></a>

<!-- topic:task-handling-and-history -->
## Task handling and history

| Capability | Status | Scope and limits | Evidence |
| --- | --- | --- | --- |
| Submit a request | ✅ | Standalone/RuoYi desktop forms submit leave and procurement; quotes use a separate page and six scenarios use /scenarios.html; H5 has no authoring. | [采购表单 / Forms](PROCUREMENT_UI.en.md) · [Screen](CASE_GALLERY.en.md#oa-submitted) |
| Pending worklist | ✅ | Pending means an unvoted member of the current stage, including every ALL/ANY member; future stages are not pending yet. | [契约 / Contract][inbox] · [Screen](CASE_GALLERY.en.md#oa-inbox) |
| Handled worklist | ✅ | Requires an actual saved APPROVE/REJECT by that actor. Submission does not count; the request may still be pending. | [测试 / Tests][inbox-tests] · [Screen](CASE_GALLERY.en.md#oa-pending-next) |
| Cursor paging and filters | ✅ | 1–100 rows per page, default 25; filter by status/process version. Cursors bind actor and filters; pages are not a frozen global snapshot. | [契约 / Contract][inbox] · [测试 / Tests][inbox-tests] |
| Approve/reject | ✅ | The server validates the current stage, actor and decision; terminal requests cannot be advanced again. | [服务 / Service][service] · [Screen](CASE_GALLERY.en.md#erp-review) |
| Decision notes | ✅ | Notes are saved with a vote. Retrying the same decision cannot rewrite the original note; no standalone chat endpoint. | [重试测试 / Tests][retry-tests] · [Screen](CASE_GALLERY.en.md#oa-approved) |
| Per-person history | ✅ | Retain actor, action, stage, time and note. Approval APIs cannot rewrite saved events; this is not cryptographically tamper-proof auditing. | [存储契约 / Store][store] · [Screen](CASE_GALLERY.en.md#erp-approved) |
| Claim a task | — | Fixed members vote directly; there is no claim/release lifecycle for a shared candidate pool. | [服务 / Service][service] · [路线图 / Roadmap][roadmap] |
| Withdraw a request | — | Applicants cannot withdraw a submitted request. | [服务 / Service][service] |
| Return to a previous stage | — | Rejection ends a request; no target-stage return or downstream reopening rule. | [服务 / Service][service] |
| Revise and resubmit | — | No edit-and-resubmit lifecycle on the same request with revision/return history. | [业务契约 / Contract][business] |
| CC/informational recipients | — | No CC node, informational inbox or read receipts. | [定义 / Definition][definition] |
| Batch decisions | — | Commands address one request, stage and actor; no batch-decision contract. | [服务 / Service][service] |
| Scheduled reminders | — | No reminder scheduler or timed message service. | [路线图 / Roadmap][roadmap] · [适配器 / Adapters][mobile-adapters] |
| Overdue escalation | — | No automatic reassignment, escalation or closure on expiry; quote expiry hints do not change approval state. | [报价宿主 / Host][quote-host] |

<a id="en-forms"></a>

<!-- topic:business-forms-and-scenarios -->
## Business forms and scenarios

| Capability | Status | Scope and limits | Evidence |
| --- | --- | --- | --- |
| OA leave form | ✅ | Title, reason and 1–365 whole days; no date range, half-day, leave balance or holiday calendar. | [字段校验 / Validation][business-model] · [Screen](CASE_GALLERY.en.md#oa-form) |
| ERP procurement form | ✅ | One item, quantity 1–100000, unit price and currency; no multi-line purchase order or actual ordering. | [表单契约 / Forms](PROCUREMENT_UI.en.md) · [Screen](CASE_GALLERY.en.md#erp-form) |
| CRM quote-discount form | 🟡 | Synthetic single-line quotes with fixed manager → finance review on /api/crm and /quote-discount.html, isolated from shared workspaces. | [案例 / Case](CRM_QUOTE_CASE.en.md) · [Screen](CASE_GALLERY.en.md#crm-form) |
| Exact money and currencies | ✅ | Exact decimal validation/totals for CNY/USD/EUR/GBP/JPY; unit price must be >0 and ≤1,000,000,000.00, with up to two decimals and whole JPY. No currency conversion. | [模型 / Model][business-model] · [前端测试 / UI tests][frontend-money-tests] · [Screen](CASE_GALLERY.en.md#erp-review) |
| Immutable business snapshot | ✅ | Freeze typed fields at submission; they cannot change during review and are validated again on recovery. | [测试 / Tests][business-tests] · [Screen](CASE_GALLERY.en.md#erp-submitted) |
| Source quote revision and hints | ✅ | Validate source fields, revision and validity; discount percentages, the 10% hint and expiry hints do not route requests. | [模型测试 / Tests][quote-model-tests] · [宿主 / Host][quote-host] · [Screen](CASE_GALLERY.en.md#crm-manager-review) |
| Visual form designer | — | Current forms are defined in code; no drag-and-drop fields, field inspector or form-schema publishing UI. | [业务契约 / Contract][business] · [表单源码 / UI](../examples/approval-ui/src/App.vue) |
| Field dependencies/stage permissions | — | No configurable visibility, cross-field formulas or stage-specific field editing; submitted fields remain read-only. | [业务契约 / Contract][business] |
| Scenario template library | 🟡 | Current main has six compiled ScenarioCatalog entries at /scenarios.html: Expense, Travel, Seal-use, Receiving, Payment and Contract, with isolated processes/stores. Leave/procurement and quotes have other entry points. No runtime installation, cloning or arbitrary-form publishing. | [业务契约 / Contract][business] · [目录源码 / Catalog][scenario-catalog] · [报销契约 / Expense][expense] |
| Attachments | — | No upload, authorized download, malware scanning or attachment-retention service. | [字段定义 / Fields][business-model] · [H5 范围 / H5 scope][mobile] |
| Repeating line items | 🟡 | Expense, Receiving, Payment and Contract support 1–20 typed lines with their own validation; money is exact and receipt quantities are grouped by unit. Procurement/quotes remain single-item; no generic line-item designer. | [字段定义 / Fields][business-model] · [报销测试 / Tests][expense-tests] · [Screen][expense-gallery] |
| Business writeback | — | Approval records a workflow state; it does not create orders, update a real CRM, ship, invoice or pay. | [采购边界 / Procurement](PROCUREMENT_UI.en.md) · [报价边界 / Quotes](CRM_QUOTE_CASE.en.md) |

<a id="en-reliability"></a>

<!-- topic:reliability-storage-and-recovery -->
## Reliability, storage and recovery

| Capability | Status | Scope and limits | Evidence |
| --- | --- | --- | --- |
| Submission idempotency | ✅ | Generic endpoints accept optional applicant-scoped keys; no key creates anew. All six scenarios require exactly one Idempotency-Key: original intent replays durable current state, while changed fields, lines or original process version conflict. | [契约 / Contract][idempotency] · [测试 / Tests][idempotency-tests] · [报销契约 / Expense][expense] |
| Browser retry keys | 🟡 | Unresolved leave/procurement and six-scenario keys live in page memory and are lost on reload/sign-out. Durable server bindings replay after restart; business ID alone does not deduplicate. | [提交契约 / Contract][idempotency] · [表单边界 / Forms](PROCUREMENT_UI.en.md) |
| Quote-revision binding | ✅ | The dedicated CRM host derives a durable key from the immutable quote revision and rejects a custom Idempotency-Key. | [宿主 / Host][quote-host] · [HTTP 测试 / Tests][quote-tests] |
| Decision idempotency | ✅ | Same request/stage/member decision retries do not add events or rewrite notes; the opposite decision conflicts. | [测试 / Tests][retry-tests] |
| Concurrent state updates | ✅ | Revision CAS and atomic store updates protect approval state; they do not guarantee exactly-once external payments or messages. | [竞争测试 / Race tests][race-tests] · [JDBC 测试 / Tests][jdbc-tests] |
| Local JSON recovery | 🟡 | Reopen definitions, requests, history and keys from an atomically replaced file; single writer only, without power-loss/filesystem durability guarantees. | [实现 / Store][json-store] · [测试 / Tests][json-tests] |
| Transactional JDBC storage | ✅ | Corresponding transactions commit approval/audit/member/key data; the host must explicitly provide a DataSource and wire the adapter. | [契约 / Contract][jdbc] · [实现 / Store][jdbc-store] |
| Rollback and uncertain commits | 🟡 | Write failures attempt rollback; after commit/cleanup errors, inspect durable state rather than assuming nothing committed. | [事务契约 / Contract][jdbc] · [测试 / Tests][jdbc-tests] |
| H2 contracts | ✅ | H2 storage contracts support local verification; they do not establish PostgreSQL/MySQL server compatibility. | [测试 / Tests][h2-tests] |
| PostgreSQL verification scope | 🟡 | Real PostgreSQL 17.6 CI; inspect non-skipped results for your commit, without generalizing to every version/configuration. | [CI][jdbc-ci] · [测试 / Tests][postgres-tests] |
| MySQL verification scope | 🟡 | Experimental real-server MySQL 8.0/8.4 matrix; excludes MariaDB, 5.7, 9 and blanket coverage of 8.x configurations. | [CI][jdbc-ci] · [测试 / Tests][mysql-tests] |
| JSON schema upgrades | 🟡 | Strict readers support wrappers 1–13: leave/procurement ≥5, quotes 6, Expense 7, Travel 8, Seal 9, Receiving 10, Payment 11, Contract 12; definition schema 4 needs 13. Reads do not upgrade; writes never downgrade. Stop incompatible readers/writers and back up first; old backup restore loses later writes. Unchanged SQL revision 3 does not imply old-reader compatibility. | [契约 / Contract][business] · [测试 / Tests][json-tests] · [报销契约 / Expense][expense] |
| SQL migration and backfill | 🟡 | Member indexes retain SQL revision 3. New types/conditions alone add no DDL and do not rebuild ready old indexes. Existing databases still need explicit migration/bounded backfill; no automatic JSON→SQL import or mixed-version writers. | [迁移契约 / Migration][jdbc] |
| Transactions with business tables | — | JdbcApprovalStore does not automatically join host business-table or Spring @Transactional transactions. | [事务契约 / Contract][jdbc] |
| Transactional outbox | — | No transactional message table, delivery acknowledgement or message replay service. | [存储边界 / Storage][jdbc] |
| Durable asynchronous execution | — | The Java DAG core runs synchronously/serially with no resumable execution state or human wait points. | [内核 / Core][core] |
| Automatic background retries | — | Idempotent command replay is not a scheduler; no failed-node backoff or automatic background retry policy. | [内核 / Core][core] · [路线图 / Roadmap][roadmap] |
| Execution timeouts/cancellation | — | No durable deadline timer or run-cancellation API; handler interruption is not a complete cancellation lifecycle. | [内核 / Core][core] · [路线图 / Roadmap][roadmap] |

<a id="en-integration"></a>

<!-- topic:integration-clients-and-core -->
## Integration, clients and core

| Capability | Status | Scope and limits | Evidence |
| --- | --- | --- | --- |
| Standalone Spring Boot + Vue | 🟡 | Bilingual design/forms/review workspace, plus isolated quote and six-scenario entries/files; fixed demo accounts and single-writer JSON, not a production identity system. | [后端 / Backend][backend] · [界面测试 / Tests][standalone-tests] |
| Native RuoYi-Vue + Vue3 | 🟡 | Reference integration with the official hosts; RuoYi’s MySQL identity database does not automatically put approvals in SQL. | [接入 / Setup][ruoyi] · [宿主测试 / Tests][ruoyi-tests] |
| H5 browser client | 🟡 | Bilingual pending/handled lists, read-only leave/procurement details and decisions; no authoring, designer, quote or Expense support. Expense narrow-browser captures do not establish H5 client integration. | [客户端 / Client][mobile] · [Screen](CASE_GALLERY.en.md#other-clients) |
| Java/HTTP interfaces | ✅ | Main registers nine types. Generic HTTP accepts only leave/procurement; /api/crm is the authorized quote host, and six exact-type hosts use /api/scenarios. Only payment/receiving/contract scenarios expose conditions. | [业务契约 / Contract][business] · [HTTP 测试 / Tests][http-tests] |
| Storage SPI | ✅ | ApprovalStore is replaceable; custom adapters must meet its contract, and unsupported inbox access fails explicitly. | [接口 / SPI][store] · [收件箱契约 / Inbox][inbox] |
| DAG dependency validation | ✅ | Java 17 target with no third-party core runtime dependencies; rejects duplicate nodes, unknown dependencies and cycles. | [实现 / Implementation][workflow] · [测试 / Tests][core-tests] |
| Synchronous DAG execution | ✅ | Run handlers one at a time in dependency order with variable snapshots; reruns repeat nodes and do not roll back external effects. | [实现 / Implementation][core] · [测试 / Tests][core-tests] |
| Handler/Event SPI | ✅ | Hosts supply node handlers and event listeners; listeners are not a durable event bus, and supplied SPIs own their thread safety. | [Handler][core-handlers] · [Event][core-events] · [内核 / Core][core] |
| Spring Boot Starter | — | A runnable Spring Boot example exists, but no standalone auto-configuration Starter. | [路线图 / Roadmap][roadmap] |
| Enterprise platform identity | — | Adapters are unconfigured placeholders that reject use; no completed OAuth exchange, platform SDK integration or enterprise SSO. | [适配器 / Adapters][mobile-adapters] |
| External notifications | — | No email, webhook or Feishu/WeCom/DingTalk delivery service. | [适配器 / Adapters][mobile-adapters] · [路线图 / Roadmap][roadmap] |
| Native apps/mini-programs | — | Verification targets H5 browsers; no delivered Android/iOS/mini-program builds or physical-device testing. | [移动端边界 / Mobile scope][mobile] |
| Real CRM/ERP/AI connections | — | Synthetic examples do not connect real business systems or model services; no automated business decisions. | [报价案例 / Quote case](CRM_QUOTE_CASE.en.md) |

<a id="en-scenarios"></a>

<!-- topic:existing-cases-and-step-by-step-screens -->
## Existing cases and step-by-step screens

Current main registers nine types: leave, procurement, quotes, expenses, travel, seal use, receiving, payments and contracts. The galleries and historical counts below measure captured evidence, separately from implemented types. The original leave, procurement and quote galleries, including their designer, group, RuoYi and H5 coverage, contain 33 distinct scenes and 61 original Chinese/English captures. These are not 33 business templates; language variants are not new scenes. This historical count excludes the merged Expense gallery, separately counted as 8 state/viewport combinations and 16 Chinese/English originals.

| Case | Configuration and form | Submit / pending / next stage | Approved / rejected | Boundary |
| --- | --- | --- | --- | --- |
| OA leave | [Flow designer](DESIGNER_GALLERY.en.md#sequential) · [Form](CASE_GALLERY.en.md#oa-form) | [Submitted](CASE_GALLERY.en.md#oa-submitted) · [Pending](CASE_GALLERY.en.md#oa-inbox) · [Next](CASE_GALLERY.en.md#oa-pending-next) | [Approved](CASE_GALLERY.en.md#oa-approved) · [Rejected](CASE_GALLERY.en.md#oa-rejected) | Standalone/RuoYi authoring; H5 review only |
| ERP procurement | [Group configuration](DESIGNER_GALLERY.en.md#all) · [Form](CASE_GALLERY.en.md#erp-form) | [Submitted](CASE_GALLERY.en.md#erp-submitted) · [Manager](CASE_GALLERY.en.md#erp-review) · [Final](CASE_GALLERY.en.md#erp-final-review) | [Approved](CASE_GALLERY.en.md#erp-approved) · [Rejected](CASE_GALLERY.en.md#erp-rejected) | One item and host-configured flow; no ordering or payment |
| CRM quote discount | [Form](CASE_GALLERY.en.md#crm-form) · [Fixed process code][quote-host] | [Submitted](CASE_GALLERY.en.md#crm-submitted) · [Manager](CASE_GALLERY.en.md#crm-manager-review) · [Finance](CASE_GALLERY.en.md#crm-finance-review) | [Approved](CASE_GALLERY.en.md#crm-approved) · [Rejected](CASE_GALLERY.en.md#crm-rejected) | Separate entry point; no quote-process configuration UI or per-person history on result cards |

[Capture provenance and reproduction](GALLERY_CAPTURE.en.md) · [Gallery sources](CASE_GALLERY.en.md#provenance). Quote history is verified through API assertions, not displayed by the current result cards. Future scenarios should gain supported-feature screenshots only after implementation and verification.

**Merged · OA expenses:** `/scenarios.html` provides a fixed-layout form and visual approval designer, with 1–20 typed lines, exact money and immutable business/process snapshots. The dedicated `/api/scenarios/oa-expense` host uses `approval.data-file + ".scenario-oa-expense.json"`, requires submission keys and introduces reader-first schema 7 while retaining SQL revision 3. This bounded synthetic demo does not pay, upload or verify invoices, or connect real finance systems, shared inboxes, RuoYi or H5.

The [Expense contract and real gallery][expense-gallery] separately cover catalog, entry, designer, submitted/pending, current reviewer, 390px narrow review, approved and rejected screens. All 16 originals come from the [`90007fc`](https://github.com/JamesCube/ArcFlow/commit/90007fc8d0499b45ca38a04d010029888ab5cbef) [browser run](https://github.com/JamesCube/ArcFlow/actions/runs/37803754153), with [per-image provenance and SHA-256](images/expense/provenance.json). Gallery commit `9653f95` did not change application source. [HTTP tests][expense-api-tests] and [real-backend browser tests][expense-browser-tests] provide code evidence; Expense captures/tests are not Travel acceptance evidence.


<a id="en-next"></a>

<!-- topic:proposed-sequence-scenarios-visual-forms-and-configuration -->
## Proposed sequence: scenarios, visual forms and configuration

This sequence records progress: Expense, Travel, Seal-use, Receiving, Payment and Contract are merged into the six-entry main catalog. Live source integration, arbitrary form configuration and further operations remain future work without a delivery schedule. Merged scope and exact-commit acceptance results are separate records.

| Order | Scope | Evidence required for completion |
| --- | --- | --- |
| 1 · First complete slice | Merged Expense reimbursement: typed document, versioned scenario catalog, isolated process, fixed-layout form and read-only detail | [Expense contract][expense], source/tests and [16 real captures][expense-gallery]; still check CI for the commit you use |
| 2 · More OA cases | Travel and Seal-use are merged into main with distinct fields/rules; verify acceptance for the selected commit | Each case has its own entry point, flow configuration, validation and acceptance; renaming a case is not a new template |
| 3 · Source-bound cases | Synthetic Receiving, Payment and Contract are merged; live source revision, access and balance integration remain future work | Source revision, business access/ownership and duplicate-submission contracts; approval does not pay, post inventory or sign |
| 4 · Visual form configuration | Add a field inspector, preview, validation and publication over fixed/versioned forms; define form schema and compatibility separately | UI configuration yields server-validated documents while old requests remain readable; no generic drag/drop form-designer claim before this exists |
| 5 · More routing operations | Three restricted condition families exist; separately design role/department resolution, return, withdrawal, added reviewers and delegation | Permissions, terminal states, versions and concurrency semantics before execution, clients and negative tests |
| 6 · Hosts and delivery safeguards | Integrate real systems, transactional outbox, messaging, tenant isolation and mobile capabilities as needed | Separate adapters and failure testing; passing source examples does not establish production acceptance |

<a id="candidate-business-templates-each-still-unimplemented"></a>

<!-- topic:business-template-progress-merged-unified-integration-and-future-candidates -->
## Business template progress: merged, unified integration and future candidates

| Area | Scenario | Status | Initial boundary / prerequisite |
| --- | --- | --- | --- |
| OA | Expense reimbursement | 🟡 | Merged runnable bounded synthetic demo: 1–20 lines with dates, categories, exact money, currency and textual receipt references; no payments, uploads or invoice verification; [contract/gallery][expense-gallery] |
| OA | Travel request | 🟡 Merged in main | [Travel contract][travel]: destination, purpose, dates and exact budget, 1–90 calendar days, isolated host and minimum wrapper 8; no booking, reimbursement or payment |
| OA | Seal-use request | 🟡 Merged in main | [Seal contract][seal]: document reference, category, purpose and copy count, minimum wrapper 9; no physical/electronic stamping |
| ERP | Payment request | 🟡 Merged in main | [Payment contract](PAYMENT_CONTRACT_SCENARIOS.en.md): 1–20 invoice allocations/deductions and exact net totals, minimum wrapper 11; no live balances, cross-request reservations or money transfer |
| ERP | Goods-receipt review | 🟡 Merged in main | [Synthetic Receiving contract][receiving]: 1–20 quantity/discrepancy lines, initial ALL then Bob, minimum wrapper 10; no real PO binding, cross-request balances or stock posting |
| CRM | Contract review | 🟡 Merged in main | [Contract review model](PAYMENT_CONTRACT_SCENARIOS.en.md): terms, dates, 1–20 milestones and acceptance criteria, minimum wrapper 12; no signing, customer delivery or CRM update |
| OA | Overtime request | — | Later candidate; work calendars, time zones, durations and conflict rules remain undefined |
| ERP | Purchase return | — | Later candidate; source receipt, returnable quantities and inventory contract remain undefined |
| CRM | Credit-limit request | — | Later candidate; customer master data, limit source and revision policy remain undefined |
| CRM | Refund request | — | Later candidate; source transaction, refundable balance and duplicate-refund boundaries remain undefined; no refund execution |

Current main includes all six standalone scenarios and payment/receiving/contract conditions, with strict wrapper-1–13 readers. The domain registers nine types; generic endpoints remain leave/procurement-only, with a dedicated quote host. Check migration, HTTP, UI, browser and H2/PostgreSQL/MySQL evidence for your exact commit. The historical unified checkpoint encountered HTTP 403/1010 downloading original images; its missing PNG/hash/independent-pixel evidence remains recorded in the [integration history][unified] and does not determine current CI status. Fixed versioned forms are not an arbitrary-field engine; see [current architecture](development/ARCHITECTURE.en.md#en) and [conditional routing](CONDITIONAL_ROUTING.en.md).

**Completion checklist for every new case:** clear field/state contracts, server validation, identity/business access, configurable fixed-reviewer stages, immutable snapshots, repeat-operation/failure tests, and real Chinese/English captures of configuration → entry → pending → approved → rejected. Six initial cases require at least 60 distinct scenario/language-state images; that is an acceptance target for the complete set, not a completed count. Expense currently has 16 originals recorded separately. Add conflict, authorization-denial and recovery evidence where applicable.

The [existing roadmap](ROADMAP.en.md) covers broader engine directions. This section scopes a proposed scenario-library sequence, without implementation dates or delivery commitments. Current runnable support remains defined by the status matrix above.

[core]: ../src/main/java/com/arcflow/ArcFlowEngine.java
[core-tests]: ../src/test/java/com/arcflow/EngineChecks.java
[workflow]: ../src/main/java/com/arcflow/Workflow.java
[domain]: ../examples/approval-domain/README.en.md
[definition]: ../examples/approval-domain/src/main/java/com/arcflow/approval/ProcessDefinition.java
[service]: ../examples/approval-domain/src/main/java/com/arcflow/approval/ApprovalService.java
[store]: ../examples/approval-domain/src/main/java/com/arcflow/approval/ApprovalStore.java
[parallel]: PARALLEL_APPROVAL.en.md
[parallel-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/ParallelApprovalTest.java
[designer-tests]: ../examples/approval-ui/src/ProcessDesigner.test.js
[ruoyi-editor]: ../examples/ruoyi-vue3/frontend/src/views/arcflow/approval/index.vue
[business]: BUSINESS_DOCUMENTS.en.md
[business-model]: ../examples/approval-domain/src/main/java/com/arcflow/approval/BusinessDocument.java
[business-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/BusinessDocumentTest.java
[inbox]: MEMBER_INBOX.en.md
[inbox-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/InboxQueryTest.java
[identity-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/ActorDirectoryTest.java
[idempotency]: SUBMISSION_IDEMPOTENCY.en.md
[idempotency-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/SubmissionIdempotencyTest.java
[retry-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/ApprovalRetryBoundaryTest.java
[race-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/ApprovalStoreRaceTest.java
[json-store]: ../examples/approval-domain/src/main/java/com/arcflow/approval/JsonApprovalStore.java
[json-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/JsonSchemaUpgradeTest.java
[jdbc]: ../examples/approval-jdbc/README.en.md
[jdbc-store]: ../examples/approval-jdbc/src/main/java/com/arcflow/approval/jdbc/JdbcApprovalStore.java
[jdbc-ci]: ../.github/workflows/approval-jdbc.yml
[accepted-crm]: CRM_COMPATIBILITY_READINESS.en.md#accepted-crm-checkpoint
[standalone-tests]: ../examples/approval-ui/src/App.procurement.test.js
[ruoyi]: ../examples/ruoyi-vue3/README.en.md
[ruoyi-controller]: ../examples/ruoyi-vue3/backend/src/main/java/com/ruoyi/arcflow/ArcFlowController.java
[ruoyi-tests]: ../examples/ruoyi-vue3/tests/smoke.py
[mobile]: ../examples/approval-mobile/README.en.md
[mobile-model]: ../examples/approval-mobile/src/domain/model.ts
[mobile-adapters]: ../examples/approval-mobile/src/platform/adapters.ts
[quote-host]: ../examples/approval-domain/src/main/java/com/arcflow/approval/QuoteDiscountCase.java
[quote-tests]: ../examples/approval-demo/backend/src/test/java/com/arcflow/demo/QuoteDiscountApiTest.java
[quote-ui-tests]: ../examples/approval-ui/tests/crm-quote/page.test.mjs
[roadmap]: ROADMAP.en.md
[designer-model]: ../examples/approval-ui/src/designer-model.js
[designer-model-tests]: ../examples/approval-ui/src/designer-model.test.js
[identity]: ../examples/approval-domain/src/main/java/com/arcflow/approval/ActorDirectory.java
[read-identity-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/IdentityReadBoundaryTest.java
[quote-domain-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/QuoteDiscountCaseTest.java
[quote-model-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/QuoteDiscountTest.java
[http-tests]: ../examples/approval-demo/backend/src/test/java/com/arcflow/demo/ApprovalApiTest.java
[security-tests]: ../examples/approval-demo/backend/src/test/java/com/arcflow/demo/SecurityConfigTest.java
[jdbc-tests]: ../examples/approval-jdbc/src/test/java/com/arcflow/approval/jdbc/JdbcApprovalStoreTest.java
[postgres-tests]: ../examples/approval-jdbc/src/test/java/com/arcflow/approval/jdbc/PostgresqlApprovalStoreTest.java
[mysql-tests]: ../examples/approval-jdbc/src/test/java/com/arcflow/approval/jdbc/MysqlApprovalStoreTest.java
[h2-tests]: ../examples/approval-jdbc/src/test/java/com/arcflow/approval/jdbc/H2ApprovalStoreContractTest.java
[frontend-money-tests]: ../examples/approval-ui/src/business-document.test.js
[backend]: ../examples/approval-demo/backend/README.en.md
[core-handlers]: ../src/main/java/com/arcflow/spi/NodeHandler.java
[core-events]: ../src/main/java/com/arcflow/spi/EventListener.java
[gallery-tests]: ../examples/approval-ui/e2e/gallery.spec.mjs

[scenario-catalog]: ../examples/approval-domain/src/main/java/com/arcflow/approval/ScenarioCatalog.java
[expense]: EXPENSE_SCENARIO.en.md
[expense-gallery]: EXPENSE_SCENARIO.en.md#gallery
[expense-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/ExpenseScenarioTest.java
[expense-api-tests]: ../examples/approval-demo/backend/src/test/java/com/arcflow/demo/ScenarioApiTest.java
[expense-browser-tests]: ../examples/approval-ui/e2e/scenarios.spec.mjs
[travel]: TRAVEL_SCENARIO.en.md

[seal]: SEAL_USE_SCENARIO.en.md
[receiving]: RECEIVING_SCENARIO.en.md
[unified]: UNIFIED_SCENARIO_INTEGRATION.en.md
