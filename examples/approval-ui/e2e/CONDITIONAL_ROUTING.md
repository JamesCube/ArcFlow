# 条件路由验收

<!-- Legacy fragments remain entry points after the language split. -->
<a id="conditional-routing-acceptance"></a>
<a id="local-verification-status"></a>
<a id="scope"></a>

[English](CONDITIONAL_ROUTING.en.md)

<!-- topic:scope -->
[conditional-routing.spec.mjs](conditional-routing.spec.mjs) 使用真实本地后端、临时账号与 JSON 存储验证场景工作区，不操作真实付款、签约或外部业务系统。以下覆盖范围与门槛描述当前测试契约；历史检查点不作为当前提交通过的证明。

<!-- topic:coverage -->
## 覆盖范围与证据门槛

付款、收货、合同各自执行英文与中文用例，共六条浏览器旅程。两种语言使用独立业务记录，标题与意见采用正常业务语言，仅业务引用带随机隔离后缀；不使用真实供应商、客户或合同。

- 付款：数值条件、审批模式切换、撤销/重做、发布、币种不匹配阻止提交、低额路径冻结、旧无条件申请保持不变、清除/重加条件仍保留 schema 4，以及高低路径的真实 ALL/ANY 表决。高额路径包含 Bob 与 Carol 的逐人审核及最终阶段，低额路径只需一票；中英文均检查审批人只能查看条件、不能编辑。
- 收货：仓库/质检条件 ALL 会签、每位审批人的独立表决、采购审核、异常收货的通过与驳回，以及正常收货跳过验收会签后由采购一票完成。
- 合同：IN/ANY 条件配置与 ALL 表决规则相互独立，空 IN 选择阻止发布；非标合同完成商务审核、进入会签、部分表决及最终通过，标准合同跳过会签阶段。

[截图契约](../scripts/routing-capture-contract.mjs) 要求 20 个状态：

- 付款 7 个：条件配置、低额冻结、高额进入会签、高额部分表决、高额最终审核、高额完成、低额完成。
- 收货 8 个：条件配置、正常收货冻结、异常收货进入会签、异常收货部分表决、采购审核、异常收货通过、异常收货驳回、正常收货通过。
- 合同 5 个：条件配置、非标进入会签、非标部分表决、非标通过、标准通过。

20 个状态 × 中英两种语言 × 1440px/390px 两种宽度 = 80 张原始 PNG。语言和宽度变体不算新的业务状态；同一语言的两种宽度展示同一笔申请的相同已保存状态。截图在认证后的页面顶部 `(0, 0)` 拍摄全页，分别使用 1440×1000 与 390×844 视口；必须无横向溢出，不截密码页。

每条旅程的 `routing-receipt.json` 保存实际启动后端的 SHA-256、合成申请的定义/路径/历史及每个业务截图检查点。[证据校验器](../scripts/verify-routing-captures.mjs) 要求：

- 六份成功旅程回执和完整 80 张配对 PNG；校验原始图像 SHA-256、完整 PNG 编码、视口、语言及页面原点。
- 所有图像与回执属于同一干净提交、源码树、运行 ID/attempt、仓库与后端包。后端 SHA-256 必须与该提交已检验的运行时报告一致，报告明确声明 Boot 4.1.1、Spring Framework 7 与 Spring Security 7。
- 真实包含/排除路径与精确业务事实匹配；每条连续旅程沿用同一申请。每个检查点的审批人/步骤/动作顺序、意见、中间与最终状态，以及配对图像的申请 ID 和决定数必须匹配契约。
- 检查点历史必须是最终保存历史的前缀；终态检查点必须与最终状态及全部历史完全一致。跳过的步骤不得产生表决。

认证信息、HAR、轨迹、视频与浏览器存储不保存。证据写入被 Git 忽略的测试输出目录。PNG 完整性与流程断言通过不能代替对下载原图的独立视觉审阅，也不能认证图像真实性；旧截图或旧运行不能证明当前提交通过。

<!-- topic:history -->
## 历史本地验证状态

以下仅记录 2026-10-09 [历史实现检查点](../../../docs/CONDITIONAL_ROUTING.md#local-verification-checkpoint-2026-10-09)，不是本次合并或当前提交的验收结果。当时完整前端单元/DOM 与生产构建通过；真实后端 HTTP 验证三类场景，包括精确的 `CNY 6500`/`CNY 10000`、布尔/枚举事实、排除路径 1 票与包含路径 3 票、schema 4 全无条件快照、旧 schema 3，以及发布后的原版本丢响应重试。在 `examples/approval-ui` 目录执行的命令为：

```sh
node scripts/verify-routing-http.mjs ../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```

该检查点没有本地渲染或截图验收：Chromium 在 process-singleton 阶段报 `socket() failed: Operation not permitted`；支持的云浏览器也不能连接隔离的 localhost，未降低安全设置。当时测试发现列出三个场景；当前扩展后的套件包含六条中英旅程。测试发现与历史 HTTP/DOM 结果均不能代替当前提交的浏览器执行、完整回执校验和原图审阅。

完成后端构建并安装前端依赖及 Playwright Chromium 后，在允许运行浏览器的本地/CI 环境，从 `examples/approval-ui` 执行：

```sh
npm run test:e2e -- e2e/conditional-routing.spec.mjs --output=routing-visual-results
```

精确提交的验收还须按 [Approval demo CI](../../../.github/workflows/approval-demo.yml) 的条件路由任务生成运行时报告，并以所期望的提交、运行和后端身份运行证据校验器。单独执行上述浏览器命令不等于完成这些门槛。当前提交 CI、独立视觉审阅、远端发布和部署须分别报告。

不据此宣称生产就绪、跨浏览器、200% 缩放、无障碍审计或任意流程引擎能力。
