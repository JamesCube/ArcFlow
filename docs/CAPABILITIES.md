# 审批能力与场景目录

<!-- Legacy fragments remain entry points after the language split. -->
<a id="approval-rules-and-voting"></a>
<a id="business-forms-and-scenarios"></a>
<a id="business-template-progress-merged-unified-integration-and-future-candidates"></a>
<a id="candidate-business-templates-each-still-unimplemented"></a>
<a id="en-design"></a>
<a id="en-forms"></a>
<a id="en-integration"></a>
<a id="en-next"></a>
<a id="en-people"></a>
<a id="en-reliability"></a>
<a id="en-rules"></a>
<a id="en-scenarios"></a>
<a id="en-tasks"></a>
<a id="existing-cases-and-step-by-step-screens"></a>
<a id="flow-design-and-versions"></a>
<a id="integration-clients-and-core"></a>
<a id="people-identity-and-permissions"></a>
<a id="proposed-sequence-scenarios-visual-forms-and-configuration"></a>
<a id="reliability-storage-and-recovery"></a>
<a id="task-handling-and-history"></a>
<a id="three-separate-layers"></a>
<a id="审批能力与场景目录--approval-capabilities-and-scenario-catalog"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](CAPABILITIES.en.md) · [文档目录](README.md)

这份清单把“可运行”“需接入”和“尚未实现”逐项分开，保留原始 91 项能力条目。当前范围按 `0.1.0-SNAPSHOT` 的 main [`666ff64b`](https://github.com/JamesCube/ArcFlow/commit/666ff64b280157e44a86f07a15fcb42f859ec11a) 核对：九种业务类型、六项独立场景目录，付款／收货／合同三种受限条件路由均已在源码中合入。合并不等于已部署或生产就绪；源码／测试链接用于定位依据，具体提交的 CI、真实浏览器与数据库结果必须另查。

✅ 已实现，限于写明的范围；🟡 有限支持，仍有宿主接线、客户端或验证范围限制；— 尚未实现。下文建议顺序不改变这些状态，也没有交付日期。

<!-- topic:three-separate-layers -->
## 先分清三个层次

| 层次 | 负责什么 | 边界 |
| --- | --- | --- |
| Java DAG 内核 | 图校验、同步处理器、变量与事件 | 无第三方运行时依赖；没有持久运行状态、人工等待或异步调度 |
| 审批领域与存储 | 顺序人工步骤、固定组、权限、快照、历史和持久化 | 位于 examples 下的独立模块，有自己的 Spring／Jackson／数据库依赖 |
| 宿主与界面 | 独立 Vue、原生若依、H5、隔离 CRM 页面与六场景页 | 入口支持不同；默认单写者 JSON，没有完整生产服务的就绪保证 |

流程设计器配置的是审批步骤；它还不是业务表单设计器。现有九种业务字段均由代码定义；六场景表单按编译期版本化 `ScenarioCatalog` 元数据渲染，不支持任意字段拖拽或表单 schema 发布。页面能力链接真实截图；并发、权限、幂等和事务必须看源码与测试，截图不能证明这些保证。


[流程设计与版本](#zh-design) · [审批规则与表决](#zh-rules) · [人员、身份与权限](#zh-people) · [任务处理与记录](#zh-tasks) · [业务表单与场景](#zh-forms) · [可靠性、存储与恢复](#zh-reliability) · [集成、客户端与内核](#zh-integration) · [场景与建设顺序](#zh-scenarios)

<a id="zh-design"></a>

<!-- topic:flow-design-and-versions -->
## 流程设计与版本

| 能力 | 状态 | 范围与限制 | 依据 / Evidence |
| --- | --- | --- | --- |
| 顺序步骤 | ✅ | 固定开始、1–8 个审批步骤、固定结束；只有当前步骤可处理。 | [定义 / Definition][definition] · [Screen](DESIGNER_GALLERY.md#sequential) |
| 插入步骤 | ✅ | 独立设计器可在指定连接位置插入审批步骤；不支持任意连线。 | [测试 / Tests][designer-tests] · [Screen](DESIGNER_GALLERY.md#all) |
| 删除步骤 | ✅ | 独立设计器可删除审批步骤，至少保留一步；不会修改已提交申请。 | [测试 / Tests][designer-tests] |
| 调整步骤顺序 | ✅ | 上下移动按钮调整顺序，保留节点标识；不是拖拽自由画布。 | [测试 / Tests][designer-tests] · [Screen](DESIGNER_GALLERY.md#reorder) |
| 节点属性配置 | ✅ | 选中节点后编辑名称、指定人员及 SINGLE／ALL／ANY；流程和节点名称最多 120 字符。 | [定义 / Definition][definition] · [Screen](DESIGNER_GALLERY.md#any) |
| 草稿撤销／重做 | 🟡 | 独立设计器保留当前标签页编辑历史；发布或退出后清空，不提供持久草稿或团队协作编辑。 | [测试 / Tests][designer-tests] · [Screen](DESIGNER_GALLERY.md#undo) |
| 定义校验 | ✅ | 校验 schema、边界、唯一节点 ID、名称、步骤数和组成员；界面错误可定位字段，服务端再校验。 | [定义 / Definition][definition] · [测试 / Tests][designer-tests] · [Screen](DESIGNER_GALLERY.md#validation) |
| 发布与版本冲突 | ✅ | 发布要求发布权限和期望版本；并发发布发生版本冲突，不能静默覆盖。 | [服务 / Service][service] · [Screen](DESIGNER_GALLERY.md#publish) |
| 申请固定流程版本 | ✅ | 提交后固定顺序、参与人和规则；后续发布仅用于新申请，不迁移运行中实例。 | [服务 / Service][service] · [Screen](DESIGNER_GALLERY.md#versions) |
| 受限条件路由 | 🟡 | 当前 main 已提供付款净额、收货拒收、合同条款的类型化条件，选择额外人工步骤；定义 schema 4／JSON wrapper 13，提交冻结完整路径。仅限三个独立场景，无任意表达式；具体提交的浏览器／数据库 CI 需另查。 | [合同 / Contract](CONDITIONAL_ROUTING.md) |
| 任意分支／汇聚 | — | 人工审批是顺序步骤；ALL／ANY 人员组不等于通用并行网关。 | [定义 / Definition][definition] |
| 运行中实例迁移 | — | 没有把已有申请迁到新流程版本的操作。 | [服务 / Service][service] |
| BPMN 导入／导出与执行 | — | 没有 BPMN 兼容实现；路线图也未承诺完整规范。 | [路线图 / Roadmap][roadmap] |

<a id="zh-rules"></a>

<!-- topic:approval-rules-and-voting -->
## 审批规则与表决

| 能力 | 状态 | 范围与限制 | 依据 / Evidence |
| --- | --- | --- | --- |
| 单人审批 | ✅ | 每步一个指定账号，同意后推进、拒绝后整笔结束；SINGLE 是界面名称，存储为 approval 节点。 | [定义 / Definition][definition] · [Screen](DESIGNER_GALLERY.md#sequential) |
| 会签 ALL | ✅ | 每组 2–16 个不同固定成员；全员同意才推进，任一拒绝即结束。 | [规则 / Rules][parallel] · [测试 / Tests][parallel-tests] · [Screen](DESIGNER_GALLERY.md#votes) |
| 或签 ANY | ✅ | 任一同意即推进；部分拒绝仍可继续，只有全员拒绝才结束。 | [测试 / Tests][parallel-tests] · [Screen](CASE_GALLERY.md#other-clients) |
| 混合单人与组步骤 | ✅ | 同一顺序流程可混用单人、ALL 和 ANY；组内表决未完成时，不启动后续步骤。 | [测试 / Tests][parallel-tests] · [Screen](DESIGNER_GALLERY.md#all) |
| 同人跨步骤审批 | ✅ | 一个人可以出现在不同步骤，每步分别投票；早先意见不会自动通过后续步骤。 | [重试测试 / Retry tests][retry-tests] · [Screen](DESIGNER_GALLERY.md#votes) |
| 提前完成后的未投票成员 | ✅ | ANY 提前通过或 ALL 拒绝后，未投票者不再因该组待办，也不补造投票或已办记录；若下一步骤仍指定该人，须另行处理。 | [收件箱测试 / Inbox tests][inbox-tests] · [Screen](DESIGNER_GALLERY.md#votes) |
| 多数／比例表决 | — | 没有 N-of-M、票数门槛或加权投票规则。 | [定义 / Definition][definition] |
| 自动同意／自动拒绝 | — | 没有无人处理、金额阈值或超时触发的自动决定；审批人必须明确操作。 | [服务 / Service][service] |
| 运行中加签／减签 | — | 当前申请的参与人快照不可改写；没有前加签、后加签或移除成员命令。 | [服务 / Service][service] |

<a id="zh-people"></a>

<!-- topic:people-identity-and-permissions -->
## 人员、身份与权限

| 能力 | 状态 | 范围与限制 | 依据 / Evidence |
| --- | --- | --- | --- |
| 宿主人员目录 | 🟡 | ActorDirectory 查询活动账号及发布／指派资格；账号管理由宿主负责。 | [接口 / Interface][identity] · [测试 / Tests][identity-tests] |
| 独立演示人员选择 | 🟡 | 默认申请人 Alice，设计器审批人仅 Bob、Carol；领域的 16 人组上限不代表演示提供 16 个账号。 | [后端 / Backend][backend] · [Screen](DESIGNER_GALLERY.md#all) |
| 若依真实账号选择 | ✅ | 原生编辑器从若依用户目录选择固定账号，复用登录、菜单及按钮权限。 | [控制器 / Controller][ruoyi-controller] · [Screen](CASE_GALLERY.md#other-clients) |
| 申请可见范围 | ✅ | 申请人与快照内有效路径参与人可见；仅位于跳过步骤的人员不获访问权。待办另限当前未投票成员，管理员不能凭通配权限代投。 | [服务 / Service][service] · [权限测试 / Tests][identity-tests] |
| 禁止申请人自审 | ✅ | 新提交时拒绝把申请人列在任何审批步骤；不是仅排除当前步骤。 | [服务 / Service][service] · [测试 / Tests][identity-tests] |
| 活动身份复核 | ✅ | 领域列表／收件箱读取在存储 I/O 后再次检查身份；历史账号标识仍保留。 | [读取边界测试 / Read tests][read-identity-tests] |
| 报价业务读权与归属 | ✅ | 专用宿主核对源报价版本读权和归属销售；审批权限不能绕过源业务读权。 | [宿主 / Host][quote-host] · [测试 / Tests][quote-domain-tests] |
| 动态角色选人 | — | 不能把角色名保存成运行时解析的审批候选人规则。 | [人员接口 / Directory][identity] · [定义 / Definition][definition] |
| 部门／直属主管选人 | — | 没有组织树、直属主管或逐级主管的自动解析规则。 | [人员接口 / Directory][identity] |
| 转办／代理审批 | — | 没有转给其他人或设置休假代理的操作；不得使用他人身份代投。 | [服务 / Service][service] |
| 租户隔离 | — | 流程 ID 作用域和参与人权限不构成租户安全边界。 | [存储契约 / Storage][jdbc] · [H5 边界 / H5 scope][mobile] |

<a id="zh-tasks"></a>

<!-- topic:task-handling-and-history -->
## 任务处理与记录

| 能力 | 状态 | 范围与限制 | 依据 / Evidence |
| --- | --- | --- | --- |
| 发起申请 | ✅ | 独立／若依桌面表单可发起请假、采购；报价从专用页面、报销从 /scenarios.html 发起，H5 不提供发起。 | [采购表单 / Forms](PROCUREMENT_UI.md) · [Screen](CASE_GALLERY.md#oa-submitted) |
| 我的待办 | ✅ | 当前步骤中本人尚未投票才是待办，覆盖 ALL／ANY 的每位成员；未来步骤不提前待办。 | [契约 / Contract][inbox] · [Screen](CASE_GALLERY.md#oa-inbox) |
| 我的已办 | ✅ | 必须有本人真实 APPROVE／REJECT 记录；提交不算已办，整笔申请可以仍在审批中。 | [测试 / Tests][inbox-tests] · [Screen](CASE_GALLERY.md#oa-pending-next) |
| 游标分页与筛选 | ✅ | 每页 1–100 条，默认 25；可按状态、流程版本筛选。游标绑定身份和筛选，跨页不是冻结快照。 | [契约 / Contract][inbox] · [测试 / Tests][inbox-tests] |
| 同意／拒绝 | ✅ | 服务端验证当前步骤、本人资格及决定；已经终结的申请不能重新推进。 | [服务 / Service][service] · [Screen](CASE_GALLERY.md#erp-review) |
| 审批意见 | ✅ | 意见随一次表决保存；相同决定重试不改写原意见，没有独立聊天接口。 | [重试测试 / Tests][retry-tests] · [Screen](CASE_GALLERY.md#oa-approved) |
| 逐人审批历史 | ✅ | 保存人员、动作、步骤、时间和意见，已保存事件不能通过审批接口改写；不是密码学防篡改审计。 | [存储契约 / Store][store] · [Screen](CASE_GALLERY.md#erp-approved) |
| 领取任务 | — | 固定成员直接表决，没有共享候选池中的领取／释放生命周期。 | [服务 / Service][service] · [路线图 / Roadmap][roadmap] |
| 申请撤回 | — | 申请人没有撤销已提交申请的操作。 | [服务 / Service][service] |
| 退回指定步骤 | — | 拒绝会结束申请，没有选择退回节点或重新打开下游任务的规则。 | [服务 / Service][service] |
| 原单修改后重提 | — | 没有在原申请上改字段、保留往返记录后重新提交的生命周期。 | [业务契约 / Contract][business] |
| 抄送／知会 | — | 没有抄送节点、知会收件箱或已读状态。 | [定义 / Definition][definition] |
| 批量审批 | — | 接口按单笔申请、步骤和参与人处理，没有批量决策契约。 | [服务 / Service][service] |
| 定时催办 | — | 没有催办调度或定时消息服务。 | [路线图 / Roadmap][roadmap] · [适配器 / Adapters][mobile-adapters] |
| 逾期升级 | — | 没有到期自动换人、升级或结束；报价有效期提示不改变审批状态。 | [报价宿主 / Host][quote-host] |

<a id="zh-forms"></a>

<!-- topic:business-forms-and-scenarios -->
## 业务表单与场景

| 能力 | 状态 | 范围与限制 | 依据 / Evidence |
| --- | --- | --- | --- |
| OA 请假表单 | ✅ | 标题、理由和 1–365 个整天；不含起止日期、半天、余额计算或假期日历。 | [字段校验 / Validation][business-model] · [Screen](CASE_GALLERY.md#oa-form) |
| ERP 采购表单 | ✅ | 单个品名、数量 1–100000、单价和币种；不是多行采购明细或实际下单。 | [表单契约 / Forms](PROCUREMENT_UI.md) · [Screen](CASE_GALLERY.md#erp-form) |
| CRM 报价折扣表单 | 🟡 | 合成单行报价，固定销售经理 → 财务；专用 /api/crm 和 /quote-discount.html，与共享工作区隔离。 | [案例 / Case](CRM_QUOTE_CASE.md) · [Screen](CASE_GALLERY.md#crm-form) |
| 精确金额与币种 | ✅ | 十进制校验和合计，CNY／USD／EUR／GBP／JPY；单价必须大于 0 且不超过 1,000,000,000.00，最多两位小数；JPY 为整数，不自动换汇。 | [模型 / Model][business-model] · [前端测试 / UI tests][frontend-money-tests] · [Screen](CASE_GALLERY.md#erp-review) |
| 不可变业务快照 | ✅ | 保存提交时的类型化业务字段；审批期间不能改写，恢复时再次校验。 | [测试 / Tests][business-tests] · [Screen](CASE_GALLERY.md#erp-submitted) |
| 源报价版本与提示 | ✅ | 校验源字段、版本和有效日期；折扣百分比、10% 提示及过期提示都不自动路由。 | [模型测试 / Tests][quote-model-tests] · [宿主 / Host][quote-host] · [Screen](CASE_GALLERY.md#crm-manager-review) |
| 可视化表单设计器 | — | 现有表单由代码定义；没有拖拽字段、字段面板或发布表单 schema 的界面。 | [业务契约 / Contract][business] · [表单源码 / UI](../examples/approval-ui/src/App.vue) |
| 字段联动与节点字段权限 | — | 没有配置式显隐、跨字段公式或按审批步骤编辑字段的规则；已提交业务字段始终只读。 | [业务契约 / Contract][business] |
| 场景模板库 | 🟡 | 当前 main 的编译期 ScenarioCatalog 与 /scenarios.html 包含报销、出差、用印、收货、付款、合同六项，各自独立流程／存储；请假／采购和报价另有入口。无运行时安装、复制或任意表单发布。 | [业务契约 / Contract][business] · [目录源码 / Catalog][scenario-catalog] · [报销契约 / Expense][expense] |
| 附件 | — | 没有上传、权限下载、病毒扫描或附件留存服务。 | [字段定义 / Fields][business-model] · [H5 范围 / H5 scope][mobile] |
| 多行明细 | 🟡 | 报销、收货、付款、合同支持 1–20 行类型化明细及各自验证；金额精确计算，收货数量按单位汇总。采购与报价仍为单行，不提供通用明细设计器。 | [字段定义 / Fields][business-model] · [报销测试 / Tests][expense-tests] · [Screen][expense-gallery] |
| 审批后业务回写 | — | 通过仅保存审批状态；不创建采购订单、更新真实 CRM、发货、开票或付款。 | [采购边界 / Procurement](PROCUREMENT_UI.md) · [报价边界 / Quotes](CRM_QUOTE_CASE.md) |

<a id="zh-reliability"></a>

<!-- topic:reliability-storage-and-recovery -->
## 可靠性、存储与恢复

| 能力 | 状态 | 范围与限制 | 依据 / Evidence |
| --- | --- | --- | --- |
| 提交幂等 | ✅ | 通用接口可选申请人作用域键，无键每次新建；全部六场景专用提交必须带一个 Idempotency-Key。同键同原始意图返回持久申请当前状态，字段、明细或原流程版本变化即冲突。 | [契约 / Contract][idempotency] · [测试 / Tests][idempotency-tests] · [报销契约 / Expense][expense] |
| 页面重试键 | 🟡 | 请假／采购及六场景的未确认提交键保存在页面内存，刷新或退出丢失；服务端持久绑定可在重启后重放，业务编号本身不是去重键。 | [提交契约 / Contract][idempotency] · [表单边界 / Forms](PROCUREMENT_UI.md) |
| 报价版本幂等绑定 | ✅ | CRM 专用宿主按不可变报价版本生成持久键；不接收自定义 Idempotency-Key。 | [宿主 / Host][quote-host] · [HTTP 测试 / Tests][quote-tests] |
| 审批决定幂等 | ✅ | 同一申请／步骤／成员重试相同决定不追加事件或改意见；相反决定冲突。 | [测试 / Tests][retry-tests] |
| 并发状态更新 | ✅ | 修订号 CAS 与存储原子更新保护审批状态；不保证外部付款或消息恰好执行一次。 | [竞争测试 / Race tests][race-tests] · [JDBC 测试 / Tests][jdbc-tests] |
| 本地 JSON 恢复 | 🟡 | 保存定义、申请、历史和键绑定，重开可恢复；原子替换要求单写者，不保证断电或任意文件系统耐久性。 | [实现 / Store][json-store] · [测试 / Tests][json-tests] |
| JDBC 事务存储 | ✅ | 对应事务提交审批、审计、成员索引和键；宿主必须显式提供 DataSource 和适配器接线。 | [契约 / Contract][jdbc] · [实现 / Store][jdbc-store] |
| 回滚与提交不确定性 | 🟡 | 写入失败尝试回滚；提交或连接清理异常后需核对持久状态，不能把异常当成肯定未提交。 | [事务契约 / Contract][jdbc] · [测试 / Tests][jdbc-tests] |
| H2 契约测试 | ✅ | H2 存储契约用于本地测试，不代替 PostgreSQL／MySQL 服务器兼容性结果。 | [测试 / Tests][h2-tests] |
| PostgreSQL 验证范围 | 🟡 | 真实 PostgreSQL 17.6 CI；核对所用提交中未跳过的结果，不能泛化到全部版本和配置。 | [CI][jdbc-ci] · [测试 / Tests][postgres-tests] |
| MySQL 验证范围 | 🟡 | 实验性 MySQL 8.0／8.4 真服务器矩阵；不涵盖 MariaDB、5.7、9 或全部 8.x 配置。 | [CI][jdbc-ci] · [测试 / Tests][mysql-tests] |
| JSON schema 升级 | 🟡 | 严格读取 wrapper 1–13；请假／采购最低 5、报价 6、报销 7、出差 8、用印 9、收货 10、付款 11、合同 12，定义 schema 4 需 13。只读不升级，写入不降级；先停不兼容读写端并备份，旧备份恢复会丢失后续写入。SQL revision 3 不变不代表旧 reader 兼容。 | [契约 / Contract][business] · [测试 / Tests][json-tests] · [报销契约 / Expense][expense] |
| SQL 迁移与回填 | 🟡 | 成员索引仍用 SQL revision 3；新类型与条件本身不新增 DDL，不重建已 ready 的旧索引。旧库仍须显式迁移／有界回填；没有自动 JSON→SQL 导入或混版本写者支持。 | [迁移契约 / Migration][jdbc] |
| 业务表联合事务 | — | JdbcApprovalStore 不自动加入宿主业务表事务或 Spring @Transactional。 | [事务契约 / Contract][jdbc] |
| 事务 outbox | — | 没有事务消息表、投递确认或消息重放服务。 | [存储边界 / Storage][jdbc] |
| 持久化异步执行 | — | Java DAG 内核同步串行运行，不保存可恢复运行状态或人工等待点。 | [内核 / Core][core] |
| 后台自动重试 | — | 审批接口的幂等重放不是调度器；没有失败节点的退避或后台重试策略。 | [内核 / Core][core] · [路线图 / Roadmap][roadmap] |
| 执行超时／取消 | — | 没有持久化截止计时或取消运行的 API；处理器中断不等于完整取消生命周期。 | [内核 / Core][core] · [路线图 / Roadmap][roadmap] |

<a id="zh-integration"></a>

<!-- topic:integration-clients-and-core -->
## 集成、客户端与内核

| 能力 | 状态 | 范围与限制 | 依据 / Evidence |
| --- | --- | --- | --- |
| 独立 Spring Boot + Vue | 🟡 | 中英文设计／表单／审批工作区，另有报价与六场景入口及隔离文件；固定演示账号和单写者 JSON，不是生产身份系统。 | [后端 / Backend][backend] · [界面测试 / Tests][standalone-tests] |
| 原生 RuoYi-Vue + Vue3 | 🟡 | 官方宿主参考接入；若依 MySQL 用户库不表示审批自动使用 SQL，仍需单独接线。 | [接入 / Setup][ruoyi] · [宿主测试 / Tests][ruoyi-tests] |
| H5 手机浏览器 | 🟡 | 中英文待办／已办、只读请假／采购详情和审批；没有手机发起、设计、报价或报销支持；报销的窄屏网页截图不代表 H5 客户端接入。 | [客户端 / Client][mobile] · [Screen](CASE_GALLERY.md#other-clients) |
| Java／HTTP 接口 | ✅ | main 注册九类业务；通用 HTTP 仅接受请假／采购，报价走 /api/crm 专用授权宿主，其余六类走准确类型的 /api/scenarios 路由。只在付款／收货／合同场景开放条件路由。 | [业务契约 / Contract][business] · [HTTP 测试 / Tests][http-tests] |
| 存储适配接口 | ✅ | ApprovalStore 可替换；第三方适配器须实现契约，未实现 inbox 时会显式失败。 | [接口 / SPI][store] · [收件箱契约 / Inbox][inbox] |
| DAG 依赖校验 | ✅ | Java 17 目标，内核无第三方运行时依赖；检查重复节点、未知依赖和环。 | [实现 / Implementation][workflow] · [测试 / Tests][core-tests] |
| DAG 同步执行 | ✅ | 按依赖顺序逐节点执行，传递变量快照；再次运行会重新执行，外部副作用不自动回滚。 | [实现 / Implementation][core] · [测试 / Tests][core-tests] |
| Handler／Event 扩展接口 | ✅ | 宿主提供节点处理器与事件监听器；监听器不是可靠消息总线，线程安全由提供方保证。 | [Handler][core-handlers] · [Event][core-events] · [内核 / Core][core] |
| Spring Boot Starter | — | 有可运行的 Spring Boot 示例，没有独立自动配置 Starter。 | [路线图 / Roadmap][roadmap] |
| 飞书／企微／钉钉身份 | — | 只有未配置适配器占位，明确拒绝调用；未完成 OAuth、平台 SDK 或企业 SSO。 | [适配器 / Adapters][mobile-adapters] |
| 外部消息通知 | — | 没有邮件、Webhook、飞书／企微／钉钉消息投递服务。 | [适配器 / Adapters][mobile-adapters] · [路线图 / Roadmap][roadmap] |
| 原生 App／小程序 | — | 当前验收为 H5 浏览器；未提供 Android／iOS／小程序构建和真机测试。 | [移动端边界 / Mobile scope][mobile] |
| 真实 CRM／ERP／AI 连接 | — | 合成数据案例不连接真实业务系统或模型服务；没有自动商业决策。 | [报价案例 / Quote case](CRM_QUOTE_CASE.md) |

<a id="zh-scenarios"></a>

<!-- topic:existing-cases-and-step-by-step-screens -->
## 已有场景与逐步截图

当前 main 注册九类业务：请假、采购、报价、报销、出差、用印、收货、付款与合同。下面保留已有图集及其历史计数；代码实现数量与可核验截图数量是不同口径。原有前三类案例及其设计器、人员组、若依、H5 图集包含 33 个不同场景、61 张中英文原始截图；这不是 33 种业务模板，语言变体不重复算场景。该历史计数不含已合并的报销图集，后者单独为 8 个状态／视口组合、16 张中英文原图。

| 业务 | 配置与表单 | 提交／待审／下一步 | 通过／驳回 | 边界 |
| --- | --- | --- | --- | --- |
| OA 请假 | [可视化流程](DESIGNER_GALLERY.md#sequential) · [表单](CASE_GALLERY.md#oa-form) | [提交](CASE_GALLERY.md#oa-submitted) · [待办](CASE_GALLERY.md#oa-inbox) · [下一步](CASE_GALLERY.md#oa-pending-next) | [通过](CASE_GALLERY.md#oa-approved) · [驳回](CASE_GALLERY.md#oa-rejected) | 独立／若依可发起，H5 仅审批 |
| ERP 采购 | [流程人员组](DESIGNER_GALLERY.md#all) · [表单](CASE_GALLERY.md#erp-form) | [提交](CASE_GALLERY.md#erp-submitted) · [主管](CASE_GALLERY.md#erp-review) · [复核](CASE_GALLERY.md#erp-final-review) | [通过](CASE_GALLERY.md#erp-approved) · [驳回](CASE_GALLERY.md#erp-rejected) | 单项采购，沿用宿主流程，无下单或付款 |
| CRM 报价折扣 | [表单](CASE_GALLERY.md#crm-form) · [固定流程代码][quote-host] | [提交](CASE_GALLERY.md#crm-submitted) · [经理](CASE_GALLERY.md#crm-manager-review) · [财务](CASE_GALLERY.md#crm-finance-review) | [通过](CASE_GALLERY.md#crm-approved) · [驳回](CASE_GALLERY.md#crm-rejected) | 独立入口；没有报价流程配置界面，卡片不显示逐人意见／完整历史 |

[逐图来源与复现](GALLERY_CAPTURE.md) · [业务图集](CASE_GALLERY.md#provenance)。报价历史由 API 断言核对，不能从当前报价结果卡片中看到。未来场景没有真实实现和验证前，不配“已支持”的演示图。

**已合并 · OA 费用报销：** `/scenarios.html` 提供固定结构表单与可视化审批流程，保存 1–20 行类型化明细、精确金额及不可变业务／流程快照。专用 `/api/scenarios/oa-expense` 宿主使用 `approval.data-file + ".scenario-oa-expense.json"`，提交幂等键必填，schema 7 按先读后写顺序升级，SQL revision 3 不变。它是有界的合成演示，不打款、不上传或验真发票，不连接真实财务系统、共享收件箱、若依或 H5。

[报销契约与真实图集][expense-gallery]单独记录场景入口、填写、设计器、提交待审、当前审批人、390px 窄屏审批、通过和驳回。16 张原图来自 [`90007fc`](https://github.com/JamesCube/ArcFlow/commit/90007fc8d0499b45ca38a04d010029888ab5cbef) 的[浏览器运行](https://github.com/JamesCube/ArcFlow/actions/runs/37803754153)，[逐图来源与 SHA-256](images/expense/provenance.json)可核验；图集提交 `9653f95` 未改应用源码。[HTTP 测试][expense-api-tests]与[真实后端浏览器测试][expense-browser-tests]提供代码依据；不能将报销图或测试当作出差验收证据。


<a id="zh-next"></a>

<!-- topic:proposed-sequence-scenarios-visual-forms-and-configuration -->
## 建议建设顺序：场景库、可视化表单与配置

下面保留分阶段建设顺序：报销、出差、用印、收货、付款与合同已合入 main 的六场景目录，真实源业务接线、任意表单配置和更多操作仍是后续工作，没有排期。各阶段的合并范围与具体提交的验收结果分别记录。

| 顺序 | 建设范围 | 完成时应能核验什么 |
| --- | --- | --- |
| 1 · 第一条完整链路 | 已合并费用报销：类型化单据、版本化场景目录、独立流程、固定结构表单和只读详情 | [报销契约][expense]、源码／测试及 [16 张真实图][expense-gallery]；使用时仍核对对应提交的 CI |
| 2 · 扩展 OA | 出差与用印已合入 main，保留各自字段与规则；按具体提交核对验收 | 每种场景有自己的入口、流程配置、业务验证与验收，不能把改标题当成新模板 |
| 3 · 源业务绑定 | 收货、付款、合同合成场景已合入 main；真实源版本、权限与余额集成仍待实现 | 明确源单据版本、业务读权及归属、重复提交规则；审批不自动付款、入库或签署 |
| 4 · 可视化表单配置 | 在固定／版本化表单之上增加字段面板、预览、校验和发布；另行定义字段 schema 与兼容性 | 从界面配置产生服务端验证的单据，旧申请仍可读取；未完成前不能称为通用拖拽表单设计器 |
| 5 · 更多流转规则 | 三种受限条件已实现；动态角色／部门选人、退回、撤回、加签、转办仍需逐项建立契约 | 每项先写清权限、终态、版本和并发语义，再补执行、客户端及负向测试 |
| 6 · 宿主与交付保障 | 按需要接入真实系统、事务 outbox、消息、租户隔离及移动端能力 | 独立适配与故障测试；源码示例通过不直接等于生产环境验收 |

<a id="候选业务模板逐项标明尚未实现"></a>

<!-- topic:business-template-progress-merged-unified-integration-and-future-candidates -->
## 业务模板进度：已合并、统一集成与后续候选

| 分类 | 场景 | 状态 | 首批边界／前置条件 |
| --- | --- | --- | --- |
| OA | 费用报销 | 🟡 | 已合并、可运行的有界合成演示；1–20 行费用、日期、类别、精确金额、币种与票据文字引用，不打款、不上传或验真发票；[契约与图集][expense-gallery] |
| OA | 出差申请 | 🟡 已合入 main | [出差契约][travel]：目的地、用途、日期与精确预算，1–90 个自然日，独立宿主、最低 wrapper 8；不订票、不报销或付款 |
| OA | 用印申请 | 🟡 已合入 main | [用印契约][seal]：文件引用、印章类别、用途和份数，最低 wrapper 9；不处理真实印章或电子签章 |
| ERP | 付款申请 | 🟡 已合入 main | [付款契约](PAYMENT_CONTRACT_SCENARIOS.md)：1–20 行发票分配与扣减、精确净额、最低 wrapper 11；不查真实余额、不跨单占票、不转账 |
| ERP | 收货验收 | 🟡 已合入 main | [合成收货契约][receiving]：1–20 行数量与差异，初始 ALL→Bob，最低 wrapper 10；无真实采购源绑定、跨单余额或自动入库 |
| CRM | 合同评审 | 🟡 已合入 main | [合同契约](PAYMENT_CONTRACT_SCENARIOS.md)：条款、期限、1–20 个付款里程碑及交付条件，最低 wrapper 12；不签署、不发送客户、不写回 CRM |
| OA | 加班申请 | — | 后续候选；工作日历、时区、时长与冲突规则未定义 |
| ERP | 采购退货 | — | 后续候选；原收货记录、可退数量和库存处理契约未定义 |
| CRM | 信用额度申请 | — | 后续候选；客户主数据、额度来源和版本策略未定义 |
| CRM | 退款申请 | — | 后续候选；原交易、可退余额及重复退款边界未定义，不执行退款 |

当前 main 已合入全部六个独立场景和付款／收货／合同条件路由，严格 reader 支持 wrapper 1–13。领域共九类型，通用入口仍限请假／采购，报价另有专用宿主。请按所用提交检查迁移、HTTP、UI、浏览器及 H2/PostgreSQL/MySQL 结果，不以历史单 PR 通过代替。历史统一候选曾遭遇原图下载 HTTP 403／1010；该检查点未取得原始 PNG、哈希与独立像素验收的事实保留在[历史记录][unified]，不据此推断当前 CI 成败。固定版本表单不等于任意字段引擎，见[当前开发架构](development/ARCHITECTURE.md#zh)与[条件契约](CONDITIONAL_ROUTING.md)。

**每个新增场景的交付清单：** 可解释的字段与状态契约、服务端验证、身份／业务读权、可配置的固定人员流程、不可变快照、重复操作与失败测试，以及中英文的“流程配置 → 填写 → 待审 → 通过 → 驳回”真实截图。六个首批场景至少需要 60 张不同场景／语言状态图；这是完整场景组的验收要求，不是已完成数量，当前报销 16 张单独记录。新能力还应补相应冲突、权限拒绝与恢复证据。

[现有路线图](ROADMAP.md)记录更广的引擎方向；本节只给本次场景库的建议顺序。没有实施日期或交付承诺。当前可运行内容仍以上面的状态矩阵为准。

[core]: ../src/main/java/com/arcflow/ArcFlowEngine.java
[core-tests]: ../src/test/java/com/arcflow/EngineChecks.java
[workflow]: ../src/main/java/com/arcflow/Workflow.java
[domain]: ../examples/approval-domain/README.md
[definition]: ../examples/approval-domain/src/main/java/com/arcflow/approval/ProcessDefinition.java
[service]: ../examples/approval-domain/src/main/java/com/arcflow/approval/ApprovalService.java
[store]: ../examples/approval-domain/src/main/java/com/arcflow/approval/ApprovalStore.java
[parallel]: PARALLEL_APPROVAL.md
[parallel-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/ParallelApprovalTest.java
[designer-tests]: ../examples/approval-ui/src/ProcessDesigner.test.js
[ruoyi-editor]: ../examples/ruoyi-vue3/frontend/src/views/arcflow/approval/index.vue
[business]: BUSINESS_DOCUMENTS.md
[business-model]: ../examples/approval-domain/src/main/java/com/arcflow/approval/BusinessDocument.java
[business-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/BusinessDocumentTest.java
[inbox]: MEMBER_INBOX.md
[inbox-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/InboxQueryTest.java
[identity-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/ActorDirectoryTest.java
[idempotency]: SUBMISSION_IDEMPOTENCY.md
[idempotency-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/SubmissionIdempotencyTest.java
[retry-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/ApprovalRetryBoundaryTest.java
[race-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/ApprovalStoreRaceTest.java
[json-store]: ../examples/approval-domain/src/main/java/com/arcflow/approval/JsonApprovalStore.java
[json-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/JsonSchemaUpgradeTest.java
[jdbc]: ../examples/approval-jdbc/README.md
[jdbc-store]: ../examples/approval-jdbc/src/main/java/com/arcflow/approval/jdbc/JdbcApprovalStore.java
[jdbc-ci]: ../.github/workflows/approval-jdbc.yml
[accepted-crm]: CRM_COMPATIBILITY_READINESS.md#accepted-crm-checkpoint
[standalone-tests]: ../examples/approval-ui/src/App.procurement.test.js
[ruoyi]: ../examples/ruoyi-vue3/README.md
[ruoyi-controller]: ../examples/ruoyi-vue3/backend/src/main/java/com/ruoyi/arcflow/ArcFlowController.java
[ruoyi-tests]: ../examples/ruoyi-vue3/tests/smoke.py
[mobile]: ../examples/approval-mobile/README.md
[mobile-model]: ../examples/approval-mobile/src/domain/model.ts
[mobile-adapters]: ../examples/approval-mobile/src/platform/adapters.ts
[quote-host]: ../examples/approval-domain/src/main/java/com/arcflow/approval/QuoteDiscountCase.java
[quote-tests]: ../examples/approval-demo/backend/src/test/java/com/arcflow/demo/QuoteDiscountApiTest.java
[quote-ui-tests]: ../examples/approval-ui/tests/crm-quote/page.test.mjs
[roadmap]: ROADMAP.md
[designer-model]: ../examples/approval-ui/src/designer-model.js
[designer-model-tests]: ../examples/approval-ui/src/designer-model.test.js
[identity]: ../examples/approval-domain/src/main/java/com/arcflow/approval/ActorDirectory.java
[read-identity-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/IdentityReadBoundaryTest.java
[quote-domain-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/QuoteDiscountCaseTest.java
[quote-model-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/QuoteDiscountTest.java
[http-tests]: ../examples/approval-demo/backend/src/test/java/com/arcflow/demo/ApprovalApiTest.java
[security-tests]: ../examples/approval-demo/backend/src/test/java/com/arcflow/demo/SecurityConfigTest.java
[jdbc-tests]: ../examples/approval-jdbc/src/test/java/com/arcflow/approval/jdbc/JdbcApprovalStoreTest.java
[postgres-tests]: ../examples/approval-jdbc/src/test/java/com/arcflow/approval/jdbc/PostgresqlApprovalStoreTest.java
[mysql-tests]: ../examples/approval-jdbc/src/test/java/com/arcflow/approval/jdbc/MysqlApprovalStoreTest.java
[h2-tests]: ../examples/approval-jdbc/src/test/java/com/arcflow/approval/jdbc/H2ApprovalStoreContractTest.java
[frontend-money-tests]: ../examples/approval-ui/src/business-document.test.js
[backend]: ../examples/approval-demo/backend/README.md
[core-handlers]: ../src/main/java/com/arcflow/spi/NodeHandler.java
[core-events]: ../src/main/java/com/arcflow/spi/EventListener.java
[gallery-tests]: ../examples/approval-ui/e2e/gallery.spec.mjs

[scenario-catalog]: ../examples/approval-domain/src/main/java/com/arcflow/approval/ScenarioCatalog.java
[expense]: EXPENSE_SCENARIO.md
[expense-gallery]: EXPENSE_SCENARIO.md#gallery
[expense-tests]: ../examples/approval-domain/src/test/java/com/arcflow/approval/ExpenseScenarioTest.java
[expense-api-tests]: ../examples/approval-demo/backend/src/test/java/com/arcflow/demo/ScenarioApiTest.java
[expense-browser-tests]: ../examples/approval-ui/e2e/scenarios.spec.mjs
[travel]: TRAVEL_SCENARIO.md

[seal]: SEAL_USE_SCENARIO.md
[receiving]: RECEIVING_SCENARIO.md
[unified]: UNIFIED_SCENARIO_INTEGRATION.md
