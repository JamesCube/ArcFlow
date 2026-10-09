# 流程设计器图集

<!-- Legacy fragments remain entry points after the language split. -->
<a id="发布与快照--publish-and-preserve"></a>
<a id="安排步骤--arrange-the-stages"></a>
<a id="流程设计器图集--flow-designer-gallery"></a>
<a id="编辑顺序--edit-the-order"></a>
<a id="配置与校验--configure-and-validate"></a>
<a id="配置之外实际逐人表决--the-rules-in-action"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](DESIGNER_GALLERY.en.md) · [文档目录](README.md)

从步骤安排到真实发布，按一次编辑过程看设计器。图片均为运行中应用、真实控件和合成数据，未生成、修图或重绘；点击可看原始尺寸。英文页面提供相同状态的英文图。

这里展示主工作区固定开始/结束之间的 1–8 个顺序审批阶段，界面仅提供 Bob、Carol；领域每组 2–16 人供其他宿主接入使用。不支持任意图、BPMN、动态部门、转办或撤回。该主工作区不提供条件配置；当前三个专用场景的受限条件见[能力边界](CAPABILITIES.md)。

<!-- topic:arrange-the-stages -->
## 安排步骤

<a id="sequential"></a>

### 1 · 多级单人审批：主管 → 复核

[![1 · 多级单人审批：主管 → 复核](images/gallery/designer-01-sequential-zh.png)](images/gallery/designer-01-sequential-zh.png)

 每一步都能选审批人；当前节点结束后才进入下一步。图中展示单人审批的实际配置面板。

<a id="all"></a>

### 2 · 在两步之间插入会签节点

[![2 · 在两步之间插入会签节点](images/gallery/designer-02-insert-all-zh.png)](images/gallery/designer-02-insert-all-zh.png)

保留主管和复核节点，在中间增加“团队交接”。选择 Bob 和 Carol，全员同意才推进，任一拒绝就结束。

<!-- topic:edit-the-order -->
## 编辑顺序

<a id="reorder"></a>

### 3 · 调整审批顺序

[![3 · 调整审批顺序](images/gallery/designer-03-reorder-zh.png)](images/gallery/designer-03-reorder-zh.png)

 把团队交接上移到第 1 步，左侧顺序和右侧节点编号一起更新。上下移动按钮处理顺序，不是任意连线画布。

<a id="undo"></a>

### 4 · 撤销后恢复原顺序

[![4 · 撤销后恢复原顺序](images/gallery/designer-04-undo-zh.png)](images/gallery/designer-04-undo-zh.png)

撤销上移后，团队交接回到中间，重做按钮可用。这里只保存当前浏览器标签页内的草稿编辑历史，发布或退出登录后清空。

<!-- topic:configure-and-validate -->
## 配置与校验

<a id="any"></a>

### 5 · 从会签切换为或签

[![5 · 从会签切换为或签](images/gallery/designer-05-any-zh.png)](images/gallery/designer-05-any-zh.png)

 同一个人员组切成 ANY 后，面板同步显示“任一同意即通过、全部拒绝才驳回”的规则。

<a id="validation"></a>

### 6 · 校验错误直接阻止发布

[![6 · 校验错误直接阻止发布](images/gallery/designer-06-validation-zh.png)](images/gallery/designer-06-validation-zh.png)

只剩一位参与人时，节点和底部错误列表同时提示，发布按钮不可用。点击错误可定位对应字段。

<!-- topic:publish-and-preserve -->
## 发布与快照

<a id="publish"></a>

### 7 · 发布后显示新版本

[![7 · 发布后显示新版本](images/gallery/designer-07-published-zh.png)](images/gallery/designer-07-published-zh.png)

 修复参与人后，通过页面发布到真实服务端。新版本号、已更新状态和不可再次点击的发布按钮一起确认结果。

<a id="versions"></a>

### 8 · 新版本不改动已提交申请

[![8 · 新版本不改动已提交申请](images/gallery/designer-08-saved-version-zh.png)](images/gallery/designer-08-saved-version-zh.png)

测试先提交两步请假流程，再发布另一版 ALL 流程。原申请仍保留旧版本、原审批人和原顺序；新旧版本一致性由接口断言核对。

<a id="votes"></a>

<!-- topic:the-rules-in-action -->
## 实际逐人表决

[![ALL：Bob 已同意，Carol 仍待表决](images/gallery/group-all-partial-zh.png)](images/gallery/group-all-partial-zh.png)

Bob 的票已保存，Carol 尚未投票，申请仍待决；已办不等于整笔申请结束。

[![ANY 组完成后的流程与记录](images/gallery/group-any-approved-zh.png)](images/gallery/group-any-approved-zh.png)

Bob 同意使 ANY 通过，Carol 在组内无需处理，再独立完成后一复核阶段。未投票者不会被补造组内投票。[规则与测试](PARALLEL_APPROVAL.md)

[业务全流程](CASE_GALLERY.md) · [逐图版本、来源与校验值](images/gallery/provenance.json) · [复现截图](GALLERY_CAPTURE.md)
