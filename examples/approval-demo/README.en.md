# Local approval demo

<!-- Legacy fragments remain entry points after the language split. -->
<a id="architecture-and-limits"></a>
<a id="local-human-approval-demo"></a>
<a id="run"></a>
<a id="verify"></a>

[简体中文](README.md)


<!-- topic:scope -->
Applies to the current source and Java artifact `0.1.0-SNAPSHOT`. This standalone Spring Boot and Vue example covers submission, ordered review, group voting and immutable history. Run it on localhost with synthetic data only; it is not a public deployment template.

<!-- topic:run -->
## Run your first approval

Use a full JDK 17+, Maven 3.9+, Node.js matching the frontend package.json, and npm. The [development setup](../../docs/development/QUICKSTART.en.md) gives the complete setup. Run these commands from the repository root:

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
read -rs -p 'Alice demo password: ' APPROVAL_ALICE_PASSWORD; echo
read -rs -p 'Bob demo password: ' APPROVAL_BOB_PASSWORD; echo
read -rs -p 'Carol demo password: ' APPROVAL_CAROL_PASSWORD; echo
export APPROVAL_ALICE_PASSWORD APPROVAL_BOB_PASSWORD APPROVAL_CAROL_PASSWORD
mvn -f examples/approval-demo/backend/pom.xml spring-boot:run
```

Choose three different demo passwords, each at least 12 characters and no more than 72 UTF-8 bytes. In another terminal:

```sh
cd examples/approval-ui
npm ci
npm run dev
```

Open `http://localhost:5173`:

1. Sign in as Alice and publish two approval steps, Bob then Carol.
2. Submit a synthetic leave or procurement request as Alice.
3. Approve as Bob. The request should remain pending and advance to Carol.
4. Approve or reject as Carol. Alice should see the final result and individual decisions.
5. Publish a different process and inspect the original request. Its submitted process and business snapshot should remain unchanged.

The backend listens on `127.0.0.1:8080`; Vite proxies `/api` to it. Keep both services off public interfaces.

<!-- topic:boundaries -->
## Identity, process and persistence

- Alice can publish. Bob and Carol can read requests where they participate in the selected route, including future or handled stages; voting is limited to an eligible current stage. Submission is rejected if the applicant appears anywhere in the definition.
- The generic workspace supports ordered SINGLE/ALL/ANY stages. Restricted conditions are available only in the dedicated [payment, receiving and contract scenarios](../../docs/CONDITIONAL_ROUTING.en.md). Arbitrary graphs and BPMN are unsupported.
- The ArcFlow core runs a synchronous validation DAG; the shared approval domain owns human-review state.
- Publication checks an expected version. Later publication never edits existing requests. Browser drafts are memory-only and disappear on reload or sign-out.
- After an uncertain submission response, keep its key, payload and original process version. Inspect saved requests or follow the [idempotency contract](../../docs/SUBMISSION_IDEMPOTENCY.en.md) before creating another submission.
- Default JSON persistence requires one writer and a stable private local path. Follow [persistence and migration](../../docs/development/PERSISTENCE.en.md) for upgrades and recovery. It does not provide tenancy, distributed transactions or operational backups.

<!-- topic:verify -->
## Verify and troubleshoot

```sh
mvn verify
bash scripts/test.sh
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml verify
(cd examples/approval-ui && npm ci && npm test && npm run build)
```

Check password environment variables for authentication failures. For rejected writes, check the allowed Origin and `X-Arcflow-Client` header. Refresh after a version conflict and reapply the preserved draft. Stop and use the recovery procedure if the data path is unwritable, corrupt or incompatible; never replace the store with empty data to hide an error.

A successful build does not establish browser or real-database acceptance. Check CI for your exact commit, then consult the [backend](backend/README.en.md), [UI](../approval-ui/README.en.md) and [API reference](../../docs/api/API_REFERENCE.en.md).
