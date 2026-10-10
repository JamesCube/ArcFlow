# Conditional-routing acceptance

<!-- Legacy fragments remain entry points after the language split. -->
<a id="local-verification-status"></a>

[简体中文](CONDITIONAL_ROUTING.md)


<!-- topic:scope -->

<!-- topic:coverage -->
## Scope

`conditional-routing.spec.mjs` exercises the real localhost backend and the
scenario workspace, using disposable accounts and a temporary JSON store.
It never uses real payments, signed contracts or external business systems.

- Payment: configure a numeric condition, switch review modes, undo/redo,
  publish, block a currency mismatch, freeze a below-threshold route, preserve
  a pre-conditional request, clear/re-add the condition without downgrading
  schema 4, and approve low/high routes with actual ALL/ANY votes.
- Receiving: true and false “has rejected lines” facts and explicit exclusion.
- Contract: IN/ANY configuration, invalid empty IN selection, standard versus
  nonstandard inclusion, selected-route completion.
- English desktop and Chinese 390px editor/detail captures, no horizontal
  overflow, read-only reviewer controls, no password screenshots.

`routing-receipt.json` records the exact launched backend SHA-256 and synthetic
request definitions/routes/history. Authentication, HAR, tracing, videos and
browser storage are not captured. Evidence is written to ignored test-results.

<!-- topic:history -->
## Historical local verification status

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
Playwright discovery lists all three journeys, but assertions and screenshots
need a successful browser run before visual acceptance can be claimed.

Run on a permitted local/CI browser environment after building the backend:

```sh
npm run test:e2e -- e2e/conditional-routing.spec.mjs
```

No production readiness, cross-browser compatibility, 200% zoom, accessibility
audit or arbitrary workflow engine support is claimed.
