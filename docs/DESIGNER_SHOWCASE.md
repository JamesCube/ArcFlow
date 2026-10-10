# 设计器历史实拍

<!-- Legacy fragments remain entry points after the language split. -->
<a id="arcflow-设计器--designer-in-action"></a>
<a id="design-publish-and-try-an-approval-sequence"></a>
<a id="what-has-been-tested"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](DESIGNER_SHOWCASE.en.md) · [文档目录](README.md)

<!-- topic:01-inspect-a-flow-and-configure-one-stage -->
## 01 · 看清流程，在一个面板配置节点

[![1440px 桌面设计器：中文配置、ANY 分组和发布状态](images/designer-desktop-836e605.png)](images/designer-desktop-836e605.png)

点击连线上的「＋」即可在该位置插入审批节点。卡片显示节点名称、参与人和审批规则；选中节点后，在右侧面板里修改。ANY 的规则直接写在面板上：**任一同意即通过，全部拒绝才驳回**。界面分别显示已发布版本、草稿所基于的版本和未发布修改，撤销/重做只修改本地草稿。

截图来自运行中的独立 Vue + Spring Boot 演示，使用 Alice、Bob、Carol 测试账号。截图版本只有设计器提供中文；当前 `main` 的登录页、导航、申请和审批页面也已支持中英文切换。

<!-- topic:02-stack-settings-below-the-flow-at-390px -->
## 02 · 390px 窄屏：流程与节点设置上下排列

<a href="images/designer-mobile-836e605.png"><img src="images/designer-mobile-836e605.png" width="390" alt="390px 窄屏设计器：流程卡片、下方节点配置与发布按钮"></a>

窄屏下，配置面板放在流程下方。浏览器测试点击最后一个节点，检查面板是否滚动到可见位置，以及页面是否横向溢出。这张完整页面截图使用 390px 的 Chromium 视口；实体手机和其他移动浏览器还需要单独测试。

<!-- topic:try-it-from-source -->
## 从源码一键试用

安装 [所需工具](TRYOUT.md#requirements)，在当前仓库根目录运行：

```sh
python3 scripts/tryout.py
```

可以使用当前 `main`，也可以检出下方测试过的 `e1ee9c6`。等启动器显示就绪后，用生成的 Alice 密码登录，打开 **Process designer**，选择单人、ALL 或 ANY 并发布流程。用测试数据提交申请后，切换到 Bob / Carol 审批。Ctrl-C 会停止服务并删除本次演示数据。[完整步骤与分组规则](TRYOUT.md#what-to-try)

[`v0.1.0-alpha.1`](https://github.com/JamesCube/ArcFlow/releases/tag/v0.1.0-alpha.1) 发布包保留了较早的顺序审批源码，不包含本页的设计器更新、ALL/ANY 或 JDBC。

<!-- topic:tested-capabilities-and-limits -->
## 已有功能和使用限制

| 模块 | 已测试的功能 | 使用时注意 |
| --- | --- | --- |
| 独立设计器与演示 | 单人 / ALL / ANY、逐人投票、固定流程快照、桌面 / 窄屏布局 | 固定合成账号；按顺序执行阶段；默认单写者 JSON |
| 官方若依参考集成 | 若依登录、菜单、权限与两级顺序审批 | 当前宿主支持 [ALL/ANY 分组](../examples/ruoyi-vue3/README.md#configure-and-vote-in-groups)，审批仍为 JSON；[若依截图](RUOYI_SHOWCASE.md#简体中文) |
| 可选 JDBC | `e1ee9c6` 的历史结果：MySQL 8.0.46 / 8.4.11 × Java 17 / 21，每组合 29 项真实服务器测试通过 | 由宿主接入并安装数据库结构；演示不会自动切换存储；[测试明细](../examples/approval-jdbc/MYSQL_VERIFICATION.md#verified-server-acceptance-2026-10-05) |

表中的 JDBC 结果来自较早的顺序存储测试，未验证之后加入的提交键及其数据库升级。

ALL 要求全员同意，任一拒绝即驳回；ANY 任一同意即通过，只有全员拒绝才驳回。图中主工作区的分组仍按阶段顺序执行，不提供条件分支或任意图形连线。草稿保存在当前页面内存中：工作台 Refresh 会保留草稿，刷新浏览器或退出登录会丢失未发布修改。该主工作区不提供条件路由；当前付款、收货、合同专用场景的受限条件见[当前架构](development/ARCHITECTURE.md)。定时器、转办和 BPMN 兼容尚未实现，生产使用也未经验证。

<!-- topic:sources-and-verification -->
## 来源与验证

- 两张图均直接取自 CI，未做修改：桌面 `1440 × 1609`，窄屏 `390 × 2373`。原始文件为工作台测试的 `02-workbench-any-inspector.png` 与 `03-workbench-narrow-inspector.png`。
- 截图提交：[`836e6051a0c1198c9348e58c094e40cdcf11f3f1`](https://github.com/JamesCube/ArcFlow/commit/836e6051a0c1198c9348e58c094e40cdcf11f3f1)。[通过的截图工作流](https://github.com/JamesCube/ArcFlow/actions/runs/37257554086)产物 ID 为 `11323062579`；CI 产物保留 7 天，图片另存于仓库，方便之后查看。
- 合并提交：[`e1ee9c6bdb971949c4f8746fe88b9ff49e6d4c36`](https://github.com/JamesCube/ArcFlow/commit/e1ee9c6bdb971949c4f8746fe88b9ff49e6d4c36)，与截图提交的 Git tree 均为 `302ecb8d9041429d8aabad2851ec7388f3b653e9`。
- 合并源码的五项工作流均通过：[Java](https://github.com/JamesCube/ArcFlow/actions/runs/37258262044)、[设计器 / API / Chromium](https://github.com/JamesCube/ArcFlow/actions/runs/37258262057)、[JDBC](https://github.com/JamesCube/ArcFlow/actions/runs/37258262111)、[原生若依](https://github.com/JamesCube/ArcFlow/actions/runs/37258262058)、[一键试用](https://github.com/JamesCube/ArcFlow/actions/runs/37258262036)。这些结果对应上述提交；查看其他版本时，请检查那个版本的 CI。
- [工作台浏览器测试](https://github.com/JamesCube/ArcFlow/blob/836e6051a0c1198c9348e58c094e40cdcf11f3f1/examples/approval-ui/e2e/workbench.spec.mjs)覆盖插入、无效分组定位、本地撤销、Escape 焦点返回、窄屏面板和发布。200% 缩放、原生文本撤销、其他浏览器与正式无障碍审计仍未验证。
