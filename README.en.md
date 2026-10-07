# ArcFlow

Add approval flows to a Java application. Set up steps and reviewers in the Vue designer, then track each request with its original process version and decision history.

Start with the leave-request demo: submit a request, switch accounts to approve it, and check the result. The RuoYi example shows how to connect approvals to an existing application.

[简体中文](README.md) · [Quick start](#quick-start) · [Business examples](#business-examples) · [RuoYi setup](examples/ruoyi-vue3/README.md) · [Docs](#docs-and-source)

[![Java CI](https://github.com/JamesCube/ArcFlow/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/JamesCube/ArcFlow/actions/workflows/ci.yml)
[![Approval demo CI](https://github.com/JamesCube/ArcFlow/actions/workflows/approval-demo.yml/badge.svg?branch=main)](https://github.com/JamesCube/ArcFlow/actions/workflows/approval-demo.yml)
[![RuoYi integration](https://github.com/JamesCube/ArcFlow/actions/workflows/ruoyi-integration.yml/badge.svg?branch=main)](https://github.com/JamesCube/ArcFlow/actions/workflows/ruoyi-integration.yml)

<a id="try-one-leave-approval"></a>
<a id="fast-local-tryout-one-terminal"></a>

## Quick start

On Linux, macOS or WSL, the recommended setup is Git, Python 3.9+, a full JDK 17+, Maven 3.9+, and Node 22.22.2+ within 22.x, including npm. The [full version ranges](docs/TRYOUT.md#requirements) include other supported versions. No database is needed.

```bash
git clone https://github.com/JamesCube/ArcFlow.git
cd ArcFlow
python3 scripts/tryout.py
```

Open the URL printed in your terminal. The launcher also tells you where to find the local file containing the demo passwords.

1. **Submit as Alice.** Create a leave request with test data.
2. **Review as Bob.** Sign out, sign in as Bob, and approve the request in **Needs my review**.
3. **Check as Alice.** Sign back in to see the result, saved process and decision history.

To try two steps, use Alice's designer to add Carol after Bob, publish, and submit a new request.

Ctrl-C stops the services and deletes that run's data. Use the [manual setup](docs/GETTING_STARTED.md#english) if you want to keep the data. The current version is `0.1.0-SNAPSHOT`; run it locally with test data. APIs may change.

## Business examples

The leave demo is the starting point for applying approvals to other business tasks. Here's where each example stands:

| Application | What gets reviewed | Status |
| --- | --- | --- |
| **Smart CRM** | Quote discounts: sales submits a quote, a manager checks the discount, and finance reviews the amount | Planned; no runnable example yet |
| **Office automation (OA)** | Leave requests: an employee enters the duration and reason; assigned reviewers decide in order | [Runnable](docs/GETTING_STARTED.md#english), including the RuoYi example |
| **ERP** | Purchase requests: enter the item, quantity and unit price, then review the need and cost | API in unmerged [PR #16](https://github.com/JamesCube/ArcFlow/pull/16); the purchase form is not published |

The Smart CRM forms and AI features aren't implemented.

## Design and review

| Vue designer | Approvals inside RuoYi |
| --- | --- |
| [![Approval steps and participant settings in the Vue designer](docs/images/designer-desktop-836e605.png)](docs/images/designer-desktop-836e605.png) | [![Approval configuration inside RuoYi's native navigation](docs/images/ruoyi-native-process-editor.png)](docs/images/ruoyi-native-process-editor.png) |
| Choose the steps, reviewers and completion rules. [More screenshots](docs/DESIGNER_SHOWCASE.md#english) | Use RuoYi's login, users, menus and permissions. [Setup guide](examples/ruoyi-vue3/README.md) |

These images show earlier versions. Click for the originals; capture versions and sources are listed in the [designer gallery](docs/DESIGNER_SHOWCASE.md#english) and [RuoYi gallery](docs/RUOYI_SHOWCASE.md#english).

- **Single reviewers, ALL and ANY groups.** A process has 1–8 steps. ALL requires everyone's approval and rejects on the first rejection. ANY passes on the first approval and rejects only when everyone rejects.
- **A saved process for each request.** Publishing a new version doesn't reroute requests already submitted.
- **Worklists, notes and history.** The server checks who can view and review requests, saves decisions, and lets you retry the same decision for the same step without adding another history entry. See [submission idempotency](docs/SUBMISSION_IDEMPOTENCY.md) for retrying a failed submission.
- **Desktop and H5.** The standalone UI supports English and Chinese. There's also a separate [mobile-browser approval client](examples/approval-mobile/README.md).

## Connect an application

The RuoYi example adds approval pages to its native menus and reuses existing accounts and permissions. For another Java application, start with the approval domain and storage interfaces. The business model on `main` is still leave-specific.

| Module or example | What it covers |
| --- | --- |
| [approval-domain](examples/approval-domain/README.md) | Approval rules, process versions, state transitions and the `ApprovalStore` interface |
| [Spring Boot backend](examples/approval-demo/backend/README.md) | HTTP endpoints, identity checks and host configuration |
| [RuoYi integration](examples/ruoyi-vue3/README.md) | Setup for RuoYi-Vue + RuoYi-Vue3 |
| [JDBC storage](examples/approval-jdbc/README.md) | Database persistence for approval data and audit history |

Both demos store approval data in local JSON and support one instance. RuoYi's MySQL database holds users, roles and menus; it doesn't automatically store approvals. JDBC needs explicit setup and migrations. Tenant isolation, pagination, transactions spanning business tables, and an outbox aren't implemented yet.

Conditional routing, dynamic role resolution, timers, withdrawal and delegation are also missing. Native apps, mini-programs, Feishu, WeCom and DingTalk integrations are unfinished. There's no production-readiness guarantee or BPMN compatibility. See the [roadmap](docs/ROADMAP.md) for planned work.

## Run just the Java core

The synchronous DAG runner works on its own, with no third-party runtime dependencies or Spring requirement:

```bash
mvn verify
java -cp target/classes com.arcflow.example.QuickStart
```

[QuickStart.java](src/main/java/com/arcflow/example/QuickStart.java) runs handlers in dependency order. The core doesn't persist execution state or wait for people. Running it again reruns every node, and external actions aren't automatically rolled back.

## Docs and source

[First approval and troubleshooting](docs/GETTING_STARTED.md#english) · [Group approval rules](docs/PARALLEL_APPROVAL.md) · [Submission idempotency](docs/SUBMISSION_IDEMPOTENCY.md) · [Integration design](docs/INTEGRATION_DESIGN.md) · [Contributing](CONTRIBUTING.md)

[Open an issue](https://github.com/JamesCube/ArcFlow/issues) with the commit, environment, command and error details if something fails. Remove credentials and real personal data first.

The published [`v0.1.0-alpha.1`](https://github.com/JamesCube/ArcFlow/releases/tag/v0.1.0-alpha.1) is an older sequential-approval version. It doesn't include the current designer, ALL/ANY or JDBC. Use current source to try those features.

[Apache License 2.0](LICENSE). Separately downloaded RuoYi projects keep their MIT licenses. This project isn't endorsed by RuoYi upstream.
