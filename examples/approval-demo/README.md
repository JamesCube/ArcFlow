# Local human-approval demo

An experimental vertical slice for ArcFlow: edit and publish a sequential process, submit a synthetic leave request, complete its assigned steps, and inspect persisted status/history.

**Localhost and synthetic data only.** This is an example application, not a production workflow service. Spring Boot 3.5.16 is pinned because this sample targets Boot 3; that generation has [ended OSS support](https://spring.io/blog/2026/06/25/spring-boot-3-5-16-available-now/). Do not expose it to the internet or use real leave/health information.

## Run

Requirements: full JDK 17+, Maven 3.9+, Node 22.22.2+ and npm. Commands begin at repository root.

```bash
# Install the small, dependency-free-at-runtime Java core locally.
mvn install

# Use three different demo-only passwords, at least 12 characters each.
# Read them without echo or shell-history storage; these are not real accounts.
read -rs -p 'Alice demo password: ' APPROVAL_ALICE_PASSWORD; echo
read -rs -p 'Bob demo password: ' APPROVAL_BOB_PASSWORD; echo
read -rs -p 'Carol demo password: ' APPROVAL_CAROL_PASSWORD; echo
export APPROVAL_ALICE_PASSWORD APPROVAL_BOB_PASSWORD APPROVAL_CAROL_PASSWORD
mvn -f examples/approval-demo/backend/pom.xml spring-boot:run
```

In another terminal:

```bash
cd examples/approval-ui
npm ci
npm run dev
```

Open **http://localhost:5173** and sign in as `alice` with Alice's demo password.

1. Open the process designer. Name the first approval step and assign Bob.
2. Add a second approval step assigned to Carol. Use Move up/down to reorder steps, then publish the intended Bob → Carol order.
3. Submit a synthetic request against that published version.
4. Sign out and sign in as Bob. Approve the first step: the request stays pending and advances to Carol.
5. Sign in as Carol to approve the final step or reject. Return as Alice to inspect the outcome and per-step history.
6. Publish a different order and compare an existing request's read-only definition snapshot. Existing requests keep the original sequence even across restart.

Alice is the demo's only process editor. Bob and Carol can inspect the published process but cannot publish. All participants in a request's definition can see it; only its current assigned approver can make a new decision. A repeated approver is allowed in separate uniquely identified steps and must decide each separately. Self-approval is blocked at submission if the applicant appears anywhere in the process.

API listens on `127.0.0.1:8080`; Vite proxies `/api` from its local origin. Do not change bindings to public interfaces. See [backend instructions](backend/README.md) for the data path, API, validation and security details, and [UI instructions](../approval-ui/README.md) for browser behavior.

## Architecture and limits

- `SubmissionWorkflow` uses the actual ArcFlow synchronous DAG to validate and normalize a submission. The core never blocks waiting for a person.
- The separate demo application owns its `PENDING → APPROVED | REJECTED` state machine, identity checks, and JSON snapshot. This does not add durable execution to the core.
- The versioned neutral JSON is executable only for the supported sequential shape: start, 1–8 approvals, end. Array order defines execution; no layout coordinates drive semantics. The backend validates the entire definition and allowed assignees. It is not BPMN XML, an arbitrary graph language or a general import format.
- Snapshot writes are serialized and atomically replaced, with an exclusive local file lock. Successful mutations survive a normal restart at the same data path. This is not a distributed store, database transaction system, power-loss guarantee, tamper-evident audit, tenant boundary or backup strategy.
- Decisions include a stable step ID. Repeating the same authorized decision for that step returns the current request without another event or advancing a later step; the opposite decision conflicts. A changed comment on a repeat is ignored. Submission itself has no API idempotency key: refresh after ambiguous network failure before creating another request.
- Publishing uses an expected version to prevent lost edits. Drafts live only in the current browser session; publish to persist. Schema-1 single-approver saved data is validated and migrated without discarding requests; new writes use schema 2. Back up demo data before switching versions; the older binary cannot read schema-2 snapshots.
- There is no RuoYi integration, role/department directory adapter, general drag-and-drop graph editor, delegation, reassignment, timer, conditional route or parallel approval in this demo.

## Verify

```bash
mvn verify
bash scripts/test.sh
mvn install
mvn -f examples/approval-demo/backend/pom.xml verify
(cd examples/approval-ui && npm ci && npm test && npm run build)
```

The root CI checks the Java core on Java 17/21. The additional approval-demo workflow checks the backend on Java 17/21 and the UI on Node 22. Test and CI status should be checked for the exact commit being evaluated.
