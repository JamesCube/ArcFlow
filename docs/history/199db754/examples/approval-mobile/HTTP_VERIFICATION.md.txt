# Real backend HTTP verification

These checks ran on **2026-10-05 UTC** against the standalone backend and shared
domain at **549e8da**, with no changes to either. They cover the mobile client’s
HTTP contract. Browser rendering, touch interaction and devices were not tested
in this run.

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
were built and tested offline using an already populated dependency cache. The backend and approval-domain source stayed unchanged.

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
  of approve/reject to Bob and Carol. ALL rejects and ANY advances whichever
  valid event order occurs; a late vote can return 409 without creating an event.
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

To use a particular Java executable or run more race rounds:

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
- At **549e8da**, decisions supported same-decision replay, but submissions had
  no idempotency key. For that version, refresh after an uncertain submission
  rather than resubmitting automatically. Current hosts support an optional
  `Idempotency-Key`; see the [submission retry contract](../../docs/SUBMISSION_IDEMPOTENCY.md).
  The tests in this report predate that feature.
- At the time of this run, part of the backend README still described schema-2
  storage. The tested group upgrade used schema 3, as described in the
  [parallel contract](../../docs/PARALLEL_APPROVAL.md#persistence-and-rollout).

These results apply to the local demo with fixed accounts and file-backed
persistence. Production and multi-instance operation were not verified.

## Typed procurement review contract, 2026-10-06

The additional disposable, loopback-only command:

```sh
python3 examples/approval-mobile/scripts/verify-documents-http.py
```

passed **28 HTTP status checks and 18 invariants**, including one backend restart.
It creates only synthetic legacy leave, typed leave and procurement records and
confirms their mixed approver list. CNY 199.99 × 3 = 599.97 and maximum JPY
1,000,000,000 × 100,000 = 100,000,000,000,000 are checked using decimal arithmetic;
USD/EUR/GBP and invalid quantities/prices/currency/unknown fields are covered too.
Existing authentication, mandatory client header, applicant denial, concealed
unrelated requests, server approval, immutable business and decision note,
same-decision retry and opposite-decision conflict are retained.
The exact business payloads and audit survive schema-5 persistence and restart.

The original mobile HTTP harness was also rerun successfully: **177 status checks,
217 invariants in the final rerun, two restarts**. The invariant count can increase
with additional legal outcomes in concurrent race cases. These are backend/HTTP checks, not browser proof.
A separate local nonbrowser smoke fed seven real backend mixed response records
through the mobile strict decoder and exact formatter successfully.
