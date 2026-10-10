# Enterprise framework and designer integration proposal

<!-- Legacy fragments remain entry points after the language split. -->
<a id="企业框架与-vue-设计器集成设计规划"></a>
<a id="前端参考示例"></a>
<a id="后端适配边界"></a>
<a id="版本化模型隔离-ui-与运行时"></a>
<a id="示例需要验证什么"></a>
<a id="首个参考接入方向"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](INTEGRATION_DESIGN.md) · [Documentation](README.en.md)

This is a design proposal for general enterprise integration, not a published API. Current source includes standalone approval, a pinned official RuoYi reference, procurement forms, nine document types, six scenarios, and restricted conditions in four dedicated scenarios. See [Architecture](development/ARCHITECTURE.en.md) for exact scope. The resource paths and general DSL below are proposals, not substitutes for the [actual API reference](api/API_REFERENCE.en.md).

<!-- topic:first-reference-integration -->
## First reference integration

The first reference uses official RuoYi-Vue’s `springboot3` branch and RuoYi-Vue3 (Vue 3/Vite/Element Plus). Pin both tags/commits when adapting/updating, and check JDK, Boot, database, authentication, and dependency compatibility. Moving upstream branches are not version pins.

Dromara RuoYi-Vue-Plus is a separate rewrite requiring its own adapter. Choose other Java enterprise frameworks by actual need. Examples remain optional and separate; the core must not depend on a particular authorization system, ORM, or frontend.

Upstream references:
- [Official RuoYi documentation](https://doc.ruoyi.vip/ruoyi-vue/)
- [RuoYi-Vue](https://github.com/yangzongzhuan/RuoYi-Vue)
- [RuoYi-Vue3](https://github.com/yangzongzhuan/RuoYi-Vue3)

Possible later hosts include [Dromara RuoYi-Vue-Plus](https://github.com/dromara/RuoYi-Vue-Plus), which has WarmFlow, and [ruoyi-vue-pro](https://github.com/YunaiV/ruoyi-vue-pro), which has Flowable. ArcFlow adapters should remain independent/optional; replacing existing workflows or migrating their data needs a separate design.

<!-- topic:backend-responsibilities -->
## Backend responsibilities

1. Resolve host user IDs, roles, and departments through an Identity SPI. The host authenticates; the server checks candidates and permissions.
2. Expose authorized APIs for starting instances, worklists, task completion, instance state, and history.
3. Commands carry business references, idempotency keys, and expected versions. Never trust client-declared actor identity or review permission.
4. Define business/engine transaction boundaries and test compensation, event outbox, races, and tenant isolation.
5. Use the `arc_` table prefix. JDBC provides explicit migrations/checks installed by the host, never automatically replacing the RuoYi database.

Proposed resource paths, **not implemented API contracts**:
- POST `/api/arcflow/instances`: start
- GET `/api/arcflow/tasks`: current actor’s pending/handled work
- POST `/api/arcflow/tasks/{id}/complete`: decide
- GET `/api/arcflow/instances/{id}`: state
- GET `/api/arcflow/instances/{id}/history`: authorized history

<!-- topic:frontend-reference -->
## Frontend reference

The proposed complete UI covers submission, pending/handled lists, detail, timelines, and Vue flow design. Existing examples have node properties, pre-publication validation, and read-only snapshots. General conditions and drag configuration need separate design; current restricted scenario conditions are not that general capability. Use independently designed UI and appropriately licensed components. Familiar DingTalk-style interactions may inform the design, without copying proprietary code, brands, or assets.

Adapters connect approval forms to enterprise business forms; the core must not hard-code business fields.

<!-- topic:versioned-model-separate-ui-and-execution -->
## Versioned model, separate UI and execution

A proposed flow document contains `schemaVersion`, `processKey`, `definitionVersion`, `nodes`, `edges`, and separate `designerMetadata`.

- Stable node IDs and explicit policy/condition types; no executable scripts.
- Server validates edges/policies on publication. Designer validation never replaces permissions or engine validation.
- Coordinates/collapsed state belong to designerMetadata and do not change execution.
- Adapters translate UI DSL into engine definitions. Only supported types, including human/condition nodes when supported, may publish and execute.
- Publications are immutable; instances keep their starting version. Editing a diagram does not mutate running instances.
- Define schema upgrades/migrations and compatibility tests. This JSON model is not BPMN XML or BPMN-compatible.

<!-- topic:what-the-reference-must-verify -->
## What the reference must verify

At minimum: publish → start → candidate worklist → authorized decision → history. Also test unauthorized access, duplicates, concurrent decisions, restart, definition upgrades, and tenant isolation. Working screens and a happy path are only a start; production use needs these checks and operational safeguards.
