# Independent mobile client review

Reviewed **2026-10-05 UTC** against the mobile working tree based on **549e8da**.
The review covered source, runtime dependency code, build output and automated
DOM tests. No browser or device was used, and the reviewer changed only this note.
Later Chromium CI results are recorded in [ACCEPTANCE.md](ACCEPTANCE.md).

## Checks repeated independently

- `npm run typecheck`: passed.
- `npm test`: **40 tests passed** in four files, including nine DOM view tests
  and the reference enumeration of **2,304** mixed sequential/ALL/ANY states.
- `npm run build:h5`: passed after the current dependency overrides and final
  focus-handling changes.
- Generated CSS retains native button resets/focus styles, 48px minimum text
  button targets, tab class selectors and 16px native input/textarea fonts.

## Draft-PR CI preflight

Before publication, the reviewer checked the workflow, Playwright configuration,
seven browser tests and their launcher. The workflow has read-only repository
permissions and no merge/deploy step. It starts its own loopback servers, refuses to reuse existing servers, disables
traces/video and uploads synthetic screenshots only after the job succeeds.

One configuration issue needed fixing before publication: Playwright reimports its
configuration in workers, so it must not regenerate passwords or stores there.
`scripts/browser-tests.mjs` now creates the run context once, then removes the
directory it created when the runner exits. When workers import the configuration,
they only validate and read that inherited context. Browser assertions now wait for
server-confirmed decisions, completed failure reconciliation and populated
details before measuring viewport overflow.

Independent `npm run test:e2e -- --list` discovered all **seven** tests and left
**zero new temporary directories**. This command did not start a browser or run
those tests. Typecheck and all **40** unit/DOM tests were repeated successfully on
Vitest **4.1.11**. The preflight found no further blockers to publishing the draft PR. The browser
tests and screenshot review had not yet run.

## Findings resolved and rechecked

- Confirmation now freezes request, step and decision. Refreshing to a later
  repeated-assignee stage, including reconciliation after a lost response, closes
  the old composer instead of applying its note/decision to the new stage.
- H5-native buttons, inputs, textareas and labels replace the uni-H5 wrappers. Dialog focus handling includes disabled controls,
  in-flight submission and reverse Tab after a failed submission.
- Unknown host selectors fail closed. Enterprise entries cannot fall back to
  demo login, produce an identity or send notifications.
- A failed initial load no longer looks like an empty inbox; ordinary
  refreshes no longer flash a failed-load state. Sampled low-contrast muted
  labels were darkened.
- The review checked in-memory credentials, same-origin endpoint restrictions,
  logout and read generations, duplicate-click prevention and handling of
  server-confirmed success. Group display semantics matched the tested
  reference transitions. Server authorization remains authoritative.

## Runtime telemetry inspection

The application statistics option is disabled. The generated page chunk has no
external URL; no uni-stat, tongji, sendBeacon or analytics strings were found in
the built JavaScript. The upstream runtime still contains dormant AdConfig and
AdReport definitions, including `hac1.dcloud.net.cn/ah5v2` and
`has1.dcloud.net.cn/ahl`. AST reference inspection found only their static-property
initializers, with no calls instantiating or invoking those classes. This was a static inspection; it does **not** show that the running app makes
no external requests.

## Acceptance limits

This review did not launch a browser or take screenshots. Touch behavior,
rendered layout at 360/390/430px, zoom/reflow, screen-reader output, full contrast,
mobile keyboard/safe-area behavior, real Back/Forward history and browser network
traffic remain unverified. DOM tests do not substitute for those checks.
Android/iOS, mini-programs and enterprise SSO/messaging were not built or tested.
The API remains a single-tenant, fixed-account local demo; this review does not
establish production security or cross-tenant isolation. See `ACCEPTANCE.md` for the dependency audit and completed/pending checks, and
`HTTP_VERIFICATION.md` for backend test results.
