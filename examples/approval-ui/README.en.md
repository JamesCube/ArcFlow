# Standalone approval UI

<!-- Legacy fragments remain entry points after the language split. -->
<a id="arcflow-approval-ui-prototype"></a>
<a id="automated-coverage"></a>
<a id="combined-verification-and-visual-boundary"></a>
<a id="contract-and-boundaries"></a>
<a id="erp-payment-request-and-crm-contract-approval"></a>
<a id="erp-receiving"></a>
<a id="expense-and-travel"></a>
<a id="focused-workbench"></a>
<a id="paginated-member-worklists"></a>
<a id="payment-and-contract-review-candidate--付款与合同审批候选"></a>
<a id="procurement-and-member-inbox-together"></a>
<a id="real-browser-first-run-check"></a>
<a id="restricted-conditional-routes--受限条件路径"></a>
<a id="run"></a>
<a id="seal-use-review"></a>
<a id="unified-typed-scenario-library"></a>
<a id="workspace-visual-redesign"></a>

[简体中文](README.md)


<!-- topic:scope -->
This Vue 3 and Vite client applies to the current source. It connects to the [standalone backend](../approval-demo/backend/README.en.md) and provides leave/procurement, quotes, a six-scenario catalog and a process designer. Keep it on localhost with synthetic data.

- `/`: leave and procurement; `/quote-discount.html`: quote discounts; `/scenarios.html`: six scenarios; `/receiving.html`: a dedicated receiving entry.
- The catalog is sorted by full ID: `crm-contract`, `erp-payment`, `erp-receiving`, `oa-expense`, `oa-seal-use`, `oa-travel`.
- Alice designs, publishes and submits; Bob and Carol review as assigned in saved stages. Fixed demo accounts are not a dynamic role, department or tenant integration.

<!-- topic:run -->
## Run and check

Start the backend using the [development setup](../../docs/development/QUICKSTART.en.md). Use a Node.js version supported by package.json (Node 22 recommended) and npm. From the repository root:

```sh
cd examples/approval-ui
npm ci
npm run dev
npm test
npm run build
```

Open `http://localhost:5173`. Vite proxies `/api` to backend port 8080; changing the URL also requires changing the backend's allowed UI Origin. Three demo passwords come from environment variables; none are built in. Credentials stay in memory, password inputs clear after login attempts, and sign-out clears session and request data. Reload requires signing in again.

The production build contains static files, not the development proxy. A real host needs a separately designed same-origin API, HTTPS, identity and session security; do not expose this demo directly.

<!-- topic:designer -->
## Design, publish and review

Definitions contain start, 1–8 ordered stages and end. Each stage uses SINGLE, ALL or ANY. The domain allows 2–16 fixed group members; this demo offers only Bob and Carol. Select a card to edit in one inspector, insert stages at connectors, and use up to 50 local undo/redo edits.

- ALL requires every approval and ends on any rejection. ANY advances on the first approval and rejects only when everyone rejects.
- A person assigned to several stages votes separately in each. Future stages cannot vote early, and completed groups never invent votes for remaining members.
- Publication checks expectedVersion. Conflicts preserve the draft for refresh and reapplication. Workspace Refresh keeps edits; reload or sign-out loses them. Successful publication clears undo history.
- Submitted requests retain immutable process, business and individual decision history. Administrators and UI hints cannot expand server permissions. An applicant appearing anywhere in the full definition cannot submit.
- Language switching changes interface copy only; entered data, process names and comments keep their original text. Mobile layouts switch between flow and settings. Escape returns focus to the selected card.

Eligible reviewers come from the saved definition and history. The compatibility `approverId` field does not represent full group membership.

<!-- topic:state -->
## Lists, drafts and uncertain responses

Needs my review and My decisions have separate server pages, cursors, filters and loading state. Handled requires an actual vote; the same request can return to pending in a later stage. Counts mean loaded rows, not a server total. Details use the visible-request list and shared snapshot cache; there is no single-request GET route.

Each business scope keeps its draft, original submission key and process version, designer undo state, and notes tied to their original stage. Navigation and language changes preserve them. A later publication cannot change an uncertain retry's version. Success clears only the originating form. Late replies update only their original scope. Sign-out, identity changes and unauthorized responses invalidate every scope; old list replies cannot undo a confirmed decision.

Mutations suppress repeated clicks. An ambiguous network failure never automatically creates another request; the original key and body remain in memory for manual retry. Reload, close and sign-out lose that key, so inspect saved records first. Failed recovery blocks further decisions. See [idempotency and recovery](../../docs/SUBMISSION_IDEMPOTENCY.en.md).

<!-- topic:scenarios -->
## Business forms and response boundaries

The client checks exact types, metadata and envelopes rather than accepting a permissive generic form. Shared numeric codecs inspect original JSON number tokens before JavaScript rounding.

| Business | Current boundary | Scenario response |
| --- | --- | --- |
| Leave/procurement | Independent drafts; integer quantities and decimal-text prices; `3 × USD 0.10 = USD 0.30` | Direct generic request |
| Quote discount | Separate page, process and business validation | See the [quote contract](../../docs/CRM_QUOTE_CASE.en.md) |
| Expense/travel | Itemized expenses or destination, dates, purpose and budget; travel's 1–90 days is derived display | `{request,total}`, decimal-string total |
| Seal use | Seven form fields, 1–100 copies, inert document reference | `{request,total:null}` |
| Receiving | 1–20 lines, separate PCS/BOX totals; received ≤ ordered, accepted + rejected = received; rejection needs a reason | `{request,total:null,summary}` |
| Payment | Invoice, prior settlement, allocation, deduction and four exact totals; net must be positive | `{request,total,paymentSummary}`, net total |
| Contract | Amount equals 1–20 milestones; dates stay within term and nondecreasing; nonstandard terms need explanation | `{request,total}`, contract amount |

Invalid raw numeric input remains editable; it is never truncated or silently coerced. Business references are not cross-request uniqueness constraints. Receiving does not allocate quantities across receipts; payment does not reserve invoice balances. Submitted documents are read-only. The [API reference](../../docs/api/API_REFERENCE.en.md) and [capability catalog](../../docs/CAPABILITIES.en.md) own detailed fields, limits and examples.

These flows produce internal review results only. They never pay, post stock, apply seals, sign contracts, book travel or write to an external ERP/CRM.

<!-- topic:routing -->
## Restricted conditional routes

Only payment, receiving and contract expose When this step runs. Conditions are independent of group ALL/ANY voting:

- Payment net total: EQ/GT/GTE/LT/LTE in CNY, USD, EUR, GBP or JPY; thresholds 0–20,000,000,000, at most two decimals and whole JPY; one currency per process.
- Receiving: whether any line has rejected goods, matching true or false.
- Contract: STANDARD/NONSTANDARD with EQ or IN.

A process permits at most eight flat predicates and needs an unconditional approval stage. No nesting or start/end conditions. Payment currency mismatch blocks submission; it never converts currency or silently skips a stage. Clearing every condition retains schema 4. Schema-2/3 wire shapes remain unchanged.

Preview uses the published or retry-pinned process. The server independently evaluates and freezes selected stages and evidence at submission; the client recomputes and rejects forged results. Excluded stages explicitly show a failed condition, never approval. Later publication cannot alter the saved route. See [conditional routing](../../docs/CONDITIONAL_ROUTING.en.md).

<!-- topic:verify -->
## Verify rendering and real HTTP

Build the backend before running browser journeys:

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml package
cd examples/approval-ui
npm ci
npx playwright install chromium
npm run test:e2e
```

Linux may need Playwright's system dependencies. Tests refuse to reuse servers on ports 8080/5173 and generate temporary stores and passwords. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for an existing Chromium. Do not run suites competing for the same ports.

From the UI directory, these installed-client HTTP checks each start and stop an isolated backend:

```sh
node scripts/verify-inbox-http.mjs ../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
node scripts/verify-receiving-http.mjs ../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
node scripts/verify-complex-http.mjs ../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
node scripts/verify-routing-http.mjs ../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```

Capture only authenticated synthetic workspaces, never password screens, HARs, authentication traces or session files. Retain exact source/backend identity, run ID and hashes. Compatibility-runtime checks cannot stand in for the declared runtime. Discovery, unit tests, builds and older screenshots do not prove current browser acceptance.

Use the commands and evidence rules for [general visual scenarios](e2e/VISUAL_SCENARIOS.en.md), [receiving](e2e/RECEIVING_SCENARIOS.en.md), [payment/contracts](e2e/COMPLEX_SCENARIOS.en.md) and [conditional routing](e2e/CONDITIONAL_ROUTING.en.md). Cross-browser, physical-device, 200% zoom and formal accessibility acceptance remain separate work.
