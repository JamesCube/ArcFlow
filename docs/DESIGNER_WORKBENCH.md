# 审批设计器工作台

<!-- Legacy fragments remain entry points after the language split. -->
<a id="approval-designer-workbench"></a>
<a id="design-references-and-deliberate-differences"></a>
<a id="interaction"></a>
<a id="verification-boundary"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](DESIGNER_WORKBENCH.en.md) · [文档目录](README.md)

本文记录独立 Vue 设计器的流程画布、节点设置面板和本地撤销/重做功能。代码与浏览器测试位于已合并提交 [`e1ee9c6`](https://github.com/JamesCube/ArcFlow/commit/e1ee9c6bdb971949c4f8746fe88b9ff49e6d4c36)，见[桌面与窄屏截图](DESIGNER_SHOWCASE.md)。该变更未修改审批领域、JDBC 适配器或 MySQL 行为。演示仍是实验性的，未验证生产使用或与商业审批工具的功能对等。

<!-- topic:interaction -->
## 交互

- 画布按顺序显示步骤，开始和结束节点固定。审批卡片显示名称、成员名与首字母、审批规则。
- 点击连线按钮在该处插入步骤；已有 ID 不变。新步骤自动选中并聚焦名称输入框。
- 设置面板一次编辑一个阶段，宽屏在右侧，窄屏在流程下方；用指针选中阶段会把窄屏面板滚入视野。
- 该提交默认中文设计器并提供英文切换，演示其他部分和服务端错误仍为英文。当前 `main` 已翻译外围工作区，见[当前界面指南](../examples/approval-ui/README.md)。
- ALL 显示“全员同意（ALL）”：全员同意才推进，任一拒绝则驳回；ANY 显示“任一同意（ANY）”：一人同意即推进，只有全员拒绝才驳回。规则始终显示在面板中；分组仍是一个有序阶段，不是两条图形分支。
- 演示仅 Bob、Carol 两名参与人。单人改为分组时会选中两人并提示，可修改勾选，但发布至少需要两人。
- 面板显示已发布版本、草稿基线版本及未发布修改。只有草稿有效、确有修改、基于当前版本且无请求进行中时，才显示“Ready to publish”。
- 草稿与撤销历史保存在页面内存。工作区 Refresh 保留编辑；浏览器重载或退出登录会丢失，中文提示说明这一区别。
- 撤销/重做最多保存 50 次编辑，连续输入合为一次，覆盖名称、指派、规则、成员、插入、移动、删除和重置。撤销不发网络请求；发布成功清空历史。撤销重置以恢复旧草稿时，仍需版本冲突检查。
- 选择验证错误会打开对应阶段并聚焦错误的名称或成员控件；错误与字段关联，便于辅助技术读取。Escape 不干扰输入法组合输入。
- 可用键盘按钮插入和移动阶段，Enter 打开卡片设置，Escape 将焦点还给卡片。画布聚焦时 Ctrl/Cmd+Z 与 Shift+Z/Y 管理本地历史，文本输入保留浏览器快捷键。

<!-- topic:design-references-and-deliberate-differences -->
## 设计参考与差异

连线按钮和单节点设置面板参考了[飞书审批设计器](https://www.feishu.cn/hc/zh-CN/articles/360036163653-%E7%AE%A1%E7%90%86%E5%91%98%E8%AE%BE%E8%AE%A1%E6%89%B9%E6%B5%81%E7%A8%8B)及[钉钉宜搭审批节点](https://docs.aliwork.com/docs/yida_support/_2/trbqg6/rq8i94)的公开交互说明；未复制专有代码、图片或素材。

宜搭的“或签”由首位操作人决定结果；ArcFlow ANY 只有全员拒绝才驳回，因此面板明确写出规则。

文本对比度和键盘交互参考 [WCAG 对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)及 [WAI 键盘界面](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)指南，但尚未执行 WCAG 审计。

<!-- topic:verification-boundary -->
## 验证边界

[该提交的审批 CI](https://github.com/JamesCube/ArcFlow/actions/runs/37258262057)通过 185 个界面测试、35 个后端测试和三个 Chromium 流程。组件/模型测试覆盖插入位置、稳定 ID、1/8 阶段上限、本地历史、选中节点焦点、非法分组、只读用户、重复交互与进行中请求、输入法 Escape、导航保留历史、重置后恢复过期草稿、发布后清空历史，也包含早期顺序与分组测试。

[`836e605` 的截图运行](https://github.com/JamesCube/ArcFlow/actions/runs/37257554086)验证中文标签、连线插入、非法分组聚焦、本地撤销、Escape 焦点返回、发布及 390px 堆叠面板无横向溢出。源码树与已合并 `e1ee9c6` 一致。[原图与来源](DESIGNER_SHOWCASE.md)保存在仓库。

这些历史提交的桌面/窄屏浏览器测试通过，不代表其他提交验收。浏览器原生文本撤销、200% 缩放、其他浏览器和无障碍仍需单独检查。在 `examples/approval-ui` 中依次运行 `npm test`、`npm run build`、`npm run test:e2e` 可重测。
