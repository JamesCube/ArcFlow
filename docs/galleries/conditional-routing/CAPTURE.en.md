# Conditional gallery: provenance, comparison and reproduction

[简体中文](CAPTURE.md) · [Gallery](README.en.md) · [Documentation](../../README.en.md)

<!-- topic:historical-identity -->
## Historical identity

- Capture commit: [`cb3f1077fc725e0031620b1210a819917d8684a4`](https://github.com/JamesCube/ArcFlow/commit/cb3f1077fc725e0031620b1210a819917d8684a4), tree `9572d7e400261f7e49760b77edf7c1b86b7d955f`.
- [GitHub Actions run 38016643460](https://github.com/JamesCube/ArcFlow/actions/runs/38016643460), attempt 1. Its historical conditional-routing job succeeded, with six passing browser journeys. It is not CI for this documentation commit.
- Artifact `conditional-routing-browser-evidence`, ID `11655974545`; original ZIP SHA-256: `c733d1de07bedf1488252cff418264a748cb0e6053a75d09a799e655dece52c0`. This publication rechecked that ZIP and every original member.
- 80 PNGs, 80 original sidecars, six original journey receipts and one original runtime report: 167 unchanged originals. Payment has 28 images, receiving 32 and contract 20.
- The 20 capture states comprise three designer states and 17 request checkpoints, each in Chinese/English × desktop/390px. Languages and widths are not extra business scenarios.
- The historical runtime report records Spring Boot 4.1.1, Spring Framework 7.0.9 and Spring Security 7.1.1. Backend JAR SHA-256: `746006781e407bef377f8125d36e29a5995d486347bb57bb32c929572b1cc89c`.

The [complete provenance](../../images/conditional-routing/cb3f1077/provenance.json) maps original archive paths to public paths, byte counts, SHA-256, states, request IDs, viewports and image dimensions. The [original evidence manifest](../../images/conditional-routing/cb3f1077/source-evidence-manifest.json) retains its bytes, as does the [runtime report](../../images/conditional-routing/cb3f1077/runtime/routing-runtime.json). Viewing the images does not require downloading a temporary CI artifact or signing into Library.

<!-- topic:source-comparison -->
## Exact comparison with the documentation baseline

The comparison baseline is main [`10e092fae22720b8c125d1a28a75f6fc559cfce8`](https://github.com/JamesCube/ArcFlow/commit/10e092fae22720b8c125d1a28a75f6fc559cfce8). This compares source; it does not establish a new capture or backend run on current main.

Git trees are identical for core `src`, domain `examples/approval-domain/src`, standalone backend `examples/approval-demo/backend/src`, frontend `examples/approval-ui/src`, and frontend verification scripts `examples/approval-ui/scripts`. Build manifests, conditional-routing spec/fixture/contract/verifier and the application workflow also match file by file. Exact tree IDs and twelve file hashes are recorded under `baseline.sourceComparison` in the manifest.

The aggregate UI directory hashes are different:

- Historical `uiSourceTreeSHA256`: `238a4e4c2696b782a1cdbeb5046d1b08c509e51bad7d3951cf53a55f85267921`
- Corresponding documentation-baseline hash: `84366fc96ac26a6a45e8929ca5262ef3fcb15bdb3a8240b42d3eb97ea9dd1cac`

Only documentation changed: the UI README plus COMPLEX_SCENARIOS, CONDITIONAL_ROUTING, RECEIVING_SCENARIOS and VISUAL_SCENARIOS under e2e were rewritten, and five English counterparts were added. The manifest records all ten paths and their old/new SHA-256 values. Git tree IDs, directory-content SHA-256 and JAR SHA-256 identify different things.

<!-- topic:reading-limits -->
## Reading the images

- Start with each page’s request-ID table. Only states sharing a language and request ID form one journey. Another language, amount or final rejection uses a separate request.
- The high payment is exactly CNY 10,000 and uses GTE. Contract condition ANY is independent of approval ANY. Each designer example has one predicate; these images do not demonstrate multi-predicate combinations.
- The contract partial state has two decisions overall, including the earlier commercial approval. Receiving rejection uses a separate request whose procurement stage is never reached.
- 1440×1000 and 390×844 are browser viewports. All 80 PNGs are full-page and taller. Previews use the same original PNG with a display-height limit; no cropping, retouching or generated UI.
- Some Chinese lists contain earlier English synthetic titles. Narrow-screen top navigation scrolls within its horizontal strip. Tall originals need normal zooming or scrolling.
- Conditions apply only to payment, receiving and contract. Accounts and business data are synthetic. Approval does not pay, sign, post inventory or write back to a real ERP/CRM.
- PNG encoding, hashes, sidecars and receipt checks do not replace independent authenticity certification, permission/idempotency tests, cross-browser, physical-device, accessibility or production acceptance.

This publication reuses the accepted capture bytes and revisits original images across the states. New documentation and website entry points still need checks for this commit. Local Chromium launch hit a process-singleton socket permission limit; it was not bypassed, and browser checks that never ran are not reported as passed.

<!-- topic:verify-public-copy -->
## Verify the public copy

Run from a repository root containing this gallery. Python checks use the standard library; strict PNG/receipt verification requires Node 24.

```bash
python3 -m unittest discover -s scripts -p 'test_conditional_gallery.py' -v
python3 scripts/verify_conditional_gallery.py
ARCFLOW_EXPECT_SOURCE_REVISION=cb3f1077fc725e0031620b1210a819917d8684a4 \
ARCFLOW_EXPECT_CAPTURE_RUN_ID=38016643460 \
ARCFLOW_EXPECT_CAPTURE_RUN_ATTEMPT=1 \
ARCFLOW_EXPECT_CAPTURE_REPOSITORY=JamesCube/ArcFlow \
ARCFLOW_EXPECT_RUNTIME_REPORT=docs/images/conditional-routing/cb3f1077/runtime/routing-runtime.json \
node examples/approval-ui/scripts/verify-routing-captures.mjs docs/images/conditional-routing/cb3f1077
python3 scripts/check_documentation.py
python3 scripts/verify_scenario_galleries.py
python3 website/scripts/build.py
python3 website/scripts/check.py
```

The new gate independently locks 167 originals, the 20×4 combinations, complete original-image coverage in both languages, request identities and provenance. The older 104-image directory and manifest are unchanged; both gates run separately. Checks do not recapture, merge or deploy. Consult the target PR/Actions results for actual CI on the documentation commit.

<!-- topic:recapture-separately -->
## Recapture separately

Prepare JDK, Node and Chromium in an isolated disposable checkout, then follow the [conditional capture instructions](../../../examples/approval-ui/e2e/CONDITIONAL_ROUTING.en.md). Check out `cb3f1077` for historical behavior, or a new exact commit to test new behavior. Backend and UI use temporary demo accounts and data; do not connect real business systems.

Retain the new commit, run identity, runtime report, PNGs, sidecars and journey receipts, and register them separately. New screenshots must not replace this historical directory. Request IDs, dates and pixels can differ; do not claim byte-for-byte reproduction.
