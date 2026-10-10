# 开发环境与验证

<!-- Legacy fragments remain entry points after the language split. -->
<a id="1-tools-and-build-order"></a>
<a id="2-run-a-persistent-local-backend"></a>
<a id="3-run-the-standalone-ui"></a>
<a id="4-verify-changes"></a>
<a id="5-common-development-failures"></a>
<a id="开发环境与验证--development-setup-and-verification"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](QUICKSTART.en.md) · [文档目录](../README.md)

<!-- topic:1-tools-and-build-order -->
## 1. 工具与构建顺序

- 完整 **JDK 17+**，包括 `java` 和 `javac`；源码基线为 Java 17，CI 覆盖 17 和 21。
- **Maven 3.9+** 为推荐开发组合。根项目不是聚合构建：示例有独立 POM，必须先把本地依赖安装到 Maven 仓库。
- 独立 Vue 界面与 H5 声明的 Node 范围为 **`^22.22.2 || ^24.15.0 || >=26.0.0`**；附带 npm。使用提交的 lockfile 执行 `npm ci`。
- Git；下方交互式密码命令需要 Bash。Python 3.9+ 用于一键试用与脚本检查。首次下载依赖需要网络和可写缓存。

[独立后端 POM](../../examples/approval-demo/backend/pom.xml)使用 Spring Boot **4.1.1**。共享领域和 JDBC 模块仍使用 Boot **3.5.16** 构建／测试父 POM，它们不是独立 Boot 服务。不要把全部模块改成同一个 Boot 版本来绕过依赖解析；独立宿主使用临时 Jackson 2 桥接保持共享契约，详见[迁移边界](../SUPPORTED_HOST_MIGRATION.md)。

从仓库根目录运行：

```bash
java -version
javac -version
mvn -version
node --version
npm --version

mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml verify
```

这里只启动独立示例，无需 MySQL、Redis、若依或外部账号。只想临时体验可改用 `python3 scripts/tryout.py`，正常退出会清理该次数据，详见[一键试用](../TRYOUT.md)。

<!-- topic:2-run-a-persistent-local-backend -->
## 2. 启动可保留数据的本地后端

在终端 1 的仓库根目录设置私有绝对路径。重启必须复用它；不要把真实业务或人员数据写入演示。

```bash
umask 077
mkdir -p "$PWD/examples/approval-demo/backend/data"
export APPROVAL_DATA_FILE="$PWD/examples/approval-demo/backend/data/requests.json"
export APPROVAL_UI_ORIGIN='http://localhost:5173'

read -rs -p 'Alice demo password: ' APPROVAL_ALICE_PASSWORD; echo
read -rs -p 'Bob demo password: ' APPROVAL_BOB_PASSWORD; echo
read -rs -p 'Carol demo password: ' APPROVAL_CAROL_PASSWORD; echo
export APPROVAL_ALICE_PASSWORD APPROVAL_BOB_PASSWORD APPROVAL_CAROL_PASSWORD

mvn -f examples/approval-demo/backend/pom.xml spring-boot:run
```

三个账号是 `alice`、`bob`、`carol`，没有默认密码。选择三个不同的演示专用密码，每个至少 12 个字符、最多 72 个 UTF-8 字节；启动会拒绝缺失或不符合长度的值。Alice 可发布，Bob／Carol 为可选审批人。不要将密码放入源码、URL、截图或报告。

后端绑定 `127.0.0.1:8080`。环境变量对应的宿主配置在 [application.properties](../../examples/approval-demo/backend/src/main/resources/application.properties)。数据包括主文件及报价／六场景的相邻文件，备份范围见[存储说明](PERSISTENCE.md#zh)。

<!-- topic:3-run-the-standalone-ui -->
## 3. 启动独立界面

在终端 2 的同一仓库根目录：

```bash
cd examples/approval-ui
npm ci
npm run dev
```

打开 **http://localhost:5173**。Vite 将 `/api` 代理到回环后端。默认端口严格固定；不要只改地址中的主机名或端口而保留旧 `APPROVAL_UI_ORIGIN`。如改后端端口，需要同步配置后端端口及 UI 的 `ARCFLOW_BACKEND_PORT`，或让试用脚本统一配置。

- `/`：请假／采购、流程设计器及成员待办
- `/quote-discount.html`：报价折扣独立页面，固定 Bob → Carol
- `/scenarios.html`：报销、出差、用印、收货、付款、合同六场景目录
- `/receiving.html`：收货专用入口，复用收货场景

页面使用相同演示账号，但独立页面不共享登录内存。刷新或退出后需重新登录。新主工作区默认 Alice 提交、Bob 单步审批；按[第一次审批](../GETTING_STARTED.md#简体中文)验证发布、投票和重启。若依与 H5 需要各自启动；H5 仅支持现有请假／采购的查看和审批，见[H5 指南](../../examples/approval-mobile/README.md)。

<!-- topic:4-verify-changes -->
## 4. 验证修改

以下是命令清单，不是已通过的测试报告。各命令从仓库根目录运行；失败或跳过应单独记录。

```bash
# 内核：Maven 测试及不依赖 Maven 下载的 JDK 检查
mvn verify
bash scripts/test.sh

# 共享领域变更后重新安装，避免后端使用旧 JAR
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml verify

# 前端模型／DOM、独立报价测试与生产构建
(cd examples/approval-ui && npm ci && npm test && node --test tests/crm-quote/*.test.mjs && npm run build)

# 可选存储：默认运行 H2，真实 PostgreSQL/MySQL 需专门配置
mvn -f examples/approval-jdbc/pom.xml verify

# 根构建、试用脚本或打包变更
python3 -m unittest discover -s scripts -p 'test_maven_build.py' -v
python3 scripts/test_tryout.py
```

真实浏览器测试先打包后端，停止已运行的 8080／5173 服务，让测试创建自己的账号与数据：

```bash
mvn -f examples/approval-demo/backend/pom.xml package
cd examples/approval-ui
npm ci
npx playwright install chromium
npm run test:e2e
```

Linux 上可能还需要 Playwright 系统依赖；CI 使用 `npx playwright install --with-deps chromium`。浏览器下载、系统依赖和端口检查失败不是测试通过。更细的 HTTP／浏览器命令见[UI 验证](../../examples/approval-ui/README.md#real-browser-first-run-check)、[JDBC 真机验证](../../examples/approval-jdbc/README.md)及 [CI 工作流](../../.github/workflows/)。改动涉及 H5 或若依时，还需运行其独立检查，不能用独立 UI 通过代替。

<!-- topic:5-common-development-failures -->
## 5. 常见开发问题

| 现象 | 检查 |
| --- | --- |
| 找不到 `arcflow-core`／`approval-domain` | 顺序执行根 `mvn install`、领域 `install`；根 Maven 不会递归构建示例 |
| 改了领域代码却看不到变化 | 重新安装领域，再重新构建／启动后端；E2E 运行的是打包 JAR |
| 启动被拒绝 | 检查密码长度、文件权限、8080 端口；一个数据文件只能有一个写入进程 |
| 401／403 或前端代理失败 | 检查账号密码、准确 Origin、代理目标；POST 必须带 `X-Arcflow-Client: approval-demo` |
| 发布／提交得到 409 | 刷新当前版本；提交结果不确定时保留原键和原始意图，先核查再重试 |
| 数据文件校验失败 | 停止写者、保留文件和备份，核对格式／二进制版本；不要删字段或降版本号绕过校验 |
