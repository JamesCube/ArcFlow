# Payment and contract browser acceptance

The suite is `complex-scenarios.spec.mjs`; both titles start with
`complex scenarios:`. It runs against a fresh disposable backend, actual demo
accounts and synthetic data. It never writes to a bank, ERP, CRM or customer
system. Credentials stay in memory; authentication screens, traces, HARs,
videos and browser storage states are not captured.

## Required journeys

- Payment: declared invoice/settlement/allocation/deduction fields; exact
  10000.00/7000.00/500.00/6500.00 summary; over-allocation error; unchanged
  lost-acknowledgement retry after navigating to another document and publishing
  v2; old default v1 ALL→ANY kept intact; partial ALL; repeated Bob; partial ANY
  rejection then approval; ANY all-reject; immediate ALL rejection; actual v2
  ALL→single reviewer completion; immutable amounts and decision history.
- Contract: term, revision and nonstandard explanation; three milestones and
  zero balance; one-cent mismatch and out-of-term date errors; STANDARD retains
  the nonstandard text for explicit correction; original intent pinned to v1
  after designer adds ANY as v2; SINGLE→ALL with Bob voting independently in
  both stages; new SINGLE→ALL→ANY completion with partial ANY rejection; ALL
  rejection leaves later ANY unexecuted; immutable terms/milestones.
- Both: English and Chinese, desktop and 390px; read-only approvers; repeated
  decision-click suppression; reload/re-login; fixed actual reviewer names;
  unchanged legacy/Expense process; no external mutation requests.

## Forty-image matrix

Each scenario requires both `en` and `zh` for these ten states:

| State | Viewport | Focus |
|---|---|---|
| `form-filled` | 1440×1000, full page | Complete typed inputs |
| `form-summary` | 390×844 | Exact amounts, no overflow |
| `validation-errors` | 1440×1000, full page | Concrete invariant errors |
| `designer-published` | 1440×1000, full page | Real v2 route publication |
| `saved-original-snapshot` | 1440×1000, full page | Original v1 after retry |
| `review-controls` | 390×844 | Comment and 44px decision controls |
| `all-partial` | 1440×1000, full page | Real partial group vote |
| `any-partial-rejection` | 1440×1000, full page | One rejection still pending |
| `approved` | 1440×1000, full page | Review outcome, no execution claim |
| `rejected` | 1440×1000, full page | Preserved business snapshot |

Set `ARCFLOW_CAPTURE_COMPLEX_SCENARIOS=1`. Original PNG bytes and JSON sidecars
are written exclusively to unique `capture-complex-<UUID>` directories in the
selected Playwright output directory. There is no image transformation, upload
or publication. Missing or inaccessible historic screenshots are not replaced.

The verifier rejects incomplete/duplicate matrices, mismatched PNG bytes or
viewport dimensions, mixed source/backend hashes and multiple sessions within
one scenario. CI binds the matrix to the exact revision, clean tree, workflow
run, attempt, repository and declared Boot version:

```sh
ARCFLOW_EXPECT_SOURCE_REVISION=<exact-head> \
ARCFLOW_REQUIRE_CLEAN_COMPLEX=1 \
ARCFLOW_EXPECT_BACKEND_RUNTIME=declared-Boot-4.1.1 \
ARCFLOW_EXPECT_CAPTURE_RUN_ID=<run-id> \
ARCFLOW_EXPECT_CAPTURE_RUN_ATTEMPT=<attempt> \
ARCFLOW_EXPECT_CAPTURE_REPOSITORY=<owner/repository> \
node scripts/verify-complex-captures.mjs <playwright-output-directory>
```

Worker configuration reload preserves the exact inherited immutable backend archive. A missing or nonregular inherited archive fails closed; it cannot silently switch to a repackaged build target. Eight regression cases cover this boundary.

A source/hash sidecar records provenance, not an independent guarantee that an
image was never manipulated. Review the actual workflow result and images.

## Local implementation checkpoint, 2026-10-09

- Passed: 46 Vitest files / 1,394 tests, production Vite build, diff whitespace
  check, and actual installed client transport/workspace HTTP acceptance using
  the project's declared Boot 4.1.1 backend.
- Blocked: Chromium process startup reports Unix socket `EPERM` before opening
  any page, including an approved escalated run. Browser assertions, visual
  quality, mobile layout and all 40 screenshots remain unverified locally.
- The capture gate correctly rejects the empty output. Unit fixtures exercise
  gate failures but are expressly not screenshots or acceptance evidence.
- The earlier supplementary Boot 3 HTTP check also passed; it is not the basis
  for the declared-runtime result above.

These results describe this local implementation checkpoint, not a published
commit, CI result, merged feature, production deployment or completed visual
acceptance. The exact-head CI browser job remains the acceptance gate.
