# Business approval graphs: travel, receiving and quote discounts

[简体中文](GRAPH_BUSINESS_SCENARIOS.md) · [Developer guide](development/README.en.md) · [Graph workspace contract](GRAPH_DESIGNER.en.md)

<!-- topic:scope-and-identity -->
## Scope and fixed identities

The standalone backend and Vue graph workspace add travel, receiving and quote-discount graphs alongside the existing payment graph. They share the bounded graph interpreter. Payment keeps definition schema 5; the three new families use schema 6 with the same field shape. Each has its own fixed process ID, strict business model, draft, publication version and isolated store. Switching business types does not relabel a payment form or open arbitrary business types.

| Graph API base | Process ID | `business.type` | Allowed condition facts |
| --- | --- | --- | --- |
| `/api/graphs/payment` | `payment-graph` | `paymentRequest` | `payment.netTotal` |
| `/api/graphs/travel` | `travel-graph` | `travel` | `travel.estimatedCost` |
| `/api/graphs/receiving` | `receiving-graph` | `receiving` | `receiving.hasRejectedLines` |
| `/api/graphs/quote` | `quote-graph` | `quoteDiscount` | `quote.reductionTotal`, `quote.discountPercent` |

The endpoint, process ID, facts and document type must agree. Even a conditionless definition cannot accept another business family. `GraphScenarios` binds both schema and process identity. Every historical schema-5 definition remains payment-only, including custom IDs that happen to equal `travel-graph`, `receiving-graph` or `quote-graph`. Schema 6 explicitly enables the new fixed families. A new business host cannot downgrade its definition to schema 5. This is a fixed demo format, not an arbitrary portable multi-business graph format. Existing linear/group scenario APIs, the original quote page, payment graph URLs, RuoYi native pages and H5 contracts remain unchanged. RuoYi and H5 do not gain graph-host support.

<!-- topic:travel -->
## Travel: manager review before the cost branch

Travel retains `documentVersion: 1`, `businessId`, `title`, `reason`, `destination`, `startDate`, `endDate`, `purpose`, `estimatedCost`, `currency` and `costCenter`. The inclusive date range is 1–90 days. Purpose is `CUSTOMER_VISIT`, `PROJECT_DELIVERY`, `TRAINING`, `CONFERENCE` or `OTHER`; cost center is `ENGINEERING`, `SALES` or `OPERATIONS`.

`estimatedCost` is an applicant-entered, server-validated estimate, not an actual cost obtained from a booking system. The existing travel DTO's strict JSON-number, currency precision and range rules apply; JPY amounts must be whole. The server evaluates the normalized estimate as `travel.estimatedCost`; clients cannot submit route results.

The initial graph first requires Bob's manager review. At 10,000 CNY or above, it then activates Bob's operations review and Carol's finance review together and waits for both. Below that threshold, the default branch goes directly through its paired merge to the end; manager review remains mandatory. An empty default branch does not mean a request may bypass every human review. Thresholds and nodes can be edited and published in the graph workspace.

<!-- topic:receiving -->
## Receiving: line reconciliation and quality exceptions

Receiving uses `documentVersion: 1`, `businessId`, `title`, `reason`, `purchaseOrderRef`, `warehouse` (`EAST`/`WEST`), `receivedOn`, and 1–20 `lines`. Each line contains `lineId`, `orderLineRef`, `description`, `unit`, `ordered`, `received`, `accepted`, `rejected` and `exceptionReason`.

The server requires `accepted + rejected = received <= ordered` on every line, at least one received line, and separately unique line IDs and purchase-order line references. A positive rejected quantity requires an exception reason. Quantities with different units must not be added into one business total.

The server derives `receiving.hasRejectedLines` by checking all lines for `rejected > 0`; its predicate accepts only `EQ` and a boolean `expected`. The initial graph routes rejected lines into parallel quality review (Bob) and purchasing review (Carol), while a clean receipt goes to Bob's standard review. The parallel join waits for both branches rather than treating the first completion as the whole review.

<!-- topic:quote-source-and-pricing -->
## Quote discounts: source revisions, access and exact arithmetic

First read `/api/graphs/quote/quotes` for current `QuoteVersion[]` visible to the authenticated actor. The `quoteDiscount` submission contains `businessId`, `title`, `reason`, `customerRef`, `quoteRevision`, `item`, `quantity`, `listUnitPrice`, `requestedUnitPrice`, `currency` and `validUntil`. This existing type has no `documentVersion` field. The source's `revision` becomes the submission's `quoteRevision`.

Customer reference, item, quantity, list price, currency and validity must match the specified source revision. The applicant supplies the title, reason and requested unit price; that price must be positive and strictly below list price. The server computes reduction total with `BigDecimal`: `(listUnitPrice - requestedUnitPrice) * quantity`. Percentage predicates compare `(listUnitPrice - requestedUnitPrice) * 100` against `listUnitPrice * threshold` by exact cross multiplication. Rounded display percentages never select a route.

- Only the source quote's owner can submit. Publication permission does not grant source access.
- Preview requires a readable source revision, matching source fields, a current and unexpired revision, and source access for every selected reviewer.
- First submission also requires the current revision, validity on the current UTC date, and source access for selected reviewers. A quote remains valid on its `validUntil` date.
- Lists, detail reads and task commands require current source access as well as graph visibility. Revoking source access affects later reads and votes.
- Saved requests retain their original definition and business snapshot. Later source updates or expiry do not reroute them or independently block authorized task decisions and original-intent replay. The saved source revision must still exist and be readable.

The initial graph routes discounts of at least 20% to Bob's commercial review and Carol's finance review in parallel, then waits for both before Carol's final confirmation. Lower discounts go through Bob's standard review and then final confirmation. This family can also use the monetary `quote.reductionTotal` fact. Percentage thresholds are 0–100 with at most two decimal places and have no `currency` field. Graph responses are `GraphInstance`, not the legacy `QuoteView`; the graph runtime shows frozen revision and validity, without live expired/source-updated badges.

<!-- topic:authoring-and-http -->
## Authoring, preview and HTTP

After choosing a business, read its `/capabilities`, `/process`, `/workspace` and `/users`. Capabilities list that family's facts, not the union of every graph fact. `/draft`, `/validate`, `/preview`, `/publish`, `/requests` and task `/decision` follow the shared [graph HTTP contract](GRAPH_DESIGNER.en.md#http-contract). The controller maps `/api/graphs/{scenario}` with the four-key allowlist above; unknown keys return 404. `/quotes` is available only for `quote`; another known family returns 400.

Submission is `{expectedVersion,business}`; preview is `{definition,business}`. All writes still require authentication, JSON and `X-Arcflow-Client: approval-demo`; submissions and decisions require exactly one valid `Idempotency-Key`. Runtime state, tasks, applicant identity, join state, derived amounts and routes are server-owned outputs, never command fields. Preview creates no request and changes neither draft nor publication.

The quote graph requires its deterministic revision key in the header: `quote:` followed by lowercase SHA-256 of UTF-8 `businessId + "\\n" + decimalRevision`. The separator is the two literal characters backslash and `n`, not a newline. A different header is a 400 error. The persisted binding is scoped to the applicant, so changing keys cannot create duplicate requests for one owner's quote revision. Replaying the original version and normalized business returns the saved request's current state; changing price or other submitted content for that revision returns 409. This differs from legacy `/api/crm/documents`, which forbids the header.

<!-- topic:frozen-runtime-and-retries -->
## Frozen instances, parallel joins and retries

Every family uses the same `GraphInstance` structure, freezing the submitted graph, normalized business and FIRST_MATCH selections. Later publications affect new requests only. Each fork activation saves its expected branch-edge IDs. Its paired join releases once, after every branch arrives. Participant ALL/ANY voting within a node does not change a parallel join's ALL semantics.

Request-revision compare-and-swap atomically persists tasks, votes, branch arrivals and events. Conflicts trigger rereading and reauthorization. Terminal rejection cancels other active tasks; replay cannot resurrect them. After an uncertain response, retry the original endpoint, version, business, task and idempotency key rather than creating another request to evade a conflict. Exact command replay adds no votes or events; fresh-key same-decision replay and its budget are covered in the [complete contract](GRAPH_DESIGNER.en.md#http-contract).

<!-- topic:persistence-and-boundaries -->
## Persistence and explicit boundaries

Payment keeps `<APPROVAL_DATA_FILE>.graph.json`. The new files are `<APPROVAL_DATA_FILE>.travel.graph.json`, `.receiving.graph.json` and `.quote.graph.json`; each owns its writer lock, draft, versions and instances. Payment definition schema remains 5; travel, receiving and quote definitions use schema 6. JSON wrapper remains 14, and JDBC graph schema remains 1. Unchanged storage schema numbers do not mean older binaries understand schema-6 definitions, business types or facts. Older graph readers reject schema 6 rather than silently interpreting it as payment. Back up all files and stop incompatible readers/writers before upgrading.

Restore validation uses frozen business and commands, independently of live CRM source permissions; current source authorization is checked at read and command boundaries. Optional JDBC still needs explicit host wiring and database acceptance; it is not automatically enabled for the standalone JSON host.

All sources are synthetic, and stores contain approval state. There is no external CRM connection or quote writeback, stock posting, purchase-order reservation, travel booking, reimbursement payment, bank instruction or cross-business transaction. General BPMN, dynamic business plugins, withdrawal/rework, loops, compensation and RuoYi-native graph approval are also outside this implementation.

<!-- topic:sources-and-verification -->
## Sources and verification

Start with [GraphScenarios](../examples/approval-domain/src/main/java/com/arcflow/approval/graph/GraphScenarios.java), [GraphSamples](../examples/approval-domain/src/main/java/com/arcflow/approval/graph/GraphSamples.java), [GraphQuotePolicy](../examples/approval-domain/src/main/java/com/arcflow/approval/graph/GraphQuotePolicy.java), [GraphApprovalService](../examples/approval-domain/src/main/java/com/arcflow/approval/graph/GraphApprovalService.java) and [GraphController](../examples/approval-demo/backend/src/main/java/com/arcflow/demo/GraphController.java). Strict business fields are documented in [JSON Schema](api/openapi/schemas.json) and the [API reference](api/API_REFERENCE.en.md).

Run the static checks from the repository root, then build the domain, backend and UI with the [development quickstart](development/QUICKSTART.en.md):

```sh
python3 scripts/check_api_contract.py
python3 scripts/test_api_contract.py
python3 scripts/verify_developer_docs.py
python3 scripts/check_documentation.py
```

Coverage and pass results belong to the logs for the relevant commit. HTTP, domain restoration, browser interaction and actual database tests establish different boundaries. This page does not turn test presence, screenshots or H2 results into production acceptance.
