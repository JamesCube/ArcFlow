# 开发文档

<!-- Legacy fragments remain entry points after the language split. -->
<a id="choose-your-task"></a>
<a id="three-distinctions-to-keep-in-mind"></a>
<a id="开发文档--developer-guide"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](README.en.md) · [文档目录](../README.md)

这里是从运行源码到接入宿主、修改规则和验证迁移的入口。文档描述当前 `main` 的源码契约，Java 工件版本为 `0.1.0-SNAPSHOT`；不代表 `v0.1.0-alpha.3` 或其他历史标签包含全部现有功能，也不构成生产就绪承诺。

<!-- topic:choose-your-task -->
## 按任务阅读

| 想做什么 | 从这里开始 |
| --- | --- |
| 安装工具、启动后端与前端、执行测试 | [开发环境与验证](QUICKSTART.md#zh) |
| 找到模块边界、调用链与扩展位置 | [架构与扩展](ARCHITECTURE.md#zh) |
| 配置 JSON／JDBC、理解版本与升级风险 | [存储与迁移](PERSISTENCE.md#zh) |
| 对接 HTTP、检查请求字段和错误／重试语义 | [接口参考](../api/API_REFERENCE.md) |
| 运行可复用的接口请求样例 | [接口示例](../api/examples/README.md) |
| 先体验一次完整审批 | [第一次审批](../GETTING_STARTED.md#简体中文) |
| 使用若依账号、菜单和权限 | [RuoYi 原生集成](../../examples/ruoyi-vue3/README.md) |
| 提交代码或文档贡献 | [贡献指南](../../CONTRIBUTING.md) |

<!-- topic:three-distinctions-to-keep-in-mind -->
## 先建立三个概念

1. **内核不是审批服务器。** `arcflow-core` 是零第三方运行时依赖的同步 DAG 执行器；人工等待、投票、版本快照和存储在 `approval-domain` 及适配器中。
2. **业务类型不是开放端点。** 领域注册了九种业务类型；独立端的六场景目录与请假／采购主工作区、报价独立页面是不同入口。通用 `/api/documents` 只接收请假和采购。
3. **三种版本分别管理。** 流程定义最高 schema **4**；JSON 文件快照最高 wrapper **13**；可选 JDBC 使用 SQL revision **3**。相同 SQL 结构不保证不同应用版本可混用。

条件路由仅用于独立端的报销、付款、收货、合同四个专用场景。SINGLE／ALL／ANY 表决与条件匹配互相独立；条件只选择额外人工审批步骤，不执行付款、入库或签约。

专题文档保留详细契约与历史验证记录：[分组审批](../PARALLEL_APPROVAL.md)、[提交幂等](../SUBMISSION_IDEMPOTENCY.md)、[成员待办](../MEMBER_INBOX.md)、[条件路由](../CONDITIONAL_ROUTING.md)、[宿主依赖迁移](../SUPPORTED_HOST_MIGRATION.md)。阅读历史测试数量或“本地候选”说明时，应核对其提交和日期；它们不是当前提交的验收结果。
