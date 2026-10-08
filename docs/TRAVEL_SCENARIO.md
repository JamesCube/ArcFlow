# 出差申请审批 / Business travel review

## Status and scope

This is a bounded implementation candidate built on the Expense scenario merged in
`9e0f2a2801fdd09c472466a57dac92ada4d77f10`. Local domain, H2 and UI checks have passed;
fresh host, PostgreSQL/MySQL, real-browser and visual acceptance remain release gates.
Check the exact candidate reports separately from Expense CI evidence; the presence of
source and test files does not establish release acceptance.

The compiled `oa-travel` scenario uses the reusable catalog, visual form renderer, designer
and approval lifecycle with a distinct `travel` version-1 business document. It accepts a
synthetic itinerary and estimated budget. Approval does not book transport or accommodation,
reimburse expenses, reserve money, issue payment, send notifications or write to another system.
There are no sensitive uploads or external integrations.

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

## Host, identity and isolation

`/scenarios.html` shares its in-memory authenticated session between Expense and Travel.
Each scenario retains its own draft, unresolved submission key and original intent, loaded
process version, designer draft, requests and review comments. Switching does not move an
in-flight response into another scenario. Logout clears all session-local drafts and keys.

The compiled host registry exposes only `/api/scenarios/oa-travel/{process,requests,documents}`
and its request decisions. Unknown scenario IDs return 404; path input never selects a file.
Travel uses `approval.data-file + .scenario-oa-travel.json`, independent of Expense, CRM and
legacy leave/procurement stores. Generic standalone and native document routes explicitly
allow only leave/procurement. Expense rejects Travel and Travel rejects Expense.

Every request uses the authenticated active identity. Publication uses the existing publisher
permission; decisions use the frozen eligible participants and active-user checks. A required,
exact applicant-scoped Idempotency-Key binds every normalized field, scenario/process ID and
process version. Identical retries return current durable state, including after approval or
rejection; different intent conflicts. In JDBC the key remains globally applicant-scoped
across configured processes. A business reference is not a uniqueness constraint.

## Schema 8 rollout and recovery

First deploy schema-8/Travel-capable readers everywhere that can read the affected JSON or
JDBC rows, stop incompatible writers, take normal backups, and only then enable Travel writes.
Opening snapshots 1–7 remains read-only and retains existing strict validation. The first
Travel mutation requires JSON snapshot schema 8. A Travel payload in schema 1–7 is rejected;
Quote still requires ≥6 and Expense ≥7. Later legacy, Expense or publication writes never
downgrade schema 8. Process definitions still use schema 2 or 3.

The first upgrade preserves the byte-exact file immediately before the upgrade in a private
`.schemaN.bak`, with a unique name if that backup exists. Atomic replacement failure publishes
neither a request nor its submission binding. Retries preserve the backup. Restoring it discards
later submissions, decisions and publications, so it is historical recovery, not a lossless
downgrade. Schema-7 application binaries cannot read Travel/schema-8 data.

SQL revision 3 is unchanged; Travel uses the existing strict `request_json` and member projection.
There is no automatic DDL, backfill or rollback migration. Existing SQL stopped-writer migration
requirements still apply. Database backups and a forward-compatible rollout are required.

## Verification and visual acceptance

Required release gates: fresh domain and JSON migration/restart tests; inherited H2/PostgreSQL/
MySQL contracts with the Travel tests explicitly executed; standalone authenticated HTTP tests;
full shared UI regression suite and build; real-backend bilingual desktop/narrow browser flows.
Expense's existing tests and screenshots are not evidence that Travel passed these gates.

Capture real catalog, filled form, designer, validation error, pending, next reviewer, approved
and rejected screens in Chinese and English with exact source SHA, viewport, capture-run and
image hashes. No mock screenshots or generated illustrations may stand in for real captures.
Review spacing, focus, keyboard use, legible errors, totals and dates, no horizontal clipping,
retained draft/retry recovery, and frozen data through approval. This candidate currently has
no accepted Travel screenshot gallery.
