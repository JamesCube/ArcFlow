# ArcFlow｜弧流

ArcFlow 用来给 Java 应用加审批。你可以在 Vue 设计器里安排审批步骤，指定一个人审批，或让一组人会签、或签。仓库里有独立演示和若依接入示例，也有可以单独使用的同步 Java DAG 内核。

简体中文 · [English](README.en.md) · [开始使用](docs/GETTING_STARTED.md#简体中文) · [若依接入](examples/ruoyi-vue3/README.md) · [参与贡献](CONTRIBUTING.md)

[![Java CI](https://github.com/JamesCube/ArcFlow/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/JamesCube/ArcFlow/actions/workflows/ci.yml)
[![Approval demo CI](https://github.com/JamesCube/ArcFlow/actions/workflows/approval-demo.yml/badge.svg?branch=main)](https://github.com/JamesCube/ArcFlow/actions/workflows/approval-demo.yml)
[![RuoYi integration](https://github.com/JamesCube/ArcFlow/actions/workflows/ruoyi-integration.yml/badge.svg?branch=main)](https://github.com/JamesCube/ArcFlow/actions/workflows/ruoyi-integration.yml)

目前版本是 `0.1.0-SNAPSHOT`，API 还会变。示例只用于本机试用，请使用测试数据，不要直接拿来处理生产审批。

## 设计器

在节点之间插入审批步骤，选好审批人，再发布流程。每个步骤可以由一个人审批，也可以设置为全员同意（ALL）或任一同意（ANY）。流程发布后只影响新申请，已提交的申请继续使用原来的版本。

[![审批设计器中的流程节点、ANY 参与人配置和发布状态](docs/images/designer-desktop-836e605.png)](docs/DESIGNER_SHOWCASE.md#简体中文)

设计器支持增删、排序、撤销和重做，窄屏时可切换流程和节点设置。独立演示可以切换中英文；[若依示例](examples/ruoyi-vue3/README.md#configure-and-vote-in-groups)也支持分组审批。

上图来自 [`836e605` 的 Chromium 测试](https://github.com/JamesCube/ArcFlow/actions/runs/37257554086)，源码树与已合并的 [`e1ee9c6`](https://github.com/JamesCube/ArcFlow/commit/e1ee9c6bdb971949c4f8746fe88b9ff49e6d4c36) 相同。该版本只有设计器使用中文，外围界面仍为英文。[查看桌面和 390px 窄屏截图](docs/DESIGNER_SHOWCASE.md#简体中文)。

## 若依示例

若依负责登录、用户、菜单和权限，ArcFlow 负责审批流程和申请状态。接入示例使用锁定版本的官方若依源码，审批人直接从若依用户中选择。

[![若依中的两级审批流程设计器](docs/images/ruoyi-native-process-editor.png)](docs/images/ruoyi-native-process-editor.png)

这里配置了 Team review → Final review 两个步骤。两位审批人依次同意后，申请显示为已通过，还能查看提交时的 v3 流程和操作记录。

[![若依中的已通过申请、流程快照和操作记录](docs/images/ruoyi-native-approved-history.png)](docs/images/ruoyi-native-approved-history.png)

这两张图来自 [`48f9b68` 的 Chromium 测试](https://github.com/JamesCube/ArcFlow/actions/runs/37091568795)，使用测试账号，展示的是较早的顺序审批版本。点击可查看 1440px 原图。[查看接入说明和测试记录](docs/RUOYI_SHOWCASE.md#简体中文)。

## 从哪里开始

| 想做什么 | 入口 | 需要安装 |
| --- | --- | --- |
| 试一次请假审批，试用设计器 | [独立演示](#先完成一次请假审批) | 完整 JDK 17+、Maven 3.9+、Node 22.22.2+（22.x）、npm、Python 3.9+；不需要数据库 |
| 接到若依的登录、菜单和权限里 | [若依接入](examples/ruoyi-vue3/README.md) | Git、Python 3、Java 17、Maven 3.9+、Node 22、MySQL 8.4、Redis 7.4 |
| 单独使用同步 Java DAG | [内核示例](#只运行-java-内核) | 完整 JDK 17+；常规构建需要 Maven 3.9+ |
| 在手机浏览器里审批 | [H5 客户端](examples/approval-mobile/README.md) | 按移动端文档启动后端和 H5 页面 |

第一次试用建议从独立演示开始。若依示例需要另外准备 MySQL 和 Redis。

<a id="先完成一笔请假审批"></a>

## 先完成一次请假审批

### 一键本地试用（一个终端）

检出当前 `main`，装好上面的工具后，在仓库目录运行：

```bash
python3 scripts/tryout.py
```

脚本会检查工具版本和端口，构建并启动演示，然后打印本机地址和密码文件的位置。按 Ctrl-C 会停止两个服务，并删除这次试用的数据。脚本不会安装系统工具，也不需要数据库。端口设置和常见问题见 [试用说明](docs/TRYOUT.md)。若依示例有[单独的启动步骤](examples/ruoyi-vue3/README.md)。

已发布的 [`v0.1.0-alpha.1`](https://github.com/JamesCube/ArcFlow/releases/tag/v0.1.0-alpha.1) 只有较早的顺序审批功能，不含新设计器、ALL/ANY 和 JDBC。想试这些功能，请使用当前源码或图集中标注的提交。

### 手动启动（保留本地数据）

使用 Bash（Linux、macOS 或 WSL）、Git 和上表中的构建工具。首次下载依赖需要网络。在终端 1 运行：

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

在终端 2，从同一个仓库目录运行：

```bash
cd examples/approval-ui
npm ci
npm run dev
```

打开 **http://localhost:5173**：

1. 以 **Alice** 登录，输入刚设置的密码。提交一份测试申请，标题填 `Demo leave`，事由填 `Synthetic test`，天数填 `1`。
2. 退出并切换到 **Bob**。打开 **Needs my review**（待我审批），选中申请，点击同意。
3. 重新以 Alice 登录。申请应显示为 **approved**（已通过），详情里能看到流程快照和操作记录。

新数据文件默认只由 Bob 审批。要试两级审批，以 Alice 打开 **Process designer**（流程设计器），在 Bob 后面加上 Carol，点击 **Publish template**（发布流程），再提交一份申请。Bob 同意后交给 Carol，Carol 同意后完成。已有申请仍按原版本审批。

[完整操作和重启检查](docs/GETTING_STARTED.md#简体中文)

## 能做什么

- **安排审批步骤。** 一个流程有 1–8 个审批步骤，每步指定一人，或指定 2–16 人组成 ALL/ANY 分组。ALL 要所有人同意，任一人拒绝就驳回；ANY 有一人同意就通过，所有人拒绝才驳回。
- **保存流程版本。** 发布时检查版本冲突；申请保留提交时的流程快照，之后修改设计器不会改变它。
- **记录审批。** 只有当前步骤有权审批且尚未投票的人可以作出新决定。相同决定可安全重试，规则见[顺序审批](docs/SEQUENTIAL_APPROVAL.md)和[分组审批](docs/PARALLEL_APPROVAL.md)。
- **避免重复提交。** 支持按申请人保存[提交幂等键](docs/SUBMISSION_IDEMPOTENCY.md)：用原键重试同一申请会返回已保存的记录，用同一个键提交不同内容会报冲突。不传键仍可能重复创建；页面刷新丢失键后，先检查申请列表再重试。
- **保存申请和审计记录。** 两个演示默认使用本地 JSON。需要数据库时可以自行接入可选的 [JDBC 模块](examples/approval-jdbc/README.md)，它不会自动替换演示存储。较早版本的 JDBC 在 MySQL **8.0.46 / 8.4.11 × Java 17 / 21** 上的测试记录见 [MySQL 验证](examples/approval-jdbc/MYSQL_VERIFICATION.md#verified-server-acceptance-2026-10-05)。
- **在移动端审批。** [uni-app Vue 3 H5 客户端](examples/approval-mobile/README.md)可以读取后端待办、提交审批意见和查看历史。已测范围见[移动端测试记录](examples/approval-mobile/ACCEPTANCE.md)。App、小程序和飞书／企微／钉钉接入尚未完成，也没有真机测试。

条件路由、定时器、转办和 BPMN XML / BPMN 2.0 兼容还没有实现。也没有发布 Spring Boot Starter 或 Maven Central 制品。

## 接入前要知道的事

```text
独立 Vue 界面 → Spring Boot 演示宿主 ─┐
                                    ├→ approval-domain → ArcFlow Java DAG
官方若依 Vue 界面 → 若依宿主 ────────┘        │            （提交校验）
                                             └→ ApprovalStore：本地 JSON / 可选 JDBC
```

`approval-domain` 管理人工审批的等待、状态流转、定义快照和存储接口。Java DAG 内核用于提交时的校验与规范化，也可以单独嵌入应用；它没有第三方运行时依赖，不要求使用 Spring。

- **身份由应用提供。** 独立演示用测试账号，若依示例用若依的用户、角色和权限。HTTP API 和 Vue 页面都在 `examples` 下。
- **JSON 存储只适合单实例。** 若依的 MySQL 保存用户、角色和菜单，审批数据仍在本地 JSON 文件里。不要让多个实例共享这个文件，也不要放到网络文件系统上。
- **JDBC 还有缺项。** 已覆盖修订号竞争、步骤重试、事务回滚和流程快照，申请、修订号和审计在同一事务内提交。租户隔离、分页、业务表联合事务和 outbox 尚未实现，也没有高吞吐、分布式事务或 exactly-once 保证。接入和迁移步骤见 [JDBC 文档](examples/approval-jdbc/README.md)；独立演示的框架版本和支持限制见[演示文档](examples/approval-demo/README.md)。
- **DAG 同步执行。** 分支表示依赖关系。所有根节点都会运行，就绪节点按声明顺序执行；没有并行执行、条件路由或持久化恢复。字符串变量共用一个命名空间，后写入的值覆盖先写入的值。
- **内核重跑会重新执行全部节点。** 处理器或监听器失败时，不会回滚已经发生的外部操作。事件监听器同步调用，内核不保存执行状态。线程安全和业务幂等性需要接入方处理。

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

有完整 JDK 时，也可以用 `bash scripts/test.sh` 运行内核检查和示例，不需要 Maven 或下载依赖。这个脚本不启动审批应用。完整代码见 [QuickStart.java](src/main/java/com/arcflow/example/QuickStart.java)。

## 阅读代码与参与贡献

- [内核及处理器／事件 SPI](src/main/java/com/arcflow/) · [内核测试](src/test/java/com/arcflow/)
- [审批领域库](examples/approval-domain/) · [独立后端](examples/approval-demo/backend/README.md) · [Vue 界面](examples/approval-ui/README.md)
- [若依集成](examples/ruoyi-vue3/README.md) · [贡献说明](CONTRIBUTING.md) · [路线图](docs/ROADMAP.md) · [集成设计](docs/INTEGRATION_DESIGN.md)

运行遇到问题，可以[提 issue](https://github.com/JamesCube/ArcFlow/issues)。请附上提交版本、系统、Java / Node 版本、运行命令，以及预期和实际结果，不要贴密码或真实个人信息。准备修改状态机或持久化行为时，先开 issue 说明方案。

徽章显示的是 `main` 的测试结果。需要核对某个版本时，请查看对应提交的工作流；构建、API 和浏览器测试的覆盖范围各不相同。

## 许可证

[Apache License 2.0](LICENSE)。另行下载的官方若依项目保留其 MIT 许可证，本集成未获得上游背书。
