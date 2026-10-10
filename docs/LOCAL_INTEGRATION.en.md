# Historical local integration of procurement and member worklists

<!-- Legacy fragments remain entry points after the language split. -->
<a id="local-integration-of-procurement-and-member-worklists"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](LOCAL_INTEGRATION.md) · [Documentation](README.en.md)

This records the initial local verification of the combined source. It is not a deployment,
production acceptance result, or evidence that all source branches are merged.
At this checkpoint the CRM quote case was being developed separately and was not included. See [current architecture](development/ARCHITECTURE.en.md) for current support.

<!-- topic:inputs-and-source-identity -->
## Inputs and source identity

The local inputs were reconstructed from persistent source/patch bundles and
checked against their exact Git trees before any conflict resolution:

| Input | Commit or provenance | Exact tree |
| --- | --- | --- |
| Earlier main | `9333bdba4743bc8d490f00d2dc48323553c205e6` | `af97795a1b97a28a8d417fcc09c53bae17e0534f` |
| Typed business / PR #16 | `e8568d437abae184ccba549a6a2dfde577201802` | `125b7ae405c537d999026ee1d3b1c6ac81656f73` |
| Procurement UI | Local source, not published | `8c26a8ab2c193d01e4a0b023ed384ccdf161df22` |
| Member inbox backend | `cac609569807ae65d488a9e79c8cf463aebad961` | `a1dc75ae7e14f822a2b581d27238a8aadd1b52dc` |
| Member inbox frontend + PR #18 copy | Local source, not published | `0bbdb6351b7f7003b4045fff46919f9728079791` |
| PR #17 documentation | `976d3047969d15e34f3f76acd439cafd9d60403c` | `f6a135562e044dc8bc51e5f65e6f8c6f47881631` |

PR #16 was subsequently merged into main as
`9143f3dacc71a5cf8e512bc8ad235744718430dd`. The exact input provenance above
is retained so this combination can be reviewed independently of branch names.
PR #18 interface copy was subsequently merged as
`86488effa4af80e86446799a1109dc85ab1d0423`; the copy is already included here.
PR #17’s separate docs-only reconciliation is not this feature bundle.

<!-- topic:combined-behavior -->
## Combined behavior

- Legacy leave and immutable typed leave/procurement documents share approval,
  authorization, saved process versions, audit and durable submission keys.
- Standalone and RuoYi forms retain independent drafts/keys for leave and
  procurement, exact decimal money and read-only business snapshots. H5 remains
  review-only.
- Pending and handled tabs use bounded actor worklists, with separate cursors,
  stale-response guards and detail refresh after decisions. The compatible
  visible-request list remains in use for applicant/history and detail refresh;
  this change does not make every legacy read bounded.
- JDBC member rows include process IDs. Queries bind both actor and configured
  process before applying filters/continuation. Backfill validates each request
  against its own retained process definition, including mixed-process batches.
- Global applicant/key compatibility is preserved across processes. Reusing a
  key for a different process or typed intent conflicts rather than creating a
  second request.
- JSON typed snapshots remain schema 5. Member projection uses SQL revision 3,
  explicit migration and stopped-writer bounded backfill. Constructors do not
  execute DDL or silently migrate.
- The concise bilingual docs and interface copy are retained, with historical
  screenshots/server results still attributed to their original source.

<!-- topic:verification -->
## Verification

Completed against this combined source on 2026-10-08, using installed tools
and cached dependencies without registry downloads:

- Core offline regression: 24 checks passed; QuickStart output also passed.
  The Maven JUnit wrapper passed as well.
- Launcher Python tests: 17 passed.
- Approval domain: 75 tests passed.
- Standalone backend service/MVC/security: 48 tests passed.
- Generic JDBC: 108 executed tests passed on Java 17 and again on Java 21,
  including 74 shared H2 contracts.
  In that run PostgreSQL and MySQL were skipped because no server was selected.
- Separate real MySQL 8.0.46 run: 80 tests passed, no skips/errors/failures.

- Standalone/shared-native unit and mounted-component tests: 442 passed.
- H5/mobile unit and mounted-component tests: 280 passed.
- Native inbox helpers/API: 51 passed; mounted native inbox tests: 19 passed.
  The 64 native submission tests are already included in the 442 count.
- Standalone build, mobile typecheck and H5 build: passed.
- Parallel/member-inbox live HTTP: 70 assertions, including restart.
- Mobile HTTP: 177 status checks and 229 invariants, including two restarts.
- Typed-document HTTP: 28 status checks and 18 invariants, including restart.
- Real standalone client plus combined backend: 37 assertions on 26 leave and
  one procurement request, covering exact raw money, key replay, paging,
  partial/final votes and handled filters.
- Local documentation paths and anchors: 217 checked, none missing.
- Shared business/submission helpers match between standalone and native code.

Node 24.19.0 was used for frontend checks. The MySQL run used a fresh disposable
8.0.46 database and shut it down afterward. The generic JDBC suites skipped
PostgreSQL/MySQL when no server was selected; the separate MySQL result above
is the real-server evidence. PostgreSQL remains unrun locally.

No new browser screenshots, full pinned RuoYi-host build/browser acceptance,
native/mini-program/real-device acceptance or production deployment are claimed.
Earlier input bundles’ CI/browser runs do not substitute for checks on this
combined source. The compatible applicant/history/detail list can still read
all visible requests; bounded member inboxes do not make that legacy API bounded.

<!-- topic:remaining-acceptance-at-this-checkpoint -->
## Remaining acceptance at this checkpoint

1. Keep this local source and its test evidence together; review the exact tree
   before creating a publication branch.
2. Publish only after separate authorization, then run exact-commit remote CI,
   PostgreSQL, MySQL 8.4 and the remaining Java/database combinations.
3. Run the pinned RuoYi host and actual-browser workflows before accepting the
   combined UI, including interrupted requests, repeated clicks and navigation.
4. Integrate the separate CRM case only after its own review and combined
   schema/business compatibility checks.

A subsequent publication candidate was prepared on the exact PR #17 documentation tree `7a80130d16c72b22ab4746d46d72d005ebf7d1c5`, preserving its current typed-business and compatibility wording. Code-level acceptance still needs the exact candidate CI; this local record does not claim those jobs passed.

Before publication, static review corrected stale mobile browser selectors and narrowed a desktop success-status assertion. The approval-demo CI now explicitly selects all 19 native inbox component tests with the existing pinned frontend tools; that exact test command passed locally. Desktop, H5 and native RuoYi browser pagination journeys have been authored for more than 25 rows, second-page procurement, partial voting and later-stage overlap. They are pending exact-candidate CI and have not yet run.

The publication base is main `2fbc40b2b166dd79b166bb17e89128d20658601d`, whose tree matches the PR #17 candidate above. Its six post-merge workflows passed before this separate feature candidate was prepared. That base acceptance does not cover the new feature delta.

The publication review also reproduced and fixed a native controlled-input issue: the process-version filter now keeps per-box drafts, echoes input updates and applies server filters only on change. All 24 native inbox DOM tests (including five new regressions), 64 shared native submission tests and 51 native helpers passed after that fix. This raises the combined distinct frontend suite to 797 tests. The complete pinned-host browser execution remains an exact-CI gate.
