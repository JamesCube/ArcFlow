# Architecture and extension

<!-- Legacy fragments remain entry points after the language split. -->
<a id="一笔申请怎样流转"></a>
<a id="九种业务类型与六场景目录"></a>
<a id="审批节点与条件路径"></a>
<a id="接入或扩展时改哪里"></a>
<a id="架构与扩展--architecture-and-extension"></a>
<a id="模块边界"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](ARCHITECTURE.md) · [Documentation](../README.en.md)

<!-- topic:module-boundaries -->
## Module boundaries

| Layer | Source entry | Responsibility and limits |
| --- | --- | --- |
| Java core | [`src/main/java/com/arcflow`](../../src/main/java/com/arcflow/) | Validates DAGs, runs handlers synchronously in topological order, emits events; no persisted execution or human waiting |
| Approval domain | [`examples/approval-domain`](../../examples/approval-domain/src/main/java/com/arcflow/approval/) | Identity SPI, immutable documents, process versions, voting, retries, frozen routing, and persistence SPI |
| Default storage | [`JsonApprovalStore`](../../examples/approval-domain/src/main/java/com/arcflow/approval/JsonApprovalStore.java) | Exclusive local writer, atomic snapshots, strict restoration, and pre-upgrade backups |
| Optional storage | [`examples/approval-jdbc`](../../examples/approval-jdbc/README.en.md) | JDBC transactions, retained definitions, audit, and member projection; host owns DataSource, drivers, and migrations |
| Standalone host | [`examples/approval-demo/backend`](../../examples/approval-demo/backend/src/main/java/com/arcflow/demo/) | Boot 4.1.1, Basic auth, fixed demo identities, strict JSON, and three endpoint families with separate stores |
| Standalone UI | [`examples/approval-ui`](../../examples/approval-ui/README.en.md) | Vue workspace, designer, quote page, and scenarios; never the final authority for permissions or money |
| Other hosts/clients | [RuoYi](../../examples/ruoyi-vue3/README.en.md), [H5](../../examples/approval-mobile/README.en.md) | RuoYi reuses native authentication/permissions; H5 reads/reviews leave and procurement only |

The root POM does not aggregate examples. Dependencies normally run host → domain → core; JDBC depends on the domain, not the reverse. The domain uses Jackson 2 and Spring Web for status-bearing exceptions. Only the core has no third-party runtime dependencies.

<!-- topic:the-lifecycle-of-a-request -->
## The lifecycle of a request

1. The host authenticates and resolves the actor from its Principal/session. Client JSON cannot choose the applicant or voter.
2. Controllers enforce the endpoint's business-type boundary, decode strict JSON, and call `ApprovalService`, `QuoteDiscountCase`, or `ScenarioCase`.
3. The domain checks active identity, permissions, process version, and document validity. A core DAG validates/normalizes submission data; human review never leaves that DAG thread suspended.
4. Submission saves the full business document, process definition, and initial `SUBMIT` event. Conditional flows also save the server-evaluated frozen route. Request, key binding, and derived projection are committed atomically.
5. Decisions authorize against the saved current stage and participants, append one event, and protect concurrent updates with a revision check. New publications affect new requests only.
6. Replay/restoration validates history and derived state. An idempotent retry returns the current request without another vote; it need not return the original response bytes.

Read [ApprovalService](../../examples/approval-domain/src/main/java/com/arcflow/approval/ApprovalService.java), then [SubmissionWorkflow](../../examples/approval-domain/src/main/java/com/arcflow/approval/SubmissionWorkflow.java) and [ApprovalStore](../../examples/approval-domain/src/main/java/com/arcflow/approval/ApprovalStore.java). Wire contracts belong in the [API reference](../api/API_REFERENCE.en.md).

<!-- topic:voting-and-conditional-paths -->
## Voting and conditional paths

- A definition is fixed `start` → **1–8 ordered human stages** → fixed `end`. It is not arbitrary graph editing, loops, or BPMN execution.
- UI **SINGLE** means `type: "approval"` with one `assigneeId`. It is not the JSON value `completionMode: "SINGLE"`.
- **ALL**/**ANY** use `type: "parallelApproval"`, null `assigneeId`, 2–16 distinct `assigneeIds`, and `completionMode`. The standalone demo can assign only Bob/Carol, so its groups contain both.
- ALL advances after every approval and rejects on any rejection. ANY advances on one approval and rejects only after all reject. A person assigned across stages votes separately at each. The core still runs serially; “parallel” means independent members eligible within one stage.
- Definition schema 2 is sequential, 3 adds groups, and 4 adds restricted `runIf`. Only payment, receiving, and contract scenarios can use schema 4; generic/quote hosts and other scenarios cannot publish it.
- Conditions use only `payment.netTotal`, `receiving.hasRejectedLines`, and `contract.termsKind`. A definition permits at most eight atoms and requires at least one unconditional human review. Predicate ALL/ANY is independent of participant ALL/ANY voting.
- The server freezes selected stages and actual condition facts from the immutable document and full definition. Skipped stages are not approvals. Skipped-only participants cannot read or vote through that assignment. Applicant self-assignment is forbidden anywhere in the full definition, including skipped stages.

See [ProcessDefinition](../../examples/approval-domain/src/main/java/com/arcflow/approval/ProcessDefinition.java), [ConditionalRouting](../../examples/approval-domain/src/main/java/com/arcflow/approval/ConditionalRouting.java), [group semantics](../PARALLEL_APPROVAL.en.md), and [routing semantics](../CONDITIONAL_ROUTING.en.md).

<!-- topic:nine-types-six-catalog-scenarios -->
## Nine types, six catalog scenarios

The domain's [explicit registry](../../examples/approval-domain/src/main/java/com/arcflow/approval/BusinessDocumentSchema.java) is not the HTTP allowlist:

| Business type | Standalone entry/host |
| --- | --- |
| `leave`, `procurement` | `/` workspace; generic `/api/documents`, plus legacy leave `/api/requests` |
| `quoteDiscount` | `/quote-discount.html`; dedicated `/api/crm`, fixed manager → finance |
| `expense` | Scenario `oa-expense` |
| `travel` | Scenario `oa-travel` |
| `sealUse` | Scenario `oa-seal-use` |
| `receiving` | Scenario `erp-receiving`, also available through `/receiving.html` |
| `paymentRequest` | Scenario `erp-payment` |
| `contractApproval` | Scenario `crm-contract` |

The six scenarios share the `/scenarios.html` catalog and `/api/scenarios/{scenarioId}/...` route pattern, with separate exact types, process IDs, and files. [ScenarioCatalog](../../examples/approval-domain/src/main/java/com/arcflow/approval/ScenarioCatalog.java) contains compiled form metadata, not arbitrary JSON Schema execution, drag-and-drop form publication, or dynamic plugins. Quotes separately check source revision, ownership, and visibility. Dedicated records do not join the main workspace inbox.

All scenarios store synthetic review state only. References do not upload attachments. Approval does not pay, sign, apply a seal, post stock, or update CRM/ERP.

<!-- topic:where-to-extend -->
## Where to extend

- **Enterprise identity:** implement [ActorDirectory](../../examples/approval-domain/src/main/java/com/arcflow/approval/ActorDirectory.java) with stable IDs, current active/deleted state, and live publishing/assignment policy. Authenticate in the host; display names are not identity keys.
- **Storage:** implement atomic publication, creation, append-one decisions, durable submission keys, and bounded member queries in `ApprovalStore`. An in-memory cache cannot replace durable idempotency, and full-list replay cannot silently replace bounded inbox queries. The service closes the store; the host still owns its DataSource.
- **Business types:** add a strict model/validator, explicit wire-type/minimum-wrapper registration, host allowlist, relevant form metadata, response handling, and isolated storage. Plan migration first; registration alone does not open generic endpoints.
- **Routing/voting:** test full definitions versus effective paths, participant authorization, indexes, replay, restoration, and frontend response validation together. A designer-only change is insufficient.
- **External effects:** business-table transaction joining, outbox, and reliable notifications do not exist. Design failure recovery and external idempotency separately; approved is not proof that an external action occurred.

Start with [ParallelApprovalTest](../../examples/approval-domain/src/test/java/com/arcflow/approval/ParallelApprovalTest.java), [ConditionalRoutingStoreTest](../../examples/approval-domain/src/test/java/com/arcflow/approval/ConditionalRoutingStoreTest.java), [UnifiedScenarioApiTest](../../examples/approval-demo/backend/src/test/java/com/arcflow/demo/UnifiedScenarioApiTest.java), and [frontend E2E](../../examples/approval-ui/e2e/). Use the [development checklist](QUICKSTART.en.md#en) to run them in context.
