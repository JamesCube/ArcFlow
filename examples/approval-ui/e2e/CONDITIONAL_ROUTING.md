# Conditional-routing acceptance

## Scope

`conditional-routing.spec.mjs` exercises the real localhost backend and the
scenario workspace, using disposable accounts and a temporary JSON store.
It never uses real payments, signed contracts or external business systems.

- Payment: configure a numeric condition, switch review modes, undo/redo,
  publish, block a currency mismatch, freeze a below-threshold route, preserve
  a pre-conditional request, clear/re-add the condition without downgrading
  schema 4, and approve low/high routes with actual ALL/ANY votes.
- Receiving: conditional warehouse/quality ALL review, each actor’s vote,
  procurement review, approved and rejected exception requests, and a clean
  receipt that skips inspection and completes with one procurement vote.
- Contract: IN/ANY condition configuration (independent from the ALL voting
  rule), invalid empty IN selection, nonstandard joint review, a partial vote,
  full approval, and a standard contract that skips the joint stage.
- Each journey runs with separate English and Chinese business records.
  Titles and comments use ordinary business language. Only business references
  carry a random isolation suffix; no real suppliers, customers or contracts
  are used.
- Twenty states × two languages × 1440px/390px viewports = 80 PNGs.
  Both viewport variants show the same saved request state. The capture gate
  requires all pairs, no horizontal overflow, authenticated screens only,
  and the original PNG bytes with SHA-256 and exact commit/run/backend identity.

`routing-receipt.json` records the exact launched backend SHA-256, synthetic
request definitions/routes/history and each pictured business checkpoint.
The gate checks the expected actor/step/action sequence, interim and final
states, comments, and every image’s request ID and decision count against those
checkpoints. A checkpoint must also be a prefix of the final saved history.
Authentication, HAR, tracing, videos and browser storage are not captured.
Evidence is written to ignored test-results. PNG integrity and passing workflow
assertions are not a substitute for independent review of the downloaded images.

## Local verification status

On 2026-10-09, the full frontend unit/DOM suite and production build passed.
The frontend workspace's real-backend HTTP journey passed for all three
families, including exact `CNY 6500`/`CNY 10000`, boolean and enum facts; 1-vote
skipped paths versus 3-vote included paths; schema-4 all-unconditional snapshots;
legacy schema-3 snapshots; and lost-response retries pinned across publication.
The acceptance command was:

```sh
node scripts/verify-routing-http.mjs ../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```

Browser rendering is **not verified locally**. Installed Chromium could not
start in this execution environment: `socket() failed: Operation not permitted`
in its process-singleton startup. A supported cloud-browser attempt could not
connect to the isolated localhost server. No security settings were weakened.
Playwright discovery now lists six bilingual journeys, but assertions and screenshots
need a successful browser run before visual acceptance can be claimed.

Run on a permitted local/CI browser environment after building the backend:

```sh
npm run test:e2e -- e2e/conditional-routing.spec.mjs
```

No production readiness, cross-browser compatibility, 200% zoom, accessibility
audit or arbitrary workflow engine support is claimed.
