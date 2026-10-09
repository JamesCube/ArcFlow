# 收货验收

<!-- Legacy fragments remain entry points after the language split. -->
<a id="contract"></a>
<a id="persistence-and-compatibility-gate"></a>
<a id="verification"></a>
<a id="中文"></a>
<a id="收货验收--goods-receipt-review"></a>
<a id="数量与边界"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](RECEIVING_SCENARIO.en.md) · [文档目录](README.md)

<!-- topic:current-scope-and-historical-evidence -->
## 当前范围与历史证据

收货已包含在当前 main 六场景目录中，并支持受限条件。当前 JSON reader 为 1–13，收货最低仍为 10，上线见[当前迁移](development/PERSISTENCE.md)。原统一候选基于 `71910bfc2ac1b9d58e0f7f1b85e6bbb206321ec1`，当时未合并/部署，reader 严格为 1–10。其组合验证和独立像素证据缺失继续作为历史事实保留，见[集成记录](UNIFIED_SCENARIO_INTEGRATION.md)。

<!-- topic:scenario-and-review-flow -->
## 场景与审批流程

独立 `erp-receiving` 位于 `/receiving.html`，也可从 `/scenarios.html` 六场景目录进入，使用本次启动的演示账号/密码。仅用合成数据；订单/验收是手工快照，没有真实 PO 查询或跨申请累计余额。

示例 Alice 提交 `GR-DEMO-001`、订单 `PO-DEMO-001`、东区演示仓和日期。传感器行：PCS，订购 20、到货 10、合格 8、不合格 2，原因“外壳损坏”；线缆行：BOX，订购 10、到货 5、合格 5、不合格 0。

默认仓库/质量 ALL（Bob+Carol）→ 采购复核（Bob）。Bob 第一票仍等 Carol，两人通过后 Bob 需另投采购票；任一 ALL 拒绝即结束。Bob 兼两项职责是固定账号演示，不保证职责分离，也不动态解析角色/部门。

Alice 可修改顺序、指定人、SINGLE/ALL/ANY 并发布，旧业务和流程快照不变。原候选没有字段条件，当前收货可配置[受限条件](CONDITIONAL_ROUTING.md)。

<!-- topic:quantity-and-response-contract -->
## 数量与响应契约

版本 1 包含业务引用、标题、说明、合成 PO、EAST/WEST 仓库、真实 YYYY-MM-DD 到货日期和 1–20 行。每行 lineId 与 PO 行引用各自在本单唯一，另有物料描述、PCS/BOX 单位、订购/到货/合格/不合格数量及异常原因。

数量必须是 0–100000 JSON 整数 token，订购为正；拒绝小数、指数、字符串、布尔、null 或浮点转整数。到货≤手工订购数，合格+不合格=到货；可有零到货行，但整单至少一行正到货。不合格为正时必须有有意义的原因，最多 1000 UTF-16 单元。

响应为 `{request,total:null,summary:{kind:"receiving",lineCount,exceptionLineCount,quantities:[{unit,received,accepted,rejected}]}}`。只显示存在的单位，PCS 在 BOX 前，分别统计，另有行数/异常行数；不把不同单位加为总数量或金额。报销/出差仍恰为 `{request,total:string}`，用印为 `{request,total:null}`，均无收货 summary。

申请人范围的键对相同规范化单据、行顺序和原版本返回持久结果，包括重启或终审后。改数量、引用、单位、说明或顺序都冲突；新键可再次提交同 PO，不提供跨单去重、库存预留、累计收货或防重复入库保证。

通过仅完成本申请审核，不入库、付款、退货、更新供应商/订单、回写或证明实际质检完成。

<!-- topic:historical-persistence-and-compatibility-gate -->
## 历史持久化与兼容门槛

- 原统一 reader 严格接受 1–10，当前为 1–13。Travel 最低 8、Seal 最低 9、Receiving 最低 10；合法 8/9 只读打开，收货在 8/9 中仍拒绝。
- 写入取已有 wrapper 和全部类型/定义/键需求最大值；后续旧接口/报销/出差/用印不低于 10。原 reader 拒绝未知类型、未来单据版本和 11+，当前上限见迁移指南。
- 升级保留紧邻之前精确字节，包含同会话早前写入，备份防重名；替换失败不发布申请/键，非法读取不改快照/旧备份。
- 原始负零在多态类型后置或请求树缓冲规范化前拒绝；不支持的数字词法、降级收货和篡改关系同样拒绝。
- 隔离宿主启动及变更前检查业务类型；决定每次 CAS 重查，过期预检不能向其他类型追加票。
- JDBC 保持 SQL revision 3、`request_json`、数据库全局申请人/键和就绪成员投影。仅新增类型不需 DDL/重建，revision 2 仍需显式停写迁移/回填。H2 不证明真实 PostgreSQL/MySQL。
- 新写入前给全部读写者部署统一 reader 并停不兼容程序；旧候选不能互读彼此类型。历史恢复丢失后续工作，不是无损降级。
- 发布前对最终组合 head 重跑。CI 检出精确事件 head，测声明 Boot 4.1.1，要求十项新增 Travel/Seal/Receiving 服务器用例无跳过，以及 15 张认证中英收货 Chromium 状态图及提交/hash 来源。原产物 HTTP 403/1010 导致原 PNG 与独立像素复核未取得；自动测试和像素验收独立。

<!-- topic:verification -->
## 验证

分别运行领域、JDBC 与声明后端：

```sh
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-jdbc/pom.xml verify
mvn -f examples/approval-demo/backend/pom.xml verify
cd examples/approval-ui && npm test && npm run build
```

重点覆盖严格数字词法、数量/文本边界、零到货行、按单位汇总、重复引用、全零/空/超长单据、ALL 部分投票/拒绝、ANY 自定义发布、同人跨阶段投票、访问隔离、键冲突、并发重试、文件/JDBC 重开、升级备份和原子发布失败。
