# Payment requests and contract approvals

<!-- Legacy fragments remain entry points after the language split. -->
<a id="crm-合同审批--contract-approval"></a>
<a id="current-main-scope--当前主线范围"></a>
<a id="erp-payment-requests-and-crm-contract-approvals"></a>
<a id="erp-付款申请--payment-request-review"></a>
<a id="historical-implementation-checkpoint--历史实现检查点"></a>
<a id="nine-type-json-compatibility-and-jdbc"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](PAYMENT_CONTRACT_SCENARIOS.md) · [Documentation](README.en.md)

<!-- topic:current-scope -->
## Current scope

Current main includes both dedicated scenarios in the six-entry standalone catalog. They remain synthetic internal reviews, without payment, signing or external writeback. Readers support wrappers 1–13; the wrapper-12 limits and local/unmerged status in the original checkpoint below describe that historical candidate, before conditional routing. Use the current migration guide for rollout and check exact-commit CI separately.

[Current architecture](development/ARCHITECTURE.en.md) · [Current migration guide](development/PERSISTENCE.en.md)

<!-- topic:historical-implementation-checkpoint -->
## Historical implementation checkpoint

This extension adds two independent, synthetic business scenarios on top of the unified
Travel / Seal-use / Receiving candidate. It is an unmerged candidate, not a deployment
or production financial/legal integration. Both are available in `/scenarios.html` and
use the existing authenticated demo identities and publication permission.

<!-- topic:payment-request-review -->
## Payment request review

`erp-payment` accepts only `paymentRequest`, `documentVersion: 1`.
It owns `approval.data-file + ".scenario-erp-payment.json"` and
`/api/scenarios/erp-payment`. No request parameter selects a filesystem path.

The form records a supplier reference, requested payment date, currency and 1–20
invoice allocations. Every invoice is an explicitly synthetic declaration, not a
verified invoice or ERP payable balance. No bank information is collected.

Each line records:

- Unique line ID and invoice reference, plus a description
- Declared invoice amount and previously settled amount
- Allocation for this request and the deduction applied within that allocation
- An explanation whenever the deduction is positive

Amounts are exact decimals, bounded to 1,000,000,000 per input. Invoice and allocation
amounts must be positive. Settled and deducted amounts may be zero. Settled cannot
exceed the invoice; allocation cannot exceed invoice minus settled; deduction cannot
exceed allocation. At least one line must retain a positive net request. All lines use
the header currency: CNY, USD, EUR, GBP or JPY. At most two decimals are accepted;
JPY must be a whole amount. Dates must be real dates in years 0001–9999.

The server derives four amounts from the frozen document:

| Value | Calculation |
| --- | --- |
| `declaredOutstanding` | Sum of invoice minus previously settled |
| `grossAllocation` | Sum of allocation for this request |
| `deductionTotal` | Sum of deductions |
| `netTotal` | Allocation minus deductions |

The response is exactly `{request,total,paymentSummary}`; `total` means net requested
amount. `paymentSummary` contains `type:"paymentRequest"` and the four exact decimal
strings above. Derived totals are not accepted as submission fields. Other scenario
responses do not gain this member.

The sample has invoice amounts 10,000 and 4,000; settled amounts 4,000 and 0;
allocations 4,500 and 2,500; and deductions 500 and 0. The result is 10,000 declared
outstanding, 7,000 allocated, 500 deducted, and **6,500 net requested**. This does not
reserve any balance. Another request with a different key may reference the same invoice.

The actual default process is:

1. `payment-check`: ALL of Bob and Carol must approve
2. `payment-final`: ANY of Bob and Carol may approve

A first approval at ALL leaves the other participant pending. Both receive a fresh
vote at the second stage. At ANY, one rejection is not a veto: the request remains
pending for the other participant; one approval completes it, while all rejections
reject it. An ALL rejection is immediately terminal. Only actual decisions appear in
history or handled membership. Bob and Carol are the same two demo people across the
steps, not four independent organizational roles.

Approval means only that the payment request passed review. It does not pay, query or verify invoices, reserve balances, create vouchers, or update ERP. The requested date is not an automatic payment schedule, and declared amounts provide no cross-request double-payment or balance-lock guarantee.

<!-- topic:contract-approval -->
## Contract approval

`crm-contract` accepts only `contractApproval`, `documentVersion: 1`.
It owns `approval.data-file + ".scenario-crm-contract.json"` and
`/api/scenarios/crm-contract`. It does not inherit the quote host's separate source
ownership checks. Customer and document references and the positive declared contract
revision are synthetic inputs, not trusted CRM source records.

The form has a dedicated contract draft panel, terms review and payment milestones.
Header fields are customer reference, declared revision (1–2,147,483,647),
PRODUCT/SERVICE category, currency, contract amount, start/end dates, STANDARD or
NONSTANDARD terms, deviation explanation, document reference and ordinary review notes.

Every one of 1–20 milestone lines has a unique line ID and milestone reference,
description, due date, positive exact amount and explicit delivery/acceptance criteria.
The sum must equal the contract amount exactly; a one-cent difference fails.
Milestone dates must be inside the inclusive contract term and nondecreasing in display
order. Multiple distinct milestones may share a date. Amount/currency/date rules match
payment requests. The contract amount itself is capped at 1,000,000,000.

NONSTANDARD requires a deviation explanation. STANDARD must leave that field empty;
ordinary comments remain available in `reason`. The interface explains this distinction
and does not silently erase a draft explanation when the terms kind changes. In this historical candidate the flag was for human review and did not choose stages. Current dedicated contract scenarios may explicitly configure [restricted conditions](CONDITIONAL_ROUTING.en.md).

The sample CNY 100,000 service contract has 30,000 / 40,000 / 30,000 milestones and
specific acceptance criteria. The response remains exactly `{request,total}` with an
exact contract amount string. The draft UI separately computes milestone sum and
unallocated balance for the current form. These are not client-authoritative inputs.

The actual default process is:

1. `commercial-review`: Bob approves the commercial draft
2. `contract-review`: ALL of Bob and Carol review the contract

Bob must make a second independent decision at the joint step. His earlier commercial
approval cannot satisfy it. Carol can reject at ALL. The designer can publish a later
version with an additional ANY final step; old requests retain their original two-step
snapshot. A contract revision number is not a source uniqueness lock: a new idempotency
key can create a new review intent for the same declared revision.

Approval means only internal contract review. It does not sign, stamp, send to customers, activate contracts, create receivables, change opportunities, or trigger payments. References do not download documents or verify signatures. This example provides neither legal advice nor certification of legal validity.

<!-- topic:shared-strictness-immutability-and-retries -->
## Shared strictness, immutability and retries

- Both routes require exactly one `Idempotency-Key`, bound to the authenticated applicant.
- The entire normalized business document, line order, process ID and original process
  version bind retry intent. Changed intent conflicts with HTTP 409; identical intent
  returns the same current request after partial votes, terminal decisions and restart.
- Contract line reordering is accepted only if it still respects chronological validation;
  any valid changed order still represents a different intent. Invalid reordered dates
  are rejected as invalid input before idempotency comparison.
- References are ASCII identifiers of 1–128 characters. Title is limited to 120 UTF-16
  units; general reason and deviation explanation to 2,000; line description to 240;
  deduction explanation and acceptance criteria to 1,000. Raw limits apply before
  existing C0 edge trimming. Unicode-only blank required text is rejected.
- Missing/unknown fields, derived submission values, duplicate JSON keys, string-valued
  numeric amounts, floating/string revisions and unsupported document versions fail closed.
- Submission freezes all business data and the complete process definition. Forms and
  subsequent publication cannot mutate an existing request. New revision intent needs a
  new request; rejection does not edit or silently resubmit a contract.
- Six compiled scenario hosts keep exact class/process boundaries. Generic leave and
  procurement routes still reject these types. The browser also validates exact response
  envelopes and current actor/scenario scope before accepting asynchronous results.
- This historical extension added no arbitrary schema, arbitrary expression, conditional route, dynamic organizational
  role, source balance reservation, payment or signing capability.

<!-- topic:historical-nine-type-json-and-jdbc-compatibility -->
## Historical nine-type JSON and JDBC compatibility

At this checkpoint the unified registry supported nine exact types and wrappers 1–12; the current ceiling is 13:

| Type | Minimum snapshot wrapper |
| --- | --- |
| leave / procurement | 5 |
| quoteDiscount | 6 |
| expense | 7 |
| travel | 8 |
| sealUse | 9 |
| receiving | 10 |
| paymentRequest | 11 |
| contractApproval | 12 |

The writer remains the maximum of the existing wrapper, definition requirements,
idempotency requirements and all persisted document minimums. Reading does not rewrite
or upgrade a valid file. A higher compatible wrapper may contain only older types.
That historical reader rejected wrapper 13+, unknown types, incorrect minimum wrappers, and invalid payloads. See the migration guide for the current future-wrapper boundary.

Each actual upgrade retains the exact immediately preceding bytes. Existing backups
are preserved on name collision; failed atomic replacement does not publish a request,
key or in-memory success. A backup is historical recovery, not a lossless downgrade.
Deploy compatible readers/writers together and stop incompatible writers before use.
PR39's schema-10 reader cannot read these new wrappers, even if all other files are
unchanged. Do not restore an older backup over new writes to pretend compatibility.

JDBC retains SQL revision 3 and existing ready member projection. No new DDL, index
rebuild, cross-scenario key namespace or process-isolation bypass is introduced. JDBC
idempotency keys remain globally applicant-scoped across processes. A new payload still
requires compatible readers, regardless of unchanged SQL revision.

<!-- topic:verification-and-screenshots -->
## Verification and screenshots

Domain tests include all 120 write orders of the five new types (Travel through Contract),
read-only wrapper 1–12 compatibility, nine minimum-version boundaries, immediate backup
failures, strict input, exact amounts and real lifecycle/version snapshots. Host and
JDBC tests exercise actual APIs, independent stores, concurrent retries, rollback and
member projection. CI separately requires declared Spring Boot 4.1.1 HTTP/browser runs,
H2 and real PostgreSQL/MySQL matrix cases with no skips.

The new browser suite records bilingual desktop and 390px states with authenticated
synthetic data, actual source revision, clean/dirty source status, backend JAR hash,
runtime label, workflow identity and image hashes. A capture is not independent visual
acceptance. Runtime compatibility-harness output must remain labeled supplementary.
Existing candidate artifact downloads previously returned 403/1010; those restrictions
are not bypassed and old original-pixel acceptance is not implied by these new captures.

Final counts, exact candidate head, and remaining gates were recorded with the original draft. This page does not authorize merging, enabling auto-merge, or deployment; check acceptance for the revision you intend to use.
