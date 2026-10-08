# 采购审批体验 / Procurement approval experience

## 入口与边界 / Entry points and scope

独立 Vue 工作区和原生若依工作区均可在请假与采购之间切换。采购表单提交到
`/api/documents` 或 `/arcflow/documents`，沿用已经发布的审批流程、权限、流程快照、
逐步骤表决与操作记录。原请假表单继续使用旧 `/requests` 入口，不迁移已有申请。

The standalone Vue workspace and the official RuoYi integration provide explicit leave /
procurement choices. Procurement uses the typed document endpoint; legacy leave submissions
retain their existing endpoint and wire shape. Lists can contain legacy leave, typed leave,
and typed procurement. Detail views use the saved business type and immutable document
snapshot, never infer leave from the compatibility `days` projection.

H5 是待办、详情、审批意见和历史客户端，只能查看并审批已有单据；本轮不提供移动端新建采购。

H5 remains a review-only client. Synthetic documents for its acceptance journey are created
through the backend test fixture; there is no mobile authoring endpoint or authoring form.

This is a local synthetic demonstration. Submitting or approving does not place a purchase
order, send information to a supplier, reserve funds, perform payment, convert currency, or
write back to another business system. A workflow approval is not proof that any of those
business operations occurred. The default demo still uses one configured `leave-approval`
process for both document types; hosts must define their own routing and eligibility policy.

## 金额与数量 / Exact amounts and quantities

- 数量 / quantity: integer 1–100,000.
- 单价 / unit price: positive decimal, at most 1,000,000,000; up to two decimal places.
- 币种 / currency: CNY, USD, EUR, GBP or JPY. JPY must use whole amounts.
- 单据编号 / business ID: 1–128 ASCII letters/digits and `._:/-`, beginning with a letter/digit.
- 品名 / item: nonblank, up to 240 characters; title and reason retain the backend limits.

Client form validation rejects zero, negative numbers, exponent notation, grouping separators,
excess precision and malformed amounts rather than rounding them or silently treating them
as zero. The backend remains authoritative. Amount calculations use exact decimal arithmetic;
no JavaScript floating-point multiplication is used for totals. Currency codes are shown
explicitly. JPY is formatted without minor units; the other supported currencies use two.
The maximum calculated total is 100,000,000,000,000.00, which must not be rounded through
unsafe integer cents. There is no tax, exchange-rate, freight or discount calculation.

## 只读快照与重试 / Saved snapshots and retries

Submitted business fields cannot be changed in the review view. Typed responses are checked
for the supported schema, exact fields, valid values and consistent compatibility projections.
Unsupported or malformed business documents fail closed instead of appearing as a zero-day
leave request. Approval permissions and audit remain the shared backend's responsibility.

Each desktop form retains one unresolved submission key in memory. A retry after a lost or
malformed acknowledgement uses the original endpoint, normalized business intent and frozen
process version. A matching durable replay returns the existing request. Editing the intent,
changing business type or signing out invalidates the previous client intent. A page reload
loses the key; refresh and inspect existing requests before resubmitting after reload. See
[the submission contract](SUBMISSION_IDEMPOTENCY.md).

## 验证方法 / Verification method

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
