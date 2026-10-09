# Procurement approval experience

<!-- Legacy fragments remain entry points after the language split. -->
<a id="入口与边界--entry-points-and-scope"></a>
<a id="只读快照与重试--saved-snapshots-and-retries"></a>
<a id="采购审批体验--procurement-approval-experience"></a>
<a id="金额与数量--exact-amounts-and-quantities"></a>
<a id="验证方法--verification-method"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](PROCUREMENT_UI.md) · [Documentation](README.en.md)

<!-- topic:entry-points-and-scope -->
## Entry points and scope

The standalone Vue workspace and the official RuoYi integration provide explicit leave /
procurement choices. Procurement uses `/api/documents` or `/arcflow/documents`, retaining the published flow, permissions, saved definition, per-step votes, and history; legacy leave submissions
retain their existing `/requests` endpoint and wire shape, without migrating existing requests. Lists can contain legacy leave, typed leave,
and typed procurement. Detail views use the saved business type and immutable document
snapshot, never infer leave from the compatibility `days` projection.

H5 remains a review-only client. Synthetic documents for its acceptance journey are created
through the backend test fixture; there is no mobile authoring endpoint or authoring form.

This is a local synthetic demonstration. Submitting or approving does not place a purchase
order, send information to a supplier, reserve funds, perform payment, convert currency, or
write back to another business system. A workflow approval is not proof that any of those
business operations occurred. The default demo still uses one configured `leave-approval`
process for both document types; hosts must define their own routing and eligibility policy.

<!-- topic:exact-amounts-and-quantities -->
## Exact amounts and quantities

- Quantity: integer 1–100,000.
- Unit price: positive decimal, at most 1,000,000,000; up to two decimal places.
- Currency: CNY, USD, EUR, GBP or JPY. JPY must use whole amounts.
- Business ID: 1–128 ASCII letters/digits and `._:/-`, beginning with a letter/digit.
- Item: nonblank, up to 240 characters; title and reason retain the backend limits.

Client form validation rejects zero, negative numbers, exponent notation, grouping separators,
excess precision and malformed amounts rather than rounding them or silently treating them
as zero. The backend remains authoritative. Amount calculations use exact decimal arithmetic;
no JavaScript floating-point multiplication is used for totals. Currency codes are shown
explicitly. JPY is formatted without minor units; the other supported currencies use two.
The maximum calculated total is 100,000,000,000,000.00, which must not be rounded through
unsafe integer cents. There is no tax, exchange-rate, freight or discount calculation.

<!-- topic:saved-snapshots-and-retries -->
## Saved snapshots and retries

Submitted business fields cannot be changed in the review view. Typed responses are checked
for the supported schema, exact fields, valid values and consistent compatibility projections.
Unsupported or malformed business documents fail closed instead of appearing as a zero-day
leave request. Approval permissions and audit remain the shared backend's responsibility.

Each desktop document type retains its own draft and one unresolved submission key in memory. A retry after a lost or
malformed acknowledgement uses the original endpoint, normalized business intent and frozen
process version. A matching durable replay returns the existing request. Switching document
types preserves both intents; returning to an unchanged form reuses its original key and
process snapshot. Editing a normalized payload invalidates only that form's intent. A successful
submission clears only its own form; signing out clears both drafts and keys. A page reload
loses the keys; refresh and inspect existing requests before resubmitting after reload. See
[the submission contract](SUBMISSION_IDEMPOTENCY.en.md).

<!-- topic:verification-method -->
## Verification method

The change adds exact-decimal, schema, mixed-document, bilingual and retry tests to both
Vue test suites, together with synthetic real-backend Chromium journeys for standalone,
native RuoYi and H5. The browser journeys include narrow Chinese/English layouts, read-only
procurement details, keyboard or repeated navigation, current-reviewer decisions and audit.
Screenshots are captured only after authentication and real backend operations. No auth
traces, videos, storage state or password screenshots are retained.

Run the repository's existing unit/build commands plus:

```bash
cd examples/approval-ui
npm run test:e2e -- --grep 'procurement:'
# Official RuoYi: follow its README and run tests/smoke.py, which invokes browser.py.
# H5: follow examples/approval-mobile/README.md and run npm run test:e2e.
```

See the exact commit's GitHub Actions checks and packaged verification manifest for results.
This document describes implemented coverage; it does not independently assert that any
particular commit's CI has passed. True-device App / mini-program testing and production
purchasing integration remain outside this change.
