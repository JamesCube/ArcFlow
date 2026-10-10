# 第一次审批

<!-- Legacy fragments remain entry points after the language split. -->
<a id="1-start-the-standalone-demo"></a>
<a id="2-complete-a-request"></a>
<a id="3-try-the-designer"></a>
<a id="4-try-procurement-and-quote-approvals"></a>
<a id="5-check-restart-persistence"></a>
<a id="first-approval--第一次审批"></a>
<a id="next-steps"></a>
<a id="troubleshooting"></a>
<a id="try-other-cases-en"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](GETTING_STARTED.en.md) · [文档目录](README.md)

本页按当前 `main` 编写。历史发布压缩包可能缺少后续场景或采用旧契约，请使用对应版本内的文档。源码开发与分层测试见[开发环境指南](development/QUICKSTART.md#zh)。

<!-- topic:1-start-the-standalone-demo -->
## 1. 启动独立演示

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

<!-- topic:2-complete-a-request -->
## 2. 完成一次审批

1. 打开界面，语言选择“简体中文”，选择 **Alice · 流程设计者**，输入配置的 Alice 密码，点击 **进入工作区 →**。
2. 提交标题“请假演示”、事由“合成测试”、天数 `1`。应显示“审批中”，当前审批人为 Bob。
3. 退出登录，选择 **Bob · 审批人**，输入 Bob 密码。打开“待我审批”，选中申请并通过。
4. 重新登录 Alice，在“申请列表”中打开申请。应显示“已通过”，可查看原始单步骤流程快照与提交、审批记录。

演示在本地运行，使用你自己配置的密码。凭据只保存在页面内存中，退出登录或刷新页面后都会清除，需要重新登录。

<!-- topic:3-try-the-designer -->
## 3. 体验顺序设计器

以 Alice 打开“流程设计器”，保留 Bob 为第一位审批人，新增 Carol 作为第二位审批人并发布。可为 1–8 个审批步骤命名、增删和排序。提交一份**新**申请后：

- Bob 通过第一步：仍为“审批中”，当前审批人变为 Carol。
- Carol 通过最后一步：变为“已通过”。如果当前步骤的审批人拒绝，申请就以“已驳回”结束。
- 原来的申请仍保留单步骤快照，后续发布不会改变运行中或已完成的申请。

只有 Alice 可以发布流程。Bob 和 Carol 只能处理当前轮到自己的步骤。退出登录或刷新页面会丢失未发布的草稿，离开前请先发布。遇到版本冲突时，刷新并查看新版本，重置草稿后再重新添加需要保留的修改。

<a id="try-other-cases-zh"></a>

<!-- topic:4-try-procurement-and-quote-approvals -->
## 4. 试试采购与报价审批

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

**六个专用场景：**同一界面地址下打开 `/scenarios.html`，可进入报销、出差、用印、收货、付款和合同审批。各场景有自己的流程、申请和文件，与请假／采购主工作区和报价页隔离。只有报销、付款、收货、合同提供条件路由；可按[报销总额条件案例](EXPENSE_ROUTING.md)配置必审步骤与按金额触发的财务复核。这些合成审批不会支付、入库、签约或回写外部系统。见[场景入口与边界](development/ARCHITECTURE.md#zh)及[接口示例](api/examples/README.md)。

**其他客户端：**[若依](../examples/ruoyi-vue3/README.md)需单独安装，并配置自己的账号、ArcFlow 菜单和角色权限，支持请假与采购；独立端 Alice／Bob／Carol 密码不能登录若依。[H5](../examples/approval-mobile/README.md#run-locally--本地运行)也需单独启动并配置允许的 Origin，只能查看和审批已创建的请假／采购单。独立端启动脚本不会启动这两个客户端。

<!-- topic:5-check-restart-persistence -->
## 5. 验证重启恢复

用 Ctrl+C 停止后端，在同一个终端重新运行后端 `spring-boot:run` 命令，保留原来的 `APPROVAL_DATA_FILE` 和密码变量。重新登录，检查流程、申请及历史仍在；未完成申请应停留在原步骤。

如果换了新终端，请重新设置密码，并把 `APPROVAL_DATA_FILE` 指向**同一个绝对路径**。不要让两个后端同时使用一个文件。文件存储只支持一个本地写入进程，不支持集群，也不保证断电后的数据恢复。

<!-- topic:troubleshooting -->
## 常见问题

- **找不到本地 Maven 依赖：**先在根目录执行 `mvn install`，再执行 `mvn -f examples/approval-domain/pom.xml install`，最后启动后端。
- **后端启动失败：**检查三个密码变量是否齐全、每个至少 12 个字符且 UTF-8 编码后最多 72 字节，以及 8080 端口和数据目录权限；同一数据文件已有写者时会拒绝启动。
- **无法连接或登录：**等待后端启动完成，使用配置的账号密码以及准确地址 `http://localhost:5173`；检查后端日志、Node 版本和 5173 端口，保持仅绑定回环地址。
- **5173 被占用：**停止另一个演示实例，或同时调整 Vite 端口和后端 `APPROVAL_UI_ORIGIN`，不要只改一端的主机名或端口。
- **发布 / 提交冲突：**刷新并检查最新流程版本，再决定重试；必要时重置并重新应用设计器草稿。
- **提交时断网：**保留原表单并沿用其页面内存中的幂等键重试。整页重载、退出或丢失键后，先刷新申请列表确认结果，再决定是否新建，详见[提交重试边界](SUBMISSION_IDEMPOTENCY.md)。
- **重启后似乎丢失数据：**确认使用相同的绝对 `APPROVAL_DATA_FILE`。不要删除或编辑校验失败的快照来绕过检查。

<!-- topic:next-steps -->
## 下一步

开发接入请从[开发文档索引](development/README.md#zh)、[接口参考](api/API_REFERENCE.md)及[存储迁移](development/PERSISTENCE.md#zh)开始。

需要真实若依用户、登录、菜单和角色权限时，查看 [官方上游参考集成](../examples/ruoyi-vue3/README.md)。需要额外准备可丢弃的本地 MySQL / Redis 测试环境；审批仍保存在 JSON 文件中。

API、测试、安全和存储限制详见 [后端说明](../examples/approval-demo/backend/README.md)、[界面说明](../examples/approval-ui/README.md) 和 [顺序审批契约](SEQUENTIAL_APPROVAL.md)。从仓库根目录依次运行 `mvn verify`、`bash scripts/test.sh`、`mvn install`、`mvn -f examples/approval-domain/pom.xml install`、`mvn -f examples/approval-demo/backend/pom.xml verify`，最后运行 `(cd examples/approval-ui && npm ci && npm test && npm run build)`，完成非浏览器验证；真实 Chromium 流程见[浏览器验证](../examples/approval-ui/README.md#real-browser-first-run-check)。仅在根目录运行 Maven 不会验证示例模块。
