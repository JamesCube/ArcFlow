# 固定参与人分组审批（领域 schema 3）

<!-- Legacy fragments remain entry points after the language split. -->
<a id="commands-identity-and-compatibility-fields"></a>
<a id="completion-and-rejection"></a>
<a id="parallel-participant-groups-domain-schema-3"></a>
<a id="persistence-and-rollout"></a>
<a id="scope-and-definition"></a>
<a id="verification"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](PARALLEL_APPROVAL.en.md) · [文档目录](README.md)

共享审批领域库支持会签 `ALL` 和或签 `ANY`。参与人随申请保存，每人的决定与审计事件在同一次提交中写入。独立 Vue / Spring Boot 示例可配置分组、逐人投票并查看结果；若依原生界面和接口也可从真实用户中选择成员并显示待办。本文讨论 schema 3；当前四个专用场景的 schema 4 条件见[条件路由](CONDITIONAL_ROUTING.md)。任意图汇聚、动态加签和转办仍不支持，生产使用未经验证。

<!-- topic:scope-and-definition -->
## 范围与定义

分组属于人工审批示例，不会为零运行时依赖的 Java DAG 内核增加并行执行。阶段按数组顺序运行：开始 → 1–8 个审批阶段 → 结束。schema 2 保留原有顺序定义和节点 JSON；schema 3 在此基础上接受 `parallelApproval`：

```json
{
  "schemaVersion": 3,
  "id": "leave-approval",
  "version": 1,
  "name": "Joint leave review",
  "nodes": [
    {"id": "start", "type": "start", "name": "Submit", "assigneeId": null},
    {"id": "review", "type": "parallelApproval", "name": "Joint review", "assigneeId": null,
     "assigneeIds": ["202", "303"], "completionMode": "ALL"},
    {"id": "final", "type": "approval", "name": "Final review", "assigneeId": "404"},
    {"id": "end", "type": "end", "name": "Complete", "assigneeId": null}
  ]
}
```

分组需要 2–16 个不同且稳定的用户 ID、`assigneeId: null`，以及 `ALL` 或 `ANY` 的完成规则。服务端拒绝空组、单成员组、重复 ID、未知或缺少字段、混合单人/分组指派，以及标量强制转换。节点 ID、名称和配置流程 ID 遵循[顺序契约](SEQUENTIAL_APPROVAL.md)；演示使用 `leave-approval`。每笔申请保留提交时的定义和成员，后续发布不会改写，成员也不会重新解析或动态添加。

<!-- topic:completion-and-rejection -->
## 通过与驳回

| 规则 | APPROVE 投票 | REJECT 投票 |
| --- | --- | --- |
| ALL（会签） | 等待全员同意后推进 | 立即驳回申请 |
| ANY（或签） | 立即推进 | 等待全员拒绝后驳回 |

当前分组中尚未投票的成员都可同时审批，后续阶段尚未激活。分组结束时，未投票的人不会获得自动决定。组被驳回则申请结束；组通过则进入下一阶段，最后一组通过后申请为 APPROVED。

不同成员竞争提交同意/拒绝时，不论先提交哪一票，ALL 最终拒绝而 ANY 最终通过。如果先提交的一票已结束分组，另一人会得到冲突，且不追加历史。同一成员提交不同决定也会冲突，先保存的决定生效，与顺序步骤相同。ANY 不赋予每人否决权。不支持法定人数、多数表决或任意图汇聚。

<!-- topic:commands-identity-and-compatibility-fields -->
## 命令、身份与兼容字段

调用 `decide(authenticatedActor, requestId, stepId, decision, comment)`，以分组 ID 作为 `stepId`，身份必须来自可信宿主会话。重试按 `(request ID, step ID, actor ID)` 识别：

- 申请人与保存定义中的所有参与人可查看申请；对无关用户的响应不泄露申请是否存在。
- 只有指定当前阶段的活动参与人能新增决定。发布与新提交都会检查全体成员是否活动且有资格；申请人被分配到任何阶段时，新提交失败。已接受的带键提交遵循[提交重试规则](SUBMISSION_IDEMPOTENCY.md)。
- 用相同决定重试已有投票会返回当前保存状态，保留原事件、评论与时间戳，即使阶段或申请已结束；改变决定会冲突。
- 从未投票的成员不能重放他人的票、在阶段关闭后投票，或跳到后续阶段。同一个人在后续阶段仍需另行决定。
- 决定写入的 compare-and-set 重试预算固定为 16 次。最后一次失败后，再读一次并重新检查实时授权与持久投票重放，不再写入；这样在重试边界并发提交的重复决定仍保持幂等。
- 每票恰好追加一个事件，修订号加一。加载时通过历史重放校验待决组状态及全部派生字段。每笔申请最多 128 个决定，另加 SUBMIT。

`Request` 与 `Event` 的 JSON 形状不变。`currentStepId` 表示当前阶段。待决时，`approverId` 是定义顺序中第一个**尚未投票**的人，仅为兼容代表，不能替代完整待办或授权规则。Java 宿主应使用 `ApprovalService.pendingApproverIds(request)`；HTTP 适配器应先提供或派生成员感知的待办，再启用分组。`decision` 和 `comment` 保留最新个人投票，因此部分 ANY 组可以同时为 `PENDING` 与 `decision: REJECT`。终态 `approverId` 是最后作决定的人，以历史为准。

<!-- topic:persistence-and-rollout -->
## 持久化与上线

schema 3 里程碑读取 JSON 快照 schema 1、2、3。首次 schema 3 写入之前，顺序写入仍为 schema 2，保持旧节点形状。升级写入将最近 schema 2 文件的原始字节保存为 `.schema2.bak`；重名时选唯一文件名。读取不会改写文件，schema 1 迁移和 `.schema1.bak` 也保留。升级后即使新定义改回顺序，文件外层版本也不低于 3；已有申请保留各自定义版本。备份应与原数据同等保护，JSON 仍只支持一个进程。

后来的[提交幂等](SUBMISSION_IDEMPOTENCY.md#json)增加快照 schema 4，旧请假的带键提交按其升级规则处理；[类型化业务单据](BUSINESS_DOCUMENTS.md)使用 schema 5，之后的旧接口写入不会降级。本文的流程定义使用 schema 2/3；当前更多业务类型和条件功能把外层快照扩展到 13、定义扩展到 4，见[迁移指南](development/PERSISTENCE.md)。

分组本身不修改 JDBC 表：申请/事件 JSON 与整数修订号已支持每人一条事件。已有 schema 2 版本、申请及审计行无需重写；schema 3 定义保存为新的不可变版本，不增加 DDL，也不自动导入 JSON。申请状态与新审计事件沿用修订检查和行锁，在同一事务提交。旧 `approver_id` 索引不能提供完整分组待办；最初 SPI 按保存的参与人过滤申请。当前有界成员待办另使用 SQL revision 3 的投影，见[成员收件箱](MEMBER_INBOX.md)。

启用 schema 3 前应升级共享存储的所有服务。旧程序不能解码分组，新旧程序混跑不受支持。备份完整 JDBC 数据库，并规划所有宿主的统一部署和恢复；文件存储备份不能代替数据库备份。

独立演示接受 schema 3 发布，按保存的定义与历史构建成员待办，固定使用 Bob/Carol。当前[若依原生宿主](../examples/ruoyi-vue3/README.md#configure-and-vote-in-groups)也接受 schema 3，成员来自真实用户目录。启用分组前，应升级仅支持顺序的旧若依宿主，让编辑器、待办和决定控件都理解成员。内核及已有顺序流程不变。

<!-- topic:verification -->
## 验证

运行包含分组测试的审批套件：

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-jdbc/pom.xml verify
mvn -f examples/approval-demo/backend/pom.xml verify
```

`ParallelApprovalTest` 覆盖通过/拒绝、身份、重放、过期读取、重启、严格形状、损坏状态与 schema 2 升级。`ApprovalRetryBoundaryTest` 固定最后一次 CAS 的重复提交时序、授权变化和读取失败。`JsonSchemaUpgradeTest` 检查发布/重启后的旧待决申请、备份重名及原子替换失败后的重试。JDBC 测试使用独立连接验证事务竞争、回滚和重载；真实 PostgreSQL 测试只在设置 `ARCFLOW_PG_URL` 时执行，H2 通过不能证明 PostgreSQL。

官方若依工作流在真实 MySQL/Redis 上验证顺序及 ALL/ANY 发布/投票、严格分组形状、指派/RBAC、停用/删除成员、重放/冲突和重启，再以原生 Chromium 检查分组编辑与投票。应查看准备使用的精确提交的完整 CI。独立分组浏览器流程覆盖 ALL/ANY 编辑、非首成员投票、部分完成分组、重复点击、重载、不可变快照、错误及移动布局，见[界面指南](../examples/approval-ui/README.md)。
