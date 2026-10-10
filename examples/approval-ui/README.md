# 独立审批界面

<!-- Legacy fragments remain entry points after the language split. -->
<a id="arcflow-approval-ui-prototype"></a>
<a id="automated-coverage"></a>
<a id="combined-verification-and-visual-boundary"></a>
<a id="contract-and-boundaries"></a>
<a id="erp-payment-request-and-crm-contract-approval"></a>
<a id="erp-receiving"></a>
<a id="expense-and-travel"></a>
<a id="focused-workbench"></a>
<a id="paginated-member-worklists"></a>
<a id="payment-and-contract-review-candidate--付款与合同审批候选"></a>
<a id="procurement-and-member-inbox-together"></a>
<a id="real-browser-first-run-check"></a>
<a id="restricted-conditional-routes--受限条件路径"></a>
<a id="run"></a>
<a id="seal-use-review"></a>
<a id="unified-typed-scenario-library"></a>
<a id="workspace-visual-redesign"></a>

[English](README.en.md)


<!-- topic:scope -->
适用范围：当前源码的 Vue 3 + Vite 客户端。它连接[独立后端](../approval-demo/backend/README.md)，提供请假/采购工作区、报价页、六场景目录和流程设计器。只使用 localhost 与合成业务数据。

- `/`：请假与采购；`/quote-discount.html`：报价折扣；`/scenarios.html`：六场景；`/receiving.html`：独立收货入口。
- 六场景按完整 ID 排序：`crm-contract`、`erp-payment`、`erp-receiving`、`oa-expense`、`oa-seal-use`、`oa-travel`。
- Alice 设计、发布和发起；Bob、Carol 根据保存的步骤参与审批。固定演示账号不代表动态角色、部门或租户集成。

<!-- topic:run -->
## 启动与基本检查

先按[开发环境](../../docs/development/QUICKSTART.md)启动后端。使用 package.json 支持的 Node.js（推荐 Node 22）和 npm，从仓库根目录运行：

```sh
cd examples/approval-ui
npm ci
npm run dev
npm test
npm run build
```

打开 `http://localhost:5173`。Vite 将 `/api` 代理到本地 8080 端口；更换地址必须同步后端允许的 UI Origin。三个演示密码由环境变量提供，没有默认密码。认证信息只存在内存中，登录尝试后清空输入，退出清除会话与申请数据；刷新整页需要重新登录。

生产构建是静态文件，Vite 代理不随构建发布。正式宿主需要独立设计同源 API、HTTPS、身份与会话安全，不能直接公开此演示。

<!-- topic:designer -->
## 设计、发布与处理

设计器支持开始、1–8 个顺序步骤、结束。每步为 SINGLE、ALL 或 ANY；领域层允许 2–16 个固定成员，本示例只有 Bob/Carol 可选。选择卡片后在单一检查器中编辑，连接处可插入步骤，支持 50 次本地撤销/重做。

- ALL 要求全员同意，任一驳回终止；ANY 首个同意即可通过，只有全员驳回才终止。
- 同一人可在不同步骤分别表决。未轮到的步骤不能提前处理，完成的分组不会伪造其他成员的票。
- 发布检查 expectedVersion；冲突保留草稿，刷新后重新应用。刷新工作区保留未发布草稿，退出或刷新整页丢失；成功发布清空撤销历史。
- 已提交申请保留不可变流程、业务内容及逐人记录。管理员或页面提示不能扩大服务端权限。完整定义包含申请人时禁止提交。
- 中英文切换只改变界面，用户输入、流程名称和意见保留原文。手机布局可切换流程和设置；Escape 返回所选卡片。

当前审批人来自保存的定义与历史，不能使用单一兼容字段 `approverId` 代表全部分组成员。

<!-- topic:state -->
## 列表、草稿与不确定响应

“待我审批”和“我的处理”分别使用服务端分页、游标、过滤条件和加载状态。处理记录要求实际表决，同一申请可在下一步骤再次进入待办。数字是已加载行数，不是服务端总数。详情沿用可见申请列表与共享快照缓存，没有单申请 GET 接口。

每种业务保留自己的草稿、原提交键与流程版本、设计器撤销状态和原步骤意见。换场景或语言不改变它们。新发布不能改变不确定提交的重试版本；成功提交只清理原表单。延迟响应只能更新原作用域，退出、切换身份或未授权响应清除全部作用域。旧列表响应不能覆盖已确认的新决策。

写入期间抑制重复点击。网络结果不确定时不自动新建请求；原键和内容留在内存供手工重试。刷新整页、关闭或退出会丢失键，重新提交前先检查保存的记录。恢复失败时禁止继续决策。详见[幂等与恢复](../../docs/SUBMISSION_IDEMPOTENCY.md)。

<!-- topic:scenarios -->
## 业务表单和响应边界

客户端严格检查类型、元数据和响应，不把六场景合并成宽松通用表单。共享精确数字解析器在 JavaScript 舍入前检查原始 JSON 数字。

| 业务 | 当前边界 | 场景响应 |
| --- | --- | --- |
| 请假/采购 | 独立草稿；采购数量为整数、价格保留十进制文本，`3 × USD 0.10 = USD 0.30` | 通用申请直接返回 |
| 报价折扣 | 独立报价页面、独立流程与业务校验 | 见[报价契约](../../docs/CRM_QUOTE_CASE.md) |
| 报销/出差 | 明细费用或目的地、日期、事由、预算；出差 1–90 天为派生显示 | `{request,total}`，total 为十进制字符串 |
| 用印 | 七个表单字段，份数 1–100；文件引用只作惰性文本 | `{request,total:null}` |
| 收货 | 1–20 行，PCS/BOX 分别汇总；接收不超过订购，合格+不合格=接收，有不合格时说明原因 | `{request,total:null,summary}` |
| 付款 | 发票原额、已结算、本次分配、扣减及四项精确合计；净额必须大于零 | `{request,total,paymentSummary}`，total 为净额 |
| 合同 | 合同金额与 1–20 里程碑之和相等，日期在期限内且非递减；非标准条款须说明 | `{request,total}`，total 为合同金额 |

原始无效数字留在输入框供纠正，不截断或自动转换。业务引用不保证跨申请唯一；收货不做跨单数量分配，付款不预留发票余额。所有提交内容只读保存。详细字段、限制与例子统一见[接口参考](../../docs/api/API_REFERENCE.md)和[能力目录](../../docs/CAPABILITIES.md)。

这些操作只产生内部审核结果，不付款、不入库、不盖章、不签约、不预订出行、不向外部 ERP/CRM 回写。

<!-- topic:routing -->
## 受限条件路径

仅报销、付款、收货、合同显示“节点执行条件”。它与审批分组 ALL/ANY 表决独立：

- 报销总额：保存的 1–20 行精确求和，EQ/GT/GTE/LT/LTE，显式同币种 CNY/USD/EUR/GBP/JPY，阈值 0–20,000,000,000，最多两位小数，JPY 整数。`GTE` 阈值以下保留必审，达到或超过则增加财务；见[独立报销案例](../../docs/EXPENSE_ROUTING.md)。

- 付款净额：EQ/GT/GTE/LT/LTE；CNY/USD/EUR/GBP/JPY，阈值 0–20,000,000,000，最多两位小数，JPY 为整数，同流程币种一致。
- 收货：是否存在不合格行，匹配 true/false。
- 合同：STANDARD/NONSTANDARD，EQ 或 IN。

最多八个平铺条件，至少一个无条件审批，不支持嵌套或开始/结束节点条件。报销/付款币种不匹配阻止提交；不会换汇或静默跳过。清除所有条件仍保留 schema 4；schema 2/3 结构不变。

表单预览使用当前发布或重试绑定的流程。服务端提交时独立评估并冻结选择的步骤和判定依据，客户端重算并拒绝伪造结果。未纳入步骤明确标为条件未满足，不显示为通过。后续发布不改变原路线。详见[条件路由](../../docs/CONDITIONAL_ROUTING.md)。

<!-- topic:verify -->
## 验证界面与真实 HTTP

先构建后端，再执行浏览器套件：

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml package
cd examples/approval-ui
npm ci
npx playwright install chromium
npm run test:e2e
```

Linux 可能需要 Playwright 系统依赖。测试拒绝复用 8080/5173 上已有服务，使用新临时存储与临时密码；可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定现有 Chromium。不要并发运行共享端口的套件。

从 UI 目录运行这些真实客户端 HTTP 检查，它们各自启动并关闭隔离后端：

```sh
node scripts/verify-inbox-http.mjs ../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
node scripts/verify-receiving-http.mjs ../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
node scripts/verify-complex-http.mjs ../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
node scripts/verify-routing-http.mjs ../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```

截图只记录成功登录后的合成工作区，不记录密码页、HAR、认证轨迹或会话文件。必须保留精确源码、后端身份、运行 ID 和哈希；兼容后端结果不能冒充声明版本通过。测试发现、单元测试、构建或旧截图均不证明当前浏览器通过。

按需执行[常规视觉场景](e2e/VISUAL_SCENARIOS.md)、[收货](e2e/RECEIVING_SCENARIOS.md)、[付款合同](e2e/COMPLEX_SCENARIOS.md)、[条件路由](e2e/CONDITIONAL_ROUTING.md)的命令和证据要求。跨浏览器、真机、200% 缩放和正式无障碍审计仍需独立验证。
