# First approval / 第一次审批

[English](#english) · [简体中文](#简体中文) · [Repository home](../README.md)

## English

### 1. Start the standalone demo

Follow the commands in the [English README](../README.en.md#try-one-leave-approval) to install the core and shared domain, start the API at `127.0.0.1:8080`, and serve the Vue UI at **http://localhost:5173**. Leave both terminals running.

Requirements: Git, Bash, a full JDK 17+, Maven 3.9+, Node 22.22.2 or later within 22.x, and npm. Supported alternatives for the standalone UI are Node 24.15+ within 24.x or Node 26+, as declared in its [package.json](../examples/approval-ui/package.json). This setup needs no MySQL, Redis or RuoYi installation.

Choose a new private data path and three different demo-only passwords, each at least 12 characters long. Use test data instead of real leave, health or personnel information. A fresh store starts with **Alice submits → Bob reviews → complete**.

### 2. Complete a request

1. Open the UI, choose **Alice · process designer**, enter Alice's configured password, and select **Enter workspace →**.
2. Submit `Demo leave`, reason `Synthetic test`, for `1` day. Expect **pending**, assigned to Bob.
3. Sign out. Choose **Bob · approver** and use Bob's password. Open **Needs my review**, select the request, and approve it.
4. Sign back in as Alice. Open the request in **Requests**. Expect **approved**, the saved one-step definition, and submission/approval activity.

The demo runs locally with the passwords you configure. Credentials stay in page memory and are cleared when you sign out or reload, so you’ll need to sign in again.

### 3. Try the designer

As Alice, open **Process designer**, keep Bob as the first approver, add Carol as the second, and publish. You can add, name, remove and reorder 1–8 approval steps. Submit a **new** request, then try the two steps:

- Bob approves the first step: the request remains **pending**, now assigned to Carol.
- Carol approves the final step: it becomes **approved**. Rejecting a current step ends it as **rejected**.
- The earlier request keeps its original one-step snapshot. Publishing never changes a running or completed request.

Only Alice can publish. Bob and Carol can decide only their current step. Signing out or reloading the page loses unpublished edits, so publish before leaving. If another publication makes your draft stale, refresh, review the new version, reset your draft and reapply the changes you still want.

### 4. Check restart persistence

Stop the backend with Ctrl+C, then rerun its `spring-boot:run` command in the same terminal, keeping the same `APPROVAL_DATA_FILE` and password variables. Sign in again and verify that the published process, requests and history remain. A pending request should continue at the same step.

If you open a new terminal, set the passwords again and set `APPROVAL_DATA_FILE` to the **same absolute path** before starting. Do not run two backends against one data file. The file store supports one local writer. It has no clustering or power-loss durability guarantee.

### Troubleshooting

| Symptom | Check |
| --- | --- |
| Maven cannot resolve `arcflow-core` or `approval-domain` | Run root `mvn install`, then `mvn -f examples/approval-domain/pom.xml install`, before starting the backend. These jars are built locally. |
| Backend refuses to start | Check all three password variables (12+ characters), port 8080, and data-path permissions. Another process using the same store intentionally blocks startup. |
| UI cannot connect / login fails | Wait for backend startup; use the configured account/password and exact URL `http://localhost:5173`. Check API logs, Node version, and port 5173. Keep loopback bindings. |
| UI port 5173 is already in use | Stop your other demo instance or deliberately change both the Vite port and backend `APPROVAL_UI_ORIGIN`. Avoid changing the hostname/port in only one place. |
| Publish or submit reports a conflict | Refresh to load the current published version. Review before retrying; preserve/reapply designer changes if needed. |
| A submission's response was interrupted | Keep the original form and retry with its retained idempotency key. If the page was reloaded or the key was lost, inspect the request list before a new submission. See [retry boundaries](SUBMISSION_IDEMPOTENCY.md). |
| Restart appears to lose data | Check the absolute `APPROVAL_DATA_FILE`; a different path creates a different store. Do not delete or edit a failing snapshot to bypass validation. |

### Next steps

- To use RuoYi’s users, login, menus and role permissions, follow the [official upstream overlay guide](../examples/ruoyi-vue3/README.md). It needs disposable local MySQL/Redis and additional setup. Approval data still goes into a JSON file.
- The [backend guide](../examples/approval-demo/backend/README.md), [UI guide](../examples/approval-ui/README.md) and [sequential contract](SEQUENTIAL_APPROVAL.md) explain the APIs, tests, security and storage limits.
- To run the non-browser standalone checks: `mvn verify`, `bash scripts/test.sh`, `mvn install`, `mvn -f examples/approval-domain/pom.xml install`, `mvn -f examples/approval-demo/backend/pom.xml verify`, then `(cd examples/approval-ui && npm ci && npm test && npm run build)` from the repository root. The root build alone does not test the examples. For the actual Chromium journey, see [real-browser first-run checks](../examples/approval-ui/README.md#real-browser-first-run-check).

## 简体中文

### 1. 启动独立演示

执行 [中文 README](../README.md#先完成一笔请假审批) 中的命令：先安装内核与共享领域库，再启动 `127.0.0.1:8080` 上的 API 和 **http://localhost:5173** 上的 Vue 界面。两个终端都保持运行。

需要 Git、Bash、完整 JDK 17+、Maven 3.9+、Node 22.22.2 或更高的 22.x 版本及 npm。独立界面也接受 24.15+ 的 Node 24.x 或 Node 26+，以 [package.json](../examples/approval-ui/package.json) 为准。这套启动方式不需要 MySQL、Redis 或若依。

选择一个新的私有数据路径，设置三个不同的演示专用密码，每个至少 12 个字符。请使用测试数据，不要输入真实请假、健康或人员信息。初始流程为 **Alice 发起 → Bob 审批 → 完成**。

### 2. 完成一次审批

1. 打开界面，选择 **Alice · process designer**，输入配置的 Alice 密码，点击 **Enter workspace →**。
2. 提交标题 `Demo leave`、原因 `Synthetic test`、天数 `1`。应显示 **pending**，当前审批人为 Bob。
3. 退出登录，选择 **Bob · approver**，输入 Bob 密码。打开 **Needs my review**，选中申请并同意。
4. 重新登录 Alice，在 **Requests** 中打开申请。应显示 **approved**，可查看原始单步骤流程快照与提交、审批记录。

演示在本地运行，使用你自己配置的密码。凭据只保存在页面内存中，退出登录或刷新页面后都会清除，需要重新登录。

### 3. 体验顺序设计器

以 Alice 打开 **Process designer**，保留 Bob 为第一位审批人，新增 Carol 作为第二位审批人并发布。可为 1–8 个审批步骤命名、增删和排序。提交一份**新**申请后：

- Bob 同意第一步：仍为 **pending**，当前审批人变为 Carol。
- Carol 同意最后一步：变为 **approved**。如果当前步骤的审批人拒绝，申请就以 **rejected** 结束。
- 原来的申请仍保留单步骤快照，后续发布不会改变运行中或已完成的申请。

只有 Alice 可以发布流程。Bob 和 Carol 只能处理当前轮到自己的步骤。退出登录或刷新页面会丢失未发布的草稿，离开前请先发布。遇到版本冲突时，刷新并查看新版本，重置草稿后再重新添加需要保留的修改。

### 4. 验证重启恢复

用 Ctrl+C 停止后端，在同一个终端重新运行后端 `spring-boot:run` 命令，保留原来的 `APPROVAL_DATA_FILE` 和密码变量。重新登录，检查流程、申请及历史仍在；未完成申请应停留在原步骤。

如果换了新终端，请重新设置密码，并把 `APPROVAL_DATA_FILE` 指向**同一个绝对路径**。不要让两个后端同时使用一个文件。文件存储只支持一个本地写入进程，不支持集群，也不保证断电后的数据恢复。

### 常见问题

- **找不到本地 Maven 依赖：**先在根目录执行 `mvn install`，再执行 `mvn -f examples/approval-domain/pom.xml install`，最后启动后端。
- **后端启动失败：**检查三个密码变量是否齐全且至少 12 字符、8080 端口和数据目录权限；同一数据文件已有写者时会拒绝启动。
- **无法连接或登录：**等待后端启动完成，使用配置的账号密码以及准确地址 `http://localhost:5173`；检查后端日志、Node 版本和 5173 端口，保持仅绑定回环地址。
- **5173 被占用：**停止另一个演示实例，或同时调整 Vite 端口和后端 `APPROVAL_UI_ORIGIN`，不要只改一端的主机名或端口。
- **发布 / 提交冲突：**刷新并检查最新流程版本，再决定重试；必要时重置并重新应用设计器草稿。
- **提交时断网：**保留原表单并沿用其页面内存中的幂等键重试。整页重载、退出或丢失键后，先刷新申请列表确认结果，再决定是否新建，详见[提交重试边界](SUBMISSION_IDEMPOTENCY.md)。
- **重启后似乎丢失数据：**确认使用相同的绝对 `APPROVAL_DATA_FILE`。不要删除或编辑校验失败的快照来绕过检查。

### 下一步

需要真实若依用户、登录、菜单和角色权限时，查看 [官方上游参考集成](../examples/ruoyi-vue3/README.md)。需要额外准备可丢弃的本地 MySQL / Redis 测试环境；审批仍保存在 JSON 文件中。

API、测试、安全和存储限制详见 [后端说明](../examples/approval-demo/backend/README.md)、[界面说明](../examples/approval-ui/README.md) 和 [顺序审批契约](SEQUENTIAL_APPROVAL.md)。非浏览器验证命令见本页英文部分；真实 Chromium 流程见[浏览器验证](../examples/approval-ui/README.md#real-browser-first-run-check)。仅在根目录运行 Maven 不会验证示例模块。
