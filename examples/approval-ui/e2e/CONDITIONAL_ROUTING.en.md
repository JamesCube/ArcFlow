# Conditional-routing acceptance

<!-- Legacy fragments remain entry points after the language split. -->
<a id="local-verification-status"></a>
<a id="scope"></a>

[简体中文](CONDITIONAL_ROUTING.md)

<!-- topic:scope -->
[conditional-routing.spec.mjs](conditional-routing.spec.mjs) exercises the scenario workspace against the real localhost backend, using disposable accounts and a temporary JSON store. It never uses real payments, signed contracts or external business systems. The coverage and gates below describe the current test contract; the historical checkpoint does not prove that the current commit passes.

<!-- topic:coverage -->
## Coverage and evidence gates

Payment, receiving and contract each run in English and Chinese, for six browser journeys. Each language uses separate business records. Titles and comments use ordinary business language; only business references carry a random isolation suffix. No real suppliers, customers or contracts are used.

- Payment: configure a numeric condition, switch review modes, undo/redo, publish, block a currency mismatch before submission, freeze a below-threshold route, preserve a pre-conditional request, clear/re-add the condition without downgrading schema 4, and approve low/high routes with actual ALL/ANY votes. The high route includes Bob's and Carol's individual reviews and the final stage; the low route needs one vote. Both languages verify that reviewers can view conditions but cannot edit them.
- Receiving: conditional warehouse/quality ALL review, each actor's vote, procurement review, approved and rejected exception requests, and a clean receipt that skips inspection and completes with one procurement vote.
- Contract: IN/ANY condition configuration is independent of the ALL voting rule; an empty IN selection blocks publication. A nonstandard contract completes commercial review, enters joint review, records a partial vote and reaches full approval. A standard contract skips the joint stage.

The [capture contract](../scripts/routing-capture-contract.mjs) requires 20 states:

- Payment, 7: condition configuration, low frozen, high joint-review entry, high partial vote, high final review, high complete, low complete.
- Receiving, 8: condition configuration, clean frozen, exception joint-review entry, exception partial vote, procurement review, exception approved, exception rejected, clean approved.
- Contract, 5: condition configuration, nonstandard joint-review entry, nonstandard partial vote, nonstandard approved, standard approved.

20 states × two languages × 1440px/390px widths = 80 original PNGs. Language and width variants are not additional business states. Both viewport variants for a language show the same saved state of the same request. Authenticated full-page captures start at the page origin `(0, 0)`, with 1440×1000 and 390×844 viewports. They must have no horizontal overflow and never show a password screen.

Each journey's `routing-receipt.json` records the exact launched backend SHA-256, synthetic request definitions/routes/history and every pictured business checkpoint. The [evidence verifier](../scripts/verify-routing-captures.mjs) requires:

- Six successful journey receipts and all 80 paired PNGs, checking original image SHA-256, complete PNG encoding, viewport, language and page origin.
- One clean commit, source tree, run ID/attempt, repository and backend archive identity across images and receipts. The backend SHA-256 must match the inspected runtime report for that commit, declaring Boot 4.1.1, Spring Framework 7 and Spring Security 7.
- Expected included/skipped routes and exact business facts, with one request continuing through each journey. Each checkpoint's actor/step/action sequence, comments, interim/final states and paired images' request IDs and decision counts must match the contract.
- Checkpoint history must be a prefix of final saved history. Terminal checkpoints must match the final status and complete history exactly. Skipped stages must never receive votes.

Authentication, HAR, tracing, videos and browser storage are not captured. Evidence is written to Git-ignored test output directories. PNG integrity and passing workflow assertions do not substitute for independent review of the downloaded original images or certify image authenticity. Old images and runs cannot establish acceptance of the current commit.

<!-- topic:history -->
## Historical local verification status

The following records only the 2026-10-09 [historical implementation checkpoint](../../../docs/CONDITIONAL_ROUTING.en.md#local-verification-checkpoint-2026-10-09), not acceptance of this merge or the current commit. At that checkpoint, the full frontend unit/DOM suite and production build passed. The real-backend HTTP journey passed for all three families, including exact `CNY 6500`/`CNY 10000`, boolean and enum facts; 1-vote skipped paths versus 3-vote included paths; schema-4 all-unconditional snapshots; legacy schema-3 snapshots; and lost-response retries pinned across publication. The command, run from `examples/approval-ui`, was:

```sh
node scripts/verify-routing-http.mjs ../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```

There was no local rendering or screenshot acceptance at that checkpoint. Installed Chromium failed during process-singleton startup with `socket() failed: Operation not permitted`; the supported cloud browser could not connect to isolated localhost. No security settings were weakened. Discovery then listed three journeys; the expanded current suite contains six English/Chinese journeys. Discovery and historical HTTP/DOM results do not replace current-commit browser execution, complete receipt validation and original-image review.

After building the backend and installing frontend dependencies and Playwright Chromium, run from `examples/approval-ui` on a permitted local/CI browser environment:

```sh
npm run test:e2e -- e2e/conditional-routing.spec.mjs --output=routing-visual-results
```

Exact-commit acceptance also requires the conditional-routing job in [Approval demo CI](../../../.github/workflows/approval-demo.yml): generate the runtime report and run the evidence verifier with the expected commit, run and backend identities. Running the browser command alone does not complete those gates. Report current-commit CI, independent visual review, remote publication and deployment separately.

No production readiness, cross-browser compatibility, 200% zoom, accessibility audit or arbitrary workflow engine support is claimed.
