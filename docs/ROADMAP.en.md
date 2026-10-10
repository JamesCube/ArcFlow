# Roadmap

<!-- Legacy fragments remain entry points after the language split. -->
<a id="arcflow-路线图"></a>
<a id="dag-编排演进"></a>
<a id="下一阶段可持续的业务审批模型"></a>
<a id="可选企业集成与可视化"></a>
<a id="实验性本地审批演示"></a>
<a id="已实现初始内核"></a>
<a id="已实现可选-jdbc-事务存储"></a>
<a id="已实现固定参与人的会签--或签"></a>
<a id="已实现持久化提交幂等"></a>
<a id="已实现按成员分页查询待办和已办"></a>
<a id="已实现请假与采购单共用审批"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](ROADMAP.md) · [Documentation](README.en.md)

This roadmap records completed milestones and possible next steps, without release dates. Exact support is defined by the code and tests for the revision you use.

<!-- topic:implemented-initial-core -->
## Implemented: initial core

- [x] Java 17 target, no Spring in the core, Apache-2.0
- [x] DAG validation, synchronous serial execution, variable snapshots
- [x] Handler/Event SPIs, examples, regression checks

<!-- topic:experimental-local-approval-demo -->
## Experimental local approval demo

The separate approval example edits/publishes 1–8 stages. Each request freezes its definition and progresses in order; rejecting a single-reviewer stage ends it. Decisions check permissions and support retries. A single-process JSON file saves definitions/requests across restart. Vue provides a designer, submission, inbox, read-only flow, and history. Repeated participants decide separately at each stage. The main workspace does not provide conditions, arbitrary graph deployment, or production storage; current expense/payment/receiving/contract conditions belong to dedicated scenarios. [Run it](../examples/approval-demo/README.en.md)

<!-- topic:implemented-optional-transactional-jdbc-storage -->
## Implemented: optional transactional JDBC storage

`approval-domain` exposes a storage SPI. `approval-jdbc` commits immutable versions, request revisions, and independent audit events together in `arc_` tables. Multiple services coordinate through conditional updates and short row locks. Repeated decisions reread committed state without another event. Tests cover rollback, reopen, concurrency, and corruption, with PostgreSQL, H2, and experimental MySQL 8 profiles. Check exact-commit real-server results for MySQL submission idempotency; they do not establish production support. [Module contract](../examples/approval-jdbc/README.en.md)

This solves approval-data persistence. Both demos still default to JSON. Automatic migration, tenant isolation, business-table atomicity, outbox, and scheduling remain unimplemented; the general engine plan below is broader.

<!-- topic:implemented-fixed-all-any-groups -->
## Implemented: fixed ALL/ANY groups

Domain schema 3 supports fixed groups. ALL waits for every approval and rejects on any rejection; ANY advances on one approval and rejects after all reject. Each participant’s vote has independent replay, with revision checks and atomic audit persistence. Schema 2 remains readable. [Group contract](PARALLEL_APPROVAL.en.md) covers JSON backups, why group support itself needs no JDBC DDL, and regression tests.

Standalone Vue/Spring Boot supports Single/ALL/ANY configuration, member inboxes, and votes. Native RuoYi also supports real-user groups through its own login, menus, and permissions. Dynamic added reviewers, delegation, and general branch joins remain unimplemented.

<!-- topic:implemented-durable-submission-idempotency -->
## Implemented: durable submission idempotency

Both HTTP hosts accept optional applicant-scoped keys. The same key/intent returns the original request’s current state; changed intent conflicts. Legacy keyed leave requires JSON wrapper 4, typed documents 5; JDBC retains the key mapping while member worklists use SQL revision 3. Mapping and request commit together. Without a key, every successful call creates a request. Clients keep unresolved keys in page memory. [Migration, races, reopen, and power-loss limits](SUBMISSION_IDEMPOTENCY.en.md)

<!-- topic:implemented-shared-leave-and-procurement-approval -->
## Implemented: shared leave and procurement approval

Immutable typed leave/procurement use shared review, permissions, history, and retries. Standalone/RuoYi have bilingual procurement forms; H5 reads/reviews them. Typed writes require JSON wrapper 5, while JDBC isolates configured processes. Business writeback, payment, and arbitrary plugins remain unsupported. [Business contract](BUSINESS_DOCUMENTS.en.md) · [Procurement UI](PROCUREMENT_UI.en.md)

<!-- topic:implemented-paginated-member-worklists -->
## Implemented: paginated member worklists

PENDING/HANDLED are scoped to the signed-in actor. ALL/ANY membership follows each participant’s actual votes; cursors bind identity and filters. JDBC uses SQL revision-3 member indexes with explicit stopped-writer bounded backfill. Standalone, RuoYi, and H5 consume the pages. [Contract and migration](MEMBER_INBOX.en.md)

<!-- topic:implemented-nine-business-types-and-restricted-routing -->
## Implemented: nine business types and restricted routing

Current main has nine domain types and six dedicated scenarios. Expense, payment, receiving, and contract support definition-schema-4 conditions with frozen paths. JSON wrappers reach 13; JDBC remains SQL revision 3. These features are not arbitrary graphs, dynamic forms, or external business execution. [Architecture](development/ARCHITECTURE.en.md) · [Capability catalog](CAPABILITIES.en.md)

<!-- topic:next-a-sustainable-general-approval-model -->
## Next: a sustainable general approval model

This is the broader model plan. Examples implement parts of it, but scope, interfaces, and tests still need completion; an example implementation does not mark the whole item complete.

- [ ] Versioned definitions, immutable publications, instance-bound versions
- [ ] Human task lifecycle: create, claim, complete, withdraw, terminal rules
- [ ] Identity SPI for users, roles, departments, and candidate resolution
- [ ] Variable SPI for types, scope, serialization, and restricted evaluation
- [ ] Storage SPI, transactions, idempotent commands, optimistic locks, durable audit
- [ ] Database migrations/indexes with `arc_` engine business tables
- [ ] Rejection/return reachability and handling of completed downstream tasks
- [ ] Extended ALL/ANY, added reviewers, delegation; define rules and transitions first

<!-- topic:optional-enterprise-integrations-and-visualization -->
## Optional enterprise integrations and visualization

- [ ] Separate Spring Boot Starter without making Spring a core dependency
- [x] Pinned official RuoYi-Vue + RuoYi-Vue3 reference, native identity/menus/permissions, single-writer file approval store rather than a production SQL engine
- [ ] Other Java enterprise frameworks as needed, separately adapted/tested
- [ ] Complete submission, pending/handled, instance-detail/history pages and APIs
- [ ] Vue designer with review nodes, conditions, drag configuration, settings, validation, preview
- [ ] Independently implemented familiar approval interactions, without proprietary code/assets
- [ ] Frontend-independent versioned DSL separating designer metadata and execution

<!-- topic:dag-evolution -->
## DAG evolution

- [ ] Async scheduling, bounded parallelism, timeout, cancellation, error propagation
- [ ] Retry policy, idempotency keys, recovery, observability
- [ ] Branch/join semantics, conditions, resource limits
- [ ] Tested performance, compatibility, and production suitability

Full BPMN is not planned; the designer DSL does not provide BPMN compatibility.
