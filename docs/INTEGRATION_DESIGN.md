# 企业框架与 Vue 设计器集成设计（规划）

这份文档讨论后续如何接入企业框架。仓库已有[独立审批示例](../examples/approval-demo/README.md)和基于固定官方版本的[若依参考集成](../examples/ruoyi-vue3/README.md)，支持顺序阶段、ALL/ANY 分组，以及各自的设计器。若依示例使用宿主的登录、菜单和权限；审批领域库另有可选 [JDBC 存储](../examples/approval-jdbc/README.md)。这些都位于同步 DAG 内核之外。[类型化请假与采购单](BUSINESS_DOCUMENTS.md)已经提供 Java 和 HTTP 接口，但还没有采购表单或任意业务类型插件。下面的通用企业 API、条件分支和完整持久化方案仍是设计草案。

## 首个参考接入方向

首个参考集成使用官方 RuoYi-Vue 的 `springboot3` 分支和官方 RuoYi-Vue3（Vue 3 / Vite / Element Plus）。适配或更新时，应锁定双方 tag/commit，并检查 JDK、Spring Boot、数据库、鉴权及依赖是否兼容。上游主分支会变化，不能用它代替明确的版本号。

RuoYi-Vue-Plus 是 Dromara 独立改写的项目，需要单独适配。其他 Java 企业开发框架按实际需求选择。示例模块应保持独立，核心不依赖特定的权限系统、ORM 或前端。

参考上游：
- [官方若依文档](https://doc.ruoyi.vip/ruoyi-vue/)
- [RuoYi-Vue](https://github.com/yangzongzhuan/RuoYi-Vue)
- [RuoYi-Vue3](https://github.com/yangzongzhuan/RuoYi-Vue3)

后续可考虑 [Dromara RuoYi-Vue-Plus](https://github.com/dromara/RuoYi-Vue-Plus) 和 [芋道 ruoyi-vue-pro](https://github.com/YunaiV/ruoyi-vue-pro)。前者已有 WarmFlow，后者已有 Flowable。ArcFlow 的示例适配应独立、可选；替换现有工作流和迁移旧流程需要另行设计。

## 后端适配边界

宿主适配和引擎各自负责以下部分：

1. 通过 Identity SPI 使用宿主的用户 ID、角色和部门。登录身份由宿主提供，候选人解析和操作权限由服务端检查。
2. 为发起流程、查询待办、完成任务、查询实例和审批历史提供带权限检查的 API。
3. 命令包含业务关联键、幂等键和期望版本。服务端不能相信前端自行声明的操作者身份或审批权限。
4. 明确业务数据与引擎数据如何提交事务，分别测试失败补偿、事件 outbox、并发操作和租户隔离。
5. 数据表统一使用 `arc_` 前缀。JDBC 模块提供迁移脚本和检查方法，由宿主明确安装，不自动替换若依数据库。

建议评估的资源路径（仅草案）：
- POST `/api/arcflow/instances`：发起流程
- GET `/api/arcflow/tasks`：当前用户待办/已办
- POST `/api/arcflow/tasks/{id}/complete`：提交审批操作
- GET `/api/arcflow/instances/{id}`：实例状态
- GET `/api/arcflow/instances/{id}/history`：有权限可见的审批历史

## 前端参考示例

前端计划覆盖发起页、待办/已办列表、审批详情、历史时间线和 Vue 流程设计器。已有示例支持节点属性、发布前校验和只读快照；条件分支与拖拽配置还需实现。界面自行设计，使用合规的开源组件。可以参考常见的钉钉式审批操作方式，但不复制其专有代码、品牌或素材。

审批表单通过适配层关联企业业务表单，业务字段不写死在内核里。

## 版本化模型，隔离 UI 与运行时

建议流程文档包含 `schemaVersion`、`processKey`、`definitionVersion`、`nodes`、`edges`，以及单独的 `designerMetadata`。

- 节点使用稳定 ID，审批策略和条件使用明确类型，不允许保存任意可执行脚本。
- 发布时由服务端检查连线和策略。设计器显示校验通过后，仍需执行权限和引擎校验。
- 画布坐标、折叠状态等界面信息放在 designerMetadata 中，不影响执行。
- 适配器将 UI DSL 转成引擎定义。只有引擎已支持的节点类型才允许发布执行，包括人工审批和条件节点。
- 已发布定义保持不变，实例固定使用启动时的版本；修改设计器中的图形不影响运行中的实例。
- 为 schema 升级和迁移制定规则并增加兼容性测试。此 JSON 模型不使用 BPMN XML，也不提供 BPMN 兼容性。

## 示例需要验证什么

参考集成至少要能走通：发布流程 → 发起 → 候选人收到待办 → 按权限审批 → 查看历史。还要测试越权访问、重复提交、并发审批、重启恢复、定义版本升级和租户隔离。完成页面和正常流程只是开始，生产使用还需要这些检查和相应的运行保障。
