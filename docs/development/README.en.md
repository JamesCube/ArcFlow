# Developer guide

<!-- Legacy fragments remain entry points after the language split. -->
<a id="先建立三个概念"></a>
<a id="开发文档--developer-guide"></a>
<a id="按任务阅读"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](README.md) · [Documentation](../README.en.md)

Start here to run the source, integrate a host, change approval rules, and verify storage upgrades. These pages describe current `main`; the Java artifact version is `0.1.0-SNAPSHOT`. They do not imply that `v0.1.0-alpha.3` or another historical tag includes every current feature, or that this project is production-ready.

<!-- topic:choose-your-task -->
## Choose your task

| Task | Start here |
| --- | --- |
| Install tools, run the backend/UI, and execute checks | [Development setup and verification](QUICKSTART.en.md#en) |
| Locate module boundaries, request flow, and extension points | [Architecture and extension](ARCHITECTURE.en.md#en) |
| Configure JSON/JDBC and plan compatible upgrades | [Persistence and migration](PERSISTENCE.en.md#en) |
| Integrate HTTP fields, errors, and retry behavior | [API reference](../api/API_REFERENCE.en.md) |
| Run reusable HTTP request examples | [API examples](../api/examples/README.en.md) |
| Complete your first approval before reading the internals | [First approval](../GETTING_STARTED.en.md#english) |
| Reuse RuoYi identities, menus, and permissions | [Native RuoYi integration](../../examples/ruoyi-vue3/README.en.md) |
| Contribute code or documentation | [Contributing](../../CONTRIBUTING.en.md) |

<!-- topic:three-distinctions-to-keep-in-mind -->
## Three distinctions to keep in mind

1. **The core is not an approval server.** `arcflow-core` is a synchronous DAG runner without third-party runtime dependencies. Human decisions, immutable versions, and persistence belong to `approval-domain` and its adapters.
2. **A registered type does not enable an endpoint.** The domain has nine business types. The standalone six-scenario catalog, leave/procurement workspace, and dedicated quote page have separate entry points. Generic `/api/documents` accepts only leave and procurement.
3. **There are three separate version systems.** Process definitions support schema **4**, JSON file snapshots support wrapper **13**, and optional JDBC uses SQL revision **3**. Unchanged SQL tables do not make application binaries interchangeable.

Restricted conditions are available only in the standalone expense, payment, receiving, and contract scenarios. SINGLE/ALL/ANY voting and condition matching are independent. Conditions select additional human reviews; they do not make payments, post stock, or sign contracts.

Detailed contracts and historical evidence remain in the focused guides: [parallel approval](../PARALLEL_APPROVAL.en.md), [submission idempotency](../SUBMISSION_IDEMPOTENCY.en.md), [member inbox](../MEMBER_INBOX.en.md), [conditional routing](../CONDITIONAL_ROUTING.en.md), and [host dependency migration](../SUPPORTED_HOST_MIGRATION.en.md). Check the revision and date behind old test counts or local-candidate notes; those records are not acceptance evidence for your current commit.
