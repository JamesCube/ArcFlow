# Seal-use review

<!-- Legacy fragments remain entry points after the language split. -->
<a id="business-boundaries--业务边界"></a>
<a id="draft-integration-candidate"></a>
<a id="explicit-schema-compatibility"></a>
<a id="seal-use-review--用印申请审批"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](SEAL_USE_SCENARIO.md) · [Documentation](README.en.md)

<!-- topic:current-scope -->
## Current scope

Current main includes all six dedicated scenarios and reads JSON wrappers 1–13. This page preserves the early unified candidate's evidence and format boundaries; its unmerged status and wrapper-10 ceiling are historical. Use the [current architecture](development/ARCHITECTURE.en.md) and [migration guide](development/PERSISTENCE.en.md) for deployment, and check exact-commit CI separately.

<!-- topic:historical-candidate-scope -->
## Historical candidate scope

This is the Seal-use slice of the local unified integration candidate based on accepted
main `71910bfc2ac1b9d58e0f7f1b85e6bbb206321ec1`. It is not merged, deployed or accepted
as a delivered scenario. Historical candidate tests do not establish combined-head success.
Fresh Boot 4.1.1 HTTP, real-server, browser and independent pixel gates remain required;
see [unified compatibility and acceptance](UNIFIED_SCENARIO_INTEGRATION.en.md).

The original compiled catalog contained Expense, Travel, Seal-use and Receiving; the current catalog has six entries, each isolated by
business type, process, JSON file and session-local workspace. Generic/native endpoints
still allow only Leave and Procurement; CRM keeps its separate source-authorization host.
The `contracts/seal-use` prototype remains historical contract evidence.

<!-- topic:what-the-form-actually-records -->
## What the form actually records

The immutable document has exactly nine fields: `type: "sealUse"`, `documentVersion: 1`,
`businessId`, `title`, `reason`, `documentName`, `documentRef`, `sealType` and `copyCount`.
The form labels reason as business purpose, so the applicant enters the purpose only once.
Seal types are the synthetic categories `OFFICIAL`, `CONTRACT` and `FINANCE`. Copy count is
an integer from 1 to 100. A document reference is inert synthetic text, not a URL to fetch or
proof that a real document exists or belongs to the applicant.

Title, purpose and document name are length-checked before Java-compatible edge trimming.
Control/Unicode whitespace/BOM-only text is invalid. IDs, references and seal categories are
not trimmed or case-folded. Integer JSON fields reject decimal/exponent tokens, strings,
booleans and null. The form keeps raw copy-count text while typing, displays errors for
invalid inputs and only normalizes on successful validation. Unknown and missing fields,
duplicate JSON keys and trailing content fail closed. The dedicated Seal HTTP submission
accepts only well-formed UTF-8 JSON bytes and limits the entire raw JSON request envelope to 8,000,000 UTF-16 code units before decoding;
this transport bound does not cap aggregate stored snapshots or direct typed Java calls.

There is no currency, amount, receipt table or financial total. Responses preserve the
existing `{request, total}` envelope and include `total: null` for Seal-use. Expense continues
to return and validate its exact monetary string. Lists and saved detail show copies and the
synthetic seal category; copies are never formatted as money.

<!-- topic:review-and-identity -->
## Review and identity

The initial process is `oa-seal-use`: submit → Bob document review (`documentReview`) → Carol
seal-use review (`sealReview`) → review complete. The shared 1–8-stage fixed-reviewer designer
can publish a new process version. Every saved request retains its submitted process version,
reviewers, business snapshot and per-stage history. Approval records a review outcome only.

The host uses the authenticated active principal, publisher authorization and workflow
participant checks. Request paths select only compiled registry entries. The dedicated JSON
filename is the configured approval data file plus `.scenario-oa-seal-use.json`; the URL does
not choose a filesystem path. Seal submissions cannot enter the Expense or generic host,
and Travel/Receiving/Expense/Leave/Procurement/Quote payloads cannot enter the Seal host.

Exactly one valid applicant-scoped `Idempotency-Key` is required. Same normalized intent and
original process version replay the current durable request after approval, rejection or
restart; any changed business field or original process version conflicts. Document and
business references are not uniqueness constraints. JDBC submission keys remain globally
applicant-scoped across processes. The separate JSON scenario stores have their existing
per-file key scope. Failed persistence must not publish an in-memory state or retry binding.

The browser keeps each scenario's unsubmitted form, unresolved retry intent/key/version,
designer draft, request selection and review note separately. Responses belong to their
initiating scenario and authentication session. Logout clears the in-memory workspaces.
Reload still loses unsaved browser state; this is not durable draft storage.

<!-- topic:historical-explicit-schema-compatibility -->
## Historical explicit schema compatibility

The historical unified reader accepted known snapshot schemas **1–10**; current main supports 1–13 with strict original shapes.
Travel requires at least 8, Seal-use at least 9 and Receiving at least 10. Valid schema 8,
including empty or Travel snapshots, is readable without mutation. Schema 9 may include
valid Travel/Seal data; schema 10 can represent every type registered at that checkpoint. That historical reader rejected unknown types,
future document versions, wrapper 11+ and invalid lower-version payloads. See the current migration guide for today’s future-wrapper boundary.

- First Seal-use write selects at least 9. Seal-use under schemas 1–8 is rejected.
- Writes take the maximum of the existing wrapper and every document/definition/key
  requirement. Seal in schema 10 stays at 10; legacy/Expense/Travel/decision/publication
  writes never lower an existing 9 or 10. Reading never forces an upgrade.
- Every actual upgrade backs up the exact bytes immediately before that upgrade, including
  same-session earlier mutations. Existing backups survive collisions and retries.
- Failed atomic replacement publishes neither request nor in-memory submission-key state.
  Read/validation failure changes neither snapshots nor backups. JSON remains single-writer.
- SQL revision 3 and its ready member projection remain unchanged. Type registration does
  not rebuild that index; revision-2 installations retain the explicit migration/backfill.
- Upgrade all readers/writers before new typed writes and stop old writers. Old independent
  candidate binaries do not acquire cross-candidate compatibility merely through SQL revision 3.
- Restoring a backup loses later submissions, decisions and publications; it is historical
  recovery, not lossless downgrade. Do not renumber or weaken unknown-type checks.

<!-- topic:verification-and-acceptance -->
## Verification and acceptance

Run the normal Java core, domain, JDBC and UI test/build commands. The same four named Seal
JDBC contracts are inherited by H2, PostgreSQL and MySQL suites. CI must require the new
server cases to execute without skips. H2 success alone is not a real-server claim.

The host test class is `SealUseApiTest`; live authentication, process isolation, immutable
snapshots, rejection and schema-9 restart are checked by:

```sh
python3 examples/scenarios/seal_use_http_smoke.py \
  --jar examples/approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```

At that historical checkpoint, the remaining gates before accepting a completed scenario were: exact-code host/server CI, actual
browser journeys, Chinese and English original images of catalog/form/designer/validation/
pending/next stage/approved/rejected and narrow reviewer controls, image provenance and
independent pixel review. Test discovery, generated illustrations and Expense/Travel images
cannot satisfy Seal screenshot acceptance. Original candidate image downloads returned HTTP 403 / 1010; original PNG bytes and independent pixel review remain unverified. No accepted Seal gallery is claimed here.

<!-- topic:business-boundaries -->
## Business boundaries

This example records seal-use requests and human review outcomes only. It does not stamp, apply electronic seals, sign contracts, upload files, lend or return seals, notify recipients, or write to a business system. All three seal categories are synthetic; they do not establish an actual seal identity, legal authority, or document validity. Approval does not mean a seal has been applied.
