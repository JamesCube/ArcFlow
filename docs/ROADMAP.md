# 路线图

<!-- Legacy fragments remain entry points after the language split. -->
<a id="arcflow-路线图"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](ROADMAP.en.md) · [文档目录](README.md)

这里记录已经完成的工作和接下来想做的事，没有排定发布日期。具体支持什么，以对应版本的代码和测试为准。

<!-- topic:implemented-initial-core -->
## 已实现：初始内核

- [x] Java 17 目标、无 Spring 核心、Apache 2.0
- [x] DAG 定义校验、同步串行执行、变量快照
- [x] Handler / Event SPI、示例和回归检查

<!-- topic:experimental-local-approval-demo -->
## 实验性本地审批演示

审批示例独立于核心，支持编辑和发布 1–8 个审批步骤。每笔申请保存自己的流程快照，按顺序推进；单人步骤拒绝后，申请结束。审批操作检查权限并支持幂等重试，单进程 JSON 文件保存流程和申请，供重启后恢复。Vue 页面包含设计器、申请、待办、只读流程和历史。一个人可以出现在不同步骤，但每一步都要分别审批。主工作区不提供条件分支、任意图形部署或生产级持久化；当前付款/收货/合同的受限条件是专用场景能力。见 [运行说明](../examples/approval-demo/README.md)。

<!-- topic:implemented-optional-transactional-jdbc-storage -->
## 已实现：可选 JDBC 事务存储

`approval-domain` 提供存储 SPI，`approval-jdbc` 使用 `arc_` SQL 表保存不可变的定义版本、申请修订号和独立审计事件，并在同一事务中提交。多个服务实例通过数据库条件更新和短事务行锁协调。重复的审批决定只重读已提交状态，不追加第二条事件。测试包含回滚、重新打开存储、并发和损坏检测，另有 PostgreSQL、H2 和实验性 MySQL 8 测试配置。查看 MySQL 提交幂等的测试结果时，需要核对具体提交的真实服务器测试；这些结果还不足以确认生产支持。见 [模块契约](../examples/approval-jdbc/README.md)。

这部分解决审批数据的存储问题。两个演示仍默认使用 JSON，自动迁移、租户隔离、与业务表共同提交事务、outbox 和调度器还没实现。下方通用引擎的计划仍有不少工作要做。

<!-- topic:implemented-fixed-all-any-groups -->
## 已实现：固定参与人的会签 / 或签

共享 `approval-domain` 的 schema 3 支持固定参与人组：ALL 要全员同意，任一拒绝即驳回；ANY 任一同意即可通过，全员拒绝才驳回。每人的投票分别处理幂等，并发决定仍通过修订号检查和审计事件的原子提交保存。旧 schema 2 定义和实例继续可用。JSON 升级备份、JDBC 无需修改表结构的原因和回归测试见 [并行审批契约](PARALLEL_APPROVAL.md)。

独立 Vue / Spring Boot 示例支持 Single / ALL / ANY 配置、参与人待办和逐人投票，原有顺序审批仍可使用。若依 HTTP 接口和原生界面也已支持真实用户分组、待办和逐人投票，使用若依自己的登录、菜单和权限。动态加签、转办和通用分支汇聚还没实现。

<!-- topic:implemented-durable-submission-idempotency -->
## 已实现：持久化提交幂等

两个 HTTP 服务都支持可选提交键，每位申请人的键独立生效。同键、相同内容的重试返回原申请当前状态；同键、不同内容则冲突。旧请假带键提交使用 JSON 快照 schema 4，类型化单据使用 schema 5；JDBC 幂等键沿用原有映射，成员待办采用 SQL revision 3。键映射和申请一起保存。不带键时仍按旧行为每次新建，客户端在页面内存中保留未确认请求的键。迁移、并发、重新打开存储及断电相关限制见[提交幂等契约](SUBMISSION_IDEMPOTENCY.md)。

<!-- topic:implemented-shared-leave-and-procurement-approval -->
## 已实现：请假与采购单共用审批

类型化请假与采购单通过不可变业务快照接入共享审批、权限、记录和幂等接口。独立与若依页面提供中英文采购表单，H5 可查看并审批采购单。JSON 新业务写入使用 schema 5；JDBC 可隔离配置的流程。业务系统写回、付款与任意业务插件仍未实现。[业务契约](BUSINESS_DOCUMENTS.md) · [采购界面](PROCUREMENT_UI.md)。

<!-- topic:implemented-paginated-member-worklists -->
## 已实现：按成员分页查询待办和已办

服务端按当前登录成员提供 PENDING／HANDLED 分页。ALL／ANY 的每位参与人均按自己的投票情况查询；游标绑定身份与筛选条件。JDBC 使用 SQL revision 3 成员索引，并支持停机后分批回填已有数据。独立、若依和 H5 界面均采用分页。[接口与迁移](MEMBER_INBOX.md)。

<!-- topic:implemented-nine-business-types-and-restricted-routing -->
## 已实现：九种业务类型与受限场景路由

当前 main 包含九种领域业务类型和六项独立场景；付款、收货、合同支持定义 schema 4 的受限条件与冻结路径。JSON wrapper 最高 13，JDBC SQL revision 3。它们不代表通用任意图、动态表单或外部业务执行，见[架构](development/ARCHITECTURE.md)和[能力目录](CAPABILITIES.md)。

<!-- topic:next-a-sustainable-general-approval-model -->
## 下一阶段：可持续的业务审批模型

以下是通用业务审批模型的计划。示例已经实现部分能力，下一步需要把适用范围、接口和测试补全，不能直接把示例里的实现视为全部完成。

- [ ] 版本化流程定义与不可变已发布版本；流程实例固定定义版本
- [ ] 人工任务生命周期：创建、领取、完成、撤回及终态约束
- [ ] Identity SPI：用户、角色、部门及审批候选人解析
- [ ] Variable SPI：变量类型、作用域、序列化和条件求值的受限契约
- [ ] 存储 SPI、事务边界、幂等命令、乐观锁、持久化审计
- [ ] 数据库迁移和索引设计；所有引擎业务表以 `arc_` 开头
- [ ] 拒绝、退回指定节点的可达性及已完成下游任务处理语义
- [ ] 扩展会签、或签、加签和转办；先写清规则和状态变化，再实现

<!-- topic:optional-enterprise-integrations-and-visualization -->
## 可选企业集成与可视化

- [ ] 独立 Spring Boot Starter，不把 Spring 引入核心必选依赖
- [x] 官方若依 RuoYi-Vue + RuoYi-Vue3 固定版本前后端参考集成（原生身份/菜单/权限；单写者文件审批存储，非生产 SQL 引擎）
- [ ] 按实际需求扩展其他主流 Java 企业快速开发框架；各自独立适配与测试
- [ ] 完整的发起、待办、已办、实例详情和审批历史页面及 API
- [ ] Vue 流程设计器：审批节点、条件分支、拖拽配置、属性面板、校验与预览
- [ ] 参考钉钉式审批的操作方式，自行实现界面，不复制专有代码或素材
- [ ] 前端无关、版本化流程 DSL；设计器元数据与执行定义隔离

<!-- topic:dag-evolution -->
## DAG 编排演进

- [ ] 异步调度、有界并行、超时、取消与错误传播
- [ ] 重试策略、幂等键、恢复机制和可观测性
- [ ] 分支/汇聚语义、条件路由及资源限制
- [ ] 通过测试确认性能、兼容性和适合生产使用的范围

目前不计划实现完整 BPMN 规范，设计器 DSL 也不提供 BPMN 兼容性。
