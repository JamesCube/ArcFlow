# Independent mobile client review

Reviewed **2026-10-05 UTC**, against the mobile working tree based on **549e8da**.
This was source, dependency-runtime, generated-artifact and automated DOM review.
It was **not browser or device acceptance**. The reviewer changed only this note.

## Checks repeated independently

- `npm run typecheck`: passed.
- `npm test`: **40 tests passed** in four files, including nine DOM view tests
  and the reference enumeration of **2,304** mixed sequential/ALL/ANY states.
- `npm run build:h5`: passed after the current dependency overrides and final
  focus-handling changes.
- Generated CSS retains native button resets/focus styles, 48px minimum text
  button targets, tab class selectors and 16px native input/textarea fonts.

## Draft-PR CI preflight

The workflow, Playwright configuration, seven authored browser tests and owning
launcher were reviewed before publication. The workflow has read-only repository
permissions and no merge/deploy step. It owns fixed loopback servers, refuses
server reuse, disables traces/video and uploads only synthetic screenshots after
job success.

A blocking configuration-lifecycle issue was fixed: Playwright reimports its
configuration in workers, so it must not regenerate passwords or stores there.
`scripts/browser-tests.mjs` now creates a fresh run context once and removes its
exact generated directory after the runner exits. Worker configuration imports
only validate/read that inherited context. Browser assertions now wait for
server-confirmed decisions, completed failure reconciliation and populated
details before measuring viewport overflow.

Independent `npm run test:e2e -- --list` discovered all **seven** tests and left
**zero new temporary directories**. This command did not start a browser or run
those tests. Typecheck and all **40** unit/DOM tests were repeated successfully on
Vitest **4.1.11**. No remaining publication blocker was found in this preflight;
the actual browser run and screenshot inspection are still required.

## Findings resolved and rechecked

- Confirmation now freezes request, step and decision. Refreshing to a later
  repeated-assignee stage, including reconciliation after a lost response, closes
  the old composer instead of applying its note/decision to the new stage.
- Actual H5-native buttons, inputs, textareas and labels replace assumptions
  about uni-H5 wrappers. Dialog focus handling includes disabled controls,
  in-flight submission and reverse Tab after a failed submission.
- Unknown host selectors fail closed. Enterprise entries cannot fall back to
  demo login, produce an identity or send notifications.
- Failed initial reads cannot report a confidently empty inbox; ordinary
  refreshes no longer flash a failed-load state. Sampled low-contrast muted
  labels were darkened.
- Explicit in-memory authorization, same-origin endpoint restrictions, logout
  epochs, read generations, duplicate-click prevention and server-confirmed
  success handling were inspected. Group display semantics matched the tested
  reference transitions. Server authorization remains authoritative.

## Runtime telemetry inspection

The application statistics option is disabled. The generated page chunk has no
external URL; no uni-stat, tongji, sendBeacon or analytics strings were found in
the built JavaScript. The upstream runtime still contains dormant AdConfig and
AdReport definitions, including `hac1.dcloud.net.cn/ah5v2` and
`has1.dcloud.net.cn/ahl`. AST reference inspection found only their static-property
initializers, with no calls instantiating or invoking those classes. This is
static evidence, **not a runtime zero-egress guarantee**.

## Acceptance limits

This local review launched no actual browser and took no screenshots. Touch behavior,
rendered layout at 360/390/430px, zoom/reflow, screen-reader output, full contrast,
mobile keyboard/safe-area behavior, real Back/Forward history and browser network
traffic remain unverified. DOM tests do not substitute for those checks.
Android/iOS, mini-programs and enterprise SSO/messaging were not built or tested.
The API remains a single-tenant, fixed-account local demo; this review does not
establish production security or cross-tenant isolation. Dependency-audit status
and all executed/unrun stages are recorded separately in `ACCEPTANCE.md`; actual
backend checks are recorded in `HTTP_VERIFICATION.md`.
