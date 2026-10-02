# Local human-approval demo

An experimental vertical slice for ArcFlow: submit a synthetic leave request, authenticate as the designated approver, approve or reject, and inspect persisted status/history.

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

Open **http://localhost:5173**, sign in as `alice`, submit a synthetic request assigned to `bob`, sign out, and sign in as `bob` with Bob's demo password. Approve or reject the request. Return as Alice to inspect the final status and activity. Carol cannot see or decide a request assigned to Bob. The page's process blueprint is read-only; general graph editing is not implemented.

API listens on `127.0.0.1:8080`; Vite proxies `/api` from its local origin. Do not change bindings to public interfaces. See [backend instructions](backend/README.md) for the data path, API, validation and security details, and [UI instructions](../approval-ui/README.md) for browser behavior.

## Architecture and limits

- `SubmissionWorkflow` uses the actual ArcFlow synchronous DAG to validate and normalize a submission. The core never blocks waiting for a person.
- The separate demo application owns its `PENDING → APPROVED | REJECTED` state machine, identity checks, and JSON snapshot. This does not add durable execution to the core.
- The versioned neutral process JSON describes one fixed supported template; layout is separate from node/edge semantics. It is not BPMN XML and is not a general executable designer import format.
- Snapshot writes are serialized and atomically replaced, with an exclusive local file lock. Successful mutations survive a normal restart at the same data path. This is not a distributed store, database transaction system, power-loss guarantee, tamper-evident audit, tenant boundary or backup strategy.
- Repeating the same authorized terminal decision returns the original result without another history event; the opposite decision conflicts. A changed comment on a repeat is ignored. Submission itself has no API idempotency key: refresh after ambiguous network failure before creating another request.
- There is no RuoYi integration, role/department directory adapter, editable designer, delegation, reassignment, timer, conditional route or multi-person approval in this demo.

## Verify

```bash
mvn verify
bash scripts/test.sh
mvn install
mvn -f examples/approval-demo/backend/pom.xml verify
(cd examples/approval-ui && npm ci && npm test && npm run build)
```

The root CI checks the Java core on Java 17/21. The additional approval-demo workflow checks the backend on Java 17/21 and the UI on Node 22. Test and CI status should be checked for the exact commit being evaluated.
