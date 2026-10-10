# 顺序审批契约（演示 schema 2）

<!-- Legacy fragments remain entry points after the language split. -->
<a id="definition"></a>
<a id="edit-publish-start"></a>
<a id="restart-and-previous-demo-data"></a>
<a id="sequential-approval-contract-demo-schema-2"></a>
<a id="step-commands-and-visibility"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](SEQUENTIAL_APPROVAL.en.md) · [文档目录](README.md)

本文说明本地审批示例的 schema 2 顺序审批规则；这些规则仍适用于顺序定义。当前宿主还支持 [schema 3 ALL/ANY 分组](PARALLEL_APPROVAL.md)。运行和接口见[示例指南](../examples/approval-demo/README.md)与 [HTTP API](api/API_REFERENCE.md)。Java DAG 内核采用独立的执行模型。

<!-- topic:definition -->
## 定义

```json
{
  "schemaVersion": 2,
  "id": "leave-approval",
  "version": 2,
  "name": "Leave approval",
  "nodes": [
    {"id": "start", "type": "start", "name": "Submit leave", "assigneeId": null},
    {"id": "manager", "type": "approval", "name": "Manager review", "assigneeId": "bob"},
    {"id": "finance", "type": "approval", "name": "Second review", "assigneeId": "carol"},
    {"id": "end", "type": "end", "name": "Completed", "assigneeId": null}
  ]
}
```

节点按数组顺序执行：一个开始节点、1–8 个审批节点、一个结束节点。ID 必须唯一且稳定。定义不包含边、脚本、表达式、布局坐标或隐式路由；服务端拒绝不支持的字段和节点形状。

演示使用流程 ID `leave-approval`。领域也接受符合 `[A-Za-z][A-Za-z0-9_-]{0,127}` 的配置流程 ID，发布时不能更改。开始与结束节点的 ID 固定，其他节点 ID 须符合 `[A-Za-z][A-Za-z0-9_-]{0,63}`。名称不得为空或包含控制字符，最长 120 个字符。独立演示只允许 Bob、Carol 审批。同一人可以出现在多个步骤，但每一步都需要分别决定。

<!-- topic:edit-publish-start -->
## 编辑、发布与发起

- 独立演示只有 Alice 可以发布；演示目录固定授予该权限，不提供企业角色管理。当前领域的身份接入方式见[架构](development/ARCHITECTURE.md)。
- 移动、添加、删除节点只影响本地草稿，直到发布。
- 发布包含编辑器预期的版本。服务端校验完整定义并递增版本；预期版本过期会产生冲突。发布成功但响应丢失后的重试也可能遇到这种冲突。
- 每笔申请复制完整的已发布定义及版本。发布 v3 不会重写以 v2 发起的申请。
- 新提交带上用户查看过的流程版本。版本变更后，应刷新并让用户重新检查步骤再提交。已接受的带键提交即使遇到后续发布，也返回已保存的申请，见[提交幂等](SUBMISSION_IDEMPOTENCY.md)。
- 只要任何步骤将申请人设为审批人，就不能创建新申请。服务端在创建前检查完整流程，包括后续步骤。

<!-- topic:step-commands-and-visibility -->
## 步骤命令与可见性

申请人及保存定义中的所有指派人都可查看申请。只有当前步骤的指派人能添加决定。命令必须包含申请 ID 和步骤 ID，已授权的指派人也不能跳过步骤。

APPROVE 完成当前步骤。有后续步骤时，申请仍为 PENDING，并返回下一步骤 ID 与审批人；最后一步通过后为 APPROVED。REJECT 立即使申请成为 REJECTED，后续步骤不会补写决定。

对已完成步骤重试相同决定时，服务端检查保存的指派人，不追加事件，返回当前申请，并保留原评论和时间戳。即使后续步骤还是同一个人，重试也不能推进它；更改决定会冲突。后续审批可能已经推进，因此重试响应不必与第一次响应相同。

每笔申请包含只读流程快照与按事件顺序保存的历史。本地 JSON 记录不提供防篡改证明或受监管审计保证。

<!-- topic:restart-and-previous-demo-data -->
## 重启与旧演示数据

单进程存储通过原子替换文件，一起保存已发布定义与全部申请。启动时先校验恢复的定义、步骤进度与历史，再提供服务。正常重启保留顺序、当前步骤及重试行为。

schema 1 的单审批人记录在迁移前会校验，并获得对应的单步骤定义及含步骤 ID 的历史；原有 ID、操作者、决定、评论与时间戳不变。读取旧文件不会改写它。第一次成功的 schema 2 写入会在原文件旁保留逐字节一致的 schema 1 备份。旧程序不能读取新格式，不要让新旧程序轮流操作同一个文件；备份应采用与原数据相同的操作系统账号访问限制。

仅在 localhost 使用合成数据。最初的 schema 2 里程碑不包含分组或若依集成，两者后来均已加入。这里的顺序宿主不支持条件分支、委派、领取或转办、取消、定时器、表达式执行、任意图导入或 BPMN 兼容；当前三个专用场景的受限条件路由见[条件契约](CONDITIONAL_ROUTING.md)。内核的同步 DAG 校验与规范化集成不变。

当前两个 HTTP 宿主都接受顺序定义和 [schema 3 固定参与人 ALL/ANY 分组](PARALLEL_APPROVAL.md)。分组支持不改变本文的 schema 2 规则。
