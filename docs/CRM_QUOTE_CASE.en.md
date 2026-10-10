# Quote discount approval

<!-- Legacy fragments remain entry points after the language split. -->
<a id="单据与-http-契约"></a>
<a id="可以运行的边界"></a>
<a id="存储格式与升级门槛"></a>
<a id="报价折扣审批--quote-discount-approval"></a>
<a id="报价版本绑定与原幂等契约"></a>
<a id="本地启动"></a>
<a id="金额时间与来源校验"></a>
<a id="验收与下一步--verification-and-next-steps"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](CRM_QUOTE_CASE.md) · [Documentation](README.en.md)

This guide describes the **isolated synthetic CRM quote case**, integration, and acceptance boundaries. [PR #20](https://github.com/JamesCube/ArcFlow/pull/20) merged as `66ec531270a513f884125065f19fe4e78762992f`; see the [exact acceptance checkpoint](CRM_COMPATIBILITY_READINESS.en.md#accepted-crm-checkpoint). The historical procurement/member-inbox base was `caece22fb52e645f303c6adec73f19a027d38e66`, tree `1d3332659bc59f3c70f2ffb5954aed6aa383f522`. This page does not substitute for a current branch/PR’s merge, deployment, or acceptance status.

Domain, HTTP, JSON/JDBC restoration, model/DOM, real-browser, and PostgreSQL/MySQL contracts are present. Test definitions are not passing evidence: check actual reports, non-skipped database cases, and bilingual captures for the target commit. Native RuoYi CRM and shared three-client quote lists are not implemented. [Release gates](CRM_COMPATIBILITY_READINESS.en.md)

<!-- topic:runnable-scope -->
## Runnable scope

- Dedicated `/api/crm` and bilingual `/quote-discount.html`.
- Synthetic customer `CUSTOMER-DEMO-A` and `Q-DEMO-001`, revision 1.
- Ten equipment sets: CNY 1,000.00 list / CNY 850.00 requested unit price; CNY 8,500.00 requested total, CNY 1,500.00 reduction, 15%. Sample expiry is fixed at 2099-12-31; host calendar is UTC.
- Alice owns the quote, Bob is the preset sales manager, Carol finance. All discounts follow Bob → Carol, independent of amount/rate; these are fixed demo identities, not organizational role resolution.
- Separate `quote-discount` process and `approval.data-file + ".quotes.json"`; legacy leave/procurement, default `/api/process`, and member inboxes do not merge or change process.
- Narrow screens read/review only; author on desktop. The existing H5 app has no CRM integration.
- No real CRM/customer account, model provider, payment, or inventory API; no customer notification, signing, opportunity closing, or writeback. APPROVED means only that this immutable snapshot passed human review.

This adds an explicit type and host boundary, not a condition gateway or external connector. It uses no third-party credentials, customer records, or external LLM calls.

<!-- topic:start-locally -->
## Start locally

Run at the repository root; [requirements](TRYOUT.en.md#requirements) list Java, Maven, and Node:

```sh
python3 scripts/tryout.py
```

After READY open the printed quote URL, by default `http://127.0.0.1:5173/quote-discount.html`. Read this run’s Alice/Bob/Carol passwords from the private file, never a URL or screenshot. Ctrl-C stops services and removes disposable leave/procurement/quote data. To retain data, follow the [two-terminal manual setup](GETTING_STARTED.en.md), including passwords and `npm ci`; its default is `http://localhost:5173/quote-discount.html`. Keep each setup’s configured hostname/ports. [Sample values and role changes](GETTING_STARTED.en.md#try-other-cases-en)

Credentials stay in page memory, clear on logout, and never enter localStorage, sessionStorage, or URLs. The quote page signs in independently from the main workspace but uses the same backend demo accounts. Alice submits, Bob reviews, then Carol. The list shows saved quote revision, amounts, current step, and original reason.

Unsaved review comments remain in the current signed-in page across language changes, same-step refreshes, and failures. Confirmed save, step/version changes, logout, and navigation clear the corresponding draft. Comments never carry across actors or requests.

The page has its own URL, outside shared navigation and procurement/member workspaces. Static builds must keep `dist/quote-discount.html` and `dist/crm-quote/`, proxy `/api` to the backend, and retain Origin and non-simple client-header checks.

<!-- topic:document-and-http-contract -->
## Document and HTTP contract

`BusinessDocument.QuoteDiscount` has wire type `quoteDiscount`; all fields are required:

```json
{
  "business": {
    "type": "quoteDiscount",
    "businessId": "Q-DEMO-001",
    "title": "设备报价折扣申请",
    "reason": "十套设备的合成报价，申请单价为 CNY 850.00。",
    "customerRef": "CUSTOMER-DEMO-A",
    "quoteRevision": 1,
    "item": "设备套装 / Equipment set",
    "quantity": 10,
    "listUnitPrice": 1000.00,
    "requestedUnitPrice": 850.00,
    "currency": "CNY",
    "validUntil": "2099-12-31"
  },
  "processVersion": 1
}
```

Submit to `POST /api/crm/documents`. Identity comes only from authentication; applicantId, approverId, and processId are not client inputs. `GET /api/crm/quotes` returns currently readable sources, `GET /api/crm/process` the fixed process, and `GET /api/crm/requests` visible snapshots/derived display amounts. Decisions use `POST /api/crm/requests/{id}/decisions` with stepId, decision, and comment.

`QuoteDiscountCase.View` preserves `ApprovalService.Request` under `request`; `listTotal/requestedTotal/reductionTotal/discountPercent` are exact decimal display strings. `thresholdReached` is only a 10% check hint, while `expired`/`quoteUpdated` are not approval states. `Request.days` is 0; consumers must branch on `business.type`, never display zero-day leave.

Generic `POST /api/documents` and RuoYi `POST /arcflow/documents` reject quotes to preserve customer access, owner, and revision checks. Production hosts must implement that boundary rather than open generic routes. Native RuoYi’s four permissions and envelopes remain unchanged; no native CRM adapter is supplied.

<!-- topic:money-dates-and-source-validation -->
## Money, dates and source validation

- Common businessId/title/reason, item, quantity, currency, two-decimal and JPY limits reuse procurement rules.
- customerRef ≤128 characters; quoteRevision integer 1–2,147,483,647.
- Both prices >0 and ≤1,000,000,000; requested price strictly below list.
- Java BigDecimal and browser BigInt minor units preserve 0.10×3=0.30 and maximum legal totals.
- Server derives totals/reduction. Derived input, unknown fields, duplicate keys, numeric strings, fractional integer fields, unknown types, and invalid dates are rejected.
- Display percentage has up to four decimals; threshold checks use exact cross-multiplication, never rounded percentages.
- validUntil is a real YYYY-MM-DD and cannot precede current UTC date on new submission. Expired historical snapshots remain restorable/readable/reviewable; expiry does not automatically reject.
- The host loads authoritative businessId+quoteRevision and checks customerRef, list price, item, quantity, currency, and expiry. Every fixed reviewer must have read access to that revision.

`QuoteSource` is a host contract: historical revisions and sales ownership are immutable; read access is current on every query. Real systems with concurrent revisions need source transactions or consistency tokens for reading/binding. The example does not provide a cross-system transaction; customer/attachment/field permissions remain host responsibilities.

<!-- topic:revision-binding-and-idempotency -->
## Revision binding and idempotency

The host encodes quote ID/revision as a deterministic SHA-256 key saved atomically with the request by the existing store. Same revision/intent returns current state; changed price, reason, title, or process version returns 409. Reload does not lose this binding. Only a new quote revision creates a new review; retrying a rejected revision returns that rejected request.

The endpoint **rejects custom Idempotency-Key with 400**, avoiding two competing key scopes. Generic `ApprovalService.submitDocument(actor, document, processVersion, key)` still has optional arbitrary-key semantics. Changed quote fields and cross leave/procurement/quote conflicts are tested; businessId does not become globally unique for all documents.

The host has one fixed process, not a process registry. When stores share JDBC, global `(applicant_id, submission_key)` still applies across processes and collisions return 409. Leave routes cannot read/decide quote requests. Completing review never writes to source quotes. A changed current source revision displays an update warning and asks for resubmission; old approval does not authorize the new revision.

<!-- topic:storage-and-upgrade-requirements -->
## Storage and upgrade requirements

- JSON 1–5 remain strict/readable; the first quote write requires wrapper 6.
- Quotes inside 5 fail; 6 never downgrades after leave/procurement writes.
- The first 5→6 upgrade preserves complete immediately preceding schema-5 bytes, including a same-process earlier decision. Failed atomic writes expose no in-memory state; earlier backup behavior remains.
- Quote definitions stay 2/3, JDBC stays member-inbox SQL revision 3, with no new SQL migration. New data uses request_json; existing revision-3 member backfill must be ready.
- **Schema-5-only readers, including the old merged procurement/member baseline, cannot read quotes/6.** Upgrade every reader and stop incompatible writers before enabling quotes. Mixed rolling writes, automatic SQL migration, and downgrade are not provided.
- Backups support controlled recovery; restoring an old file loses later submissions/votes and is not lossless downgrade.

<!-- topic:verification-and-next-steps -->
## Verification and next steps

Earlier local evidence applies only to its delivered source. `examples/crm-quote/http_smoke.py` launches the packaged real Boot host with random temporary passwords, checking quotes, two-step review, tamper rejection, process isolation, and restart.

```sh
mvn -f examples/approval-domain/pom.xml test
mvn -f examples/approval-demo/backend/pom.xml verify
mvn -f examples/approval-jdbc/pom.xml test
node --test examples/approval-ui/tests/crm-quote/*.test.mjs
python3 examples/crm-quote/http_smoke.py --inbox --jar examples/approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```

Without real database configuration, Maven skips PostgreSQL/MySQL; do not call that a server pass. DOM tests are not browser acceptance. `--inbox` verifies real HTTP process isolation, not a simulated browser. [Accepted exact-commit results](CRM_COMPATIBILITY_READINESS.en.md#accepted-crm-checkpoint) include desktop/390px bilingual captures, real databases, and remote CI. Later changes need fresh evidence; a generic RuoYi build does not establish a CRM page.

1. Rerun affected domain/MVC/JDBC/client build and live HTTP checks for each new CRM commit.
2. For page/storage changes retain corresponding PostgreSQL/MySQL contracts, bilingual browser flows/captures, and explicit failed/skipped stages.
3. Independently review the delta and exact-head CI before a new release; merge is not deployment or production acceptance.
4. Shared workspace support remains unimplemented. Extend standalone/RuoYi/H5 parsing, exact money, business authorization, and read-only details together, then accept separately. H5 remains review-only.

The dedicated page is the only quote UI in scope; approval never sends a quote, charges payment, notifies a customer, or writes to CRM.
