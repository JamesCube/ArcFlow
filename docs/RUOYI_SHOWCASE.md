# RuoYi × ArcFlow · 原生集成案例 / Native integration case

[简体中文](#简体中文) · [English](#english) · [README](../README.md)

## 简体中文

### 从熟悉的若依工作台，走完一笔两级审批

本页较早的实拍把 ArcFlow 的顺序审批设计器挂载到**官方 RuoYi-Vue（Spring Boot 3）+ RuoYi-Vue3** 应用中。左侧菜单、顶栏、登录会话、用户和权限来自真实若依宿主；工作台内的流程定义、申请与逐步审批由 ArcFlow 提供。

1. 管理员在 **ArcFlow → 审批工作台 → 流程设计** 发布 Team review → Final review 两个步骤，分别指定若依用户。
2. 合成申请人提交请假申请，实例保存提交时的流程版本。
3. 第一位审批人通过后才轮到第二位。两步完成，申请变为“已通过”，详情保留定义快照和操作记录。

### 01 · 在原生菜单中设计与发布

[![若依原生菜单中的 ArcFlow 两级流程设计器](images/ruoyi-native-process-editor.png)](images/ruoyi-native-process-editor.png)

截图中已发布 v3，两个步骤分别分配给 CI first（101）与 CI second（102）。这些旧截图展示顺序步骤编辑器，不证明后来加入的分组能力；条件路由和 BPMN 设计仍未实现。

### 02 · 在同一个宿主里完成审批

[![若依中的已通过申请、两级流程快照与审批记录](images/ruoyi-native-approved-history.png)](images/ruoyi-native-approved-history.png)

第二位审批人的待办归零，右侧申请显示“已通过”，并保留 Team review、Final review 与完成状态。申请人与原因均为合成测试数据。两张图片均为未修改的 1440 × 1080 Chromium 截图，可点击查看原图。

### 接入与证据

- [环境准备、原生角色权限和启动步骤](../examples/ruoyi-vue3/README.md) · [上游精确版本锁](../examples/ruoyi-vue3/upstream-lock.json)
- 截图源提交：[`48f9b68340ad84fc4b782cd6917903c39345ada1`](https://github.com/JamesCube/ArcFlow/commit/48f9b68340ad84fc4b782cd6917903c39345ada1)。[该提交的若依集成 CI 已通过](https://github.com/JamesCube/ArcFlow/actions/runs/37091568795)，原产物名为 `ruoyi-native-browser-screenshots`，产物保留期为 7 天；本页保存图片供长期查看。
- [浏览器测试源码](../examples/ruoyi-vue3/tests/browser.py)覆盖原生登录、菜单、发布、申请、两级指定人审批、刷新/直接导航、记录、退出与加载失败恢复。CI 中关闭验证码仅限一次性数据库测试夹具，正常安装仍使用若依验证码。
- 想先试审批、不准备若依环境？[独立演示快速启动](TRYOUT.md) · [第一笔审批](GETTING_STARTED.md#简体中文)。

### 适用边界与归属

若依的 MySQL 存储用户、角色和菜单；ArcFlow 审批状态仍写入私有的**单写者本地 JSON**，不是 SQL 审批存储，不支持多实例。界面中的操作记录不构成生产级持久审计保证。本案例只面向 localhost 与合成数据；一次桌面 Chromium 路径不等于全浏览器或无障碍覆盖。

上游项目：[RuoYi-Vue](https://github.com/yangzongzhuan/RuoYi-Vue) 与 [RuoYi-Vue3](https://github.com/yangzongzhuan/RuoYi-Vue3)，保留各自 MIT 许可证；ArcFlow 代码使用 Apache-2.0。此参考集成与截图不代表上游背书。其他若依分支或开源项目未在此作为已完成集成展示。

当前源码另已增加[若依原生 ALL/ANY 分组配置与逐人投票](../examples/ruoyi-vue3/README.md#configure-and-vote-in-groups)。本页旧截图只证明当时的两级顺序流程；新分组运行结果以对应提交的原生 CI 为准，审批存储仍为单写者 JSON。

## English

### A real two-step approval inside the familiar RuoYi workspace

This reference overlay mounts ArcFlow in the **official RuoYi-Vue (Spring Boot 3) + RuoYi-Vue3** applications. RuoYi supplies the shell, login/session, users, menu routes and permissions. ArcFlow supplies process publication, request snapshots and ordered human decisions.

1. The administrator publishes Team review → Final review, assigning two RuoYi users.
2. A synthetic applicant submits a leave request, saving that process version.
3. The assigned reviewers approve in order; the completed request retains its definition snapshot and activity history.

The two unmodified 1440 × 1080 screenshots above show the published v3 editor and the completed request inside the native shell. Click to inspect full-size images. These older captures show the sequential editor. The current native host separately adds [ALL/ANY participant groups](../examples/ruoyi-vue3/README.md#configure-and-vote-in-groups); these screenshots do not prove that newer journey. Conditional routing and BPMN remain unsupported.

### Reproduce and verify

- [Prerequisites, native roles/permissions and setup](../examples/ruoyi-vue3/README.md) · [Exact upstream pins](../examples/ruoyi-vue3/upstream-lock.json)
- Capture source: [`48f9b68340ad84fc4b782cd6917903c39345ada1`](https://github.com/JamesCube/ArcFlow/commit/48f9b68340ad84fc4b782cd6917903c39345ada1). Its [RuoYi integration run passed](https://github.com/JamesCube/ArcFlow/actions/runs/37091568795). The original `ruoyi-native-browser-screenshots` artifact expires after seven days; these checked-in copies preserve the captures.
- [Browser test source](../examples/ruoyi-vue3/tests/browser.py): native login/menu, process publication, submission, assigned two-step decisions, reload/direct navigation, history, logout and load-error recovery. CAPTCHA is disabled only in disposable CI fixtures; normal installations keep RuoYi CAPTCHA.
- [Standalone quick tryout](TRYOUT.md) · [First approval](GETTING_STARTED.md#english) if you want to evaluate without the RuoYi environment.

### Boundaries and attribution

RuoYi MySQL stores users, roles and menus. ArcFlow approvals still use a private **single-writer local JSON file**, not SQL approval persistence; multiple instances are unsupported. Activity history is not a production durable-audit guarantee. Use localhost and synthetic data only. One desktop Chromium journey does not establish comprehensive browser or accessibility coverage.

[RuoYi-Vue](https://github.com/yangzongzhuan/RuoYi-Vue) and [RuoYi-Vue3](https://github.com/yangzongzhuan/RuoYi-Vue3) retain their MIT licenses; ArcFlow code is Apache-2.0. No upstream endorsement is implied. Other RuoYi forks or open-source projects are not presented here as completed integrations.
