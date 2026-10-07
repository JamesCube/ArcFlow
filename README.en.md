# ArcFlow

Add approval flows to a Java application. Define the steps in a Vue designer, assign one reviewer or an ALL/ANY group, then try the flow in the standalone demo or the RuoYi integration. The repository also includes a synchronous Java DAG runner you can use on its own.

[简体中文](README.md) · [Getting started](docs/GETTING_STARTED.md#english) · [RuoYi setup](examples/ruoyi-vue3/README.md) · [Contributing](CONTRIBUTING.md)

[![Java CI](https://github.com/JamesCube/ArcFlow/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/JamesCube/ArcFlow/actions/workflows/ci.yml)
[![Approval demo CI](https://github.com/JamesCube/ArcFlow/actions/workflows/approval-demo.yml/badge.svg?branch=main)](https://github.com/JamesCube/ArcFlow/actions/workflows/approval-demo.yml)
[![RuoYi integration](https://github.com/JamesCube/ArcFlow/actions/workflows/ruoyi-integration.yml/badge.svg?branch=main)](https://github.com/JamesCube/ArcFlow/actions/workflows/ruoyi-integration.yml)

The current version is `0.1.0-SNAPSHOT`, and the APIs may change. Run the examples on localhost with test data. They aren't ready to handle production approvals.

## The designer

Insert a step between two nodes, choose its reviewers, then publish the process. Each step can have one reviewer or an ALL/ANY group. Publishing changes the process for new requests; requests already submitted keep their original version.

[![Approval designer showing process steps, an ANY group and publication status](docs/images/designer-desktop-836e605.png)](docs/DESIGNER_SHOWCASE.md#english)

You can add, remove and reorder steps, undo or redo edits, and switch between the flow and step settings on narrow screens. The standalone demo supports English and Chinese. The [RuoYi example](examples/ruoyi-vue3/README.md#configure-and-vote-in-groups) supports group approvals too.

This screenshot comes from [Chromium tests at `836e605`](https://github.com/JamesCube/ArcFlow/actions/runs/37257554086), which has the same source tree as merged commit [`e1ee9c6`](https://github.com/JamesCube/ArcFlow/commit/e1ee9c6bdb971949c4f8746fe88b9ff49e6d4c36). In that version, only the designer had Chinese labels. [See the desktop and 390px screenshots](docs/DESIGNER_SHOWCASE.md#english).

## The RuoYi example

RuoYi handles login, users, menus and permissions. ArcFlow handles process definitions and approval state. The example uses pinned commits from the official RuoYi projects and lets you choose reviewers from RuoYi's user directory.

[![Two-step approval designer inside RuoYi](docs/images/ruoyi-native-process-editor.png)](docs/images/ruoyi-native-process-editor.png)

This process has two steps: Team review, then Final review. Once both reviewers approve, the request is marked approved. Its details still show the v3 process saved at submission and the history of each decision.

[![Approved request with its process snapshot and history inside RuoYi](docs/images/ruoyi-native-approved-history.png)](docs/images/ruoyi-native-approved-history.png)

These screenshots use test accounts and come from [Chromium tests at `48f9b68`](https://github.com/JamesCube/ArcFlow/actions/runs/37091568795), before group approvals were added. Click either image for the 1440px original. [Read the setup notes and test results](docs/RUOYI_SHOWCASE.md#english).

## Where to start

| What you want to do | Start here | Prerequisites |
| --- | --- | --- |
| Submit a leave request and try the designer | [Standalone demo](#try-one-leave-approval) | Full JDK 17+, Maven 3.9+, Node 22.22.2+ within 22.x, npm, Python 3.9+; no database |
| Use RuoYi's login, menus and permissions | [RuoYi setup](examples/ruoyi-vue3/README.md) | Git, Python 3, Java 17, Maven 3.9+, Node 22, MySQL 8.4, Redis 7.4 |
| Use the synchronous Java DAG runner | [Core example](#run-just-the-java-core) | Full JDK 17+; Maven 3.9+ for a normal build |
| Review requests in a mobile browser | [H5 client](examples/approval-mobile/README.md) | Follow the mobile README to start the backend and H5 app |

For a first look, use the standalone demo. The RuoYi example also needs MySQL and Redis.

## Try one leave approval

### Fast local tryout (one terminal)

Check out current `main`, install the tools above, then run this from the repository root:

```bash
python3 scripts/tryout.py
```

The script checks tool versions and ports, builds and starts the demo, and prints the local URL and credentials-file path. Ctrl-C stops both services and deletes that run's data. It doesn't install system tools or need a database. See the [tryout guide](docs/TRYOUT.md) for port settings and troubleshooting. RuoYi has [separate setup steps](examples/ruoyi-vue3/README.md).

The published [`v0.1.0-alpha.1`](https://github.com/JamesCube/ArcFlow/releases/tag/v0.1.0-alpha.1) is an older sequential-approval snapshot. It doesn't include the new designer, ALL/ANY groups or JDBC. To try those, use current source or a commit linked from the screenshot gallery.

### Manual startup (keep local data)

Use Bash (Linux, macOS or WSL), Git and the build tools listed above. The first build needs network access to download dependencies. In terminal 1:

```bash
git clone https://github.com/JamesCube/ArcFlow.git
cd ArcFlow
mvn install
mvn -f examples/approval-domain/pom.xml install

# Private local demo state; reuse this absolute path when restarting.
umask 077
mkdir -p "$PWD/examples/approval-demo/backend/data"
export APPROVAL_DATA_FILE="$PWD/examples/approval-demo/backend/data/requests.json"

# Choose three different demo-only passwords, each at least 12 characters.
read -rs -p 'Alice demo password: ' APPROVAL_ALICE_PASSWORD; echo
read -rs -p 'Bob demo password: ' APPROVAL_BOB_PASSWORD; echo
read -rs -p 'Carol demo password: ' APPROVAL_CAROL_PASSWORD; echo
export APPROVAL_ALICE_PASSWORD APPROVAL_BOB_PASSWORD APPROVAL_CAROL_PASSWORD
mvn -f examples/approval-demo/backend/pom.xml spring-boot:run
```

In terminal 2, from the same checkout:

```bash
cd examples/approval-ui
npm ci
npm run dev
```

Open **http://localhost:5173**:

1. Sign in as **Alice** with the password you just set. Submit a request titled `Demo leave`, with reason `Synthetic test`, for `1` day.
2. Sign out and sign in as **Bob**. Open **Needs my review**, select the request and approve it.
3. Sign back in as Alice. The request should be **approved**, with its process snapshot and decision history in the details.

A fresh data file starts with Bob as the only reviewer. To try two steps, sign in as Alice, open **Process designer**, add Carol after Bob and publish. Submit a new request: Bob's approval sends it to Carol, and Carol's approval completes it. Existing requests keep their original process.

[Full walkthrough and restart checks](docs/GETTING_STARTED.md#english)

## What you can do

- **Set up approval steps.** A process has 1–8 steps. Each step has one reviewer or an ALL/ANY group of 2–16 people. ALL requires everyone's approval and rejects on the first rejection. ANY passes on the first approval and rejects only when everyone rejects.
- **Keep process versions.** Publishing checks for version conflicts. Each request saves the process it was submitted against, so later edits won't change its route.
- **Record decisions.** Only eligible reviewers for the current step who haven't voted can record a new decision. Repeating the same decision is safe; see the [sequential](docs/SEQUENTIAL_APPROVAL.md) and [group approval](docs/PARALLEL_APPROVAL.md) rules.
- **Retry submissions.** An [idempotency key](docs/SUBMISSION_IDEMPOTENCY.md) is saved per applicant. Retrying the same request with its original key returns the saved record; reusing the key with different content returns a conflict. Requests without keys can still create duplicates. If a page reload loses the key, check the request list before resubmitting.
- **Store requests and audit history.** Both demos use local JSON by default. You can wire in the optional [JDBC module](examples/approval-jdbc/README.md) for database storage; it doesn't replace the demo stores automatically. For an earlier JDBC revision, see the [MySQL test results](examples/approval-jdbc/MYSQL_VERIFICATION.md#verified-server-acceptance-2026-10-05) for **8.0.46 / 8.4.11 × Java 17 / 21**.
- **Approve on mobile.** The [uni-app Vue 3 H5 client](examples/approval-mobile/README.md) reads pending requests from the backend, submits decision notes and shows history. The [test report](examples/approval-mobile/ACCEPTANCE.md) lists coverage. Native app and mini-program builds and Feishu, WeCom and DingTalk integrations are unfinished. Physical devices haven't been tested.

Conditional routing, timers, delegation and BPMN XML / BPMN 2.0 compatibility aren't implemented. There is no published Spring Boot Starter or Maven Central artifact yet.

## Before you integrate

```text
Standalone Vue UI → Spring Boot demo host ─┐
                                         ├→ approval-domain → ArcFlow Java DAG
Official RuoYi Vue UI → RuoYi host ────────┘        │            (submission checks)
                                                  └→ ApprovalStore: JSON / optional JDBC
```

`approval-domain` handles waiting for people, state transitions, process snapshots and the storage interface. The Java DAG core validates and normalizes submissions. You can also embed it separately; it has no third-party runtime dependencies and doesn't require Spring.

- **Your application supplies identity.** The standalone demo uses test accounts; the RuoYi example uses RuoYi users, roles and permissions. HTTP APIs and Vue screens are under `examples`.
- **JSON storage supports one instance.** RuoYi's MySQL database stores users, roles and menus, while approval data stays in a local JSON file. Don't share that file between instances or put it on a network filesystem.
- **JDBC still has gaps.** It covers competing revisions, per-step retries, rollback and process snapshots. Requests, revisions and audit events are committed in one transaction. Tenant isolation, pagination, transactions spanning business tables, and an outbox aren't implemented. It provides no high-throughput, distributed-transaction or exactly-once guarantees. See the [JDBC guide](examples/approval-jdbc/README.md) for setup and migrations, and the [demo README](examples/approval-demo/README.md) for framework versions and support limits.
- **The DAG runs synchronously.** Branches describe dependencies. All roots run, and ready nodes execute in declaration order. There's no parallel execution, conditional routing or durable recovery. String variables share one namespace; later writes replace earlier values.
- **Running the core again reruns every node.** A failed handler or listener doesn't undo external actions that already happened. Event listeners run synchronously; the core doesn't persist execution state. Your handlers and listeners need to handle thread safety and business idempotency.

## Run just the Java core

From the repository root:

```bash
mvn verify
java -cp target/classes com.arcflow.example.QuickStart
```

Expected output:

```text
[validate, price, summary]
Order DEMO-001: 120
```

With a full JDK, you can also run `bash scripts/test.sh` without Maven or dependency downloads. It checks the core and runs the example; it doesn't start the approval apps. See [QuickStart.java](src/main/java/com/arcflow/example/QuickStart.java) for the full example.

## Code and contributions

- [Core and handler/event SPI](src/main/java/com/arcflow/) · [Core tests](src/test/java/com/arcflow/)
- [Approval domain](examples/approval-domain/) · [Standalone backend](examples/approval-demo/backend/README.md) · [Vue UI](examples/approval-ui/README.md)
- [RuoYi integration](examples/ruoyi-vue3/README.md) · [Contributing](CONTRIBUTING.md) · [Roadmap](docs/ROADMAP.md) · [Integration design](docs/INTEGRATION_DESIGN.md)

If something doesn't work, [open an issue](https://github.com/JamesCube/ArcFlow/issues) with your commit, OS, Java/Node versions, command, and expected and actual results. Leave out credentials and real personal data. For changes to the state machine or persistence behavior, open an issue to discuss the approach first.

The badges show results for `main`. Check the workflow for your exact commit when evaluating a version; build, API and browser tests cover different things.

## License

[Apache License 2.0](LICENSE). The separately downloaded RuoYi projects keep their MIT licenses. This integration isn't endorsed by upstream.
