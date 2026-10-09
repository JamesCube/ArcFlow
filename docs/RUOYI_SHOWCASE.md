# 若依原生集成历史实拍

<!-- Legacy fragments remain entry points after the language split. -->
<a id="boundaries-and-attribution"></a>
<a id="reproduce-and-verify"></a>
<a id="ruoyi--arcflow--原生集成--native-integration"></a>
<a id="two-step-approval-in-ruoyi"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](RUOYI_SHOWCASE.en.md) · [文档目录](README.md)

<!-- topic:complete-two-stage-approval-in-the-native-workspace -->
## 从熟悉的若依工作台，完成一次两级审批

本页截图来自较早的顺序审批版本。ArcFlow 接入了**官方 RuoYi-Vue（Spring Boot 3）+ RuoYi-Vue3**，左侧菜单、顶栏、登录会话、用户和权限都使用若依本身的功能。ArcFlow 负责工作台里的流程定义、申请和各步骤的审批。

1. 管理员在 **ArcFlow → 审批工作台 → 流程设计** 中配置 Team review → Final review，为两步分别选择若依用户，然后发布。
2. 用测试账号提交请假申请，申请会保存当时的流程版本。
3. 第一位审批人同意后，申请交给第二位。两步都同意后，申请显示“已通过”，详情保留流程快照和操作记录。

<!-- topic:01-design-and-publish-from-native-menus -->
## 01 · 在原生菜单中设计与发布

[![若依原生菜单中的 ArcFlow 两级流程设计器](images/ruoyi-native-process-editor.png)](images/ruoyi-native-process-editor.png)

截图中已发布 v3，两个步骤分别分配给 CI first（101）和 CI second（102）。这里显示的是当时的顺序步骤编辑器，ALL/ANY 分组在之后才加入。条件路由和 BPMN 设计仍未实现。

<!-- topic:02-complete-review-in-the-same-host -->
## 02 · 在同一个宿主里完成审批

[![若依中的已通过申请、两级流程快照与审批记录](images/ruoyi-native-approved-history.png)](images/ruoyi-native-approved-history.png)

第二位审批人的待办归零，右侧申请显示“已通过”，可以看到 Team review、Final review 都已完成。申请人和请假原因使用测试数据。两张图都直接取自 1440 × 1080 的 Chromium 页面，未做修改，点击可查看原图。

<!-- topic:run-it-and-inspect-capture-sources -->
## 运行方法和截图来源

- [环境准备、原生角色权限和启动步骤](../examples/ruoyi-vue3/README.md) · [上游精确版本锁](../examples/ruoyi-vue3/upstream-lock.json)
- 截图源提交：[`48f9b68340ad84fc4b782cd6917903c39345ada1`](https://github.com/JamesCube/ArcFlow/commit/48f9b68340ad84fc4b782cd6917903c39345ada1)。[该提交的若依集成 CI 已通过](https://github.com/JamesCube/ArcFlow/actions/runs/37091568795)，原产物名为 `ruoyi-native-browser-screenshots`，保留 7 天；仓库另存了图片，方便之后查看。
- [浏览器测试源码](../examples/ruoyi-vue3/tests/browser.py)覆盖原生登录、菜单、发布、申请、两级指定人审批、刷新/直接导航、记录、退出与加载失败恢复。CI 只在一次性测试数据库中关闭验证码，正常安装仍使用若依验证码。
- 还没准备若依环境，可以先看[独立演示快速启动](TRYOUT.md)和[第一次审批](GETTING_STARTED.md#简体中文)。

<!-- topic:limits-and-licenses -->
## 使用限制和许可证

若依的 MySQL 保存用户、角色和菜单。ArcFlow 的审批状态仍保存在私有的**单写者本地 JSON** 文件中，尚未接入 SQL 审批存储，也不支持多个实例共用。操作记录没有经过生产审计所需的验证。请仅在 localhost 使用测试数据；这里的桌面 Chromium 测试没有覆盖所有浏览器，也没有完成无障碍审计。

上游 [RuoYi-Vue](https://github.com/yangzongzhuan/RuoYi-Vue) 和 [RuoYi-Vue3](https://github.com/yangzongzhuan/RuoYi-Vue3) 保留各自的 MIT 许可证，ArcFlow 代码使用 Apache-2.0。这份参考集成由 ArcFlow 提供，不代表上游背书。其他若依分支和开源项目尚未在这里完成集成。

当前源码已支持[若依原生 ALL/ANY 分组配置与逐人投票](../examples/ruoyi-vue3/README.md#configure-and-vote-in-groups)。本页旧截图保留了当时的两级顺序流程。分组的运行结果请查看对应提交的若依 CI；存储仍使用单写者 JSON。
