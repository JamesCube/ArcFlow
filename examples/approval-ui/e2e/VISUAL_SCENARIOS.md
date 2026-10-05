# Real-backend visual scenarios

`visual-scenarios.spec.mjs` is a single ordered Chromium journey against the actual
Spring Boot API and Vue workspace. Its title starts with `visual showcase:` so CI
can capture a clean gallery in a separate Playwright invocation:

```sh
# Run the existing functional journeys first.
npm run test:e2e -- --grep-invert 'visual showcase:'
# Start new disposable servers and an empty store for the gallery.
npm run test:e2e -- --grep 'visual showcase:' --output=visual-results
```

Build the backend and install Playwright first, as described in the
[UI run guide](../README.md#real-browser-first-run-check). Each invocation refuses
to reuse existing servers, generates disposable passwords and creates a new
single-writer store. The existing configuration runs one worker. Do not override
that setting or run competing publications against the same backend. The visual
journey reads the current version before every seeded publication; it never rewrites
version numbers or existing request snapshots. Playwright stops the disposable servers after the run; the isolated temporary
data directory can remain until the runner is cleaned up. No cleanup publication
can mask the original failure. Run it
in the separate invocation shown above, keeping gallery data and functional fixtures
isolated.

## Captures and evidence

Desktop captures use a 1440 × 1000 viewport and retain the full document. Mobile
captures use a 390 × 844 Chromium viewport and retain the visible viewport. The
latter deliberately show separate flow, inspector, decision, snapshot and activity
views rather than pretending an excessively long page is one phone screen.

| PNG prefix | Scene | Locales |
| --- | --- | --- |
| `01-same-scene-three-step-any` | Original workbench scene: unpublished first ANY group selected, followed by Team group ANY and Final review single | Chinese |
| `02-sequential-leave-designer` | Manager review assigned directly to Bob, then HR review assigned directly to Carol | Chinese / English |
| `02-tablet-sequential-designer-en-1024` | 1024px intermediate-width designer | English |
| `03-applicant-new-leave-form` | Alice's filled three-day leave form, before submission | Chinese / English |
| `04-applicant-submitted-leave` | Real submitted request and its saved sequential definition | Chinese / English |
| `05-all-group-designer` | Editable ALL group, named handover step and exact completion rule | Chinese / English |
| `06-mobile-all-workspace` | Top-of-page mobile workspace context | Chinese / English |
| `06-mobile-all-designer-flow` | Compact mobile sequence view | Chinese / English |
| `07-mobile-all-designer-inspector` | Mobile name, review mode, participants and rule settings | Chinese / English |
| `08-mobile-bob-review-controls` | Bob's real pending group decision, comment and action buttons | Chinese / English |
| `09-bob-partial-all-awaiting-carol` | Bob has approved; ALL remains pending for Carol, and Bob cannot vote again | Chinese / English |
| `10-any-group-designer` | Editable ANY group and exact completion rule | Chinese / English |
| `11-any-approved-readonly-snapshot-activity` | Bob's ANY approval, Carol marked not required in that group, her separate final-step approval, read-only snapshot and activity | Chinese / English |
| `12-mobile-any-saved-snapshot` | Same saved ANY definition on mobile | Chinese / English |
| `13-mobile-any-completed-activity` | Same completed request's actual recorded activity on mobile | Chinese / English |

There are 28 PNGs. All screenshots show authenticated workspace UI. No successful
response is mocked. Seeding and two sequential example decisions call the real
version-checked API; ALL/ANY edits, publication, applicant submission and group
votes go through the browser UI. After ANY completes, another actual publication
changes the current template. API assertions verify the earlier ALL and ANY
request definitions remain unchanged and that the partial ALL request remains
pending. Request IDs, versions and recorded timestamps come from the server; they
are not painted over or fabricated, so this is a scenario gallery rather than a
pixel-stable golden-image suite.

Every capture checks document and body horizontal overflow. Mobile inspector
fields must remain inside the viewport width, at least 44px tall, and at least
16px in computed font size. Decision buttons must be at least 44px tall with
15px text. Insert, add-step and step-control targets are also checked at 44px. Both localized UI labels and group participant states are checked.
The journey also rejects browser page errors. These checks are not a formal
accessibility audit, physical-phone verification or a real 200% zoom test.

## Honest comparison and scope

The first scene reconstructs the original workbench input and edit sequence:
`Parallel synthetic review`, `跨团队协同审批` (ANY, Bob + Carol), `Team group`
(ANY, Bob + Carol), then `Final review` (single, Carol). The first group is selected
and unpublished; Carol was unchecked and restored with Undo before capture, just
as in the historical `02-workbench-any-inspector.png`. The locale now applies to
the entire workspace. Backend version numbers can differ because this gallery
starts a fresh store; the topology, configured names, people, selection and draft
state are the comparison target. Keep the historical original image unchanged
and label its capture commit when presenting a before/after pair.

All names, requests, reasons and comments are synthetic demo content. The compact
Chinese/English process and step names are configured user data; the language
switch translates interface copy, not saved business data. “Manager review” and
“HR review” are step names only. The demo still assigns stable account IDs `bob`
and `carol` directly; it does not discover managers, resolve organizational roles,
or integrate an HR directory. These screenshots prove only the standalone demo,
not the separately developed native RuoYi integration or production readiness.

No password-form screenshots, trace, HAR, video or saved authentication state
are produced. Explicit progress logs contain no credential values. Gallery API
transport and password-entry errors are replaced with bounded summaries because
Playwright’s raw failure logs can contain headers or filled values; do not add raw
error/cause logging. CI uploads only the PNG directories. Runtime
and visual acceptance require a successful current CI run and inspection of its
artifacts; static syntax checks alone do not establish either.
