# PR #18 文案本地整合记录

<!-- Legacy fragments remain entry points after the language split. -->
<a id="reconciliation"></a>
<a id="verification"></a>
<a id="本地整合-pr-18-文案--local-pr-18-copy-reconciliation"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](MEMBER_INBOX_COPY_INTEGRATION.en.md) · [文档目录](README.md)

本文是指定输入树的历史本地记录；后续组合见[本地集成](LOCAL_INTEGRATION.md)，精确提交 CI 另查。

- 后端基线：`cac609569807ae65d488a9e79c8cf463aebad961`。
- 上一已审收件箱 tree：`5e848595537dc837bf8710248471110e475e687e`。
- 文案源：[PR #18](https://github.com/JamesCube/ArcFlow/pull/18)，head `188924015b991848923aa477f9b169de0a28b17e`，base `9333bdba4743bc8d490f00d2dc48323553c205e6`。
- 2026-10-07 只读核验当时 open、draft、未合并，14 文件差异与保留源一致；仅纳入 12 个前端/选择器文件。

仅本地源码整合，没有推送、PR、合并或部署，未纳入 PR #16、采购界面或 PR #17 文档重写。PR #18 根 `pom.xml` 描述及 `scripts/tryout.py` 提示不属于前端补丁，保持后端基线原样。

<!-- topic:reconciliation -->
## 协調方式

桌面/移动文案保留每个收件箱专用键，采纳登录、帮助、空态、已保存决定和集成说明。移动 `savedPending` 仍解释同一人可能需要审后续步骤；加载数、仅加载搜索、独立分页、共享移动筛选及实时列表提示不被旧文案覆盖。

若依过渡句精确为“当前节点已通过，等待下一节点审批。”，浏览器断言一致。流程说明及禁止自审提示也匹配 PR #18，已有状态协调、响应验证和会话保护不变。

<!-- topic:verification -->
## 验证

- 独立端 **271** 单元/组件/DOM 与生产构建通过。
- 移动 **71** 单元/DOM、Vue TypeScript 与 H5 构建通过。
- 若依 overlay **44** 纯测试和 **11** 挂载 DOM 通过。
- 一个新桌面 DOM 回归检查中英登录标题、第二页切换语言不额外取数、退出取消，以及另一个账号登录后丢弃旧人的迟到页。
- 九个 JS/TS/Vue 文案文件 AST 比较只发现字符串值改变；Vue test ID、事件/model 绑定、Python 断言结构、manifest 非描述数据、非标题 HTML 不变。
- 独立源码审查未发现阻断问题，中英文键一致，旧精确文案断言已清理。

全部重跑用现有工具并禁网络，未重试 npm/registry、安装依赖或运行浏览器。保留的原 22 项真实 HTTP 只证明未变的传输/分页，不是新的浏览器或文案整合 HTTP 运行。完整锁定若依运行/构建与远端 CI 对此组合仍未执行。
