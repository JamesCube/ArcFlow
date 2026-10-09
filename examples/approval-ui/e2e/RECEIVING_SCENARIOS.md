# ERP receiving browser acceptance

`receiving.spec.mjs` is a dedicated real-backend journey. Its title starts with
`receiving:` so a separate browser job can run it without repeating it in the
main leave/expense gallery job. Use the repository's declared backend and the
existing disposable, loopback-only Playwright setup:

```sh
ARCFLOW_CAPTURE_RECEIVING=1 \
ARCFLOW_SOURCE_REVISION="$(git rev-parse HEAD)" \
ARCFLOW_VERIFICATION_BACKEND=declared-Boot-4.1.1 \
npm run test:e2e -- e2e/receiving.spec.mjs --output=receiving-visual-results
```

The source must be a clean committed checkout when capture is enabled. Evidence
reads the actual full Git HEAD itself, rejects a different supplied revision,
and refuses dirty tracked sources. CI should explicitly check out the PR head
rather than a synthetic merge commit when it wants evidence for the PR head.
Running `playwright test e2e/receiving.spec.mjs --list` only discovers the test;
it neither launches Chromium nor verifies rendering.

## Real behavior exercised

1. Inspect the initial Bob + Carol ALL group and Bob procurement stage.
2. Fill separate PCS/BOX quantities in English and Chinese, including 390px;
   reject an unbalanced line locally before any POST.
3. Discard one response only after a real backend save, then prove an unchanged
   manual retry returns the same request ID using the same idempotency key.
4. Save two ALL receiving snapshots. Use the actual ProcessDesigner inspector
   to change the first group to ANY and publish a new version. Assert the
   returned process and the old immutable ALL snapshots.
5. Submit a new ANY receipt using the newly published process.
6. Record Bob's partial ALL vote, Carol's completion, and Bob's distinct
   procurement vote. Assert saved stage IDs, participants and final history.
7. Reject the second ALL receipt through Carol and prove procurement is not
   reached.
8. Approve the ANY inspection through Bob alone, prove Carol is no longer
   required, then record Bob's separate procurement approval.
9. Reload/re-login and verify saved ALL history. Read the main and expense
   process before and after; both must remain identical. Every browser POST
   must stay under `/api/scenarios/erp-receiving/`.

The test uses no fabricated successful responses. Password input, request
credentials, storage state, traces, video and automatic failure screenshots
are never retained. Explicit captures require an authenticated receiving shell
and no password inputs. Every capture checks document/body overflow. Mobile
review controls also check touch height, readable type and viewport bounds.

## Expected screenshots

Exactly fifteen PNG files and fifteen matching JSON files are expected in the
single-test output directory. All images are full-page; desktop uses 1440×1000
and mobile uses 390×844.

- `01-form-en-desktop.png`
- `02-form-zh-desktop.png`
- `03-form-zh-390.png`
- `04-quantity-error-en-desktop.png`
- `05-quantity-error-zh-390.png`
- `06-published-any-designer-en-desktop.png`
- `07-published-any-designer-zh-390.png`
- `08-immutable-all-snapshot-en-desktop.png`
- `09-all-partial-bob-vote-en-desktop.png`
- `10-all-quality-review-zh-390.png`
- `11-bob-procurement-review-en-desktop.png`
- `12-all-approved-en-desktop.png`
- `13-all-rejected-zh-desktop.png`
- `14-any-early-advance-en-desktop.png`
- `15-any-approved-zh-390.png`

Each JSON includes actual `sourceRevision`, `sourceTreeClean`, backend label,
GitHub run/attempt when present, scenario, state, timestamp, viewport, locale,
image filename, SHA-256 and retry number. Only a wholly successful journey
writes `receiving-acceptance.json` with `result: "passed"`, `capturedStates: 15`,
the ALL and ANY snapshot versions, and confirmation that main/expense processes
were unchanged. A partial screenshot collection alone is not acceptance.

Local DOM/model tests and a successful build do not prove browser appearance.
If Chromium cannot launch, retain the launch failure separately and mark visual
acceptance unverified; never replace screenshots with mock renders. Compatibility
backend runs must retain their explicit label and cannot substitute for exact
acceptance against the declared backend.
