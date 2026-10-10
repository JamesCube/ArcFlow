# Goods receipt review

<!-- Legacy fragments remain entry points after the language split. -->
<a id="contract"></a>
<a id="persistence-and-compatibility-gate"></a>
<a id="中文"></a>
<a id="收货验收--goods-receipt-review"></a>
<a id="数量与边界"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](RECEIVING_SCENARIO.md) · [Documentation](README.en.md)

<!-- topic:current-scope-and-historical-evidence -->
## Current scope and historical evidence

Receiving is included in current main's six-scenario catalog and supports restricted conditions. Current JSON readers accept wrappers 1–13; receiving still requires at least 10. Use the [current migration guide](development/PERSISTENCE.en.md). The historical unified candidate below was based on `71910bfc2ac1b9d58e0f7f1b85e6bbb206321ec1`, before merge or deployment, with a strict 1–10 reader. Its missing independent pixel evidence and combined-head verification remain historical facts; see [integration history](UNIFIED_SCENARIO_INTEGRATION.en.md).

<!-- topic:scenario-and-review-flow -->
## Scenario and review flow

`erp-receiving` is a separate goods-receipt review scenario at `/receiving.html`, also available in the six-entry `/scenarios.html` catalog. Sign in with the demo backend accounts and passwords for this run. Use synthetic data only. Purchase-order and inspection fields are manually entered snapshots, without real PO lookup or cross-request cumulative balances.

Sample: Alice submits `GR-DEMO-001`, purchase order `PO-DEMO-001`, East demo warehouse and a delivery date. Line 1: demo sensors, PCS, ordered 20, received 10, accepted 8, rejected 2, reason “Damaged casing”. Line 2: demo cables, BOX, ordered 10, received 5, accepted 5, rejected 0.

Default route: warehouse and quality ALL review (Bob + Carol), then procurement review (Bob). Bob’s first vote waits for Carol; after both approve, Bob casts a separate procurement vote. One ALL rejection ends the request. Bob holds two responsibilities in this demo: these are fixed accounts, without separation-of-duties guarantees or dynamic role/department resolution.

Alice can change ordered stages, named participants and SINGLE/ALL/ANY in the existing designer, then publish a new version. Submitted business data and routing remain immutable snapshots. The historical candidate had no field-based routing; current receiving supports [restricted conditions](CONDITIONAL_ROUTING.en.md).

<!-- topic:quantity-and-response-contract -->
## Quantity and response contract

Version 1 has a business reference, title, context, synthetic PO reference, EAST/WEST warehouse, valid YYYY-MM-DD delivery date, and 1–20 lines. Each line has a stable, unique-within-document lineId and PO line reference, material description, PCS/BOX unit, ordered/received/accepted/rejected integer counts and an exception reason.

Counts are integer JSON tokens in 0–100000; ordered must be positive. Fractional or exponent tokens, strings, booleans and null are rejected rather than coerced. Received cannot exceed the manually entered ordered count; accepted + rejected must equal received. Zero-delivery lines are allowed if another line has a positive delivery. Rejected quantities require a meaningful reason of at most 1000 UTF-16 code units.

The response is `{request,total:null,summary:{kind:"receiving",lineCount,exceptionLineCount,quantities:[{unit,received,accepted,rejected}]}}`. Unit groups are PCS then BOX, only when present. Expense/Travel retain exactly `{request,total:string}` and Seal-use retains `{request,total:null}`, without a receiving summary. Units are never added into a misleading global quantity or currency amount.

An applicant-scoped idempotency key replays the persisted result for the same canonical document, line order and original process version, including after restart or final approval. A changed intent with that key conflicts. A different key may submit the same PO again: there is no cross-document deduplication, inventory reservation or cumulative receiving ledger.

Approval only finishes this request’s review. It does not post stock, pay, return goods, update suppliers/orders, write to another system or certify real-world inspection.

<!-- topic:historical-persistence-and-compatibility-gate -->
## Historical persistence and compatibility gate

- The historical unified reader accepted known schemas 1–10; current main reads 1–13 and preserves the original field/type/version validation. Travel requires ≥8, Seal-use ≥9 and Receiving ≥10; legal schema 8/9 snapshots are read without rewriting. Receiving in 8/9 still fails closed.
- Writes take the maximum of the current wrapper and all type/definition/key requirements. Receiving does not assign a lower wrapper on write, and later legacy/Expense/Travel/Seal writes cannot lower 10. Unknown types and future document versions were rejected, as was wrapper 11+ at that checkpoint. See the current migration guide for the present wrapper boundary.
- Every actual upgrade preserves exact immediately preceding bytes, including prior writes in that session, using a collision-safe backup. Failed replacement does not publish request/key state; invalid reads do not mutate snapshots or existing backups.
- Raw negative-zero tokens are rejected before polymorphic/type-last or request/tree buffering can normalize them. Other unsupported numeric lexemes, downgraded Receiving and tampered relationships also fail closed.
- Isolated hosts reject wrong-business-type records at startup and before mutation. Each typed decision rechecks its target on every CAS attempt, so a stale preflight cannot append a vote to another document type.
- JDBC retains SQL revision 3, existing `request_json`, database-global applicant/key scope and the ready member projection. No DDL or rebuild is required solely for these types; older revision-2 installations still need explicit stopped-writer migration/backfill. H2 results do not establish PostgreSQL/MySQL results.
- Deploy the unified reader to every reader/writer and stop incompatible binaries before new writes. Old independent candidates do not understand one another’s types. Historical backup restore discards later work and is not lossless downgrade.
- Before release, rerun all final checks against the intended combined head. CI checks out its exact event head, tests the declared Boot 4.1.1 host, requires all ten new Travel/Seal/Receiving server cases without skips, and requires 15 authenticated bilingual Receiving Chromium states with commit/hash provenance. Original candidate image downloads returned HTTP 403 / 1010; original PNG bytes and independent pixel review remain unverified. Automated evidence and pixel acceptance are separate gates.

<!-- topic:verification -->
## Verification

Run domain tests, JDBC tests and the declared backend tests separately:

```sh
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-jdbc/pom.xml verify
mvn -f examples/approval-demo/backend/pom.xml verify
cd examples/approval-ui && npm test && npm run build
```

Focused coverage includes strict numeric lexemes, boundary quantities and text, zero-delivery rows, per-unit summaries, duplicate references, all-zero/empty/overlong documents, ALL partial voting and rejection, ANY custom publication, same-person cross-stage voting, access isolation, idempotency conflicts, concurrent retries, file/JDBC reopen, migration backups and failed atomic publication.
