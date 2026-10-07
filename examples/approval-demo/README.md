# Local human-approval demo

Try human approvals with ArcFlow: publish an ordered process, submit a sample leave request, approve or reject its steps, and see the saved result and history. Steps can have one approver or an ALL/ANY group.

**Run this on localhost with synthetic data only.** The example pins Spring Boot 3.5.16 to stay on Boot 3, which has [ended OSS support](https://spring.io/blog/2026/06/25/spring-boot-3-5-16-available-now/). Keep it off the public internet and do not enter real leave or health information. It is not ready for production use.

## Run

You need a full JDK 17+, Maven 3.9+, Node 22.22.2+ and npm. Start these commands at the repository root.

```bash
# Install the small, dependency-free-at-runtime Java core locally.
mvn install
mvn -f examples/approval-domain/pom.xml install

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

Alice is the only process editor. Bob and Carol can view the published process but cannot publish changes. A request is visible to its applicant and everyone assigned in its saved definition. Only an eligible participant in the current step can make a new decision. You can assign the same person to several steps, but each step needs a separate decision. Submission is rejected if the applicant is assigned anywhere in the process.

The API listens on `127.0.0.1:8080`; Vite proxies `/api` from its local origin. Do not change bindings to public interfaces. See [backend instructions](backend/README.md) for the data path, API, validation and security details, and [UI instructions](../approval-ui/README.md) for browser behavior.

## Architecture and limits

- `SubmissionWorkflow` uses the actual ArcFlow synchronous DAG to validate and normalize a submission. The core never blocks waiting for a person.
- The approval application handles `PENDING → APPROVED | REJECTED`, identity checks and JSON persistence through the shared approval domain. The core does not persist or resume a DAG while waiting for a person.
- Process JSON supports one shape: start, 1–8 ordered approval stages, end. Schema 2 supports single approvers; schema 3 also supports ALL/ANY groups. Array order determines execution, and the backend validates the full definition and allowed assignees. Layout coordinates have no effect. BPMN XML and arbitrary graphs are not supported.
- Snapshot writes are serialized and atomically replaced, with an exclusive local file lock. Successful mutations survive a normal restart at the same data path. This is not a distributed store, database transaction system, power-loss guarantee, tamper-evident audit, tenant boundary or backup strategy.
- Decisions include a stable step ID. Repeating the same authorized decision for that step returns the current request without another event or advancing a later step; the opposite decision conflicts. A changed comment on a repeat is ignored. Submission accepts the optional `Idempotency-Key` header. Keep the same key, normalized intent and original process version after an uncertain response; replay returns the current original request. Missing keys retain legacy behavior. See [durable submission semantics](../../docs/SUBMISSION_IDEMPOTENCY.md).
- Publishing uses an expected version to prevent lost edits. Drafts live only in the current browser session; publish to persist. Schema-1 single-approver saved data is validated and migrated without discarding requests; unkeyed writes use snapshot schema 2/3 according to the definitions, while the first keyed creation upgrades to snapshot schema 4 with a byte-exact backup. Definition schemas stay 2/3. Back up data and upgrade all hosts before enabling the keyed clients; older binaries cannot read schema-4 snapshots. See the [upgrade contract](../../docs/SUBMISSION_IDEMPOTENCY.md#upgrade-and-rollback--升级与回退).
- This standalone demo has no RuoYi or role/department directory integration, general drag-and-drop graph editor, delegation, reassignment, timers or conditional routes. ALL/ANY groups are supported within the ordered process. See the [separate RuoYi example](../ruoyi-vue3/README.md) for directory-backed users.

## Verify

```bash
mvn verify
bash scripts/test.sh
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml verify
(cd examples/approval-ui && npm ci && npm test && npm run build)
```

Root CI tests the Java core on Java 17/21. The approval-demo workflow tests the backend on Java 17/21 and the UI on Node 22. Check the results for the commit you plan to use.
