# ArcFlow｜弧流

轻量 Java DAG 内核、支持单人 / ALL / ANY 的 Vue 审批设计器，以及基于官方若依应用的参考集成。

简体中文 · [English](README.en.md) · [完成第一笔审批](docs/GETTING_STARTED.md#简体中文) · [若依接入](examples/ruoyi-vue3/README.md) · [参与贡献](CONTRIBUTING.md)

[![Java CI](https://github.com/JamesCube/ArcFlow/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/JamesCube/ArcFlow/actions/workflows/ci.yml)
[![Approval demo CI](https://github.com/JamesCube/ArcFlow/actions/workflows/approval-demo.yml/badge.svg?branch=main)](https://github.com/JamesCube/ArcFlow/actions/workflows/approval-demo.yml)
[![RuoYi integration](https://github.com/JamesCube/ArcFlow/actions/workflows/ruoyi-integration.yml/badge.svg?branch=main)](https://github.com/JamesCube/ArcFlow/actions/workflows/ruoyi-integration.yml)

**实验阶段：`0.1.0-SNAPSHOT`，API 尚不稳定。示例仅用于 localhost 和合成数据，不适合直接用于生产审批。**

## 先看设计器：中文节点配置，桌面与移动端实拍

连接处插入节点，在同一个面板配置单人审批、全员同意（ALL）或任一同意（ANY），再发布为可执行的审批流程。

[![ArcFlow 中文优先设计器：流程卡片、ANY 参与人配置与发布状态](docs/images/designer-desktop-836e605.png)](docs/DESIGNER_SHOWCASE.md#简体中文)

- **设计与运行连在一起：** 顺序阶段中可使用单人或 ALL/ANY 分组；已提交申请固定原流程快照。
- **专注当前节点：** 连接处插入、单节点配置面板、本地撤销/重做；窄屏改为上下布局。
- **按需选择存储：** 独立演示默认 JSON；可选 JDBC 已通过真实 MySQL **8.0.46 / 8.4.11 × Java 17 / 21** 验证。[逐项证据](examples/approval-jdbc/MYSQL_VERIFICATION.md#verified-server-acceptance-2026-10-05)

[查看桌面 / 390px 移动端图集与验证来源 →](docs/DESIGNER_SHOWCASE.md#简体中文) · [一键本地试用 →](#一键本地试用一个终端)

截图来自 [`836e605` 的 Chromium CI](https://github.com/JamesCube/ArcFlow/actions/runs/37257554086)，与已合并的 [`e1ee9c6`](https://github.com/JamesCube/ArcFlow/commit/e1ee9c6bdb971949c4f8746fe88b9ff49e6d4c36) 源码树相同。中文优先仅覆盖设计器，外围演示界面仍为英文。当前若依宿主也已开放 [ALL/ANY 分组](examples/ruoyi-vue3/README.md#configure-and-vote-in-groups)；以下较早的若依截图仍展示顺序审批。两个演示均不会自动切换为 JDBC。

## 开源项目集成实拍：RuoYi × ArcFlow

在官方若依的菜单与权限体系里，设计、发布并完成一笔两级审批。

[![官方若依宿主中的 ArcFlow 两级顺序审批设计器](docs/images/ruoyi-native-process-editor.png)](docs/images/ruoyi-native-process-editor.png)

**原生若依工作台 · 流程设计。** 左侧保留若依导航，ArcFlow 页面配置 Team review → Final review，审批人来自若依用户。真实 Chromium 截图，使用合成测试账号。

[![官方若依宿主中已完成的两级审批与流程快照、操作记录](docs/images/ruoyi-native-approved-history.png)](docs/images/ruoyi-native-approved-history.png)

**审批闭环 · 实例快照与记录。** 两位指定审批人依次通过，申请显示“已通过”，保留提交时的 v3 定义与逐步操作记录。点击图片查看原始 1440 px 截图。

[查看集成案例与验证证据 →](docs/RUOYI_SHOWCASE.md#简体中文) · [按锁定版本接入 →](examples/ruoyi-vue3/README.md)

截图来自 [`48f9b68` 的原生浏览器 CI](https://github.com/JamesCube/ArcFlow/actions/runs/37091568795)，不是概念效果图。若依管理登录、用户、菜单和权限；ArcFlow 管理审批流程与状态。此若依演示的审批状态仍为单写者本地 JSON，本地合成演示不代表生产就绪或上游背书。

## 从哪里开始

| 你想做什么 | 入口 | 环境要求 |
| --- | --- | --- |
| 体验请假审批与单人 / ALL / ANY 设计器 | [独立演示](#先完成一笔请假审批) | 完整 JDK 17+、Maven 3.9+、Node 22.22.2+（22.x）、npm；无需数据库 |
| 在真正的若依登录、菜单和权限中接入审批 | [官方若依参考集成](examples/ruoyi-vue3/README.md) | Git、Python 3、Java 17、Maven 3.9+、Node 22、MySQL 8.4、Redis 7.4 |
| 阅读或嵌入同步 Java DAG | [纯 Java 示例](#只运行-java-内核) | 完整 JDK 17+；常规构建需要 Maven 3.9+ |

只想了解审批闭环，先运行独立演示。若依示例会下载锁定提交的官方上游代码，使用原生若依身份体系，与独立演示共享审批领域库；它不是给演示登录页换皮。

## 先完成一笔请假审批

### 一键本地试用（一个终端）

从当前 `main` 或图集标注的已验证提交检出源码，安装 Python 3.9+ 及构建工具后，在仓库目录运行：

```bash
python3 scripts/tryout.py
```

脚本检查环境与端口、构建演示、生成私有演示密码，并显示本机地址与密码文件路径。Ctrl-C 停止两个服务并删除本次演示数据；无需数据库，不会安装系统工具。版本要求、端口设置、源码包与排障见 [TRYOUT](docs/TRYOUT.md)。本命令启动独立宿主；[若依接入](examples/ruoyi-vue3/README.md)仍按单独步骤运行。

已有的 [`v0.1.0-alpha.1`](https://github.com/JamesCube/ArcFlow/releases/tag/v0.1.0-alpha.1) 仍是旧顺序审批快照，不包含上面的新设计器、ALL/ANY 或 JDBC；试用新能力请使用当前源码。

### 手动启动（保留本地数据）

使用 Bash（Linux、macOS 或 WSL）、Git 和上表环境。首次下载依赖需要网络。终端 1，从新检出的仓库开始：

```bash
git clone https://github.com/JamesCube/ArcFlow.git
cd ArcFlow
mvn install
mvn -f examples/approval-domain/pom.xml install

# 私有本地演示数据；重启时复用这个绝对路径。
umask 077
mkdir -p "$PWD/examples/approval-demo/backend/data"
export APPROVAL_DATA_FILE="$PWD/examples/approval-demo/backend/data/requests.json"

# 设置三个不同的、至少 12 个字符的演示专用密码。
read -rs -p 'Alice demo password: ' APPROVAL_ALICE_PASSWORD; echo
read -rs -p 'Bob demo password: ' APPROVAL_BOB_PASSWORD; echo
read -rs -p 'Carol demo password: ' APPROVAL_CAROL_PASSWORD; echo
export APPROVAL_ALICE_PASSWORD APPROVAL_BOB_PASSWORD APPROVAL_CAROL_PASSWORD
mvn -f examples/approval-demo/backend/pom.xml spring-boot:run
```

终端 2，从同一个仓库目录开始：

```bash
cd examples/approval-ui
npm ci
npm run dev
```

打开 **http://localhost:5173**：

1. 选择 **Alice**，输入刚设置的密码。提交标题为 `Demo leave`、原因为 `Synthetic test`、天数为 `1` 的合成申请。
2. 退出登录，切换 **Bob**，打开 **Needs my review**，选中该申请并同意。
3. 重新以 Alice 登录。申请应为 **approved**，可查看该实例的流程快照与操作历史。

全新数据文件默认只有一个 Bob 审批步骤。想体验设计器，以 Alice 打开 **Process designer**，在 Bob 后新增 Carol 步骤并点击 **发布流程**，再提交一笔新申请。Bob 同意后流转到 Carol，Carol 同意后完成；已有申请仍保留原来的流程版本。

[完整操作、重启验证与常见问题 →](docs/GETTING_STARTED.md#简体中文)

## 当前能力

| 能力 | Java 内核 | 独立演示 / 若依示例 |
| --- | --- | --- |
| DAG 校验、同步串行处理器 | 已实现 | 用于申请的校验与规范化 |
| 增删、排序、指定 1–8 个审批步骤 | 不属于内核 | Vue 已实现 |
| 流程版本发布、实例固定定义快照 | 不属于内核 | 共享审批领域库已实现 |
| 顺序人工审批、终态拒绝、逐步骤重试保护 | 不属于内核 | 已实现；仅当前指定审批人可操作 |
| 身份与权限 | 由接入方提供 | 演示账号 / 若依原生用户、角色和权限 |
| 重启恢复 | 无 | 演示默认单写者 JSON；可选 [JDBC 适配器](examples/approval-jdbc/README.md)提供数据库事务与持久审计 |
| 固定参与人会签 ALL / 或签 ANY | 不属于内核 | [领域与 JSON/JDBC 已实现](docs/PARALLEL_APPROVAL.md)；独立演示与若依原生界面均支持参与人分组与逐人投票 |
| 条件路由、定时器、转办 | 未实现 | 未实现 |
| BPMN XML / BPMN 2.0 兼容 | 未实现 | 未实现 |

内核没有第三方运行时依赖，也不强依赖 Spring。审批 HTTP API 和 Vue 界面位于示例层；尚未发布 Spring Boot Starter 或 Maven Central 制品。

## 分层与边界

```text
独立 Vue 界面 → Spring Boot 演示宿主 ─┐
                                    ├→ approval-domain → ArcFlow Java DAG
官方若依 Vue 界面 → 若依宿主 ────────┘        │            （提交校验）
                                             └→ ApprovalStore：本地 JSON / 可选 JDBC
```

- `approval-domain` 管理人工等待、顺序阶段 / 并行分组状态流转、定义快照与存储 SPI。可选 `approval-jdbc` 将请求、审批修订号和审计事件在同一事务内提交；内核不会等待人工处理。
- JDBC 接入、`arc_` 数据库迁移、PostgreSQL / H2 测试命令及已通过真实 MySQL 8.0 / 8.4 验证的实验性适配见 [事务审批存储](examples/approval-jdbc/README.md)。它是独立可选模块，不会自动替换两个演示的存储。
- 若依的 MySQL 仅存储用户、角色和菜单；审批仍存储于私有本地 JSON 文件，不支持多个实例或网络文件系统。
- JDBC 首个切片覆盖多服务实例的修订号竞争、步骤幂等重试、事务回滚和定义版本快照。它尚无租户隔离、分页、业务表联合事务或 outbox；不承诺通用生产就绪、高吞吐、分布式事务或 exactly-once。独立示例的框架版本和支持限制见其 [README](examples/approval-demo/README.md)。
- 内核 DAG 分支表达依赖，不是并行执行或条件路由；所有根节点都会执行，就绪节点按声明顺序运行。字符串变量共享一个命名空间，后写覆盖先写。
- 每次内核执行均从头开始，重复执行会重跑全部节点。处理器或监听器失败不会回滚外部副作用，同步事件回调不是持久化机制；线程安全和业务幂等性由接入方负责。
- 申请提交支持[持久化幂等键](docs/SUBMISSION_IDEMPOTENCY.md)：同一用户使用原键与原意图重试会返回原申请，改动意图返回冲突。不带键仍可能重复创建；页面重载丢失客户端键后先刷新确认结果。审批决定按实例已保存的步骤提供同决定重试保护，详见 [顺序审批契约](docs/SEQUENTIAL_APPROVAL.md)。

## 只运行 Java 内核

在仓库根目录运行：

```bash
mvn verify
java -cp target/classes com.arcflow.example.QuickStart
```

预期输出：

```text
[validate, price, summary]
Order DEMO-001: 120
```

有完整 JDK 时，`bash scripts/test.sh` 可以不依赖 Maven 或下载依赖运行内核检查与示例；它**不会**启动或验证审批应用。完整代码见 [QuickStart.java](src/main/java/com/arcflow/example/QuickStart.java)。

## 阅读代码与参与贡献

- [内核与处理器 / 事件 SPI](src/main/java/com/arcflow/) · [内核测试](src/test/java/com/arcflow/)
- [共享审批领域库](examples/approval-domain/) · [独立后端](examples/approval-demo/backend/README.md) · [Vue 界面](examples/approval-ui/README.md)
- [官方若依集成与归属说明](examples/ruoyi-vue3/README.md) · [顺序审批契约](docs/SEQUENTIAL_APPROVAL.md)
- [贡献说明](CONTRIBUTING.md) · [路线图](docs/ROADMAP.md) · [集成设计](docs/INTEGRATION_DESIGN.md)

欢迎提供可复现的首次运行反馈、权限 / 重试边界回归测试及文档修正。[报告问题](https://github.com/JamesCube/ArcFlow/issues)时请附提交版本、操作系统、Java / Node 版本、命令、预期和实际结果。新增状态机或持久化行为请先讨论；不要附带密码或真实人员数据。

徽章跟踪 `main`；评估时请查看具体提交的工作流结果。构建和 API 测试通过不等于浏览器验证或生产就绪。

## 许可证

[Apache License 2.0](LICENSE)。另行下载的官方若依项目保留其 MIT 许可证；本集成不代表上游背书。

## 移动审批（H5 首片）

独立的 uni-app Vue 3 [移动审批客户端](examples/approval-mobile/README.md) 已提供真实后端待办、审批意见和历史闭环。构建、单元/HTTP 和 Chromium 移动闭环已验证；[具体范围与截图来源](examples/approval-mobile/ACCEPTANCE.md)列出已测与未测项目。App/小程序、真机和飞书/企微/钉钉接入仍待单独验收。
