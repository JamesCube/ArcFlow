# 审批能力与场景目录 / Approval capabilities and scenario catalog

[简体中文](#zh) · [English](#en) · [README 中文](../README.md) · [README English](../README.en.md) · [本地运行 / Run locally](TRYOUT.md)

<a id="zh"></a>

## 简体中文

这份清单把“可运行”“需接入”和“尚未实现”逐项分开，方便判断能否用于你的业务。按 `0.1.0-SNAPSHOT` 源码核对，原始 91 项能力核对基线为 [`4ff4bcf`](https://github.com/JamesCube/ArcFlow/commit/4ff4bcf0b90cc07ac26d5483847e8b41fd25ed08)，本次保留全部条目，并以 main 的 [`71910bfc`](https://github.com/JamesCube/ArcFlow/commit/71910bfc2ac1b9d58e0f7f1b85e6bbb206321ec1)为费用报销已交付状态及文案核对基线。出差、用印和收货单列为本地统一集成候选，不属于 main 已交付内容；本文不声称组合版本已测试通过、合并或部署。源码／测试链接用于定位依据；有测试文件不代表任意提交都已通过，使用前仍须查看对应提交的 CI。

✅ 已实现，限于写明的范围；🟡 有限支持，仍有宿主接线、客户端或验证范围限制；— 尚未实现。下文建议顺序不改变这些状态，也没有交付日期。

### 先分清三个层次

| 层次 | 负责什么 | 边界 |
| --- | --- | --- |
| Java DAG 内核 | 图校验、同步处理器、变量与事件 | 无第三方运行时依赖；没有持久运行状态、人工等待或异步调度 |
| 审批领域与存储 | 顺序人工步骤、固定组、权限、快照、历史和持久化 | 位于 examples 下的独立模块，有自己的 Spring／Jackson／数据库依赖 |
| 宿主与界面 | 独立 Vue、原生若依、H5、隔离 CRM 页面与独立报销场景页 | 入口支持不同；默认单写者 JSON，没有完整生产服务的就绪保证 |

流程设计器配置的是审批步骤；它还不是业务表单设计器。现有请假、采购、报价和报销字段均由代码定义；报销表单按编译期版本化 `ScenarioCatalog` 元数据渲染，不支持任意字段拖拽或表单 schema 发布。页面能力链接真实截图；并发、权限、幂等和事务必须看源码与测试，截图不能证明这些保证。


[流程设计与版本](#zh-design) · [审批规则与表决](#zh-rules) · [人员、身份与权限](#zh-people) · [任务处理与记录](#zh-tasks) · [业务表单与场景](#zh-forms) · [可靠性、存储与恢复](#zh-reliability) · [集成、客户端与内核](#zh-integration) · [场景与建设顺序](#zh-scenarios)

<a id="zh-design"></a>

### 流程设计与版本

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
| 受限条件路由 | 🟡 | 本地候选：付款净额、收货拒收、合同条款选择额外人工步骤；schema4/JSON13，提交冻结完整路径。无任意表达式，报价阈值仍只是提示；本轮浏览器验收未完成。 | [合同 / Contract](CONDITIONAL_ROUTING.md) |
| 任意分支／汇聚 | — | 人工审批是顺序步骤；ALL／ANY 人员组不等于通用并行网关。 | [定义 / Definition][definition] |
| 运行中实例迁移 | — | 没有把已有申请迁到新流程版本的操作。 | [服务 / Service][service] |
| BPMN 导入／导出与执行 | — | 没有 BPMN 兼容实现；路线图也未承诺完整规范。 | [路线图 / Roadmap][roadmap] |

<a id="zh-rules"></a>

### 审批规则与表决

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

### 人员、身份与权限

| 能力 | 状态 | 范围与限制 | 依据 / Evidence |
| --- | --- | --- | --- |
| 宿主人员目录 | 🟡 | ActorDirectory 查询活动账号及发布／指派资格；账号管理由宿主负责。 | [接口 / Interface][identity] · [测试 / Tests][identity-tests] |
| 独立演示人员选择 | 🟡 | 默认申请人 Alice，设计器审批人仅 Bob、Carol；领域的 16 人组上限不代表演示提供 16 个账号。 | [后端 / Backend][backend] · [Screen](DESIGNER_GALLERY.md#all) |
| 若依真实账号选择 | ✅ | 原生编辑器从若依用户目录选择固定账号，复用登录、菜单及按钮权限。 | [控制器 / Controller][ruoyi-controller] · [Screen](CASE_GALLERY.md#other-clients) |
| 申请可见范围 | ✅ | 申请人与快照内参与人可见；待办另限当前未投票成员，管理员不能凭通配权限代投。 | [服务 / Service][service] · [权限测试 / Tests][identity-tests] |
| 禁止申请人自审 | ✅ | 新提交时拒绝把申请人列在任何审批步骤；不是仅排除当前步骤。 | [服务 / Service][service] · [测试 / Tests][identity-tests] |
| 活动身份复核 | ✅ | 领域列表／收件箱读取在存储 I/O 后再次检查身份；历史账号标识仍保留。 | [读取边界测试 / Read tests][read-identity-tests] |
| 报价业务读权与归属 | ✅ | 专用宿主核对源报价版本读权和归属销售；审批权限不能绕过源业务读权。 | [宿主 / Host][quote-host] · [测试 / Tests][quote-domain-tests] |
| 动态角色选人 | — | 不能把角色名保存成运行时解析的审批候选人规则。 | [人员接口 / Directory][identity] · [定义 / Definition][definition] |
| 部门／直属主管选人 | — | 没有组织树、直属主管或逐级主管的自动解析规则。 | [人员接口 / Directory][identity] |
| 转办／代理审批 | — | 没有转给其他人或设置休假代理的操作；不得使用他人身份代投。 | [服务 / Service][service] |
| 租户隔离 | — | 流程 ID 作用域和参与人权限不构成租户安全边界。 | [存储契约 / Storage][jdbc] · [H5 边界 / H5 scope][mobile] |

<a id="zh-tasks"></a>

### 任务处理与记录

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

### 业务表单与场景

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
| 场景模板库 | 🟡 | 已合并编译期版本化 ScenarioCatalog 与 /scenarios.html 报销入口；模板结构由代码定义，无运行时安装、复制或任意表单发布。统一候选目录含报销／出差／用印／收货四项，保持独立工作区；新三项未完成发布验收。 | [业务契约 / Contract][business] · [目录源码 / Catalog][scenario-catalog] · [报销契约 / Expense][expense] |
| 附件 | — | 没有上传、权限下载、病毒扫描或附件留存服务。 | [字段定义 / Fields][business-model] · [H5 范围 / H5 scope][mobile] |
| 多行明细 | 🟡 | 报销支持 1–20 行类型化明细、增删、逐行校验及精确合计；行号与合成票据引用在单内唯一。采购与报价仍为单行，不提供通用明细设计器。 | [字段定义 / Fields][business-model] · [报销测试 / Tests][expense-tests] · [Screen][expense-gallery] |
| 审批后业务回写 | — | 通过仅保存审批状态；不创建采购订单、更新真实 CRM、发货、开票或付款。 | [采购边界 / Procurement](PROCUREMENT_UI.md) · [报价边界 / Quotes](CRM_QUOTE_CASE.md) |

<a id="zh-reliability"></a>

### 可靠性、存储与恢复

| 能力 | 状态 | 范围与限制 | 依据 / Evidence |
| --- | --- | --- | --- |
| 提交幂等 | ✅ | 通用接口可选申请人作用域键，无键每次新建；报销专用提交必须带一个 Idempotency-Key。同键同原始意图返回持久申请当前状态，字段、明细或原流程版本变化即冲突。 | [契约 / Contract][idempotency] · [测试 / Tests][idempotency-tests] · [报销契约 / Expense][expense] |
| 页面重试键 | 🟡 | 请假／采购及报销的未确认提交键保存在会话内存，刷新或退出丢失；服务端持久绑定可在重启后重放，业务编号本身不是去重键。 | [提交契约 / Contract][idempotency] · [表单边界 / Forms](PROCUREMENT_UI.md) |
| 报价版本幂等绑定 | ✅ | CRM 专用宿主按不可变报价版本生成持久键；不接收自定义 Idempotency-Key。 | [宿主 / Host][quote-host] · [HTTP 测试 / Tests][quote-tests] |
| 审批决定幂等 | ✅ | 同一申请／步骤／成员重试相同决定不追加事件或改意见；相反决定冲突。 | [测试 / Tests][retry-tests] |
| 并发状态更新 | ✅ | 修订号 CAS 与存储原子更新保护审批状态；不保证外部付款或消息恰好执行一次。 | [竞争测试 / Race tests][race-tests] · [JDBC 测试 / Tests][jdbc-tests] |
| 本地 JSON 恢复 | 🟡 | 保存定义、申请、历史和键绑定，重开可恢复；原子替换要求单写者，不保证断电或任意文件系统耐久性。 | [实现 / Store][json-store] · [测试 / Tests][json-tests] |
| JDBC 事务存储 | ✅ | 对应事务提交审批、审计、成员索引和键；宿主必须显式提供 DataSource 和适配器接线。 | [契约 / Contract][jdbc] · [实现 / Store][jdbc-store] |
| 回滚与提交不确定性 | 🟡 | 写入失败尝试回滚；提交或连接清理异常后需核对持久状态，不能把异常当成肯定未提交。 | [事务契约 / Contract][jdbc] · [测试 / Tests][jdbc-tests] |
| H2 契约测试 | ✅ | H2 存储契约用于本地测试，不代替 PostgreSQL／MySQL 服务器兼容性结果。 | [测试 / Tests][h2-tests] |
| PostgreSQL 验证范围 | 🟡 | 真实 PostgreSQL 17.6 CI；核对所用提交中未跳过的结果，不能泛化到全部版本和配置。 | [CI][jdbc-ci] · [测试 / Tests][postgres-tests] |
| MySQL 验证范围 | 🟡 | 实验性 MySQL 8.0／8.4 真服务器矩阵；不涵盖 MariaDB、5.7、9 或全部 8.x 配置。 | [CI][jdbc-ci] · [测试 / Tests][mysql-tests] |
| JSON schema 升级 | 🟡 | 类型化请假／采购至少 schema 5，报价 schema 6，报销 schema 7；先升级全部读取端、停止不兼容写者再启用，升级保留旧字节备份且后续写入不降级；历史备份不能无损恢复升级后的新写入。统一候选 reader 严格支持 1–10，出差最低 8、用印最低 9、收货最低 10；写入单调取最大值，新类型不重建已 ready 的 SQL revision 3 成员索引。 | [契约 / Contract][business] · [测试 / Tests][json-tests] · [报销契约 / Expense][expense] |
| SQL 迁移与回填 | 🟡 | 成员索引仍为 SQL revision 3，报销不新增 DDL；已有迁移与分批回填须显式完成，无自动 JSON→SQL 导入或混合版本写者支持。 | [迁移契约 / Migration][jdbc] |
| 业务表联合事务 | — | JdbcApprovalStore 不自动加入宿主业务表事务或 Spring @Transactional。 | [事务契约 / Contract][jdbc] |
| 事务 outbox | — | 没有事务消息表、投递确认或消息重放服务。 | [存储边界 / Storage][jdbc] |
| 持久化异步执行 | — | Java DAG 内核同步串行运行，不保存可恢复运行状态或人工等待点。 | [内核 / Core][core] |
| 后台自动重试 | — | 审批接口的幂等重放不是调度器；没有失败节点的退避或后台重试策略。 | [内核 / Core][core] · [路线图 / Roadmap][roadmap] |
| 执行超时／取消 | — | 没有持久化截止计时或取消运行的 API；处理器中断不等于完整取消生命周期。 | [内核 / Core][core] · [路线图 / Roadmap][roadmap] |

<a id="zh-integration"></a>

### 集成、客户端与内核

| 能力 | 状态 | 范围与限制 | 依据 / Evidence |
| --- | --- | --- | --- |
| 独立 Spring Boot + Vue | 🟡 | 中英文设计、表单和审批工作区，报销另有独立场景页与文件；固定演示账号、默认单写者 JSON，非生产账号系统。 | [后端 / Backend][backend] · [界面测试 / Tests][standalone-tests] |
| 原生 RuoYi-Vue + Vue3 | 🟡 | 官方宿主参考接入；若依 MySQL 用户库不表示审批自动使用 SQL，仍需单独接线。 | [接入 / Setup][ruoyi] · [宿主测试 / Tests][ruoyi-tests] |
| H5 手机浏览器 | 🟡 | 中英文待办／已办、只读请假／采购详情和审批；没有手机发起、设计、报价或报销支持；报销的窄屏网页截图不代表 H5 客户端接入。 | [客户端 / Client][mobile] · [Screen](CASE_GALLERY.md#other-clients) |
| Java／HTTP 接口 | ✅ | main 领域支持请假、采购、报价与报销四类单据；通用 HTTP 仅接受请假／采购，报价走业务授权宿主，报销走 oa-expense 专用场景路由。统一候选另含出差／用印／收货独立宿主，通用入口限制不变。 | [业务契约 / Contract][business] · [HTTP 测试 / Tests][http-tests] |
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

### 已有场景与逐步截图

主线已交付请假、采购、报价和费用报销四类业务案例。原有前三类案例及其设计器、人员组、若依、H5 图集包含 33 个不同场景、61 张中英文原始截图；这不是 33 种业务模板，语言变体不重复算场景。该历史计数不含已合并的报销图集，后者单独为 8 个状态／视口组合、16 张中英文原图。

| 业务 | 配置与表单 | 提交／待审／下一步 | 通过／驳回 | 边界 |
| --- | --- | --- | --- | --- |
| OA 请假 | [可视化流程](DESIGNER_GALLERY.md#sequential) · [表单](CASE_GALLERY.md#oa-form) | [提交](CASE_GALLERY.md#oa-submitted) · [待办](CASE_GALLERY.md#oa-inbox) · [下一步](CASE_GALLERY.md#oa-pending-next) | [通过](CASE_GALLERY.md#oa-approved) · [驳回](CASE_GALLERY.md#oa-rejected) | 独立／若依可发起，H5 仅审批 |
| ERP 采购 | [流程人员组](DESIGNER_GALLERY.md#all) · [表单](CASE_GALLERY.md#erp-form) | [提交](CASE_GALLERY.md#erp-submitted) · [主管](CASE_GALLERY.md#erp-review) · [复核](CASE_GALLERY.md#erp-final-review) | [通过](CASE_GALLERY.md#erp-approved) · [驳回](CASE_GALLERY.md#erp-rejected) | 单项采购，沿用宿主流程，无下单或付款 |
| CRM 报价折扣 | [表单](CASE_GALLERY.md#crm-form) · [固定流程代码][quote-host] | [提交](CASE_GALLERY.md#crm-submitted) · [经理](CASE_GALLERY.md#crm-manager-review) · [财务](CASE_GALLERY.md#crm-finance-review) | [通过](CASE_GALLERY.md#crm-approved) · [驳回](CASE_GALLERY.md#crm-rejected) | 独立入口；没有报价流程配置界面，卡片不显示逐人意见／完整历史 |

[逐图来源与复现](GALLERY_CAPTURE.md) · [业务图集](CASE_GALLERY.md#provenance)。报价历史由 API 断言核对，不能从当前报价结果卡片中看到。未来场景没有真实实现和验证前，不配“已支持”的演示图。

**已合并 · OA 费用报销：** `/scenarios.html` 提供固定结构表单与可视化审批流程，保存 1–20 行类型化明细、精确金额及不可变业务／流程快照。专用 `/api/scenarios/oa-expense` 宿主使用 `approval.data-file + ".scenario-oa-expense.json"`，提交幂等键必填，schema 7 按先读后写顺序升级，SQL revision 3 不变。它是有界的合成演示，不打款、不上传或验真发票，不连接真实财务系统、共享收件箱、若依或 H5。

[报销契约与真实图集][expense-gallery]单独记录场景入口、填写、设计器、提交待审、当前审批人、390px 窄屏审批、通过和驳回。16 张原图来自 [`90007fc`](https://github.com/JamesCube/ArcFlow/commit/90007fc8d0499b45ca38a04d010029888ab5cbef) 的[浏览器运行](https://github.com/JamesCube/ArcFlow/actions/runs/37803754153)，[逐图来源与 SHA-256](images/expense/provenance.json)可核验；图集提交 `9653f95` 未改应用源码。[HTTP 测试][expense-api-tests]与[真实后端浏览器测试][expense-browser-tests]提供代码依据；不能将报销图或测试当作出差验收证据。


<a id="zh-next"></a>

### 建议建设顺序：场景库、可视化表单与配置

下面保留分阶段顺序并标明当前进度：第一阶段报销已合并；出差／用印／收货已纳入统一候选但未完成组合发布验收，其余仍为建议，没有交付排期。每个新场景都须从配置、表单到持久审批结果做完整，不能仅增加名称、表单截图或未接后端的成功状态。

| 顺序 | 建设范围 | 完成时应能核验什么 |
| --- | --- | --- |
| 1 · 第一条完整链路 | 已合并费用报销：类型化单据、版本化场景目录、独立流程、固定结构表单和只读详情 | [报销契约][expense]、源码／测试及 [16 张真实图][expense-gallery]；使用时仍核对对应提交的 CI |
| 2 · 扩展 OA | 出差与用印为统一集成候选，待组合验收；保留各自字段和规则 | 每种场景有自己的入口、流程配置、业务验证与验收，不能把改标题当成新模板 |
| 3 · 源业务绑定 | 收货为手工合成候选，无真实源绑定；ERP 付款申请、CRM 合同评审仍待实现 | 明确源单据版本、业务读权及归属、重复提交规则；审批不自动付款、入库或签署 |
| 4 · 可视化表单配置 | 在固定／版本化表单之上增加字段面板、预览、校验和发布；另行定义字段 schema 与兼容性 | 从界面配置产生服务端验证的单据，旧申请仍可读取；未完成前不能称为通用拖拽表单设计器 |
| 5 · 更多流转规则 | 条件路由、动态角色／部门选人、退回、撤回、加签、转办逐项建立契约 | 每项先写清权限、终态、版本和并发语义，再补执行、客户端及负向测试 |
| 6 · 宿主与交付保障 | 按需要接入真实系统、事务 outbox、消息、租户隔离及移动端能力 | 独立适配与故障测试；源码示例通过不直接等于生产环境验收 |

<a id="候选业务模板逐项标明尚未实现"></a>

### 业务模板进度：已合并、统一集成与后续候选

| 分类 | 场景 | 状态 | 首批边界／前置条件 |
| --- | --- | --- | --- |
| OA | 费用报销 | 🟡 | 已合并、可运行的有界合成演示；1–20 行费用、日期、类别、精确金额、币种与票据文字引用，不打款、不上传或验真发票；[契约与图集][expense-gallery] |
| OA | 出差申请 | 🟡 统一候选 | [统一集成候选][travel]，未合并到 main：目的地、用途、起止日期与精确预算，1–90 个自然日，独立宿主与 schema 8；尚待发布验收，不订票、不报销或付款 |
| OA | 用印申请 | 🟡 统一候选 | [固定版本用印契约][seal]：文件引用、印章类别、用途和份数，最低 schema 9；未完成组合验收，不处理真实印章或电子签章 |
| ERP | 付款申请 | — | 先明确应付源单、版本、读权和金额校验；只审批，不执行资金划转 |
| ERP | 收货验收 | 🟡 统一候选 | [手工合成收货契约][receiving]：1–20 行数量及差异、ALL→Bob 复核、最低 schema 10；未完成组合验收，无真实采购源绑定、跨单余额或自动入库 |
| CRM | 合同评审 | — | 先明确合同源版本、金额和业务读权；不签署或发送给客户 |
| OA | 加班申请 | — | 后续候选；工作日历、时区、时长与冲突规则未定义 |
| ERP | 采购退货 | — | 后续候选；原收货记录、可退数量和库存处理契约未定义 |
| CRM | 信用额度申请 | — | 后续候选；客户主数据、额度来源和版本策略未定义 |
| CRM | 退款申请 | — | 后续候选；原交易、可退余额及重复退款边界未定义，不执行退款 |

当前 main 已提供报销的可运行表单、流程发布及真实图集。本地统一候选加入出差、用印与收货，严格 reader 支持 schema 1–10；已有单 PR 的本地／CI 记录不代表组合版本通过。最终组合 head 仍须重跑全部迁移、HTTP、UI、浏览器、H2/PostgreSQL/MySQL 验收。原候选图片下载遇到 HTTP 403／1010，未取得可核验原图，逐图哈希、来源与独立像素验收仍未完成。未合并、未部署，不能宣称三场景已交付。见[统一门槛][unified]。这些都是固定、版本化结构化表单；可编辑审核步骤不等于任意字段表单引擎；后续本地候选增加三种类型化受限条件，见[路由合同](CONDITIONAL_ROUTING.md)。

**每个新增场景的交付清单：** 可解释的字段与状态契约、服务端验证、身份／业务读权、可配置的固定人员流程、不可变快照、重复操作与失败测试，以及中英文的“流程配置 → 填写 → 待审 → 通过 → 驳回”真实截图。六个首批场景至少需要 60 张不同场景／语言状态图；这是完整场景组的验收要求，不是已完成数量，当前报销 16 张单独记录。新能力还应补相应冲突、权限拒绝与恢复证据。

[现有路线图](ROADMAP.md)记录更广的引擎方向；本节只给本次场景库的建议顺序。没有实施日期或交付承诺。当前可运行内容仍以上面的状态矩阵为准。

<a id="en"></a>

## English

This checklist separates runnable features, bounded integrations and missing capabilities so you can assess a concrete use case. The original 91 capabilities were checked against `0.1.0-SNAPSHOT` at [`4ff4bcf`](https://github.com/JamesCube/ArcFlow/commit/4ff4bcf0b90cc07ac26d5483847e8b41fd25ed08). All entries are retained, with main commit [`71910bfc`](https://github.com/JamesCube/ArcFlow/commit/71910bfc2ac1b9d58e0f7f1b85e6bbb206321ec1) as the baseline for shipped Expense support and its corrected documentation. Travel, Seal-use and Receiving are separately labeled as local unified integration candidates, not main-delivered features. No fresh combined-head pass, merge or deployment is claimed here. Code/test links identify evidence; a test file does not mean every revision passed. Check CI for the commit you use.

✅ Implemented within the stated scope; 🟡 bounded support with integration, client or verification limits; — not implemented. The proposed sequence below does not change these statuses or promise release dates.

### Three separate layers

| Layer | Responsibility | Boundary |
| --- | --- | --- |
| Java DAG core | Graph validation, synchronous handlers, variables and events | No third-party runtime dependencies; no durable execution state, human waits or async scheduling |
| Approval domain and storage | Ordered human stages, fixed groups, permissions, snapshots, history and persistence | Separate examples modules with their own Spring/Jackson/database dependencies |
| Hosts and UI | Standalone Vue, native RuoYi, H5, isolated CRM page and separate Expense scenario page | Different entry-point scopes; single-writer JSON by default, with no complete production-service readiness guarantee |

The flow designer configures approval stages. A business-form designer is still missing: leave, procurement, quote and expense fields are defined in code. Expense renders compiled, versioned ScenarioCatalog metadata, without arbitrary-field drag/drop or form-schema publishing. Visible capabilities link real captures; concurrency, authorization, idempotency and transactions require code/test evidence rather than screenshots.


[Flow design and versions](#en-design) · [Approval rules and voting](#en-rules) · [People, identity and permissions](#en-people) · [Task handling and history](#en-tasks) · [Business forms and scenarios](#en-forms) · [Reliability, storage and recovery](#en-reliability) · [Integration, clients and core](#en-integration) · [Scenarios and next steps](#en-scenarios)

<a id="en-design"></a>

### Flow design and versions

| Capability | Status | Scope and limits | Evidence |
| --- | --- | --- | --- |
| Ordered stages | ✅ | Fixed start, 1–8 approval stages and fixed end; only the current stage can act. | [定义 / Definition][definition] · [Screen](DESIGNER_GALLERY.md#sequential) |
| Insert a stage | ✅ | Insert at a chosen connector in the standalone designer; no arbitrary edges. | [测试 / Tests][designer-tests] · [Screen](DESIGNER_GALLERY.md#all) |
| Remove a stage | ✅ | Remove a stage while retaining at least one; existing requests keep their saved definition. | [测试 / Tests][designer-tests] |
| Reorder stages | ✅ | Move-up/down controls preserve node IDs; this is not a freeform drag canvas. | [测试 / Tests][designer-tests] · [Screen](DESIGNER_GALLERY.md#reorder) |
| Stage inspector | ✅ | Edit the selected stage name, people and SINGLE/ALL/ANY mode; process/node names are limited to 120 characters. | [定义 / Definition][definition] · [Screen](DESIGNER_GALLERY.md#any) |
| Draft undo/redo | 🟡 | Standalone tab-local history; publication/sign-out clears it. No durable draft or collaborative editing. | [测试 / Tests][designer-tests] · [Screen](DESIGNER_GALLERY.md#undo) |
| Definition validation | ✅ | Validate schema, boundaries, unique IDs, names and stage/member counts; UI errors locate fields, and the server validates again. | [定义 / Definition][definition] · [测试 / Tests][designer-tests] · [Screen](DESIGNER_GALLERY.md#validation) |
| Publication conflicts | ✅ | Publication requires permission and an expected version; a conflicting publication cannot silently overwrite the current version. | [服务 / Service][service] · [Screen](DESIGNER_GALLERY.md#publish) |
| Pinned process version | ✅ | Submission freezes order, people and rules. Later publications apply to new requests; running instances are not migrated. | [服务 / Service][service] · [Screen](DESIGNER_GALLERY.md#versions) |
| Restricted conditional routing | 🟡 | Local candidate: typed payment/receipt/contract predicates select extra manual stages with frozen schema4/JSON13 routes. No arbitrary expressions; quote thresholds remain informational. Browser acceptance is incomplete. | [合同 / Contract](CONDITIONAL_ROUTING.md) |
| Arbitrary forks/joins | — | Human stages remain sequential; ALL/ANY reviewer groups are not general parallel gateways. | [定义 / Definition][definition] |
| Running-instance migration | — | No operation migrates an existing request to a new process version. | [服务 / Service][service] |
| BPMN import/export/execution | — | No BPMN-compatible implementation or commitment to the full specification. | [路线图 / Roadmap][roadmap] |

<a id="en-rules"></a>

### Approval rules and voting

| Capability | Status | Scope and limits | Evidence |
| --- | --- | --- | --- |
| Single reviewer | ✅ | One assigned user; approval advances, rejection ends the request. SINGLE is a UI label for an approval node. | [定义 / Definition][definition] · [Screen](DESIGNER_GALLERY.md#sequential) |
| ALL groups | ✅ | 2–16 distinct fixed members; every approval is required, and any rejection ends the request. | [规则 / Rules][parallel] · [测试 / Tests][parallel-tests] · [Screen](DESIGNER_GALLERY.md#votes) |
| ANY groups | ✅ | One approval advances; partial rejection leaves others able to approve, and only unanimous rejection ends the request. | [测试 / Tests][parallel-tests] · [Screen](CASE_GALLERY.md#other-clients) |
| Mixed single/group stages | ✅ | Mix single, ALL and ANY stages in one sequence; unfinished group voting does not activate later stages. | [测试 / Tests][parallel-tests] · [Screen](DESIGNER_GALLERY.md#all) |
| Same reviewer in later stages | ✅ | The same person may appear in different stages and must vote in each; earlier votes do not auto-complete later stages. | [重试测试 / Retry tests][retry-tests] · [Screen](DESIGNER_GALLERY.md#votes) |
| Unvoted members after closure | ✅ | After early ANY approval or ALL rejection, that group no longer awaits unvoted members, without fabricated votes/handled entries. A later stage may still require them. | [收件箱测试 / Inbox tests][inbox-tests] · [Screen](DESIGNER_GALLERY.md#votes) |
| Majority/percentage voting | — | No N-of-M, percentage threshold or weighted voting rule. | [定义 / Definition][definition] |
| Automatic decisions | — | No automatic decision for missing reviewers, thresholds or elapsed time; reviewers must act explicitly. | [服务 / Service][service] |
| Add/remove active reviewers | — | Submitted membership is immutable; no commands add pre/post reviewers or remove active members. | [服务 / Service][service] |

<a id="en-people"></a>

### People, identity and permissions

| Capability | Status | Scope and limits | Evidence |
| --- | --- | --- | --- |
| Host identity directory | 🟡 | ActorDirectory resolves active accounts and publication/assignment eligibility; the host owns account management. | [接口 / Interface][identity] · [测试 / Tests][identity-tests] |
| Standalone demo picker | 🟡 | The default applicant is Alice; the designer offers Bob and Carol. The domain group limit does not supply 16 demo accounts. | [后端 / Backend][backend] · [Screen](DESIGNER_GALLERY.md#all) |
| Native RuoYi users | ✅ | The native editor selects fixed users from RuoYi and reuses its login, menus and button permissions. | [控制器 / Controller][ruoyi-controller] · [Screen](CASE_GALLERY.md#other-clients) |
| Request visibility | ✅ | Applicants and snapshotted participants can see a request; pending is narrower. Administrator wildcard permission does not permit proxy voting. | [服务 / Service][service] · [权限测试 / Tests][identity-tests] |
| Applicant cannot review own request | ✅ | New submission rejects the applicant appearing anywhere in the approval sequence, not only in the current stage. | [服务 / Service][service] · [测试 / Tests][identity-tests] |
| Active-identity rechecks | ✅ | Domain list/inbox reads recheck active identity after storage I/O; historical actor IDs remain in records. | [读取边界测试 / Read tests][read-identity-tests] |
| Quote access and ownership | ✅ | The dedicated host checks source revision access and sales ownership; approval membership does not bypass business access. | [宿主 / Host][quote-host] · [测试 / Tests][quote-domain-tests] |
| Dynamic role resolution | — | No runtime candidate rule resolves a stored role name. | [人员接口 / Directory][identity] · [定义 / Definition][definition] |
| Department/manager resolution | — | No automatic organization-tree, direct-manager or management-chain resolution. | [人员接口 / Directory][identity] |
| Delegation/substitution | — | No reassignment or absence-substitute operation; voting as another identity is unsupported. | [服务 / Service][service] |
| Tenant isolation | — | Process scoping and participant authorization do not establish a tenant boundary. | [存储契约 / Storage][jdbc] · [H5 边界 / H5 scope][mobile] |

<a id="en-tasks"></a>

### Task handling and history

| Capability | Status | Scope and limits | Evidence |
| --- | --- | --- | --- |
| Submit a request | ✅ | Standalone/RuoYi desktop forms submit leave and procurement; quotes use a separate page and Expense uses /scenarios.html; H5 has no authoring. | [采购表单 / Forms](PROCUREMENT_UI.md) · [Screen](CASE_GALLERY.md#oa-submitted) |
| Pending worklist | ✅ | Pending means an unvoted member of the current stage, including every ALL/ANY member; future stages are not pending yet. | [契约 / Contract][inbox] · [Screen](CASE_GALLERY.md#oa-inbox) |
| Handled worklist | ✅ | Requires an actual saved APPROVE/REJECT by that actor. Submission does not count; the request may still be pending. | [测试 / Tests][inbox-tests] · [Screen](CASE_GALLERY.md#oa-pending-next) |
| Cursor paging and filters | ✅ | 1–100 rows per page, default 25; filter by status/process version. Cursors bind actor and filters; pages are not a frozen global snapshot. | [契约 / Contract][inbox] · [测试 / Tests][inbox-tests] |
| Approve/reject | ✅ | The server validates the current stage, actor and decision; terminal requests cannot be advanced again. | [服务 / Service][service] · [Screen](CASE_GALLERY.md#erp-review) |
| Decision notes | ✅ | Notes are saved with a vote. Retrying the same decision cannot rewrite the original note; no standalone chat endpoint. | [重试测试 / Tests][retry-tests] · [Screen](CASE_GALLERY.md#oa-approved) |
| Per-person history | ✅ | Retain actor, action, stage, time and note. Approval APIs cannot rewrite saved events; this is not cryptographically tamper-proof auditing. | [存储契约 / Store][store] · [Screen](CASE_GALLERY.md#erp-approved) |
| Claim a task | — | Fixed members vote directly; there is no claim/release lifecycle for a shared candidate pool. | [服务 / Service][service] · [路线图 / Roadmap][roadmap] |
| Withdraw a request | — | Applicants cannot withdraw a submitted request. | [服务 / Service][service] |
| Return to a previous stage | — | Rejection ends a request; no target-stage return or downstream reopening rule. | [服务 / Service][service] |
| Revise and resubmit | — | No edit-and-resubmit lifecycle on the same request with revision/return history. | [业务契约 / Contract][business] |
| CC/informational recipients | — | No CC node, informational inbox or read receipts. | [定义 / Definition][definition] |
| Batch decisions | — | Commands address one request, stage and actor; no batch-decision contract. | [服务 / Service][service] |
| Scheduled reminders | — | No reminder scheduler or timed message service. | [路线图 / Roadmap][roadmap] · [适配器 / Adapters][mobile-adapters] |
| Overdue escalation | — | No automatic reassignment, escalation or closure on expiry; quote expiry hints do not change approval state. | [报价宿主 / Host][quote-host] |

<a id="en-forms"></a>

### Business forms and scenarios

| Capability | Status | Scope and limits | Evidence |
| --- | --- | --- | --- |
| OA leave form | ✅ | Title, reason and 1–365 whole days; no date range, half-day, leave balance or holiday calendar. | [字段校验 / Validation][business-model] · [Screen](CASE_GALLERY.md#oa-form) |
| ERP procurement form | ✅ | One item, quantity 1–100000, unit price and currency; no multi-line purchase order or actual ordering. | [表单契约 / Forms](PROCUREMENT_UI.md) · [Screen](CASE_GALLERY.md#erp-form) |
| CRM quote-discount form | 🟡 | Synthetic single-line quotes with fixed manager → finance review on /api/crm and /quote-discount.html, isolated from shared workspaces. | [案例 / Case](CRM_QUOTE_CASE.md) · [Screen](CASE_GALLERY.md#crm-form) |
| Exact money and currencies | ✅ | Exact decimal validation/totals for CNY/USD/EUR/GBP/JPY; unit price must be >0 and ≤1,000,000,000.00, with up to two decimals and whole JPY. No currency conversion. | [模型 / Model][business-model] · [前端测试 / UI tests][frontend-money-tests] · [Screen](CASE_GALLERY.md#erp-review) |
| Immutable business snapshot | ✅ | Freeze typed fields at submission; they cannot change during review and are validated again on recovery. | [测试 / Tests][business-tests] · [Screen](CASE_GALLERY.md#erp-submitted) |
| Source quote revision and hints | ✅ | Validate source fields, revision and validity; discount percentages, the 10% hint and expiry hints do not route requests. | [模型测试 / Tests][quote-model-tests] · [宿主 / Host][quote-host] · [Screen](CASE_GALLERY.md#crm-manager-review) |
| Visual form designer | — | Current forms are defined in code; no drag-and-drop fields, field inspector or form-schema publishing UI. | [业务契约 / Contract][business] · [表单源码 / UI](../examples/approval-ui/src/App.vue) |
| Field dependencies/stage permissions | — | No configurable visibility, cross-field formulas or stage-specific field editing; submitted fields remain read-only. | [业务契约 / Contract][business] |
| Scenario template library | 🟡 | Merged compiled/versioned ScenarioCatalog and /scenarios.html Expense entry; code-defined templates, without runtime installation, cloning or arbitrary-form publishing. The unified candidate catalogs Expense/Travel/Seal/Receiving with isolated workspaces; the three new slices await combined release acceptance. | [业务契约 / Contract][business] · [目录源码 / Catalog][scenario-catalog] · [报销契约 / Expense][expense] |
| Attachments | — | No upload, authorized download, malware scanning or attachment-retention service. | [字段定义 / Fields][business-model] · [H5 范围 / H5 scope][mobile] |
| Repeating line items | 🟡 | Expense supports 1–20 typed lines, add/remove, per-line validation and exact totals; line IDs and synthetic receipt references are unique within a claim. Procurement/quotes remain single-item; no generic line-item designer. | [字段定义 / Fields][business-model] · [报销测试 / Tests][expense-tests] · [Screen][expense-gallery] |
| Business writeback | — | Approval records a workflow state; it does not create orders, update a real CRM, ship, invoice or pay. | [采购边界 / Procurement](PROCUREMENT_UI.md) · [报价边界 / Quotes](CRM_QUOTE_CASE.md) |

<a id="en-reliability"></a>

### Reliability, storage and recovery

| Capability | Status | Scope and limits | Evidence |
| --- | --- | --- | --- |
| Submission idempotency | ✅ | Generic endpoints accept optional applicant-scoped keys; no key creates anew. Expense requires exactly one Idempotency-Key: identical original intent replays durable current state, while changed fields, lines or original process version conflict. | [契约 / Contract][idempotency] · [测试 / Tests][idempotency-tests] · [报销契约 / Expense][expense] |
| Browser retry keys | 🟡 | Unresolved leave/procurement and Expense keys live in session memory and are lost on reload/sign-out. Durable server bindings replay after restart; business ID alone does not deduplicate requests. | [提交契约 / Contract][idempotency] · [表单边界 / Forms](PROCUREMENT_UI.md) |
| Quote-revision binding | ✅ | The dedicated CRM host derives a durable key from the immutable quote revision and rejects a custom Idempotency-Key. | [宿主 / Host][quote-host] · [HTTP 测试 / Tests][quote-tests] |
| Decision idempotency | ✅ | Same request/stage/member decision retries do not add events or rewrite notes; the opposite decision conflicts. | [测试 / Tests][retry-tests] |
| Concurrent state updates | ✅ | Revision CAS and atomic store updates protect approval state; they do not guarantee exactly-once external payments or messages. | [竞争测试 / Race tests][race-tests] · [JDBC 测试 / Tests][jdbc-tests] |
| Local JSON recovery | 🟡 | Reopen definitions, requests, history and keys from an atomically replaced file; single writer only, without power-loss/filesystem durability guarantees. | [实现 / Store][json-store] · [测试 / Tests][json-tests] |
| Transactional JDBC storage | ✅ | Corresponding transactions commit approval/audit/member/key data; the host must explicitly provide a DataSource and wire the adapter. | [契约 / Contract][jdbc] · [实现 / Store][jdbc-store] |
| Rollback and uncertain commits | 🟡 | Write failures attempt rollback; after commit/cleanup errors, inspect durable state rather than assuming nothing committed. | [事务契约 / Contract][jdbc] · [测试 / Tests][jdbc-tests] |
| H2 contracts | ✅ | H2 storage contracts support local verification; they do not establish PostgreSQL/MySQL server compatibility. | [测试 / Tests][h2-tests] |
| PostgreSQL verification scope | 🟡 | Real PostgreSQL 17.6 CI; inspect non-skipped results for your commit, without generalizing to every version/configuration. | [CI][jdbc-ci] · [测试 / Tests][postgres-tests] |
| MySQL verification scope | 🟡 | Experimental real-server MySQL 8.0/8.4 matrix; excludes MariaDB, 5.7, 9 and blanket coverage of 8.x configurations. | [CI][jdbc-ci] · [测试 / Tests][mysql-tests] |
| JSON schema upgrades | 🟡 | Typed leave/procurement require at least schema 5, quotes 6 and Expense 7. Upgrade all readers and stop incompatible writers before enabling writes; retain byte-exact upgrade backups and never downgrade. Historical backups cannot losslessly recover later writes. The unified candidate reader strictly accepts 1–10: Travel ≥8, Seal ≥9, Receiving ≥10; writes take a monotonic maximum. New type registration does not rebuild ready SQL revision-3 member indexes. | [契约 / Contract][business] · [测试 / Tests][json-tests] · [报销契约 / Expense][expense] |
| SQL migration and backfill | 🟡 | Member indexes retain SQL revision 3; Expense adds no DDL. Existing migration/bounded backfill remain explicit; no automatic JSON→SQL import or mixed-version writers. | [迁移契约 / Migration][jdbc] |
| Transactions with business tables | — | JdbcApprovalStore does not automatically join host business-table or Spring @Transactional transactions. | [事务契约 / Contract][jdbc] |
| Transactional outbox | — | No transactional message table, delivery acknowledgement or message replay service. | [存储边界 / Storage][jdbc] |
| Durable asynchronous execution | — | The Java DAG core runs synchronously/serially with no resumable execution state or human wait points. | [内核 / Core][core] |
| Automatic background retries | — | Idempotent command replay is not a scheduler; no failed-node backoff or automatic background retry policy. | [内核 / Core][core] · [路线图 / Roadmap][roadmap] |
| Execution timeouts/cancellation | — | No durable deadline timer or run-cancellation API; handler interruption is not a complete cancellation lifecycle. | [内核 / Core][core] · [路线图 / Roadmap][roadmap] |

<a id="en-integration"></a>

### Integration, clients and core

| Capability | Status | Scope and limits | Evidence |
| --- | --- | --- | --- |
| Standalone Spring Boot + Vue | 🟡 | Bilingual design/forms/review workspace, plus a separate Expense page and file; fixed demo accounts and single-writer JSON, not a production identity system. | [后端 / Backend][backend] · [界面测试 / Tests][standalone-tests] |
| Native RuoYi-Vue + Vue3 | 🟡 | Reference integration with the official hosts; RuoYi’s MySQL identity database does not automatically put approvals in SQL. | [接入 / Setup][ruoyi] · [宿主测试 / Tests][ruoyi-tests] |
| H5 browser client | 🟡 | Bilingual pending/handled lists, read-only leave/procurement details and decisions; no authoring, designer, quote or Expense support. Expense narrow-browser captures do not establish H5 client integration. | [客户端 / Client][mobile] · [Screen](CASE_GALLERY.md#other-clients) |
| Java/HTTP interfaces | ✅ | Main supports leave, procurement, quotes and expenses. Generic HTTP accepts leave/procurement; quotes use a business-authorized host and Expense uses dedicated oa-expense routes. The unified candidate adds separate Travel/Seal/Receiving hosts without widening generic routes. | [业务契约 / Contract][business] · [HTTP 测试 / Tests][http-tests] |
| Storage SPI | ✅ | ApprovalStore is replaceable; custom adapters must meet its contract, and unsupported inbox access fails explicitly. | [接口 / SPI][store] · [收件箱契约 / Inbox][inbox] |
| DAG dependency validation | ✅ | Java 17 target with no third-party core runtime dependencies; rejects duplicate nodes, unknown dependencies and cycles. | [实现 / Implementation][workflow] · [测试 / Tests][core-tests] |
| Synchronous DAG execution | ✅ | Run handlers one at a time in dependency order with variable snapshots; reruns repeat nodes and do not roll back external effects. | [实现 / Implementation][core] · [测试 / Tests][core-tests] |
| Handler/Event SPI | ✅ | Hosts supply node handlers and event listeners; listeners are not a durable event bus, and supplied SPIs own their thread safety. | [Handler][core-handlers] · [Event][core-events] · [内核 / Core][core] |
| Spring Boot Starter | — | A runnable Spring Boot example exists, but no standalone auto-configuration Starter. | [路线图 / Roadmap][roadmap] |
| Enterprise platform identity | — | Adapters are unconfigured placeholders that reject use; no completed OAuth exchange, platform SDK integration or enterprise SSO. | [适配器 / Adapters][mobile-adapters] |
| External notifications | — | No email, webhook or Feishu/WeCom/DingTalk delivery service. | [适配器 / Adapters][mobile-adapters] · [路线图 / Roadmap][roadmap] |
| Native apps/mini-programs | — | Verification targets H5 browsers; no delivered Android/iOS/mini-program builds or physical-device testing. | [移动端边界 / Mobile scope][mobile] |
| Real CRM/ERP/AI connections | — | Synthetic examples do not connect real business systems or model services; no automated business decisions. | [报价案例 / Quote case](CRM_QUOTE_CASE.md) |

<a id="en-scenarios"></a>

### Existing cases and step-by-step screens

Main provides four business cases: leave, procurement, quotes and expenses. The original leave, procurement and quote galleries, including their designer, group, RuoYi and H5 coverage, contain 33 distinct scenes and 61 original Chinese/English captures. These are not 33 business templates; language variants are not new scenes. This historical count excludes the merged Expense gallery, separately counted as 8 state/viewport combinations and 16 Chinese/English originals.

| Case | Configuration and form | Submit / pending / next stage | Approved / rejected | Boundary |
| --- | --- | --- | --- | --- |
| OA leave | [Flow designer](DESIGNER_GALLERY.md#sequential) · [Form](CASE_GALLERY.md#oa-form) | [Submitted](CASE_GALLERY.md#oa-submitted) · [Pending](CASE_GALLERY.md#oa-inbox) · [Next](CASE_GALLERY.md#oa-pending-next) | [Approved](CASE_GALLERY.md#oa-approved) · [Rejected](CASE_GALLERY.md#oa-rejected) | Standalone/RuoYi authoring; H5 review only |
| ERP procurement | [Group configuration](DESIGNER_GALLERY.md#all) · [Form](CASE_GALLERY.md#erp-form) | [Submitted](CASE_GALLERY.md#erp-submitted) · [Manager](CASE_GALLERY.md#erp-review) · [Final](CASE_GALLERY.md#erp-final-review) | [Approved](CASE_GALLERY.md#erp-approved) · [Rejected](CASE_GALLERY.md#erp-rejected) | One item and host-configured flow; no ordering or payment |
| CRM quote discount | [Form](CASE_GALLERY.md#crm-form) · [Fixed process code][quote-host] | [Submitted](CASE_GALLERY.md#crm-submitted) · [Manager](CASE_GALLERY.md#crm-manager-review) · [Finance](CASE_GALLERY.md#crm-finance-review) | [Approved](CASE_GALLERY.md#crm-approved) · [Rejected](CASE_GALLERY.md#crm-rejected) | Separate entry point; no quote-process configuration UI or per-person history on result cards |

[Capture provenance and reproduction](GALLERY_CAPTURE.md) · [Gallery sources](CASE_GALLERY.md#provenance). Quote history is verified through API assertions, not displayed by the current result cards. Future scenarios should gain supported-feature screenshots only after implementation and verification.

**Merged · OA expenses:** `/scenarios.html` provides a fixed-layout form and visual approval designer, with 1–20 typed lines, exact money and immutable business/process snapshots. The dedicated `/api/scenarios/oa-expense` host uses `approval.data-file + ".scenario-oa-expense.json"`, requires submission keys and introduces reader-first schema 7 while retaining SQL revision 3. This bounded synthetic demo does not pay, upload or verify invoices, or connect real finance systems, shared inboxes, RuoYi or H5.

The [Expense contract and real gallery][expense-gallery] separately cover catalog, entry, designer, submitted/pending, current reviewer, 390px narrow review, approved and rejected screens. All 16 originals come from the [`90007fc`](https://github.com/JamesCube/ArcFlow/commit/90007fc8d0499b45ca38a04d010029888ab5cbef) [browser run](https://github.com/JamesCube/ArcFlow/actions/runs/37803754153), with [per-image provenance and SHA-256](images/expense/provenance.json). Gallery commit `9653f95` did not change application source. [HTTP tests][expense-api-tests] and [real-backend browser tests][expense-browser-tests] provide code evidence; Expense captures/tests are not Travel acceptance evidence.


<a id="en-next"></a>

### Proposed sequence: scenarios, visual forms and configuration

The sequence now records progress: the first Expense slice is merged; Travel/Seal/Receiving are included in a unified candidate awaiting combined acceptance; the rest remain proposals without a delivery schedule. Every new case must connect configuration and form entry to persisted decisions. New labels, form-only screenshots or disconnected success states do not establish a runnable scenario.

| Order | Scope | Evidence required for completion |
| --- | --- | --- |
| 1 · First complete slice | Merged Expense reimbursement: typed document, versioned scenario catalog, isolated process, fixed-layout form and read-only detail | [Expense contract][expense], source/tests and [16 real captures][expense-gallery]; still check CI for the commit you use |
| 2 · More OA cases | Travel and Seal-use are unified integration candidates awaiting combined acceptance; each retains distinct fields and rules | Each case has its own entry point, flow configuration, validation and acceptance; renaming a case is not a new template |
| 3 · Source-bound cases | Receiving is a manually entered synthetic candidate without source binding; ERP payments and CRM contract review remain proposals | Source revision, business access/ownership and duplicate-submission contracts; approval does not pay, post inventory or sign |
| 4 · Visual form configuration | Add a field inspector, preview, validation and publication over fixed/versioned forms; define form schema and compatibility separately | UI configuration yields server-validated documents while old requests remain readable; no generic drag/drop form-designer claim before this exists |
| 5 · More routing operations | Define conditional routing, role/department resolution, return, withdrawal, added reviewers and delegation separately | Permissions, terminal states, versions and concurrency semantics before execution, clients and negative tests |
| 6 · Hosts and delivery safeguards | Integrate real systems, transactional outbox, messaging, tenant isolation and mobile capabilities as needed | Separate adapters and failure testing; passing source examples does not establish production acceptance |

<a id="candidate-business-templates-each-still-unimplemented"></a>

### Business template progress: merged, unified integration and future candidates

| Area | Scenario | Status | Initial boundary / prerequisite |
| --- | --- | --- | --- |
| OA | Expense reimbursement | 🟡 | Merged runnable bounded synthetic demo: 1–20 lines with dates, categories, exact money, currency and textual receipt references; no payments, uploads or invoice verification; [contract/gallery][expense-gallery] |
| OA | Travel request | 🟡 Unified candidate | [Unified implementation candidate][travel], not merged into main: destination, purpose, dates and exact budget, 1–90 calendar days, dedicated host and schema 8. Release acceptance pending; no booking, reimbursement or payment |
| OA | Seal-use request | 🟡 Unified candidate | [Versioned Seal contract][seal]: document reference, category, purpose and copy count, minimum schema 9; combined acceptance pending, no physical/electronic stamping |
| ERP | Payment request | — | Define payable-source revision, access and money validation first; approval only, no transfer |
| ERP | Goods-receipt review | 🟡 Unified candidate | [Synthetic Receiving contract][receiving]: 1–20 quantity/discrepancy lines, ALL then Bob review, minimum schema 10; combined acceptance pending, no real PO source binding, cross-request balances or stock posting |
| CRM | Contract review | — | Define contract revision, amounts and business access first; no signing or customer delivery |
| OA | Overtime request | — | Later candidate; work calendars, time zones, durations and conflict rules remain undefined |
| ERP | Purchase return | — | Later candidate; source receipt, returnable quantities and inventory contract remain undefined |
| CRM | Credit-limit request | — | Later candidate; customer master data, limit source and revision policy remain undefined |
| CRM | Refund request | — | Later candidate; source transaction, refundable balance and duplicate-refund boundaries remain undefined; no refund execution |

Current main provides the Expense form, process publication and real gallery. This local unified candidate adds Travel, Seal-use and Receiving with a strict schema-1–10 reader. Historical single-PR local/CI results do not establish a combined-head pass. The final combined head must rerun all migration, HTTP, UI, browser and H2/PostgreSQL/MySQL gates. Original candidate image downloads returned HTTP 403 / 1010; original PNG bytes, hashes/provenance and independent pixel acceptance remain unverified. The candidate is not merged or deployed and the three scenarios are not claimed as delivered. See [unified gates][unified]. These are fixed versioned forms; editable review stages do not provide an arbitrary-field form engine. A later local candidate adds three typed condition families; see [the routing contract](CONDITIONAL_ROUTING.md).

**Completion checklist for every new case:** clear field/state contracts, server validation, identity/business access, configurable fixed-reviewer stages, immutable snapshots, repeat-operation/failure tests, and real Chinese/English captures of configuration → entry → pending → approved → rejected. Six initial cases require at least 60 distinct scenario/language-state images; that is an acceptance target for the complete set, not a completed count. Expense currently has 16 originals recorded separately. Add conflict, authorization-denial and recovery evidence where applicable.

The [existing roadmap](ROADMAP.md) covers broader engine directions. This section scopes a proposed scenario-library sequence, without implementation dates or delivery commitments. Current runnable support remains defined by the status matrix above.

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
