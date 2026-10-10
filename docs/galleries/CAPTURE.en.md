# Reproduce and verify the five galleries

[简体中文](CAPTURE.md) · [English](CAPTURE.en.md) · [Gallery index](README.en.md)

<!-- topic:historical-capture-identity -->
## Historical capture identity

- Exact application commit: [`8c26d953e53991d3e445aa69c530726f1d81daae`](https://github.com/JamesCube/ArcFlow/commit/8c26d953e53991d3e445aa69c530726f1d81daae)
- Git tree: `45de9943bc651bef4e377d5b9c1ef38f52670619`
- [Approval demo CI run 37918452685](https://github.com/JamesCube/ArcFlow/actions/runs/37918452685), push event, attempt 1, completed successfully. This is the historical capture run, not CI for the gallery documentation commit.
- Capture timestamps: 2026-10-09 10:37:30.430–10:39:28.741 UTC.
- 104 unchanged original PNG files, 23,292,297 bytes: 82 desktop and 22 narrow captures; 92 full-page and 12 viewport captures; 53 English and 51 Chinese UI images. Locale/viewport variants are not additional business cases.
- [Per-image provenance](../images/scenarios/provenance.json) preserves each original sidecar, artifact ID/name/path and recorded archive digest, image SHA-256 and dimensions. Original artifact archive digests are retained provenance; this documentation work rechecks PNG bytes and sidecars, not unavailable original archive ZIPs.

The relevant application trees are identical between capture commit `8c26d95` and documentation baseline [`199db7548f6faba5dfef105eaaf7311972adb388`](https://github.com/JamesCube/ArcFlow/commit/199db7548f6faba5dfef105eaaf7311972adb388): core `src`, approval UI (including its capture fixtures), domain `src` and standalone backend `src`. Exact Git tree objects are recorded in the manifest. Documentation, website and CI changes do not turn these historical images into fresh captures of a later head.

The travel and seal-use catalog captures share two byte-identical locale pairs: 104 source files, 102 unique PNG byte sequences. The manifest declares these duplicate groups explicitly; they are the same shared catalog state.

<!-- topic:real-application-and-evidence-boundaries -->
## Real application, bounded evidence

The fixtures drive the real standalone Spring Boot backend and Chromium UI with disposable authenticated accounts and synthetic data. No generated UI, rewritten success screen or retouched/cropped PNG is included. Lost-response tests drop delivery only after the backend really saves; a saved response is not fabricated. No login screenshots, passwords, HAR, videos or saved authentication state are published.

Desktop viewport: 1440×1000. Narrow viewport: 390×844. A full-page PNG can be much taller than its browser viewport. Travel/seal/payment/contract narrow reviewer or summary images are viewport captures; receiving and conditional-routing narrow images are full-page captures. They are responsive standalone pages, not the separate H5 client, RuoYi or physical-device tests.

Receiving and routing do not provide every state in both languages and widths. The galleries show the available originals with honest labels. Receiving routing images are still PENDING. Payment “high” routing means CNY 10,000 exactly, meeting the GTE CNY 10,000 threshold; “low” is CNY 6,500. Contract condition matching ANY with `IN {NONSTANDARD}` is distinct from ALL member voting. Partial ALL approval and partial ANY rejection are nonterminal states. Approved and rejected examples can be separate requests or process versions; the pages do not splice them into one transaction.

No currency-error screenshot exists in this set. Browser assertions exercise that error, but an assertion is not a screenshot. These images do not establish database compatibility, authorization, idempotency, accessibility certification, cross-browser/physical-device support, external effects or production readiness. Historical local Chromium startup was blocked by an IPC socket restriction; the originals came from the successful GitHub Actions run above. This change does not claim a fresh local application-browser pass.

<!-- topic:capture-from-an-isolated-checkout -->
## Capture from an isolated checkout

Follow the [development prerequisites](../development/QUICKSTART.en.md#en), including a full JDK and supported Node version. Use a disposable checkout of the capture SHA to reproduce that historical version. The Playwright configuration creates temporary stores and credentials and starts its own backend/UI; never point it at real data or a shared service. Install Chromium and Noto CJK fonts in an environment that permits browser execution.

```bash
git checkout 8c26d953e53991d3e445aa69c530726f1d81daae
mvn --batch-mode --no-transfer-progress install
mvn --batch-mode --no-transfer-progress -f examples/approval-domain/pom.xml install
mvn --batch-mode --no-transfer-progress -f examples/approval-demo/backend/pom.xml package
cd examples/approval-ui
npm ci
npx playwright install --with-deps chromium
ARCFLOW_SOURCE_REVISION="$(git rev-parse HEAD)" ARCFLOW_CAPTURE_TRAVEL_SCENARIOS=1 npm run test:e2e -- e2e/travel-scenarios.spec.mjs --output=gallery-results/travel
ARCFLOW_SOURCE_REVISION="$(git rev-parse HEAD)" ARCFLOW_CAPTURE_SCENARIOS=1 npm run test:e2e -- e2e/seal-use.spec.mjs --output=gallery-results/seal
ARCFLOW_CAPTURE_RECEIVING=1 npm run test:e2e -- e2e/receiving.spec.mjs --output=gallery-results/receiving
ARCFLOW_CAPTURE_COMPLEX_SCENARIOS=1 npm run test:e2e -- e2e/complex-scenarios.spec.mjs --output=gallery-results/complex
npm run test:e2e -- e2e/conditional-routing.spec.mjs --output=gallery-results/routing
```

Run these commands serially. Preserve new sidecars, exact commit, workflow/run identity, viewport, state and SHA-256; do not relabel local results as the old CI run. Dates, request IDs and other incidental data can differ. Reproducing behavior is not byte-identical image reproduction. For current-source testing, use a separate current checkout and label those results with its actual head.

<!-- topic:check-this-documentation-checkout -->
## Check this documentation checkout

Run these from a checkout containing the gallery documentation, not from the historical capture SHA:

```bash
python3 -m unittest discover -s scripts -p 'test_scenario_galleries.py' -v
python3 scripts/verify_scenario_galleries.py
python3 scripts/verify_developer_docs.py
python3 website/scripts/build.py
python3 website/scripts/check.py
```

The gallery verifier checks all PNG bytes/dimensions against provenance, source/run/state/locale/viewport consistency, complete five-case inventories, local links and original-image coverage. Its mutation tests must fail on tampering and inconsistent evidence. It is an offline documentation integrity check, not an application acceptance test. The added Gallery documentation CI job performs only these non-deploying checks. Existing application and website workflows verify the exact PR head separately; merging or deploying is outside this gallery change.
