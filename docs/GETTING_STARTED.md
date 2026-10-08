# First approval / 第一次审批

[English](#english) · [简体中文](#简体中文) · [Repository home](../README.md)

## English

### 1. Start the standalone demo

These steps start the demo in two terminals and keep its data between runs. For a temporary demo that cleans up when you stop it, use the [one-command launcher](TRYOUT.md).

Requirements: Git, Bash, a full JDK 17+, Maven 3.9+, Node 22.22.2 or later within 22.x, and npm. Supported alternatives for the standalone UI are Node 24.15+ within 24.x or Node 26+, as declared in its [package.json](../examples/approval-ui/package.json). This setup needs no MySQL, Redis or RuoYi installation.

Choose a new private data path and three different demo-only passwords, each at least 12 characters long and at most 72 UTF-8 bytes. Multibyte characters can reach the byte limit sooner. Use test data instead of real leave, health or personnel information. A fresh store starts with **Alice submits → Bob reviews → complete**.

In terminal 1:

```bash
git clone https://github.com/JamesCube/ArcFlow.git
cd ArcFlow
mvn install
mvn -f examples/approval-domain/pom.xml install

# Private local demo state; reuse this absolute path when restarting.
umask 077
mkdir -p "$PWD/examples/approval-demo/backend/data"
export APPROVAL_DATA_FILE="$PWD/examples/approval-demo/backend/data/requests.json"

# Choose three different demo-only passwords, each at least 12 characters and at most 72 UTF-8 bytes.
read -rs -p 'Alice demo password: ' APPROVAL_ALICE_PASSWORD; echo
read -rs -p 'Bob demo password: ' APPROVAL_BOB_PASSWORD; echo
read -rs -p 'Carol demo password: ' APPROVAL_CAROL_PASSWORD; echo
export APPROVAL_ALICE_PASSWORD APPROVAL_BOB_PASSWORD APPROVAL_CAROL_PASSWORD
mvn -f examples/approval-demo/backend/pom.xml spring-boot:run
```

In terminal 2, from the same repository root:

```bash
cd examples/approval-ui
npm ci
npm run dev
```

Keep both terminals running. Open [http://localhost:5173](http://localhost:5173) after the backend and UI are ready.

### 2. Complete a request

1. Open the UI and select **English** in the language menu. Choose **Alice · process designer**, enter Alice's configured password, and select **Enter workspace →**.
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

<a id="try-other-cases-en"></a>

### 4. Try procurement and quote approvals

All three cases use the same running standalone backend and UI. No additional server, database or vendor account is needed. With the launcher, use the exact printed origin and the passwords in its private file. With the manual setup above, use `http://localhost:5173` and the passwords you configured. Keep passwords out of URLs and source files.

**ERP procurement, in the existing workspace:**

1. Sign in as Alice and open **Requests**. Choose **Procurement** under **Request type**.
2. Enter reference `PO-DEMO-001`, title `Demo equipment purchase`, item `Equipment set`, quantity `3`, unit price `0.10`, currency `CNY`, and reason `Synthetic test`. Check that the total is **CNY 0.30**, then submit.
3. Follow the reviewers in the saved process. A fresh store uses Bob only; if you published Bob → Carol above, both must approve in order. Sign back in as Alice to check the saved item, amount and history. Approval does not place an order or make a payment.

**CRM quote discount, on its own page:**

1. Open `/quote-discount.html` on the same UI origin. With the default manual setup, that is [http://localhost:5173/quote-discount.html](http://localhost:5173/quote-discount.html). Select **English** in this page's own language menu. Use a desktop-width window to submit; narrow screens only support viewing and review.
2. Sign in as Alice again with the same configured password. The two pages do not share a login. Select the preset `Q-DEMO-001` revision 1, keep the synthetic title/reason and requested unit price `850.00`. For ten items, check **CNY 8,500.00** and a **CNY 1,500.00** reduction, then submit. The saved record also shows a **15%** discount.
3. Sign out on the quote page, sign in as Bob and approve, then sign out and sign in as Carol to approve. This fixed Bob → Carol sequence is separate from the leave/procurement designer. Alice can then inspect the approved record on the quote page.

One quote revision binds to one request. Repeating the same submission returns that record; changing its price or reason conflicts. The preset source has only revision 1. For a fresh exercise, finish and stop the disposable launcher, then start a new run; do not delete a persistent store just to repeat the demo. See [the quote contract](CRM_QUOTE_CASE.md) for details. Quotes are not listed in the shared workspace, RuoYi or H5. This synthetic case makes no external CRM or AI calls and performs no business writeback.

**Other clients:** [RuoYi](../examples/ruoyi-vue3/README.md) has its own installation, accounts, ArcFlow menu and role permissions. It supports leave and procurement; standalone Alice/Bob/Carol passwords do not log in to RuoYi. [H5](../examples/approval-mobile/README.md#run-locally--本地运行) is a separate review-only client for existing leave/procurement requests, with its own startup and origin configuration. The standalone launcher starts neither client.

### 5. Check restart persistence

Stop the backend with Ctrl+C, then rerun its `spring-boot:run` command in the same terminal, keeping the same `APPROVAL_DATA_FILE` and password variables. Sign in again and verify that the published process, requests and history remain. A pending request should continue at the same step.

If you open a new terminal, set the passwords again and set `APPROVAL_DATA_FILE` to the **same absolute path** before starting. Do not run two backends against one data file. The file store supports one local writer. It has no clustering or power-loss durability guarantee.

### Troubleshooting

| Symptom | Check |
| --- | --- |
| Maven cannot resolve `arcflow-core` or `approval-domain` | Run root `mvn install`, then `mvn -f examples/approval-domain/pom.xml install`, before starting the backend. These jars are built locally. |
| Backend refuses to start | Check all three password variables (at least 12 characters and at most 72 UTF-8 bytes each), port 8080, and data-path permissions. Another process using the same store intentionally blocks startup. |
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

下面分两个终端启动演示，停止后保留数据。如果只想临时试用、结束后删除数据，可以用[一键启动脚本](TRYOUT.md)。

需要 Git、Bash、完整 JDK 17+、Maven 3.9+、Node 22.22.2 或更高的 22.x 版本及 npm。独立界面也接受 24.15+ 的 Node 24.x 或 Node 26+，以 [package.json](../examples/approval-ui/package.json) 为准。这套启动方式不需要 MySQL、Redis 或若依。

选择一个新的私有数据路径，设置三个不同的演示专用密码，每个至少 12 个字符，且 UTF-8 编码后最多 72 字节。多字节字符会更早达到字节上限。请使用测试数据，不要输入真实请假、健康或人员信息。初始流程为 **Alice 发起 → Bob 审批 → 完成**。

在终端 1 运行：

```bash
git clone https://github.com/JamesCube/ArcFlow.git
cd ArcFlow
mvn install
mvn -f examples/approval-domain/pom.xml install

# 私有本地演示数据；重启时复用这个绝对路径。
umask 077
mkdir -p "$PWD/examples/approval-demo/backend/data"
export APPROVAL_DATA_FILE="$PWD/examples/approval-demo/backend/data/requests.json"

# 设置三个不同的演示专用密码，每个至少 12 个字符，且 UTF-8 编码后最多 72 字节。
read -rs -p 'Alice demo password: ' APPROVAL_ALICE_PASSWORD; echo
read -rs -p 'Bob demo password: ' APPROVAL_BOB_PASSWORD; echo
read -rs -p 'Carol demo password: ' APPROVAL_CAROL_PASSWORD; echo
export APPROVAL_ALICE_PASSWORD APPROVAL_BOB_PASSWORD APPROVAL_CAROL_PASSWORD
mvn -f examples/approval-demo/backend/pom.xml spring-boot:run
```

在终端 2，从同一个仓库根目录运行：

```bash
cd examples/approval-ui
npm ci
npm run dev
```

保持两个终端运行。后端和界面都启动后，打开 [http://localhost:5173](http://localhost:5173)。

### 2. 完成一次审批

1. 打开界面，语言选择“简体中文”，选择 **Alice · 流程设计者**，输入配置的 Alice 密码，点击 **进入工作区 →**。
2. 提交标题“请假演示”、事由“合成测试”、天数 `1`。应显示“审批中”，当前审批人为 Bob。
3. 退出登录，选择 **Bob · 审批人**，输入 Bob 密码。打开“待我审批”，选中申请并通过。
4. 重新登录 Alice，在“申请列表”中打开申请。应显示“已通过”，可查看原始单步骤流程快照与提交、审批记录。

演示在本地运行，使用你自己配置的密码。凭据只保存在页面内存中，退出登录或刷新页面后都会清除，需要重新登录。

### 3. 体验顺序设计器

以 Alice 打开“流程设计器”，保留 Bob 为第一位审批人，新增 Carol 作为第二位审批人并发布。可为 1–8 个审批步骤命名、增删和排序。提交一份**新**申请后：

- Bob 通过第一步：仍为“审批中”，当前审批人变为 Carol。
- Carol 通过最后一步：变为“已通过”。如果当前步骤的审批人拒绝，申请就以“已驳回”结束。
- 原来的申请仍保留单步骤快照，后续发布不会改变运行中或已完成的申请。

只有 Alice 可以发布流程。Bob 和 Carol 只能处理当前轮到自己的步骤。退出登录或刷新页面会丢失未发布的草稿，离开前请先发布。遇到版本冲突时，刷新并查看新版本，重置草稿后再重新添加需要保留的修改。

<a id="try-other-cases-zh"></a>

### 4. 试试采购与报价审批

三种案例共用已启动的独立端后端与界面，不需要再启动服务、安装数据库或连接厂商账号。使用一键启动脚本时，保持终端打印的完整地址，并使用它生成的私有密码文件；按上文手动启动时，地址为 `http://localhost:5173`，密码为你刚设置的演示密码。不要把密码放进 URL 或源码。

**ERP 采购，在现有工作区操作：**

1. 以 Alice 登录，打开“申请列表”，将“申请类型”改为“采购”。
2. 填写单据编号 `PO-DEMO-001`、标题“设备采购演示”、品名“设备套装”、数量 `3`、单价 `0.10`、币种 `CNY`，事由填“合成测试”。确认合计为 **CNY 0.30** 后提交。
3. 按申请保存的流程切换账号审批。全新数据默认只需 Bob；若已按上文发布 Bob → Carol，则需要两人依次审批。最后由 Alice 查看原始物品、金额和操作记录。审批通过不会下单或付款。

**CRM 报价折扣，使用独立页面：**

1. 在相同界面地址后加 `/quote-discount.html`。上文默认手动启动地址为 [http://localhost:5173/quote-discount.html](http://localhost:5173/quote-discount.html)。请使用桌面宽度窗口提交；窄屏只支持查看和审批。
2. 使用同一密码重新登录 Alice；两个页面不共享登录态。选择预设 `Q-DEMO-001` 第 1 版，保留合成标题、理由和申请单价 `850.00`。确认十套设备的申请总额为 **CNY 8,500.00**，减少 **CNY 1,500.00** 后提交；保存的记录还会显示 **15%** 折扣率。
3. 在报价页退出并换 Bob 登录、同意，再退出并换 Carol 登录、同意。报价固定按 Bob → Carol 审批，不受请假／采购设计器的发布影响。最后由 Alice 在报价页查看已通过的记录。

同一报价版本只绑定一笔申请：原样重复提交会返回原记录，改价格或理由会冲突。预设报价只有第 1 版。如需从头体验，完成本次试用后停止临时启动脚本，再启动新的一轮；不要为重试随意删除持久化数据。详见[报价契约](CRM_QUOTE_CASE.md)。报价不会进入共享工作区、若依或 H5 列表；此合成案例不调用外部 CRM 或 AI，也不回写业务系统。

**其他客户端：**[若依](../examples/ruoyi-vue3/README.md)需单独安装，并配置自己的账号、ArcFlow 菜单和角色权限，支持请假与采购；独立端 Alice／Bob／Carol 密码不能登录若依。[H5](../examples/approval-mobile/README.md#run-locally--本地运行)也需单独启动并配置允许的 Origin，只能查看和审批已创建的请假／采购单。独立端启动脚本不会启动这两个客户端。

### 5. 验证重启恢复

用 Ctrl+C 停止后端，在同一个终端重新运行后端 `spring-boot:run` 命令，保留原来的 `APPROVAL_DATA_FILE` 和密码变量。重新登录，检查流程、申请及历史仍在；未完成申请应停留在原步骤。

如果换了新终端，请重新设置密码，并把 `APPROVAL_DATA_FILE` 指向**同一个绝对路径**。不要让两个后端同时使用一个文件。文件存储只支持一个本地写入进程，不支持集群，也不保证断电后的数据恢复。

### 常见问题

- **找不到本地 Maven 依赖：**先在根目录执行 `mvn install`，再执行 `mvn -f examples/approval-domain/pom.xml install`，最后启动后端。
- **后端启动失败：**检查三个密码变量是否齐全、每个至少 12 个字符且 UTF-8 编码后最多 72 字节，以及 8080 端口和数据目录权限；同一数据文件已有写者时会拒绝启动。
- **无法连接或登录：**等待后端启动完成，使用配置的账号密码以及准确地址 `http://localhost:5173`；检查后端日志、Node 版本和 5173 端口，保持仅绑定回环地址。
- **5173 被占用：**停止另一个演示实例，或同时调整 Vite 端口和后端 `APPROVAL_UI_ORIGIN`，不要只改一端的主机名或端口。
- **发布 / 提交冲突：**刷新并检查最新流程版本，再决定重试；必要时重置并重新应用设计器草稿。
- **提交时断网：**保留原表单并沿用其页面内存中的幂等键重试。整页重载、退出或丢失键后，先刷新申请列表确认结果，再决定是否新建，详见[提交重试边界](SUBMISSION_IDEMPOTENCY.md)。
- **重启后似乎丢失数据：**确认使用相同的绝对 `APPROVAL_DATA_FILE`。不要删除或编辑校验失败的快照来绕过检查。

### 下一步

需要真实若依用户、登录、菜单和角色权限时，查看 [官方上游参考集成](../examples/ruoyi-vue3/README.md)。需要额外准备可丢弃的本地 MySQL / Redis 测试环境；审批仍保存在 JSON 文件中。

API、测试、安全和存储限制详见 [后端说明](../examples/approval-demo/backend/README.md)、[界面说明](../examples/approval-ui/README.md) 和 [顺序审批契约](SEQUENTIAL_APPROVAL.md)。非浏览器验证命令见本页英文部分；真实 Chromium 流程见[浏览器验证](../examples/approval-ui/README.md#real-browser-first-run-check)。仅在根目录运行 Maven 不会验证示例模块。
