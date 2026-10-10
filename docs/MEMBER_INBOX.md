# 全成员任务收件箱

<!-- Legacy fragments remain entry points after the language split. -->
<a id="host-integration-with-typed-business-documents"></a>
<a id="http-contract"></a>
<a id="ordering-and-consistency"></a>
<a id="storage-boundary"></a>
<a id="verification"></a>
<a id="全成员任务收件箱--full-member-task-inbox"></a>
<a id="待办与已办的精确含义--membership-rules"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](MEMBER_INBOX.en.md) · [文档目录](README.md)

按当前登录用户查询待办与已办，并使用有界游标分页。原有 `GET /requests` 列表及审批写入契约保持兼容；最初的接口变更独立于业务单据和采购界面，当前接入情况见下文。

这是**申请级**待办，一笔申请一行，而非每票或每阶段一行。它使用不可变申请/流程快照与宿主认证身份，不增加管理员可见范围、租户隔离、转办或新的审批策略。

<!-- topic:http-contract -->
## HTTP 契约

- 独立端：`GET /api/requests/inbox`
- 若依：`GET /arcflow/requests/inbox`，沿用 `arcflow:request:read` 权限，结果位于 `AjaxResult.data`。
- 操作者只来自认证 Principal 或当前若依会话，查询参数不能指定他人。

| 参数 | 含义 |
| --- | --- |
| `box` | `PENDING`（默认）或 `HANDLED`，必须大写 |
| `limit` | 整数 1–100，默认 25 |
| `status` | 可选当前申请状态：`PENDING`、`APPROVED`、`REJECTED` |
| `processVersion` | 可选正整数，匹配快照中的流程版本 |
| `cursor` | 可选，上一页返回的不透明续页值 |

未知或重复参数、不支持的枚举、非法数字、越界数量及无效游标返回 HTTP 400。省略可选筛选与显式空值不同。必须认证；停用身份会被拒绝，包括存储 I/O 后才发现的撤权。

```json
{"items": [], "nextCursor": null}
```

`items` 保留完整且不变的 `ApprovalService.Request` 形状。`nextCursor: null` 表示本页读取快照中未发现更多匹配项。非空游标须沿用相同身份、box、status 与 processVersion，页大小可以调整。不提供总数、偏移、任意排序表达式或客户端身份筛选。

<!-- topic:membership-rules -->
## 待办与已办的精确含义

- `PENDING`：申请待决，且此人是**当前快照阶段中尚未投票的成员**。包括所有符合条件的 ALL/ANY 成员；旧 `approverId` 只是代表，不能表示全体成员。
- `HANDLED`：此人在申请历史中至少有一条真实 APPROVE/REJECT，SUBMIT 不计。申请仍可能等待其他成员或后续阶段。
- 只在未来阶段指派的人尚无待办。申请人、发布人或无关管理员不能仅因角色而获得收件箱条目。
- ANY 因一人同意结束后，未投票者从待办移除，但不计入已办；ALL 因拒绝结束时也一样。
- 前一阶段已投票、后一阶段又待办的人可同时出现在**两个列表**。无论投过几票，每个列表中仍是一笔申请一行。
- 旧 `list(actor)` / `GET /requests` 仍向申请人及快照全体参与人显示记录，包括未来或未投票成员。这个更宽的历史可见列表不能替代待办。

<!-- topic:ordering-and-consistency -->
## 排序与一致性

先按**创建 Instant** 从新到旧，再按申请 ID 的 ASCII 降序排列。提交后创建时间与 ID 不变。秒与纳秒按数值比较，不把变长 ISO 时间字符串当字典序键。

每页来自一致的存储快照。游标表示“严格早于最后返回的创建位置”。投票不会移动申请的排序位置；同时间戳由 ID 确定顺序。

分页是实时待办，不是冻结的跨申请事务。两次读取之间，决定可能移除待办或增加已办，新提交可能排在游标之前。想看到更新或新匹配项，应从第一页刷新。不承诺恰好一次投递或不可变的跨页快照。

游标有版本和长度限制，并绑定精确身份/筛选值；它不是秘密或授权令牌。每次查询仍从服务端解析身份，领域在返回前检查准确成员资格、筛选、顺序、唯一 ID 及存储返回行数上限。修改游标不能获得可见权限。

<!-- topic:storage-boundary -->
## 存储边界

`ApprovalStore.inbox(InboxQuery)` 最多按序返回 `limit + 1` 个已验证的匹配申请，额外一项用于判断后续页面。不具备此能力的第三方适配器会在默认 SPI 方法中明确失败，不会静默调用 `requests()` 并重放整个存储。

JSON 演示从已验证快照构建内存中的身份/分桶有序索引，原子发布文件成功后再更新。查询只查看该人的桶，找到足够匹配项后停止；可选筛选可能需要扫描更多同一桶记录。修改仍会重写本地快照，保持单进程/本地文件系统限制。

JDBC 使用完整的逐申请成员投影、二进制精确身份键、ASCII 二进制申请排序键及纪元秒/纳秒排序。创建和决定在一个事务中维护投影、申请与审计。每页使用一个读取快照事务、有界身份/流程/分桶查询，并批量校验申请、版本、审计和成员。PostgreSQL/MySQL 使用 REPEATABLE_READ；H2 需要更强的 JDBC SERIALIZABLE 保持跨表稳定快照。不会重放无关申请或为每笔申请单独查询审计/版本。可选筛选可能增加索引扫描；返回行数有界不等于数据库 CPU 或延迟固定。

新库、显式升级、可恢复的有界回填、就绪检查与停写上线见 [JDBC 安装及 revision 3 迁移](../examples/approval-jdbc/README.md)。构造器不执行 DDL，也不静默回填旧数据，不支持新旧写者混用。

校验可以发现选中申请的快照、审计行和完整成员投影不一致，但不提供防篡改存储。外部删除索引行可能让申请根本不进入候选结果；仍需应用账号限制、受控迁移、备份和运维完整性检查。一页查询成功不能证明整个数据库完整。

<!-- topic:host-integration-with-typed-business-documents -->
## 宿主与类型化单据接入

两个宿主都提供接口。独立桌面、原生若依和 H5/移动端分别使用待办/已办游标页，并保留兼容的申请人/历史列表，见[前端接入与历史本地验证](MEMBER_INBOX_UI.md)。API 自身的使用和验证不依赖界面或截图。

接入为旧请假、类型化请假和采购保留相同的身份、成员、排序及游标规则。业务字段不可变，结果保留类型化快照。JDBC 同时绑定配置流程与身份；显式回填使用每笔申请自身保留的流程定义。`HANDLED` 始终表示此人实际投过票，即使后续阶段仍待决，也不是全部终态申请或全体参与人。[组合报告](LOCAL_INTEGRATION.md)区分已执行检查与待验收项。

<!-- topic:verification -->
## 验证

- 领域测试覆盖全部 ALL/ANY 成员、未投票者、未来指派、重复身份、大小写/重音/尾空格精确身份、撤权、游标排序同值、筛选及非法/他人游标。
- HTTP 测试覆盖宿主认证、身份冒充、重复/未知字段、响应封装、分组生命周期与分页；独立真实 HTTP 验证还会重启一次性后端。
- 共享 JDBC 契约在对应服务器可用时分别运行于真实 H2、PostgreSQL、MySQL，覆盖固定查询次数、有界返回行、独立实例决定、分页快照竞争、投影回滚、损坏与显式有界迁移/回填。
- H2 通过或服务器套件被跳过都不能证明 PostgreSQL/MySQL。应按精确提交 CI 与实际服务器版本确认兼容性。
