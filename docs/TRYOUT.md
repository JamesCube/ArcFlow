# 本地试用与源码打包

<!-- Legacy fragments remain entry points after the language split. -->
<a id="arcflow-local-tryout"></a>
<a id="build-a-versioned-source-bundle"></a>
<a id="readiness-and-stopping"></a>
<a id="release-candidate-checklist"></a>
<a id="requirements"></a>
<a id="start-from-a-checkout-or-extracted-source-bundle"></a>
<a id="troubleshooting-and-boundaries"></a>
<a id="verify-and-extract"></a>
<a id="what-to-try"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](TRYOUT.en.md) · [文档目录](README.md)

在一个终端从源码运行独立 Vue 设计器和 Spring Boot。启动器构建内核、领域、后端、UI，需要以下工具，源码包不含预构建应用；仅用于 localhost 与测试数据。

若依另有[独立设置](../examples/ruoyi-vue3/README.md)，启动器不启动若依、MySQL 或 Redis。当前 main 可体验全部场景；[已接受三案例检查点](CRM_COMPATIBILITY_READINESS.md#accepted-crm-checkpoint)只对应当时请假/采购/报价。[设计器历史图](DESIGNER_SHOWCASE.md)的 `e1ee9c6bdb971949c4f8746fe88b9ff49e6d4c36` 不含后来的采购/CRM；更早 `v0.1.0-alpha.1` 仅顺序演示，无中文工作台、ALL/ANY 或 JDBC。

<!-- topic:requirements -->
## 环境要求

- Linux/macOS POSIX；不支持原生 Windows 启动器，可用 WSL 等 Linux。
- Python 3.9+（`python3`）。
- 完整 JDK 17+（`java`、`javac`），不能只有 JRE。
- Maven 3.8+（`mvn`），或 `--maven` 指定已有可执行文件。
- Node/npm：锁定依赖支持 **22.x 中 22.22.2+、24.x 中 24.15.0+，或 26+**；23/25 不在范围内。
- 首次 Maven/npm 下载所需网络，以及可写源码、Maven 仓库、npm 缓存。
- 两个空闲回环端口，默认后端 8080、UI 5173。

启动器检查工具并提示修复，不安装 Python/Java/Maven/Node，无需管理员权限，不代设若依。首次依赖下载需要网络；`npm ci` 使用提交锁文件并执行包安装脚本。

<!-- topic:start-from-a-checkout-or-extracted-source-bundle -->
## 从源码或解压包启动

在含 `pom.xml` 的源码根目录：

```sh
# Check tools and port availability without building or starting the applications.
python3 scripts/tryout.py --check

# Build and run the standalone tryout in this terminal.
python3 scripts/tryout.py
```

保持终端打开，首次下载/构建可能数分钟。等待 ready 后打开准确打印的 URL，默认 UI `http://127.0.0.1:5173`，后端 `http://127.0.0.1:8080`。就绪消息提供三个入口：

- 主工作区：请假/采购，可在 Request type → Procurement 选择采购。
- `/quote-discount.html`：独立合成报价，固定 Bob→Carol；同账号另行登录，记录不在主工作区/inbox。
- `/scenarios.html`：当前六项独立场景目录，原启动器标签保留 OA expense；具体范围见[架构](development/ARCHITECTURE.md)。

示例值与角色步骤见[第一次审批](GETTING_STARTED.md)。不启动若依/H5，也不需供应商账号或 AI 凭据。

启动器为 alice/bob/carol 生成不同密码，写入私有临时 `credentials.json` 并打印路径，用本地编辑器查看。仅本次有效，无默认/共享密码，不应放入 issue、聊天、截图或版本控制。

自定义端口或 Maven：

```sh
python3 scripts/tryout.py --backend-port 18080 --ui-port 15173
python3 scripts/tryout.py --maven /absolute/path/to/maven/bin/mvn
python3 scripts/tryout.py --help
```

按打印地址访问，后端允许 Origin 与 UI 代理由启动器一起配置，单独换主机名/端口会破坏请求。两者只绑定回环，占用端口时停止并报告。

<!-- topic:what-to-try -->
## 体验流程

1. Alice 登录，打开 Process designer，第一步 Bob、第二步 Carol，点击 Publish template（发布流程）。
2. 用合成标题/原因、1 天提交。
3. 退出后 Bob 登录，Needs my review 审当前步骤，申请仍待 Carol。
4. Carol 登录完成终审，再以 Alice 查看已通过、保存定义和有序历史。
5. 发布另一流程，比较旧申请仍保持原版本。

分组可选择全员同意（ALL）或任一同意（ANY），勾 Bob/Carol。ALL 双方同意才通过、任一可拒绝；ANY 一人同意即推进、两人都拒绝才驳回。发布后新建申请，参与人随申请固定，阶段仍顺序执行。

空存储默认 Bob 单步骤，仅 Alice 可发布。单人模式只有当前成员能决定，拒绝立即结束，见[顺序契约](SEQUENTIAL_APPROVAL.md)。

<!-- topic:readiness-and-stopping -->
## 就绪与停止

- `--check` 仅查要求，下载、构建、启动和浏览器仍可能失败。
- 构建后先检查认证后端 API 与 UI HTTP，再打印 ready。
- 手动体验以上步骤；ready 不代表完整套件或浏览器测试已跑。
- 启动终端 Ctrl-C 停两个服务并删除临时凭据、数据和日志。每次新账号/空存储，正常停止不保留已发布流程或申请。
- 构建输出、node_modules、Maven 仓库/npm 缓存保留，不含该次密码文件/审批存储。
- 强杀、系统崩溃或断电可能来不及清理；先停残留服务，再删除打印的私有运行目录。不得公开该目录或使用真实员工/请假/健康数据。

保留数据或测正常重启请用[手动入门](GETTING_STARTED.md)及[后端说明](../examples/approval-demo/backend/README.md)；启动器始终一次性数据。

<!-- topic:build-a-versioned-source-bundle -->
## 打包版本化源码

打包需要 Python 3.9+ 和 Git；运行解压包不需 Git。

```sh
# Commit the intended sources before packaging HEAD.
python3 scripts/package-tryout.py

# Or package an existing commit/tag into another directory.
python3 scripts/package-tryout.py --ref YOUR_COMMIT_OR_TAG --output-dir /tmp/arcflow-bundles
```

默认输出 `dist/tryout/`：

```text
arcflow-tryout-VERSION-COMMIT12-source.tar.gz
arcflow-tryout-VERSION-COMMIT12-source.tar.gz.sha256
```

VERSION 来自所选提交根 pom，COMMIT12 是 Git ID 前 12 位，`TRYOUT_BUNDLE.json` 保存完整提交、版本和提交时间。打包 HEAD 时拒绝已跟踪暂存/未暂存修改；不含未跟踪/忽略文件。指定旧 ref 按提交树读取，不受工作区修改影响，且该提交须已有启动器、打包脚本和本指南。

`git archive` 配显式排除，规范 tar 所有权/权限/时间并固定 gzip 时间。同提交、同打包实现及 Python/zlib 工具链重复产物和 SHA-256 相同，不受输出目录名/当前时间影响；跨 zlib 实现可能不同，应记录工具链。拒绝软链接和其他不支持条目，不解引用。

包含已提交代码、测试、文档、许可证、npm lock 和独立若依 overlay；排除 .git、私密 .env、运行数据、构建/测试输出、已装依赖和临时上游检出。无预构建 JAR、运行环境、缓存、生成凭据或审批数据。SNAPSHOT 打包后仍是 snapshot，发布/CI 另查。

### 校验与解压

将 tar.gz 与 sha256 放一起，用实际文件名替换占位：

```sh
# Linux:
sha256sum -c arcflow-tryout-VERSION-COMMIT12-source.tar.gz.sha256

# macOS:
shasum -a 256 -c arcflow-tryout-VERSION-COMMIT12-source.tar.gz.sha256

# Extract into a new directory; then run from the extracted source root.
tar -xzf arcflow-tryout-VERSION-COMMIT12-source.tar.gz
cd arcflow-tryout-VERSION-COMMIT12-source
python3 scripts/tryout.py --check
python3 scripts/tryout.py
```

从可信来源取得预期 hash；它检测字节变化，不认证发布者或代替签名。复现需源码仓库和 manifest 完整提交；解压包没有 Git 数据，不能由此脚本重打包。

<!-- topic:release-candidate-checklist -->
## 发布候选检查清单

在干净跟踪工作区、文档工具及精确提交运行以下检查；这是清单，不是已通过记录：

```sh
# Launcher and packaging regression checks.
python3 scripts/test_tryout.py

# Real dependency build/start, non-default ports, authenticated readiness,
# private credential permissions, and SIGINT process/data cleanup.
python3 scripts/smoke-tryout.py

# UI tests and production asset build.
(cd examples/approval-ui && npm ci && npm test && npm run build)

# Package twice into separate directories and compare archive checksums.
python3 scripts/package-tryout.py --output-dir /tmp/arcflow-rc-one
python3 scripts/package-tryout.py --output-dir /tmp/arcflow-rc-two
```

- 两次打印 SHA-256 必须一致，使用新/空输出目录避免旧包混淆。
- 校验 sidecar，解压到新目录运行 check 和启动，走完 Bob→Carol，确认 Ctrl-C 停两服务并删除私有目录。
- 检查与 manifest **相同完整提交**的 Java、审批、浏览器 CI 作业本身；main badge、构建成功或 ready 不能证明浏览器。
- 记录 OS、工具版本、完整提交、hash 及失败/跳过。全部通过后仍为实验性本地演示。

<!-- topic:troubleshooting-and-boundaries -->
## 排错与边界

- 工具失败：自行安装/选择支持工具再 check；同终端核对 `java -version`、`javac -version`、`mvn -version`、`node --version`、`npm --version`；非 PATH Maven 用 `--maven`。
- 端口占用：选两个空闲端口或停自己拥有的进程，不改成公开接口。
- 下载/构建失败：检查错误、配置 registry 和代理后重试；源码包不是离线安装器，不绕过 TLS。
- 认证失败：用当前运行密码及精确 URL，旧密码无效。
- 断网后结果不确定：原表单/键重试；重载/退出会丢键，先查列表，见[持久重试](SUBMISSION_IDEMPOTENCY.md)。
- 生产需求：演示身份、单写者 JSON 未验证生产安全或集群持久性。[宿主迁移](SUPPORTED_HOST_MIGRATION.md)说明 Boot 4 与临时 Jackson 2 兼容层。启动器不含若依；支持顺序/ALL/ANY，条件仅限付款/收货/合同，不是通用路由，定时器/BPMN 不支持。

报告问题时提供完整提交、OS、Python/Java/Maven/Node 版本、命令、错误和预期；先移除凭据和真实个人信息。
