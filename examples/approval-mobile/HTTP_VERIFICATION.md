# Real backend HTTP verification

Verified on **2026-10-05 UTC** against the unchanged standalone backend and shared
domain at **549e8da**. This report covers the HTTP contract used by the mobile
client. It does not claim browser rendering, touch interaction, or device testing.

## Result

- Core Maven suite: 1 JUnit test containing **24 regression checks**, passed.
- Shared approval-domain Maven suite: **36 tests**, 0 failures/errors/skips.
- Standalone backend Maven suite: **35 tests**, 0 failures/errors/skips.
- New `scripts/verify-http.py`: **177 real HTTP status checks and 223 contract
  invariants**, passed, including **two actual Java backend restarts**.
- Existing `../approval-demo/verify-parallel-http.py`: **40 authenticated HTTP
  assertions**, passed, including restart.
- Python compilation and the new harness's occupied-port refusal: passed.

The run used Python 3.12, Java 17.0.20.1 and Maven 3.9.16. The three Maven modules
were built and tested offline using an already populated dependency cache. No
backend or approval-domain code was changed.

## Coverage

- Missing, invalid, and malformed Basic authentication return 401. Each demo
  identity is derived from the authenticated principal.
- Forged actor/applicant/approver fields are rejected by strict JSON decoding;
  applicants cannot decide; unrelated users cannot see requests and receive 404
  for decision attempts. Bob cannot publish, including with an invalid body.
- Foreign Origin, cross-site Fetch Metadata, and a missing client header are
  rejected. Every harness POST uses the actual `approval-demo` client header.
- Assigned group participants both see the saved request. Self-assigned
  submission and stale process versions are rejected. Publication preserves
  existing requests' immutable definitions.
- ALL waits for both approvals and ANY waits through a first rejection. ANY
  rejects when everyone rejects and advances on a first approval.
- Exact and changed-comment same-decision replays preserve the original event,
  comment and timestamp. Six simultaneous duplicate votes create one event and
  advance only one stage. Opposite replays return 409.
- Current, future, unknown and already-closed stages are checked separately.
  A repeated assignee in the next stage must make a distinct decision there.
  An unvoted ANY member cannot act after another member closes the group.
- Twelve concurrent mixed-outcome races cover ALL and ANY with both assignments
  of approve/reject to Bob and Carol. ALL rejects and ANY advances under either
  legal event ordering; a late vote can return 409 without creating an event.
  Concurrent matching votes and opposite commands by the same actor are tested
  for both modes as well.
- Partial-group and final full-store restarts preserve requests for every
  principal, publication, comments (including Unicode/newlines), timestamps and
  ordered histories. Null comments become empty strings. Schema-2 backup and
  schema-3 storage upgrade are verified.

The invariant count can differ between runs because concurrent commands may
legally serialize in different orders. The harness checks every accepted vote
against the final durable events rather than assuming a particular winner.

## Run again

From the repository root, with Python 3.9+, Java 17+ and Maven available:

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml install
python3 examples/approval-mobile/scripts/verify-http.py
```

An explicit Java executable or longer race run can be selected:

```sh
python3 examples/approval-mobile/scripts/verify-http.py \
  --java /path/to/jdk-17/bin/java --race-rounds 10
```

The harness chooses a free loopback port by default. `--port` may select another
free port; occupied ports are refused. `--jar` may select a freshly built backend
jar. It generates random passwords in memory, creates a private disposable
directory, starts its own server, bypasses HTTP proxies for loopback requests,
and stops the server and removes its test data on exit. It never points at a
running user server or a production store and prints no credentials.

## Integration details

- The mobile client must send `X-Arcflow-Client: approval-demo` and JSON for POSTs.
- `APPROVAL_UI_ORIGIN` must match the browser's exact frontend origin (default
  `http://localhost:5173`); a different port or hostname is a different origin.
- `approverId` is only the first undecided participant. The full inbox comes from
  the saved current stage's participants minus that stage's recorded voters.
- A pending ANY request may legitimately have latest `decision: REJECT`.
- Decisions have safe same-decision replay; submission has no idempotency key.
  Refresh after an uncertain submission rather than automatically resubmitting.
- The backend README still describes a schema-2 store in part of its persistence
  section. The implemented schema-3 group upgrade follows the current
  [parallel contract](../../docs/PARALLEL_APPROVAL.md#persistence-and-rollout).

This remains a local demonstration with fixed accounts and file-backed
persistence. These checks do not establish production or multi-instance safety.
