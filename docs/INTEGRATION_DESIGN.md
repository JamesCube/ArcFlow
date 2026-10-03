# 企业框架与 Vue 设计器集成设计（规划）

本文件是企业框架集成的未来设计草案。当前同步 DAG 内核之外，已有独立本机审批示例与窄范围顺序设计器（见 [运行说明](../examples/approval-demo/README.md)）；另有固定官方版本的[若依参考集成](../examples/ruoyi-vue3/README.md)，接入原生登录、菜单和权限。下述通用企业 API 和条件分支仍是未来设计。窄范围顺序审批已有可选 [JDBC 事务存储切片](../examples/approval-jdbc/README.md)，但不等于这里规划的完整企业持久化架构。

## 首个参考接入方向

优先评估官方 RuoYi-Vue 的 `springboot3` 分支配合官方 RuoYi-Vue3（Vue 3 / Vite / Element Plus）。实施前锁定双方 tag/commit，并验证 JDK、Spring Boot、数据库、鉴权及依赖组合，不把当前主分支默认等同于某个固定 Spring Boot 版本。

RuoYi-Vue-Plus 属于 Dromara 独立改写的项目，需要另做适配，不能视为官方若依的直接兼容替换。其他 Java 企业快速开发框架在确定用户需求后选择；示例模块保持独立，不让核心绑定某套权限、ORM 或前端。

参考上游：
- [官方若依文档](https://doc.ruoyi.vip/ruoyi-vue/)
- [RuoYi-Vue](https://github.com/yangzongzhuan/RuoYi-Vue)
- [RuoYi-Vue3](https://github.com/yangzongzhuan/RuoYi-Vue3)

后续候选包括 [Dromara RuoYi-Vue-Plus](https://github.com/dromara/RuoYi-Vue-Plus) 和 [芋道 ruoyi-vue-pro](https://github.com/YunaiV/ruoyi-vue-pro)。前者已有 WarmFlow，后者已有 Flowable：应提供可选、隔离的 ArcFlow 示例适配，不承诺直接替换原工作流或自动迁移流程。

## 后端适配边界

未来示例负责宿主框架接入；引擎负责流程状态和命令约束：

1. 将宿主用户 ID、角色、部门映射到 Identity SPI；宿主为认证来源，候选人解析与操作授权在服务端执行。
2. 对流程发起、待办列表、任务完成、实例查询和审批审计提供受权限保护的 API。
3. 命令携带业务关联键、幂等键及期望版本；不要信任前端提交的操作者或审批人权限。
4. 业务数据与引擎数据的事务关系需明确；失败补偿、事件 outbox、并发操作和租户隔离须单独测试。
5. 数据库使用 `arc_` 表前缀；可选 JDBC 模块提供明确边界的 SQL 迁移与验证，宿主显式安装，不自动上线或替换若依数据库。

建议评估的资源路径（仅草案）：
- POST `/api/arcflow/instances`：发起流程
- GET `/api/arcflow/tasks`：当前用户待办/已办
- POST `/api/arcflow/tasks/{id}/complete`：提交审批操作
- GET `/api/arcflow/instances/{id}`：实例状态
- GET `/api/arcflow/instances/{id}/history`：有权限可见的审批历史

## 前端参考示例

计划提供发起页、待办/已办列表、审批详情、历史时间线，以及 Vue 流程设计器。设计器支持审批节点、条件分支、拖拽配置、节点属性、保存前校验和只读预览。使用自主设计和合法开源组件，借鉴常见钉钉式审批体验，不复制钉钉专有代码、品牌或资产。

审批表单和企业业务表单通过适配边界关联，避免把任意业务字段硬编码进内核。

## 版本化模型，隔离 UI 与运行时

建议流程文档有 `schemaVersion`、`processKey`、`definitionVersion`、`nodes`、`edges` 和独立 `designerMetadata`。

- 节点使用稳定 ID，审批策略/条件使用明确类型，禁止保存任意可执行脚本。
- 连线与策略需在发布时做服务端语义校验；设计器的通过提示不能替代授权或引擎校验。
- 画布坐标、折叠状态等 UI 信息属于 designerMetadata，不决定执行语义。
- UI DSL 经适配器转换为引擎定义；人工审批与条件节点在对应引擎能力完成之前不允许发布执行。
- 已发布定义保持不可变；运行实例绑定版本，修改图形不改变运行中的实例。
- 引入 schema 升级/迁移规则和兼容性测试；该 JSON 模型不是 BPMN XML，也不声称兼容 BPMN。

## 示例的验收目标

未来参考集成至少覆盖：发布流程 → 发起 → 候选人收到待办 → 合法审批 → 历史可查；并验证越权访问、重复提交、并发审批、重启恢复、定义版本升级和租户边界。达到这些验收前，不能将演示 UI 视为生产工作流平台。
