# 按总额选择报销审批路径

[English](EXPENSE_ROUTING.en.md) · [文档目录](README.md)

<!-- topic:scope-and-prerequisites -->
## 范围与准备

本操作案例适用于当前源码中 `/scenarios.html` 的独立 OA 费用报销场景（`oa-expense`）。它在固定人员流程上增加 `expense.totalAmount` 条件：Bob 始终审核费用，精确总额达到设定阈值时才由 Carol 财务复核。发布者修改前，默认流程仍为无条件审批。该字段不增加业务类型、端点、表单字段或通用表达式引擎。

按[本地启动](GETTING_STARTED.md)准备合成数据与一次性演示账号，或在仓库根目录执行 `python3 scripts/tryout.py`，打开打印的 `/scenarios.html` 地址。Alice 可发布和提交；Bob、Carol 是固定人员，并非动态角色。凭据不要放入命令、截图或源码。若保留数据，先完成[上线与恢复](#rollout-and-recovery)，再发布条件流程。

这只记录人工内部审核，不执行报销打款、票据验真/上传、财务回写、组织/角色解析或租户隔离。原生若依、H5、共享请假/采购工作区与报价宿主不会因此获得报销路由。独立网页的窄屏视口也不代表 H5 接入。

<!-- topic:configure-the-finance-threshold -->
## 配置财务复核阈值

1. Alice 登录后选择费用报销，打开流程设计器，保留一个指派给 Bob 的无条件 SINGLE 必审步骤。
2. 新增或选择指派给 Carol 的 SINGLE 财务复核步骤。条件字段选 `expense.totalAmount`，运算符 `GTE`，币种 `CNY`，阈值 `10000`；这一个谓词的组合模式保留 `ALL`。不能把全部审批步骤都改成条件步骤。
3. 使用当前预期流程版本发布。遇到版本冲突时保留草稿，刷新后审阅并重新应用；新申请使用发布响应返回的版本。
4. 填写费用明细并查看路径预览：总额低于 CNY 10,000 时不纳入财务；恰好达到或超过时纳入。服务端会独立校验并冻结结果。

API 客户端可使用下面等价的发布体，它仅适用于**初始版本为 1** 的流程。先读取 `GET /api/scenarios/oa-expense/process`；如已不是版本 1，把两个 version 字段都替换为当前版本。按[接口传输契约](api/API_REFERENCE.md)携带认证与所需 Origin/客户端头，发送至 `POST /api/scenarios/oa-expense/process`。发布会改变当前流程定义。

```json
{
  "expectedVersion": 1,
  "definition": {
    "schemaVersion": 4,
    "id": "oa-expense",
    "version": 1,
    "name": "Synthetic expense amount review",
    "nodes": [
      {"id": "start", "type": "start", "name": "Submit", "assigneeId": null},
      {"id": "expense-review", "type": "approval", "name": "Expense review", "assigneeId": "bob"},
      {
        "id": "finance",
        "type": "approval",
        "name": "Finance review",
        "assigneeId": "carol",
        "runIf": {
          "mode": "ALL",
          "predicates": [
            {"field": "expense.totalAmount", "operator": "GTE", "currency": "CNY", "threshold": 10000}
          ]
        }
      },
      {"id": "end", "type": "end", "name": "Complete", "assigneeId": null}
    ]
  }
}
```

条件可用于 SINGLE、ALL 或 ANY 审批步骤。条件的 `ALL`/`ANY` 用于组合谓词；成员的 `ALL`/`ANY` 用于表决，两者独立。定义仍限制为 1–8 个有序阶段、至少一个无条件人工阶段、全定义至多八个平铺谓词。开始/结束条件、嵌套规则与跨业务谓词均拒绝。清除 schema 4 定义的所有条件也不会降低定义版本。

<!-- topic:exact-total-and-currency -->
## 精确总额与币种

- 不可变 `BusinessDocument.Expense` 包含 1–20 行。`expense.totalAmount` 是各行金额精确求和，不是客户端提交字段，也不是舍入后的显示总额。每行仍须为正且不超过 1,000,000,000；最高总额为 20,000,000,000。
- 运算符为 `EQ`、`GT`、`GTE`、`LT`、`LTE`。阈值是 0 至 20,000,000,000（含端点）的 JSON 数字，最多两位小数，JPY 为整数。浏览器保留十进制文本并精确运算，领域使用 `BigDecimal`；例如 0.10 + 0.20 精确等于 0.30。
- 每个金额谓词必须明确指定 CNY、USD、EUR、GBP 或 JPY，并与报销币种一致；即使 `ANY` 的另一谓词已满足也要检查全部金额谓词。没有换汇、隐含币种或币种不符时静默 false。币种不匹配拒绝提交，不能借此绕过财务审核。
- 原有 `{request,total}` 响应仍把总额作为显示字符串，除 JPY 整数外保留两位小数。冻结的谓词事实使用 `CNY 10000` 这样的规范字符串，去掉小数尾零、不用指数记法。两种格式表示同一精确金额。

日期、引用、类别与文本限制见[报销字段契约](EXPENSE_SCENARIO.md)。合法路由条件不能让非法报销单据通过验证。

<!-- topic:independent-case-matrix -->
## 独立案例矩阵

每个新意图使用不同的合成业务引用与提交键。下表基于前述已发布的 CNY `GTE 10000` 流程，属于验收步骤与预期结果，并非通过记录。通过与驳回分支须分别提交独立申请。

| 案例 | 输入或操作 | 应观察到的结果 |
| --- | --- | --- |
| 低于阈值 | CNY 9,999.99 | 选中 ID 仅含 `expense-review`，财务条件事实为 false。Bob 通过后完成，不产生 Carol 的审批事件。 |
| 恰好达到 | 两行 CNY 6,000 与 4,000 | 精确总额 10,000，选中 `expense-review`、`finance`。Bob 通过后 Carol 待审；Carol 通过后完成。 |
| 高于阈值 | CNY 10,000.01 | 同样走两个步骤，不能因舍入省略财务。 |
| 必审驳回 | 另建低额申请，由 Bob 拒绝 | 申请 REJECTED，不伪造财务票。 |
| 财务驳回 | 另建达到或超过阈值的申请，Bob 通过、Carol 拒绝 | 申请 REJECTED，保留两个真实步骤事件及原业务/定义/路径。 |
| 币种不符 | CNY 条件下提交 USD 报销 | 明确提示币种问题并拒绝，不创建申请、键绑定、初始审计或成员投影；除界面拦截外还要直接验证 HTTP。 |
| 精确小数 | 另行发布 `EQ CNY 0.30`，提交 0.10 与 0.20 两行 | 谓词精确匹配；这是不同意图，使用新键及对应版本。 |
| 阈值/明细边界 | 负数、超过 200 亿或三位小数阈值，JPY 小数，0/21 行，非正/超限行金额 | 对应发布或单据校验拒绝非法值；0 与 200 亿阈值仍合法。 |
| 全条件/跨类型 | 给唯一必审步骤也加条件，或对 `oa-expense` 使用 `payment.netTotal` | 发布拒绝，当前版本不变。 |
| 新版发布、旧单冻结 | 以阈值 10,000 提交 CNY 15,000，再发布阈值 20,000，另提新 CNY 15,000 意图 | 旧单仍需财务，保留完整原定义与事实；新单跳过财务。重启存储后重复检查。 |
| 发布后重试 | 新版本发布或响应丢失后，以旧键、原始请求体和原流程版本重试 | 返回同一持久申请的当前审批状态与原路由，不按新阈值重算；同键改变意图则冲突。 |
| 权限边界 | Carol 访问/操作低额路径；高额路径中 Carol 抢在 Bob 前投票；Alice 自审/自指派 | 仅出现在被跳过步骤的 Carol 不能查看或投票。高额路径中的 Carol 可查看，但当前阶段前不能投票。Alice 不能自审；完整定义任意位置指派 Alice 都阻止提交，即使该步骤会跳过。 |

另按[条件路由要求](CONDITIONAL_ROUTING.md)覆盖 SINGLE/ALL/ANY 分组、重复审批人、伪造/过期客户端响应及篡改路由后的恢复。跳过节点应明确显示未纳入，不能显示为审批通过。历史报销截图早于这个字段，不能证明这些案例。

<!-- topic:frozen-state-and-permissions -->
## 冻结状态与权限

每笔 schema 4 申请保存完整发布定义、不可变报销业务快照和 `routing.schemaVersion:1`。选中步骤 ID 保持原序。evaluations 包含全部条件步骤与全部谓词的精确事实/结果，不短路，也保留未选中步骤的判定。必审步骤始终选中，跳过步骤永远没有审批事件。

重放、当前审批人、投票授权、可见申请与持久成员投影使用同一有效路径。仅出现在跳过步骤的人不能由该指派获得访问权，也不会进入待办/已办；若还出现在其他选中步骤，仍保留那些步骤的原有权利。已办必须有真实保存的票。提交前仍按完整定义禁止自审。

新发布仅影响未来意图。完全相同的已保存意图在发布、审批或重启后重试，仍返回原路径。恢复时从保存业务和完整保存定义重算，比较所有 ID、事实与顺序，不替换成最新配置。缺失或改变路径数据会明确拒绝；一致性检查不等于防止整份未签名文件被重写的密码学证明。

<a id="rollout-and-recovery"></a>

<!-- topic:rollout-and-recovery -->
## 上线与恢复

各版本独立：报销 `documentVersion:1`、定义 schema 4、冻结路由 schema 1、JSON wrapper 13、JDBC SQL revision 3。无条件报销单据最低 wrapper 7；发布任何 schema 4 报销定义时，**即使还没有申请**也要求 wrapper 13。写入不降级，只读不升级。

1. 核对所有读写程序支持的字段，不能只看 wrapper 数字。懂 wrapper 13 但不懂 `expense.totalAmount` 的扩展前程序，必须拒绝仅发布定义的文件和包含该字段的已存申请。不要混跑程序，也不能删除字段来伪装回退兼容。
2. 停止并排空不兼容的读写端，在发布前一致性备份所有活动文件或数据库，并记录代码版本与配置。原本已是 wrapper 13 的存储不会因新增字段触发 wrapper 升级备份，因此操作备份不可省略。
3. 部署匹配的领域、宿主、UI 与 JDBC 组件。先在备份副本验证无申请的保留定义、旧无条件报销、进行中的条件报销、投票、提交键重试与选中成员投影。
4. `routingDefinitions` 保留每个已发布 schema 4 定义，包括旧版和未使用版本；每笔申请保留完整原定义与冻结路径。JSON wrapper 升级时先原样备份紧邻之前字节再原子替换，不得静默接受低 wrapper 路由或未知字段。
5. JDBC 的 SQL revision 3 已存完整定义/申请 JSON 与派生成员；新字段不增加 DDL，也不重建已就绪的 schema 2/3 投影。原 revision 1/2 显式迁移和有界回填仍须执行。相同表结构不允许新旧程序混跑。
6. 验证或恢复失败时停止写入，保留原件、备份与日志。只能配合兼容程序恢复经过审查的一致备份。恢复发布前数据可能丢失之后的申请、票与键，不是无损降级；删除条件或改小 wrapper 编号也不能让旧 reader 安全理解已有条件历史。

使用保留数据前，阅读完整[存储与迁移指南](development/PERSISTENCE.md)。

<!-- topic:verification-and-evidence -->
## 验证与证据

按[开发验证](development/QUICKSTART.md)执行核心、领域、独立 HTTP、UI 和可选 JDBC 检查。用新打包后端与匹配前端执行独立矩阵，陈旧内嵌领域 JAR 不能代表目标候选。用真正旧二进制验证严格拒绝，并确认被拒文件逐字节不变。

从仓库根目录执行下列命令，先按[开发环境](development/QUICKSTART.md)准备 JDK 17+、Maven 及受支持的 Node 版本。HTTP 脚本创建私有临时存储和本地后端，凭据在内存生成，完成后停止自己的进程并删除临时数据。可选 `--output-dir` 保留合成 JSON 回执供检查，该目录须另行管理。浏览器测试也使用一次性数据，需要空闲的 8080/5173 端口，不要并发运行争用端口的套件。

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml package
python3 examples/approval-demo/backend/scripts/verify-expense-routing-http.py \
  --jar examples/approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
(cd examples/approval-ui && npm ci && npx playwright install chromium && \
  npm run test:e2e -- e2e/expense-routing.spec.mjs)
```

[随仓库提供的 API 示例](api/examples/README.md)使用 `GTE CNY 0.30` 与 0.29/0.30/0.31 总额，以紧凑数据验证精确小数边界；它们与本指南的 CNY 10,000 业务案例分开。HTTP 脚本检查真实申请、表决、币种拒绝不落盘、原版本重试及重启；[浏览器套件](../examples/approval-ui/e2e/expense-routing.spec.mjs)操作真实中英文工作区。列出命令不代表已经通过。

浏览器证据使用另一套配置来验证多人表决：可选的大额费用 ALL 节点由 Bob 和 Carol 共同审批，随后是始终保留的 Carol 财务节点。低于阈值时，Bob 不成为该申请成员、没有访问权限，由 Carol 完成唯一有效节点；恰好达到阈值时，必须先取得两人的组内同意，再进入最后的财务审核。这与上方较简单的“Bob → 条件触发 Carol”教程不同。语言和视口变体展示相同业务状态，不另计场景类型。

分别报告单元/HTTP/浏览器、H2/PostgreSQL/MySQL、跳过与未执行项目。真实浏览器应覆盖中英文配置、低/高额预览、已存路径详情、通过与驳回、发布后旧单不变、权限和 390px 视口。新截图关联精确源码/后端/运行/hash。[原报销图集](EXPENSE_SCENARIO.md#gallery)与[原三场景条件图集](galleries/conditional-routing/README.md)保留原范围的历史证据，均不证明新报销路由。本案例指南本身不声明新增测试、CI、截图、发布或部署已通过或完成。

源码：[ConditionalRouting](../examples/approval-domain/src/main/java/com/arcflow/approval/ConditionalRouting.java)、[BusinessDocument](../examples/approval-domain/src/main/java/com/arcflow/approval/BusinessDocument.java)、[ScenarioCase](../examples/approval-domain/src/main/java/com/arcflow/approval/ScenarioCase.java)、[前端路由](../examples/approval-ui/src/routing.js)与[流程设计器](../examples/approval-ui/src/ProcessDesigner.vue)。
