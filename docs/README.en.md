# Documentation

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](README.md) · [Documentation](README.en.md)

This task-oriented index describes current `0.1.0-SNAPSHOT` main. Historical alpha tags may have a smaller feature set, and source availability is not production readiness. Complete one approval first, then choose integration or contract details. Historical evidence remains tied to its date, revision, and environment.

<!-- topic:start-here -->
## Start here

- First evaluation: [First approval](GETTING_STARTED.en.md) → [Business journeys](CASE_GALLERY.en.md)
- Development: [Developer guide](development/README.en.md) → [Setup and verification](development/QUICKSTART.en.md) → [Architecture](development/ARCHITECTURE.en.md)
- HTTP integration: [API reference](api/API_REFERENCE.en.md) → [Executable examples](api/examples/README.en.md)
- Upgrades: [Persistence and migration](development/PERSISTENCE.en.md), separating definition schema, JSON wrapper, and SQL revision

<!-- topic:tutorials-complete-a-journey -->
## Tutorials: complete a journey

- [First approval](GETTING_STARTED.en.md): start, submit, publish, decide, restart
- [Designer gallery](DESIGNER_GALLERY.en.md): sequential stages, ALL/ANY, validation, publication, snapshots
- [Business journeys](CASE_GALLERY.en.md): real leave, procurement, and quote states

<!-- topic:how-to-guides-complete-a-task -->
## How-to guides: complete a task

- [Local tryout and source packaging](TRYOUT.en.md): disposable startup, checks, cleanup, reproducible source bundles
- [Development setup and verification](development/QUICKSTART.en.md): build order, tests, recovery
- [Reproduce captures](GALLERY_CAPTURE.en.md): real UI, provenance, hashes, visual acceptance
- [Root build plugins](BUILD_REPRODUCIBILITY.en.md): pinned inputs and cold/warm cache checks
- Host/module setup: [standalone backend](../examples/approval-demo/backend/README.en.md), [Vue](../examples/approval-ui/README.en.md), [RuoYi](../examples/ruoyi-vue3/README.en.md), [H5](../examples/approval-mobile/README.en.md), [JDBC](../examples/approval-jdbc/README.en.md)

<!-- topic:explanation-understand-the-design -->
## Explanation: understand the design

- [Architecture and extension](development/ARCHITECTURE.en.md): modules, request flow, types, host boundaries
- [Capabilities and scenarios](CAPABILITIES.en.md): implemented, limited, and unsupported behavior
- [Designer workbench](DESIGNER_WORKBENCH.en.md): interactions, rationale, revision-specific evidence
- [Enterprise integration proposal](INTEGRATION_DESIGN.en.md): proposed general API/DSL, not existing routes
- [Roadmap](ROADMAP.en.md): completed milestones and possible work without delivery dates

<!-- topic:reference-inspect-rules-and-compatibility -->
## Reference: inspect rules and compatibility

- Foundation: [API](api/API_REFERENCE.en.md), [sequential approval](SEQUENTIAL_APPROVAL.en.md), [groups](PARALLEL_APPROVAL.en.md), [conditions](CONDITIONAL_ROUTING.en.md)
- State/storage: [business documents](BUSINESS_DOCUMENTS.en.md), [submission idempotency](SUBMISSION_IDEMPOTENCY.en.md), [member inbox](MEMBER_INBOX.en.md), [migration](development/PERSISTENCE.en.md)
- Scenarios: [procurement](PROCUREMENT_UI.en.md), [quote discounts](CRM_QUOTE_CASE.en.md), [expenses](EXPENSE_SCENARIO.en.md), [travel](TRAVEL_SCENARIO.en.md), [seal-use](SEAL_USE_SCENARIO.en.md), [receiving](RECEIVING_SCENARIO.en.md), [payment and contracts](PAYMENT_CONTRACT_SCENARIOS.en.md)
- Documentation: [standard](DOCUMENTATION_STANDARD.en.md), [this audit](DOCUMENTATION_AUDIT.en.md)

Nine domain types do not mean nine types on generic endpoints. `/api/documents` accepts leave/procurement only; quotes use `/api/crm`, and six scenarios have dedicated hosts. Conditions are limited to payment/receiving/contract. Approval does not pay, sign, stamp, or post stock.

<!-- topic:historical-evidence-follow-the-source -->
## Historical evidence: follow the source

These records preserve original commits, counts, failures, skips, and unaccepted checks; they do not certify later revisions. Some also describe current scope. Deployment still follows current contracts and evidence for the intended commit.

- [Early designer captures](DESIGNER_SHOWCASE.en.md), [early RuoYi captures](RUOYI_SHOWCASE.en.md), [initial local ALL/ANY verification](PARALLEL_DESIGNER_VERIFICATION.en.md)
- [Local procurement/inbox combination](LOCAL_INTEGRATION.en.md), [frontend inbox adoption](MEMBER_INBOX_UI.en.md), [PR #18 copy reconciliation](MEMBER_INBOX_COPY_INTEGRATION.en.md)
- [Accepted CRM checkpoint and future gates](CRM_COMPATIBILITY_READINESS.en.md)
- [Host dependency migration](SUPPORTED_HOST_MIGRATION.en.md), [unified scenario integration](UNIFIED_SCENARIO_INTEGRATION.en.md)
- [Original source archive](history/README.en.md): evidence preserved by original path and revision, not current usage instructions

<!-- topic:maintenance-and-navigation -->
## Maintenance and navigation

Chinese retains `NAME.md`; English uses `NAME.en.md`, with a direct switch at the top. Keep equivalent fields, steps, limits, commands, and sources by topic. Do not stack languages or move stable paths merely to express categories. For code changes, follow the [standard](DOCUMENTATION_STANDARD.en.md) and check both languages’ links and topic coverage.
