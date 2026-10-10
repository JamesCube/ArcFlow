# 原生若依接入

<!-- Legacy fragments remain entry points after the language split. -->
<a id="boundaries"></a>
<a id="bounded-member-inbox-api"></a>
<a id="configure-and-vote-in-groups"></a>
<a id="connect-real-users"></a>
<a id="durable-submission-retries--持久化提交重试"></a>
<a id="official-ruoyi-vue--vue-3-integration-example"></a>
<a id="prepare"></a>
<a id="procurement-forms--采购表单"></a>
<a id="typed-business-documents--类型化业务单据"></a>
<a id="upstream-attribution"></a>
<a id="verification"></a>

[English](README.en.md)


<!-- topic:scope -->
适用范围：当前 ArcFlow overlay 与 `upstream-lock.json` 固定的官方 RuoYi 后端/Vue 3 前端。若依负责登录、JWT/Redis、数字用户 ID、菜单和权限；ArcFlow 提供顺序及 ALL/ANY 流程、请假/采购、不可变快照和逐人历史。上游 MIT 与本项目 Apache-2.0 许可证分别保留。

若依的用户/角色/菜单在 MySQL，审批状态仍是私有单写者 JSON 文件。此示例不自动接 JDBC、不协调业务 SQL 事务、不提供集群或租户隔离。管理员通配权限不能代替保存的审批参与人。不会安装第二条安全过滤链、全局更改 Jackson 或增加演示认证。

<!-- topic:prepare -->
## 准备官方宿主

需要 Git、Python 3、JDK 17、Maven 3.9+、Node 22、MySQL 8.4、Redis 7.4。只使用全新的本地可丢弃数据库。以下命令从仓库根目录运行：

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
python3 examples/ruoyi-vue3/bootstrap.py --directory examples/ruoyi-vue3/.work
```

目标目录必须为空。bootstrap 获取并核对固定提交，复制 overlay，给 ruoyi-admin 增加领域依赖；只把日志目录改为 `ARCFLOW_LOG_DIR`（默认 `./logs`），保留审计 appender 与原认证。

创建空 `ry-vue` 数据库，依次导入 `.work/backend/sql/ry_20260417.sql`、`.work/backend/sql/quartz.sql`、本例 `sql/menu.sql`。上游 SQL 有样例账号，必须通过若依正常账号管理修改密码并保持本地监听。menu.sql 只加菜单/权限，不加用户；菜单 ID 冲突会失败，不能覆盖原菜单。

<!-- topic:identity -->
## 配置用户、权限与启动

在若依原生用户/角色管理创建申请人和两名审批人，分配父菜单、工作台和所需按钮权限：

| 权限 | 用途 |
| --- | --- |
| `arcflow:request:read` | 进入页面、查看流程和自己可见申请 |
| `arcflow:request:submit` | 发起申请 |
| `arcflow:request:decide` | 对本人当前有权处理的步骤表决 |
| `arcflow:process:publish` | 发布下一流程版本 |

改权限后刷新或重新登录以更新缓存。每次 ArcFlow 请求重查数据库账号状态；候选审批人仅返回 ID/显示名，禁用/删除用户不可新指派。

按 `backend/src/main/resources/application-arcflow.yml` 设置测试数据库、JWT secret、私有可写数据路径与初始审批人数值 ID。凭据不进入源码。

```sh
mvn -f examples/ruoyi-vue3/.work/backend/pom.xml package
java -jar examples/ruoyi-vue3/.work/backend/ruoyi-admin/target/ruoyi-admin.jar \
  --spring.profiles.active=druid,arcflow
```

另开终端：

```sh
cd examples/ruoyi-vue3/.work/frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

打开 `http://127.0.0.1:5173`，使用若依正常登录和验证码，进入 ArcFlow 审批工作台。发布两步流程，分别用申请人和指定审批人完成流程；后一步不能抢先，已有申请始终保留原版本。

<!-- topic:contract -->
## 流程、单据与重试契约

- 每步 SINGLE/ALL/ANY，分组 2–16 个不同数字字符串 ID。角色不会自动解析为成员。ALL 任一拒绝即终止，ANY 全员拒绝才终止；同人跨步骤分别表决。
- 发布新流程或新提交时所有指派者必须活跃。禁用/删除者不能操作或重试，历史 ID 和票仍可读。管理员不能越过参与人约束。
- 旧请假走 `POST /arcflow/requests`，类型化请假/采购走 `POST /arcflow/documents`，后者使用 `{business,processVersion}`。响应保留若依 AjaxResult，不能按独立宿主的直接响应解析。
- 原生表单为请假/采购，ArcFlow 页内语言开关不改变若依导航或账号偏好。采购保留原始精确数字与不可变明细，`3 × USD 0.10` 为 `USD 0.30`；不付款、换汇或发送采购单。
- 可选 Idempotency-Key 绑定认证申请人。未确定响应时保留原端点、标准化内容、键和流程版本；相同意图返回原申请当前状态，变更意图冲突。明确过期版本可刷新后重建；模糊错误必须保留键。刷新整页/退出丢键，先查看列表再重提。
- 原生幂等调用只绕过短时重复提交拦截，认证与 RBAC 仍生效。前后端共享 helper 必须与 canonical 版本逐字节一致，bootstrap 漂移时失败。
- `/arcflow/requests/inbox` 使用读取权限，AjaxResult.data 为 `{items,nextCursor}`。待办/已办各自分页与过滤；取消/旧响应不能进入新会话。发起与历史列表仍用兼容路径。

定义 schema 2/3、提交键 wrapper 4、类型化写入最低 wrapper 5 不是当前文件最高版本。以[存储迁移](../../docs/development/PERSISTENCE.md)为准，备份并升级所有读取端，不混写旧新应用。条件路由只在独立专用场景，此若依宿主不支持。

<!-- topic:verify -->
## 验证、恢复与归属

按[测试指南](tests/README.md)运行真实 MySQL/Redis、官方登录、API 和官方前端 Chromium。测试 fixture 只在可丢弃 CI 数据库建临时账号并关闭该测试库验证码，不能用于真实安装。浏览器依赖 HTTP smoke 创建的流程/身份，不能单独运行 browser.py。

确认来源提交与 CI 结果，再检查成功产物；有测试代码不代表已通过。截图只保存已登录工作区，不保存认证页、HAR 或会话，CI 保留七天。权限失败先检查若依角色缓存与账号状态；写入/恢复问题按 JSON 迁移处理，不删除现有数据假装修复。

[原生截图](../../docs/RUOYI_SHOWCASE.md)、[API 参考](../../docs/api/API_REFERENCE.md)、[成员收件箱](../../docs/MEMBER_INBOX.md)提供后续阅读。此 Chromium 范围不证明全浏览器、无障碍或生产可用。

官方来源：[RuoYi-Vue](https://github.com/yangzongzhuan/RuoYi-Vue/tree/a51a838b71b446ea27256900efe7ed2faa2a02fd)、[RuoYi-Vue3](https://github.com/yangzongzhuan/RuoYi-Vue3/tree/838965c5a18d2c61b73ec30c6e288057aaa08b63)，MIT，Copyright (c) 2018 RuoYi。bootstrap 保留各自 LICENSE，不代表上游为本示例背书。
