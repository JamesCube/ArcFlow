# Business travel review

<!-- Legacy fragments remain entry points after the language split. -->
<a id="schema-8-rollout-and-recovery"></a>
<a id="status-and-scope"></a>
<a id="出差申请审批--business-travel-review"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](TRAVEL_SCENARIO.md) · [Documentation](README.en.md)

<!-- topic:current-scope -->
## Current scope

Current main includes all six dedicated scenarios and reads JSON wrappers 1–13. This page preserves the early unified candidate's evidence and format boundaries; its unmerged status and wrapper-10 ceiling are historical. Use the [current architecture](development/ARCHITECTURE.en.md) and [migration guide](development/PERSISTENCE.en.md) for deployment, and check exact-commit CI separately.

<!-- topic:historical-candidate-and-scenario-scope -->
## Historical candidate and scenario scope

This is the Travel slice of a local unified Travel/Seal-use/Receiving integration candidate,
based on accepted main `71910bfc2ac1b9d58e0f7f1b85e6bbb206321ec1`. It is not merged or
deployed. Historical standalone candidate results are not a fresh combined-head test result.
See [combined compatibility and acceptance gates](UNIFIED_SCENARIO_INTEGRATION.en.md).

The compiled `oa-travel` scenario uses the reusable catalog, visual form renderer, designer
and approval lifecycle with a distinct `travel` version-1 business document. It accepts a
synthetic itinerary and estimated budget. Approval does not book transport or accommodation,
reimburse expenses, reserve money, issue payment, send notifications or write to another system.
There are no sensitive uploads or external integrations.

<!-- topic:form-and-business-rules -->
## Form and business rules

Required fields are `businessId`, `title`, `reason`, `destination`, `startDate`, `endDate`,
`purpose`, `estimatedCost`, `currency`, and `costCenter`, plus `type: travel` and
`documentVersion: 1`. The immutable request preserves all fields throughout approval.

- Business reference: 1–128 ASCII letters/digits and `._:/-`, starting with a letter/digit.
- Title ≤120 characters; reason ≤2,000; destination ≤160; each must remain nonblank after
  normalization. Destination and common text are trimmed; the business reference is exact.
- Dates: real Gregorian `YYYY-MM-DD`, years 0001–9999. End cannot precede start, and
  inclusive duration must be 1–90 days. Same-day and leap-day trips are supported. These
  are local calendar dates; no timezone conversion or current-date expiration is inferred.
- Purpose: `CUSTOMER_VISIT`, `PROJECT_DELIVERY`, `TRAINING`, `CONFERENCE`, or `OTHER`.
- Estimated cost: an exact JSON number, greater than zero and at most 1,000,000,000,
  with at most two decimal places. JPY amounts must be whole. Currency is CNY, USD,
  EUR, GBP or JPY. No exchange-rate conversion is performed.
- Cost center: ENGINEERING, SALES or OPERATIONS.
- Duration is derived from the immutable dates. `durationDays` and totals are not accepted
  as input. Legacy `request.days` is 0 because this is not a leave document.

The default fixed process is submit → trip review (Bob) → budget review (Carol) → complete.
The designer can publish the existing 1–8 approval-step model with SINGLE/ALL/ANY voting;
there is no amount-based routing, dynamic organizational role, timer or outbox.

<!-- topic:host-identity-and-isolation -->
## Host, identity and isolation

The original four-scenario candidate shared an in-memory authenticated session across Expense, Travel, Seal-use, and Receiving at `/scenarios.html`; the current catalog has six entries.
Each scenario retains its own draft, unresolved submission key and original intent, loaded
process version, designer draft, requests and review comments. Switching does not move an
in-flight response into another scenario. Logout clears all session-local drafts and keys.

The compiled host registry exposes only `/api/scenarios/oa-travel/{process,requests,documents}`
and its request decisions. Unknown scenario IDs return 404; path input never selects a file.
Travel uses `approval.data-file + .scenario-oa-travel.json`, independent of Expense, Seal-use, Receiving, CRM and
legacy leave/procurement stores. Generic standalone and native document routes explicitly
allow only leave/procurement. Every scenario host rejects the other business types.

Every request uses the authenticated active identity. Publication uses the existing publisher
permission; decisions use the frozen eligible participants and active-user checks. A required,
exact applicant-scoped Idempotency-Key binds every normalized field, scenario/process ID and
process version. Identical retries return current durable state, including after approval or
rejection; different intent conflicts. In JDBC the key remains globally applicant-scoped
across configured processes. A business reference is not a uniqueness constraint.

<!-- topic:historical-schema-8-rollout-and-recovery -->
## Historical schema-8 rollout and recovery

At the historical checkpoint, deploy the unified schema-1–10 reader everywhere that can read the affected JSON or
JDBC rows, stop incompatible writers, take normal backups, and only then enable Travel writes. Current deployments require the 1–13 reader described above.
Opening supported snapshots 1–10 remains read-only and retains existing strict validation. The first
Travel mutation requires at least JSON snapshot schema 8; valid Travel at 9 or 10 remains readable. A Travel payload in schema 1–7 is rejected;
Quote still requires ≥6 and Expense ≥7. Later legacy, Expense or publication writes never
downgrade an existing schema 8, 9 or 10. The writer takes a monotonic maximum, not an unconditional assignment to 8. Process definitions still use schema 2 or 3.

The first upgrade preserves the byte-exact file immediately before the upgrade in a private
`.schemaN.bak`, with a unique name if that backup exists. Atomic replacement failure publishes
neither a request nor its submission binding. Retries preserve the backup. Restoring it discards
later submissions, decisions and publications, so it is historical recovery, not a lossless
downgrade. Schema-7 application binaries cannot read Travel/schema-8 data.

SQL revision 3 is unchanged; Travel uses the existing strict `request_json` and member projection.
Registration does not rebuild an already-ready member projection. There is no automatic DDL, backfill or rollback migration. Existing SQL stopped-writer migration
requirements still apply. Database backups and a forward-compatible rollout are required.

<!-- topic:verification-and-visual-acceptance -->
## Verification and visual acceptance

Required release gates: fresh domain and JSON migration/restart tests; inherited H2/PostgreSQL/
MySQL contracts with the Travel tests explicitly executed; standalone authenticated HTTP tests;
full shared UI regression suite and build; real-backend bilingual desktop/narrow browser flows.
Expense's existing tests and screenshots are not evidence that Travel passed these gates.

Capture real catalog, filled form, designer, validation error, pending, next reviewer, approved
and rejected screens in Chinese and English with exact source SHA, viewport, capture-run and
image hashes. No mock screenshots or generated illustrations may stand in for real captures.
Review spacing, focus, keyboard use, legible errors, totals and dates, no horizontal clipping,
retained draft/retry recovery, and frozen data through approval. That historical candidate had
no independently accepted Travel screenshot gallery. Original candidate image downloads returned HTTP 403 / 1010; the original PNG bytes and independent pixel review remain unverified.
