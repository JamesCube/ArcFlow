# ArcFlow

A small Java workflow core with explicit execution semantics.

[简体中文](README.md) · [QuickStart](src/main/java/com/arcflow/example/QuickStart.java) · [Roadmap](docs/ROADMAP.md)

**Early development: `0.1.0-SNAPSHOT`. APIs may change. The current core is not suitable for production approval workflows.**

ArcFlow starts with an inspectable DAG implementation for Java 17+. The core has no third-party runtime dependencies and does not require Spring. Business approvals and application integrations are development directions; see the implementation status below before evaluating it.

## Run the current example

Requirements: a full JDK 17+ and Maven 3.9+.

```bash
git clone https://github.com/JamesCube/ArcFlow.git
cd ArcFlow
mvn verify
java -cp target/classes com.arcflow.example.QuickStart
```

Expected example output:

```text
[validate, price, summary]
Order DEMO-001: 120
```

With a full JDK, the offline checks and example can also run without Maven:

```bash
bash scripts/test.sh
```

## Try the local approval example

The experimental [approval demo](examples/approval-demo/README.md) pairs a Spring Boot 3 API with a [Vue 3 UI](examples/approval-ui/README.md): design and publish a sequential approval process, submit a leave request, complete each assigned step, and inspect status/history. The Vue designer can add, remove, reorder, name and assign 1–8 approval steps. Every request stores an immutable definition snapshot; later publications affect new requests only.

The demo uses the ArcFlow DAG for synchronous submission validation/normalization. A separate example-layer state machine owns human waiting, authorization and local JSON snapshots. These capabilities do not change the core execution guarantees. Use synthetic data on localhost only. Spring Boot 3.5 is past OSS support; see the demo's dependency and security limitations before running it.

See the [sequential contract](docs/SEQUENTIAL_APPROVAL.md) for definition validation, publishing, per-step retry semantics and saved-data migration.

## What is implemented

- Immutable DAG definitions with validation for empty graphs, duplicate nodes/dependencies, unknown dependencies and cycles
- Synchronous, sequential execution in dependency order; ready nodes use declaration order
- Explicit `NodeHandler` registration and synchronous `EventListener` callbacks
- Read-only string-variable snapshots and merged handler outputs
- Handler-binding validation before execution
- Fail-fast handler errors that preserve the failing node, original cause and interrupt flag
- A Java example, regression checks, a Maven/JUnit test entry point and CI configuration

Branches express dependencies; they do not execute in parallel. A DAG join waits for its dependencies; it is not a multi-person approval operation.

## Minimal Java example

```java
import com.arcflow.*;
import java.util.List;
import java.util.Map;

var workflow = new Workflow("demo", List.of(
    new Node("prepare", "prepare", List.of()),
    new Node("finish", "finish", List.of("prepare"))
));
var engine = new ArcFlowEngine(Map.of(
    "prepare", (node, vars) -> Map.of("message", "Hello ArcFlow"),
    "finish", (node, vars) -> Map.of("result", vars.get("message"))
));
var result = engine.execute(workflow, Map.of());
```

Put this snippet inside a method. For a complete executable class, use [QuickStart.java](src/main/java/com/arcflow/example/QuickStart.java).

## Important limits

Each execution starts in memory, with no persisted instance, recovery or queryable history. All roots execute. Variables are strings in a shared execution-wide namespace; later writes replace earlier values, including across independent branches. Handler and listener thread safety is the application's responsibility.

Repeated execution reruns all nodes. The engine does not guarantee exactly-once behavior or roll back external effects. Callbacks are synchronous and are not durable audit records. STARTED/COMPLETED listener errors stop execution; FAILED listener errors are suppressed on the original failure. Large-graph performance is not promised.

Human tasks, approver authorization, conditional routing, asynchronous execution, retries, persistence, transactions, timers, multi-tenancy, an HTTP API, a Spring Boot Starter, a Vue designer and RuoYi integration are not implemented in this core snapshot. There is no BPMN XML parser or BPMN 2.0 compatibility promise. Project Maven coordinates have not been published to Maven Central.

## Where this project is heading

The focus is a small core with clear semantics and testable extensions. See the [roadmap](docs/ROADMAP.md) and [integration design](docs/INTEGRATION_DESIGN.md) for planned work. Release timing and framework compatibility are not guaranteed.

For Java and RuoYi developers evaluating future approval integration, feedback on identity boundaries, persistence and failure handling is useful. Please include the commit, command and observed result in bug reports. If the project is useful to you, a star helps you find it again.

## License

[Apache License 2.0](LICENSE).

## Official RuoYi integration example

[Real RuoYi-Vue + Vue 3 overlay](examples/ruoyi-vue3/README.md): pinned upstream applications, native JWT/Redis login, dynamic menus, role permissions and sequential approval. MySQL stores RuoYi identity; approval persistence remains a private single-writer JSON file.
