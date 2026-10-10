# 文档目录

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](README.en.md) · [文档目录](README.md)

本目录按读者任务组织当前源码文档，适用于 `0.1.0-SNAPSHOT` 的 main，不代表历史 alpha 标签包含相同能力，也不构成生产就绪承诺。先完成一次审批，再按需要查看接入和契约；历史记录始终绑定其日期、提交与环境。

<!-- topic:start-here -->
## 从这里开始

- 第一次体验：[第一次审批](GETTING_STARTED.md) → [业务案例图集](CASE_GALLERY.md)
- 准备开发：[开发文档](development/README.md) → [环境与验证](development/QUICKSTART.md) → [架构](development/ARCHITECTURE.md)
- 接 HTTP：[接口参考](api/API_REFERENCE.md) → [可执行示例](api/examples/README.md)
- 准备升级：[存储与迁移](development/PERSISTENCE.md)，区分流程定义 schema、JSON wrapper 与 SQL revision

<!-- topic:tutorials-complete-a-journey -->
## 教程：完成一次完整操作

- [第一次审批](GETTING_STARTED.md)：启动、提交、发布、决定、重启
- [设计器图集](DESIGNER_GALLERY.md)：顺序、ALL/ANY、校验、发布和快照
- [业务案例图集](CASE_GALLERY.md)：请假、采购、报价的真实状态流程

- [条件路由完整图集](galleries/conditional-routing/README.md)：付款、收货、合同共 80 张历史原图，含设计器、部分票与终态。

<!-- topic:how-to-guides-complete-a-task -->
## 操作指南：完成具体任务

- [本地试用与源码打包](TRYOUT.md)：一次性启动、验证、清理及可复现源码包
- [开发环境与验证](development/QUICKSTART.md)：构建顺序、测试和排错
- [截图复现](GALLERY_CAPTURE.md)：真实采集、来源、hash 与视觉验收边界
- [根构建插件与验证](BUILD_REPRODUCIBILITY.md)：固定输入与冷/热缓存检查
- 模块接入：[独立后端](../examples/approval-demo/backend/README.md)、[Vue](../examples/approval-ui/README.md)、[若依](../examples/ruoyi-vue3/README.md)、[H5](../examples/approval-mobile/README.md)、[JDBC](../examples/approval-jdbc/README.md)

<!-- topic:explanation-understand-the-design -->
## 原理说明：理解设计与限制

- [架构与扩展](development/ARCHITECTURE.md)：模块、调用链、类型和宿主边界
- [能力与场景目录](CAPABILITIES.md)：实现、有限支持与未实现项
- [设计器工作台](DESIGNER_WORKBENCH.md)：交互、设计依据和对应版本证据
- [企业集成提议](INTEGRATION_DESIGN.md)：规划中的通用 API/DSL，不是现有端点
- [路线图](ROADMAP.md)：已完成里程碑与未承诺日期的后续方向

<!-- topic:reference-inspect-rules-and-compatibility -->
## 参考资料：查规则、字段和兼容性

- 基础：[接口参考](api/API_REFERENCE.md)、[顺序审批](SEQUENTIAL_APPROVAL.md)、[分组审批](PARALLEL_APPROVAL.md)、[条件路由](CONDITIONAL_ROUTING.md)
- 状态与存储：[业务单据](BUSINESS_DOCUMENTS.md)、[提交幂等](SUBMISSION_IDEMPOTENCY.md)、[成员收件箱](MEMBER_INBOX.md)、[存储迁移](development/PERSISTENCE.md)
- 业务场景：[采购](PROCUREMENT_UI.md)、[报价折扣](CRM_QUOTE_CASE.md)、[费用报销](EXPENSE_SCENARIO.md)、[出差](TRAVEL_SCENARIO.md)、[用印](SEAL_USE_SCENARIO.md)、[收货](RECEIVING_SCENARIO.md)、[付款与合同](PAYMENT_CONTRACT_SCENARIOS.md)
- 文档维护：[文档标准](DOCUMENTATION_STANDARD.md)、[本次审计](DOCUMENTATION_AUDIT.md)

九种领域类型不等于通用端点接受九种类型。通用 `/api/documents` 只接受请假/采购，报价使用 `/api/crm`，六个专用场景使用各自宿主。条件仅用于付款/收货/合同，通过不执行付款、签约、盖章或入库。

<!-- topic:historical-evidence-follow-the-source -->
## 历史证据：按来源阅读

以下记录保留原提交、计数、失败、跳过或尚未验收项，不能用来证明后续提交。部分页面也说明当前范围；上线仍以当前源码契约和目标提交结果为准。

- [设计器早期截图](DESIGNER_SHOWCASE.md)、[若依早期截图](RUOYI_SHOWCASE.md)、[ALL/ANY 最初本地验证](PARALLEL_DESIGNER_VERIFICATION.md)
- [采购/成员待办本地组合](LOCAL_INTEGRATION.md)、[待办前端接入](MEMBER_INBOX_UI.md)、[PR #18 文案协调](MEMBER_INBOX_COPY_INTEGRATION.md)
- [CRM 已接受检查点与后续门槛](CRM_COMPATIBILITY_READINESS.md)
- [宿主依赖迁移](SUPPORTED_HOST_MIGRATION.md)、[场景统一集成记录](UNIFIED_SCENARIO_INTEGRATION.md)
- [原始材料归档](history/README.md)：按原路径和版本保留的证据，不当作当前使用指南

<!-- topic:maintenance-and-navigation -->
## 维护与导航约定

中文保留原 `NAME.md`，英文为 `NAME.en.md`，顶部直接切换。按主题维护同等字段、步骤、限制、命令和来源；不堆叠两种语言，也不为分类移动稳定文件。改代码时同步查[文档标准](DOCUMENTATION_STANDARD.md)并验证两种语言的链接与主题覆盖。
