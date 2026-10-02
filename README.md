# ArcFlow｜弧流

[English](README.en.md) | 简体中文

以弧串联业务，让流程轻量流转

轻量级 Java 工作流引擎，从小而清晰的内核出发，逐步支持业务审批与 DAG 任务编排。

- Java 包名：`com.arcflow`
- 主入口：`ArcFlowEngine`
- 未来数据库表前缀：`arc_`
- 许可证：Apache License 2.0
- 当前阶段：`0.1.0-SNAPSHOT` 初始骨架，API 尚不稳定，**不适合直接用于生产审批**

## 设计方向

核心不强依赖 Spring；业务审批只选择实用 BPM 子集，不追求完整 BPMN 实现。未来通过可选 Spring Boot Starter、身份适配、持久化和前后端示例接入企业系统。

内核以 Java 17 为最低目标：它是成熟的 LTS 基线，也便于未来接入 Spring Boot 3 生态。当前核心没有第三方运行时依赖。`com.arcflow:arcflow-core` 是项目内拟定坐标，尚未验证 Maven Central 命名空间所有权，也未发布任何制品。

## 当前实现

- 不可变 DAG 定义，校验空流程、重复节点、未知依赖、重复依赖及环
- 按依赖拓扑顺序**同步、串行**执行；多个就绪节点按声明顺序选择
- 显式注册 `NodeHandler` 与同步 `EventListener` SPI
- 字符串变量快照与处理器输出合并；同名键由后执行节点覆盖
- 处理器异常立即终止，并保留失败节点、原始原因与线程中断标记
- 运行前检查所有处理器绑定，避免执行一半才发现处理器缺失
- Java 示例、24 项回归检查、Maven/JUnit 测试入口及 CI 配置

这里的 DAG 分支仅表达依赖关系，并不并行执行；join 表示所有依赖完成，不是审批会签。

## 独立审批示例（实验性）

新增的 [本地审批演示](examples/approval-demo/README.md) 使用 Spring Boot 3 API 和 [Vue 3 界面](examples/approval-ui/README.md)，提供可编辑的顺序审批设计器：增加、删除、排序审批步骤并指定审批人，发布后发起请假申请，逐步同意或终态拒绝。每个实例固定已发布定义快照，后续编辑不会改变运行中的实例。审批状态由独立示例层管理，核心 DAG 行为不变。仅用于本机合成数据演示，不用于真实审批或个人信息。

顺序模型、版本发布与逐步重试规则见 [顺序审批契约](docs/SEQUENTIAL_APPROVAL.md)。

## 内核尚未实现

人工任务、审批人权限校验、会签/或签/加签/转办/退回指定节点、条件路由、异步执行、重试补偿、持久化、事务、定时器、多租户、HTTP API、Spring Boot Starter、Vue 设计器以及若依等框架集成，均为后续路线图。

**没有 BPMN XML 解析或 BPMN 2.0 兼容性承诺。** 不要把事件回调当成持久化审计；不保证 exactly-once，也不会回滚处理器已产生的外部副作用。

## 快速运行

需要完整 JDK 17+；常规构建需要 Maven 3.9+。

```bash
mvn verify
java -cp target/classes com.arcflow.example.QuickStart
```

无 Maven、无网络时，可在完整 JDK 上运行同一组回归检查和示例：

```bash
bash scripts/test.sh
```

预期示例输出：

```text
[validate, price, summary]
Order DEMO-001: 120
```

最小使用：

```java
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

上述代码导入 `com.arcflow.*`、`java.util.List`、`java.util.Map`。完整可执行示例见 [QuickStart.java](src/main/java/com/arcflow/example/QuickStart.java)。

## 执行语义与边界

- 每次 `execute` 都是全新内存执行，没有实例 ID、检查点、恢复或查询历史。
- 所有根节点都会运行。没有条件表达式、跳过状态或人工等待状态。
- 输入及输出变量不允许 null 键/值；只支持字符串值。
- 处理器拿到只读快照；返回变量更新，不直接修改共享上下文。
- 变量属于整个执行的共享命名空间：独立分支也能看到之前串行执行的分支更新，不提供分支隔离。
- 引擎不持有可变运行状态，但处理器及监听器的线程安全由接入方负责。
- 监听器同步调用；STARTED/COMPLETED 回调异常直接中止执行，已发生的副作用保留。FAILED 回调异常作为 suppressed exception 保存，避免掩盖处理器异常。监听器应自行隔离日志/网络故障。
- 处理器必须自行考虑业务幂等性。重复调用 `execute` 会重新运行全部节点。
- 该版 DAG 校验面向小规模流程，不承诺大型图性能。

## 目录

```text
src/main/java/com/arcflow/          内核、模型和异常
src/main/java/com/arcflow/spi/      当前可用的处理器/事件 SPI
src/main/java/com/arcflow/example/  纯 Java 示例
src/test/java/com/arcflow/         Maven 与离线共用的回归检查
scripts/test.sh                    完整 JDK 上的离线验证
docs/                            路线图与未来集成设计
```

## 后续方向

见 [路线图](docs/ROADMAP.md)、[企业框架与 Vue 设计器集成设计](docs/INTEGRATION_DESIGN.md)。欢迎围绕小内核、清晰语义和可测试扩展贡献；暂不承诺发布时间和兼容矩阵。

## 许可证

[Apache License 2.0](LICENSE)。

## Official RuoYi integration example

[Real RuoYi-Vue + Vue 3 overlay](examples/ruoyi-vue3/README.md): pinned upstream applications, native JWT/Redis login, dynamic menus, role permissions and sequential approval. MySQL stores RuoYi identity; approval persistence remains a private single-writer JSON file.
