# 采购与成员待办历史本地集成

<!-- Legacy fragments remain entry points after the language split. -->
<a id="combined-behavior"></a>
<a id="inputs-and-source-identity"></a>
<a id="local-integration-of-procurement-and-member-worklists"></a>
<a id="remaining-acceptance-at-this-checkpoint"></a>
<a id="verification"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](LOCAL_INTEGRATION.en.md) · [文档目录](README.md)

本文记录组合源码最初的本地验证，不是部署、生产验收或全部源分支已合并的证明。当时 CRM 报价独立开发，未包含在此范围；当前实现见[架构](development/ARCHITECTURE.md)。

<!-- topic:inputs-and-source-identity -->
## 输入与源码身份

输入从持久源码/补丁包恢复，解决冲突前逐一核对精确 Git tree：

| 输入 | 提交或来源 | 精确 tree |
| --- | --- | --- |
| 早期 main | `9333bdba4743bc8d490f00d2dc48323553c205e6` | `af97795a1b97a28a8d417fcc09c53bae17e0534f` |
| 类型化业务 / PR #16 | `e8568d437abae184ccba549a6a2dfde577201802` | `125b7ae405c537d999026ee1d3b1c6ac81656f73` |
| 采购界面 | 本地源码，未发布 | `8c26a8ab2c193d01e4a0b023ed384ccdf161df22` |
| 成员待办后端 | `cac609569807ae65d488a9e79c8cf463aebad961` | `a1dc75ae7e14f822a2b581d27238a8aadd1b52dc` |
| 成员待办前端与 PR #18 文案 | 本地源码，未发布 | `0bbdb6351b7f7003b4045fff46919f9728079791` |
| PR #17 文档 | `976d3047969d15e34f3f76acd439cafd9d60403c` | `f6a135562e044dc8bc51e5f65e6f8c6f47881631` |

PR #16 后来合入 main `9143f3dacc71a5cf8e512bc8ad235744718430dd`，保留以上输入用于独立复核。PR #18 文案后来合为 `86488effa4af80e86446799a1109dc85ab1d0423`，已包含在组合中。PR #17 独立纯文档协调不是本功能包。

<!-- topic:combined-behavior -->
## 组合行为

- 旧请假和不可变类型化请假/采购共用审批、授权、流程版本、审计和持久键。
- 独立/若依为两类分别保留草稿/键、精确小数和只读快照，H5 仅审批。
- 待办/已办使用有界身份列表、独立游标、旧响应保护和决定后详情刷新；申请人/历史/详情仍用兼容可见列表，不使所有旧读取有界。
- JDBC 成员行含流程 ID，查询先绑定身份/配置流程，再筛选/续页；回填用每笔自身保留定义，支持混合流程批次。
- 全局申请人/键仍跨流程，同键改流程或类型化意图冲突，不创建第二笔。
- 当时类型化 JSON 为 5；成员投影 SQL revision 3，显式停写有界回填，构造器不执行 DDL 或静默迁移。
- 保留双语说明/文案，历史图片及服务器结果仍归属原源。

<!-- topic:verification -->
## 验证

2026-10-08 对组合源码使用现有工具和缓存依赖执行，无 registry 下载：

- 内核离线 24 检查、QuickStart 输出、Maven JUnit 包装通过。
- 启动器 Python 17 通过；领域 75；独立服务/MVC/安全 48。
- 通用 JDBC 在 Java 17、21 各执行 108 通过，含 H2 共用 74；未选服务器，PostgreSQL/MySQL 被跳过。
- 独立真实 MySQL 8.0.46：80 通过，零跳过/错误/失败。
- 独立/共享若依单元和挂载测试 442；H5 280；若依 inbox helpers/API 51、DOM 19。64 个若依提交已计在 442 内。
- 独立构建、移动类型检查/H5 构建通过。
- 分组/收件箱真实 HTTP 70 断言，含重启；移动 HTTP 177 状态+229 不变量，含两次重启；类型化 HTTP 28 状态+18 不变量，含重启。
- 实际独立客户端+组合后端对 26 请假和 1 采购执行 37 断言：原始精确金额、键重放、分页、部分/最终投票及已办筛选。
- 本地文档路径/锚点 217，无缺失；独立/若依共享业务/提交 helper 一致。

前端 Node 24.19.0。MySQL 使用全新一次性 8.0.46 库并在后关闭，不能将通用套件跳过误报通过；单独运行才是真实服务器证据，PostgreSQL 本地未跑。

没有新浏览器图、完整锁定若依构建/浏览器、App/小程序/真机或生产部署。输入包旧 CI/浏览器不代替组合检查。兼容申请人/历史/详情仍可读取全部可见申请，有界 inbox 不改变它。

<!-- topic:remaining-acceptance-at-this-checkpoint -->
## 当时剩余验收

1. 源码与证据一起保留，发布分支前复核精确 tree。
2. 另获授权后发布，并运行精确提交远端 CI、PostgreSQL、MySQL 8.4 与其他 Java/数据库组合。
3. 验收界面前运行锁定若依及真实浏览器，含中断、重复点击、导航。
4. CRM 独立审查并组合 schema/业务兼容检查后才集成。

随后候选以 PR #17 文档 tree `7a80130d16c72b22ab4746d46d72d005ebf7d1c5` 准备，保留当时类型化/兼容措辞；仍需候选精确 CI，本记录不声称通过。

发布前静态审查修正过期移动选择器并收窄桌面成功断言。审批 CI 显式选择全部 19 若依 inbox DOM，精确命令本地通过。桌面/H5/若依浏览器已编写 >25 行、第二页采购、部分投票和后续阶段重叠流程，但当时尚未执行、待候选 CI。

发布基线 main `2fbc40b2b166dd79b166bb17e89128d20658601d` 与上述 PR #17 tree 相同，六条合并后工作流在功能候选准备前通过，不覆盖新增量。

发布审查另复现并修复若依受控输入问题：版本筛选按 box 保存草稿、回显输入，仅在 change 时应用服务端筛选。修复后全部 24 inbox DOM（含新增 5）、64 共享提交和 51 helpers 通过，组合独立前端总数升至 797。完整锁定宿主浏览器仍待精确 CI。
