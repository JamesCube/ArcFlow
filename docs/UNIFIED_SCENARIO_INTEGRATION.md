# 场景统一集成历史

<!-- Legacy fragments remain entry points after the language split. -->
<a id="current-main-scope--当前主线范围"></a>
<a id="four-isolated-scenarios--四个独立场景"></a>
<a id="historical-implementation-checkpoint--历史实现检查点"></a>
<a id="jdbc-compatibility--数据库边界"></a>
<a id="local-verification-checkpoint--本地验证阶段"></a>
<a id="reader-and-writer-contract--读写兼容"></a>
<a id="rollout-and-stop-conditions--切换与停止条件"></a>
<a id="status--状态"></a>
<a id="unified-scenario-integration--场景统一集成"></a>
<a id="verification-gates"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](UNIFIED_SCENARIO_INTEGRATION.en.md) · [文档目录](README.md)

<!-- topic:current-main-scope -->
## 当前主线范围

当前 main 已合入出差、用印、收货，与报销、付款、合同组成六项独立目录，领域共九类；reader 支持 wrapper 1–13，条件仅付款/收货/合同。下方候选状态、输入 head、缺失原图和本地结果均为历史；合并不能追认跳过或受阻检查为通过。[当前架构](development/ARCHITECTURE.md) · [迁移](development/PERSISTENCE.md)

<!-- topic:historical-candidate-status -->
## 历史候选状态

原本地候选将有边界的出差/用印/收货与已有报销组合，当时**未合并或部署**。本记录说明契约和门槛，**不声称完整 exact-head CI/发布通过**。测试文件、合法 workflow、历史单 PR 绿灯或 H2 不能证明组合宿主、真实数据库和浏览器通过。

共同基线 `71910bfc2ac1b9d58e0f7f1b85e6bbb206321ec1`，输入：

| 候选 | 精确 head |
| --- | --- |
| [Travel PR35](https://github.com/JamesCube/ArcFlow/pull/35) | `b1306f0cb9571d054949fb4cb89dcc103ddf6347` |
| [Seal-use PR37](https://github.com/JamesCube/ArcFlow/pull/37) | `0fca720bf07085bfd988616074aa03f3b493ed44` |
| [Receiving PR38](https://github.com/JamesCube/ArcFlow/pull/38) | `91facd6bfee8cfa46756f409153f27eb07ec67dd` |

原候选图下载遇 **HTTP403/1010**，原始字节、逐图来源、独立像素检查未验证。新自动图不能追认不可用原图；新组合采集和独立审查是分开的发布门槛。此次统一了三个原本互不兼容的 reader/宿主，单 PR 结果不能代替组合结果，自动 CI 不能代替逐图验收。

<!-- topic:local-verification-checkpoint -->
## 本地验证检查点

2026-10-09 组合本地工作树报告如下，与干净已提交组合 head、GitHub CI 和发布验收分开：

| 检查 | 观察结果 |
| --- | --- |
| 内核/Python | 24 回归及 33 Python 通过 |
| 领域 | 505，通过中含 21 个 `UnifiedBusinessSchemaTest` |
| 前端单元/模型/DOM | 1,197 及生产构建通过 |
| H2 共用契约 | 94，零跳过/错误/失败；本地 JDBC 模块共 137 通过 |
| 真实 MySQL 8.0.46 | 100，零跳过/错误/失败，15 个新增场景/组合具名用例均在 |
| PostgreSQL/MySQL8.4 | 未跑，PostgreSQL94 跳过不是服务器通过 |
| CI/文档静态 | 六工作流解析、shell/内嵌 Python、链接、验证夹具通过，不代表 GitHub CI/浏览器 |
| 补充 Boot3.5.16 | 单独配置运行器 88 通过，仅诊断，不满足声明后端门槛 |
| 声明 Boot4.1.1 | 受阻：parent POM 未缓存，Maven Central 新 DNS 解析失败 |
| exact-head 截图/像素 | 未建立，原图访问仍受阻 |

单独 Boot3 不能代替声明 Boot4.1.1 HTTP/浏览器；后续改动需重测，数量不授权合并或部署。

<!-- topic:historical-reader-and-writer-contract -->
## 历史读写契约

该候选 reader 严格接受 wrapper **1–10**，显式七类：

| 类型 | 最低 wrapper | 字段/版本 |
| --- | --- | --- |
| `leave`、`procurement` | 5 | 原严格单据，不加版本字段 |
| `quoteDiscount` | 6 | 不可变报价版本/源字段 |
| `expense` | 7 | 版本 1，精确费用 |
| `travel` | 8 | 版本 1，日历日期/精确预算 |
| `sealUse` | 9 | 版本 1，非金额文档/份数 |
| `receiving` | 10 | 版本 1，严格整数/分单位摘要 |

最低值不是精确值：Travel 可在 9/10、Seal 可在 10，8/9/10 可空或只有旧类型；低于最低值拒绝。未知类型/大小写别名、缺少/重复/未知字段、未来单据版本、当时 11+、小数/溢出 wrapper 或非法业务均拒绝。schema1 迁移与 2/3/4 形状仍严格，不承诺未来格式或让旧程序自动兼容。当前 1–13 规则见上方迁移指南。

写入取已有 wrapper、定义/历史、最低 2、带键最低 4、类型化最低 5 及各已存类型最低值最大值。打开不改写或强升 10；首次报销仍只需 7。真实升级后旧接口/出差/用印/报销/决定/发布均不降级。

每次升级保留紧邻之前逐字节文件，包括进程中早先写入；重名选安全新名，保留旧备份。原子替换失败不发布申请/键，非法读取或校验不改快照/备份。

收货在类型后置/树缓冲及严格恢复前保留原始 `-0` 防护；每次场景决定 CAS 重查类型。用印保持有效 UTF-8 `application/json`、原始外层 8,000,000 UTF-16 单元上限和安全 415 处理，不是累积快照文件上限。

<!-- topic:historical-four-scenario-isolation -->
## 历史四场景隔离

当时按稳定 ID 排序：`erp-receiving`、`oa-expense`、`oa-seal-use`、`oa-travel`，各有准确类型、流程、固定后缀及浏览器工作区；用户路径不能选任意文件。

| 场景 | 加到 `approval.data-file` 的后缀 | 响应 |
| --- | --- | --- |
| 报销 | `.scenario-oa-expense.json` | `{request,total:string}` |
| 出差 | `.scenario-oa-travel.json` | `{request,total:string}` |
| 用印 | `.scenario-oa-seal-use.json` | `{request,total:null}` |
| 收货 | `.scenario-erp-receiving.json` | `{request,total:null,summary}` |

`/scenarios.html` 分别保留表单、设计器、选择、评论、未确认键/意图/版本；迟到响应绑定发起场景和会话，退出清空，重载不恢复持久草稿。收货另有 `/receiving.html` 和 Vite 构建目标。

`/api/scenarios/{compiled-id}` 拒绝其他类型；通用独立/若依仅请假/采购，CRM 源访问/归属/版本检查与路由独立。编解码支持不授权绕过宿主或混用场景文件。

均为固定版本表单及 1–8 个固定成员 SINGLE/ALL/ANY；该候选不增加动态条件引擎、任意表单、真实源、上传、预订、付款、盖章/签约、入库或回写。收货 Bob 可前一 ALL 已办、后一阶段待办，每步独立票；不同单位不相加为总数量/金额。字段契约：[报销](EXPENSE_SCENARIO.md)、[出差](TRAVEL_SCENARIO.md)、[用印](SEAL_USE_SCENARIO.md)、[收货](RECEIVING_SCENARIO.md)。

<!-- topic:jdbc-compatibility -->
## JDBC 兼容

各类沿用严格 `request_json`，SQL revision **3** 与就绪投影不变；新增类型**无需 DDL 或重建已就绪索引**。revision2 仍需显式停写有界回填，不为加类型重新初始化或清空就绪表。

键在数据库全局为 `(applicant_id, submission_key)`，不按场景隔离。流程存储不得暴露/修改他流程申请、历史或成员；定义/版本不可变，成员由固定快照与实际票派生。JSON 各自每文件键空间，SQL 未变不证明旧 codec 兼容。

<!-- topic:verification-gates -->
## 验证门槛

工作流检出精确 `${{ github.event.pull_request.head.sha || github.sha }}`，新组合证据须用该源与声明 **Boot4.1.1**，其他 Boot 只作诊断。

1. 内核/领域/迁移：合法 1–10 读矩阵、非法低版本/类型、三个新类型六种写序、单调写、紧邻字节备份/重名/失败/重试/重启、非法读不改文件、收货词法、旧形状/授权/CAS 回归。
2. 宿主：Travel/Seal/Receiving 至少 5/10/4 测试，另有 `UnifiedScenarioApiTest` 目录/封装/文件/跨宿主；保留 CRM/Expense/Travel/Seal/inbox 实际 HTTP，收货已安装客户端验证声明后端包。
3. H2 及真实 PG17/MySQL8.0/8.4，按配置 Java17/21。真实服务器零跳过/错误/失败且具名用例齐全。原 10 新增（Travel2、Seal4、Receiving4）给 PG≥89/MySQL≥95，五项组合后变 **PG≥94/MySQL≥100**；数量不能代替名称。
4. 完整共享模型/DOM、若依挂载、构建/真实浏览器；重型报销/出差/用印独立矩阵并从通用调用排除，收货独立作业，旧请假/采购、CRM、图集/拒绝仍必需。
5. 认证 exact-head 图集：报销 16、出差 20、用印 18、收货 15，核状态名、源版本、图片 hash、语言/视口/来源；收货另需 ALL/ANY 验收摘要、干净 tree 和后端身份。不保留认证 trace、密码、HAR、视频或登录图。
6. 中英桌面/390px 独立原图审查：错误/数量可读、键盘/焦点、无裁切、不同真实状态、业务冻结。原图仍受阻，代码、生成图或别场景不能代替。

十项原新增服务器测试须保留：

- `travelTypedSnapshotGlobalKeysAndMemberProjectionRemainProcessIsolated`
- `travelConcurrentRetryCreatesOneRequestBindingAndExactAudit`
- `sealUseTypedSnapshotGlobalKeysAndMemberProjectionRemainProcessIsolated`
- `sealUseConcurrentRetryCreatesOneRequestBindingAndExactAudit`
- `sealUseEveryFieldAndVersionBindsRetryAfterRejectionAndReopen`
- `sealUseFailedAuditRollsBackTypedRequestMembersAndKey`
- `receivingTypedSnapshotAllVotesAndProcessIsolation`
- `receivingConcurrentRetryAndRepeatedReviewerRemainExact`
- `receivingRawNegativeZeroPayloadCannotBeRead`
- `receivingHostRejectsWrongBusinessTypeBeforeMutation`

五项组合数据库另要求隔离读/决定/inbox、全局跨类型键冲突、独立版本重启、双连接单键仅一赢家、申请/审计/键/成员共同回滚；报销/CRM 既有具名门槛也保留。

<!-- topic:rollout-and-stop-conditions -->
## 上线与停止条件

1. 新写者开放前先对历史数据验证统一 reader。代码不自动提供两阶段部署或开关，生产需明确入口上线计划。
2. 停不兼容写者，备份文件/库，全部 codec 一致且 JDBC3 就绪；每入口功能/视觉门槛完成后启用，前端/目录校验器同步部署，旧严格客户端可能拒绝新目录。
3. JSON 单写者；响应失败先核持久状态再重试/恢复，失败不证明没提交。
4. 历史恢复丢后续申请/票/发布，不是无损回退；不得降 wrapper、删类型、忽略记录或重建索引假装旧程序安全。
5. codec、宿主隔离、迁移或 exact-head 证据失败时停止，分别报告源、命令、通过/失败/受阻及原图未解门槛。合并/部署另需授权，本文不声称执行。
