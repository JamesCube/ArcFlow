<!-- topic:scope -->
# 独立审批后端

<!-- Legacy fragments remain entry points after the language split. -->
<a id="authentication-and-http-boundaries"></a>
<a id="en"></a>
<a id="english"></a>
<a id="persistence-and-verification"></a>
<a id="run"></a>
<a id="zh"></a>
<a id="独立审批后端--standalone-approval-backend"></a>
<a id="简体中文"></a>

[English](README.en.md)


这是当前 `main` 的本地示例宿主，使用 **Spring Boot 4.1.1、Java 17+**，通过临时 Jackson 2 兼容模块复用审批领域契约。共享领域／JDBC 的构建父版本和若依上游未一起升级，详见[宿主迁移边界](../../../docs/SUPPORTED_HOST_MIGRATION.md)。请只在回环地址使用合成数据；固定账号、JSON 存储和框架升级不构成生产就绪承诺。

<!-- topic:run -->
## 运行

需要完整 JDK 17+、Maven 3.9+，以下交互命令使用 Bash。从仓库根目录先安装本地依赖：

```bash
mvn install
mvn -f examples/approval-domain/pom.xml install

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

没有默认密码。选择三个不同的演示专用密码，每个至少 12 个字符、最多 72 UTF-8 字节。后端默认绑定 `127.0.0.1:8080`，独立前端的 Vite 代理 `/api`。不设置 `APPROVAL_DATA_FILE` 时使用相对后端工作目录的 `./data/requests.json`；重启请复用同一绝对路径。变更前端地址时同步设置准确的 `APPROVAL_UI_ORIGIN`，没有通配 Origin 或开放 CORS。

前端启动、Node 版本、依赖顺序与排障见[开发环境](../../../docs/development/QUICKSTART.md#zh)。

<!-- topic:transport -->
## 身份与 HTTP 边界

- `/api/**` 需要 `alice`、`bob` 或 `carol` 的 HTTP Basic。服务端从认证 Principal 取得 actor；JSON 不能提供申请人或审批人覆盖值。
- Alice 可发布，Bob／Carol 可被指派；决定只能由保存的当前步骤成员执行。管理员或发布者没有代投权限。
- POST 使用 `Content-Type: application/json` 和 `X-Arcflow-Client: approval-demo`。跨站 Fetch Metadata、外来 Origin、缺失客户端标头被拒绝。没有表单登录、会话或浏览器 Basic 挑战对话框。
- HTTP 使用共享严格 Jackson 2 mapper：拒绝未知／重复字段、尾随内容及不合法的数值／标量强制转换。不要添加客户端计算的路由、金额汇总或任意脚本。

[接口参考](../../../docs/api/API_REFERENCE.md)统一维护路径、字段、响应、鉴权、错误与重试；[接口示例](../../../docs/api/examples/README.md)提供可运行请求。入口分为：

| 家族 | 接受范围 |
| --- | --- |
| `/api/process`、`/api/requests`、`/api/documents` | 主请假／采购流程；兼容请假提交、类型化单据及成员 inbox |
| `/api/crm` | 独立报价折扣、固定 Bob → Carol，以及源报价版本／归属校验 |
| `/api/scenarios/{scenarioId}/...` | 六个准确类型场景；提交必须带 `Idempotency-Key`，各自独立流程与存储 |

领域共有九种业务类型，但通用 `/api/documents` 只接收 `leave`／`procurement`。六场景是 `oa-expense`、`oa-travel`、`oa-seal-use`、`erp-receiving`、`erp-payment`、`crm-contract`；只有收货、付款、合同允许条件定义 schema 4。完整映射与 SINGLE／ALL／ANY 边界见[架构说明](../../../docs/development/ARCHITECTURE.md#zh)。

<!-- topic:persistence -->
## 存储和验证

默认主文件、报价相邻文件及六个场景文件各自使用单写者 JSON 存储。当前严格读取 wrapper **1–13**；文件按实际内容单调升级，定义 schema **4** 需要 wrapper **13**。SQL revision **3** 属于独立可选 JDBC 适配器，本宿主不会自动切换到数据库。

升级时先停止不兼容读写端、备份全部文件，再部署兼容代码。读取不会改写文件，格式提升会保存立即升级前的字节备份；恢复旧备份会丢失后续数据。完整矩阵与操作步骤见[存储与迁移](../../../docs/development/PERSISTENCE.md#zh)。

```bash
# 在仓库根目录，已安装 core 和 domain 后
mvn -f examples/approval-demo/backend/pom.xml verify
```

测试覆盖 HTTP／安全边界及业务场景；打包后可继续运行真实 HTTP 与 Playwright 检查，见[分层验证清单](../../../docs/development/QUICKSTART.md#zh)和[宿主 CI](../../../.github/workflows/approval-demo.yml)。测试存在不等于当前提交已通过，框架迁移通过也不代替若依／H5／数据库验证。
