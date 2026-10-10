# 业务案例图集 / Business journeys in pictures

新增五类独立图集：[出差／用印／收货／付款／合同](galleries/README.md)，含各自设计器、真实业务状态与条件路由补充。

Five additional case galleries: [travel, seal use, receiving, payment and contracts](galleries/README.en.md), including their designers, real states and conditional-routing supplements.

[README 中文](../README.md) · [English README](../README.en.md) · [先看流程设计器](DESIGNER_GALLERY.md) · [本地试用](GETTING_STARTED.md)

[OA 请假](#oa) · [ERP 采购](#erp) · [CRM 报价](#crm) · [若依与 H5](#other-clients) · [截图来源](#provenance)

每种业务都按“填写 → 提交 → 待办 → 下一步 → 通过／驳回”展开。小图用于比较状态，点击可看完整原图；前三组业务流程均提供中英文版本，若依与 H5 补充图为中文。所有图片来自真实应用和合成数据，没有用一张图重复充当不同状态。

Each case follows entry, submission, pending review, the next stage and approval/rejection. Click a thumbnail for the full-size screenshot; English variants are linked for the three business journeys; the RuoYi/H5 supplement is Chinese-only. All are real UI captures with synthetic data.

<a id="oa"></a>

## OA · 请假：从发起到结束 / Leave, end to end

先让 Alice 提交三天年假，再由 Bob 主管审批、Carol 复核。下面第 1–5 张是同一份申请的连续状态，第 6 张是另一次驳回分支。

Alice requests three days; Bob reviews first and Carol follows. Images 1–5 follow one request. Image 6 shows a separate rejection branch.

| <a id="oa-form"></a>1 · 填写三天请假与交接事由 | <a id="oa-submitted"></a>2 · Alice 已提交，等待主管 Bob |
| --- | --- |
| [![填写三天请假与交接事由](images/gallery/oa-01-form-zh.png)](images/gallery/oa-01-form-zh.png) | [![Alice 已提交，等待主管 Bob](images/gallery/oa-02-submitted-zh.png)](images/gallery/oa-02-submitted-zh.png) |
| Enter three days and the handover reason. [English](images/gallery/oa-01-form-en.png) | Alice has submitted; Bob is the current reviewer. [English](images/gallery/oa-02-submitted-en.png) |

| <a id="oa-inbox"></a>3 · Bob 的待办：查看原单并填写意见 | <a id="oa-pending-next"></a>4 · Bob 已办，整笔仍等待 Carol |
| --- | --- |
| [![Bob 的待办：查看原单并填写意见](images/gallery/oa-03-inbox-zh.png)](images/gallery/oa-03-inbox-zh.png) | [![Bob 已办，整笔仍等待 Carol](images/gallery/oa-04-pending-next-zh.png)](images/gallery/oa-04-pending-next-zh.png) |
| Bob’s pending inbox shows the request and review controls. [English](images/gallery/oa-03-inbox-en.png) | Bob’s handled entry remains pending at Carol’s stage. [English](images/gallery/oa-04-pending-next-en.png) |

| <a id="oa-approved"></a>5 · 两级通过，保留两位审批人的记录 | <a id="oa-rejected"></a>6 · 另一份申请被驳回，保留拒绝理由 |
| --- | --- |
| [![两级通过，保留两位审批人的记录](images/gallery/oa-05-approved-zh.png)](images/gallery/oa-05-approved-zh.png) | [![另一份申请被驳回，保留拒绝理由](images/gallery/oa-06-rejected-zh.png)](images/gallery/oa-06-rejected-zh.png) |
| Both stages have passed, with each saved decision and note. [English](images/gallery/oa-05-approved-en.png) | A separate request is rejected, with its reason retained. [English](images/gallery/oa-06-rejected-en.png) |

真实待办按登录成员查询。Bob 审批后出现在“我已审批”，即使 Carol 尚未处理；这不是“已办=申请全部结束”。[待办契约 / Worklist semantics](MEMBER_INBOX.md) · [操作步骤 / Walkthrough](GETTING_STARTED.md)

<a id="erp"></a>

## ERP · 采购：先核金额，再看结果 / Procurement, from amount to outcome

3 把人体工学椅，单价 CNY 199.50，合计 CNY 598.50。第 1–5 张跟随同一张采购单；第 6 张是独立的追加采购驳回单。

Three ergonomic chairs at CNY 199.50 total CNY 598.50. Images 1–5 follow one purchase request; image 6 is a separate rejected purchase.

| <a id="erp-form"></a>1 · 填写物品、数量、单价与币种 | <a id="erp-submitted"></a>2 · 采购单已保存，业务快照不可改写 |
| --- | --- |
| [![填写物品、数量、单价与币种](images/gallery/erp-01-form-zh.png)](images/gallery/erp-01-form-zh.png) | [![采购单已保存，业务快照不可改写](images/gallery/erp-02-submitted-zh.png)](images/gallery/erp-02-submitted-zh.png) |
| Enter the item, quantity, unit price and currency. [English](images/gallery/erp-01-form-en.png) | The submitted purchase request has a saved business snapshot. [English](images/gallery/erp-02-submitted-en.png) |

| <a id="erp-review"></a>3 · 主管核对 3 × CNY 199.50 = CNY 598.50 | <a id="erp-final-review"></a>4 · 主管已通过，Carol 继续复核 |
| --- | --- |
| [![主管核对 3 × CNY 199.50 = CNY 598.50](images/gallery/erp-03-review-zh.png)](images/gallery/erp-03-review-zh.png) | [![主管已通过，Carol 继续复核](images/gallery/erp-04-final-review-zh.png)](images/gallery/erp-04-final-review-zh.png) |
| The manager checks three chairs at CNY 199.50, total CNY 598.50. [English](images/gallery/erp-03-review-en.png) | After the manager’s approval, Carol performs the final review. [English](images/gallery/erp-04-final-review-en.png) |

| <a id="erp-approved"></a>5 · 两级通过后保留金额、流程和审批意见 | <a id="erp-rejected"></a>6 · 追加采购被驳回：先使用现有库存 |
| --- | --- |
| [![两级通过后保留金额、流程和审批意见](images/gallery/erp-05-approved-zh.png)](images/gallery/erp-05-approved-zh.png) | [![追加采购被驳回：先使用现有库存](images/gallery/erp-06-rejected-zh.png)](images/gallery/erp-06-rejected-zh.png) |
| The completed request retains its exact amounts, flow and notes. [English](images/gallery/erp-05-approved-en.png) | A separate purchase is rejected in favor of existing stock. [English](images/gallery/erp-06-rejected-en.png) |

采购与请假共用演示工作区里已发布的流程。本页使用两级人工审批；真实宿主须自行定义路由与资格策略。审批不会向供应商下单、预留资金、付款或回写业务系统。

Leave and procurement use the demo workspace’s published flow; this capture uses two human stages. Hosts must define routing and eligibility. Approval does not place an order, reserve funds, pay or write back. [采购说明 / Procurement guide](PROCUREMENT_UI.md)

<a id="crm"></a>

## CRM · 报价折扣：销售经理 → 财务 / Quote discount, manager to finance

10 套设备，目录单价 CNY 1,000.00，申请单价 CNY 850.00；申请总额 CNY 8,500.00，优惠 CNY 1,500.00（15%）。第 1–5 张是同一份报价申请，第 6 张在全新临时后端重走驳回分支，不是修改已通过结果。

Ten equipment sets go from a CNY 1,000.00 list unit price to a requested CNY 850.00: CNY 8,500.00 total and CNY 1,500.00 savings (15%). Images 1–5 follow one request. Image 6 uses a fresh disposable backend for an alternative rejection; it does not alter the approved request.

| <a id="crm-form"></a>1 · 源报价、申请单价与减少金额一起核对 | <a id="crm-submitted"></a>2 · 销售已提交，等待销售经理 |
| --- | --- |
| [![源报价、申请单价与减少金额一起核对](images/gallery/crm-01-form-zh.png)](images/gallery/crm-01-form-zh.png) | [![销售已提交，等待销售经理](images/gallery/crm-02-submitted-zh.png)](images/gallery/crm-02-submitted-zh.png) |
| Review the source quote, requested price and CNY 1,500 reduction together. [English](images/gallery/crm-01-form-en.png) | The salesperson has submitted and is awaiting the manager. [English](images/gallery/crm-02-submitted-en.png) |

| <a id="crm-manager-review"></a>3 · Bob 审核源报价与折扣理由 | <a id="crm-finance-review"></a>4 · Bob 已同意，Carol 复核金额 |
| --- | --- |
| [![Bob 审核源报价与折扣理由](images/gallery/crm-03-manager-review-zh.png)](images/gallery/crm-03-manager-review-zh.png) | [![Bob 已同意，Carol 复核金额](images/gallery/crm-04-finance-review-zh.png)](images/gallery/crm-04-finance-review-zh.png) |
| Bob reviews the source quotation and discount rationale. [English](images/gallery/crm-03-manager-review-en.png) | After Bob’s approval, Carol checks the amount. [English](images/gallery/crm-04-finance-review-en.png) |

| <a id="crm-approved"></a>5 · 两级通过，保存报价版本和原始理由 | <a id="crm-rejected"></a>6 · 独立驳回分支：经理拒绝后的状态 |
| --- | --- |
| [![两级通过，保存报价版本和原始理由](images/gallery/crm-05-approved-zh.png)](images/gallery/crm-05-approved-zh.png) | [![独立驳回分支：经理拒绝后的状态](images/gallery/crm-06-rejected-zh.png)](images/gallery/crm-06-rejected-zh.png) |
| Both stages pass; the quote revision and original rationale remain. [English](images/gallery/crm-05-approved-en.png) | A separate run shows the manager-rejected result. The saved review reason is verified through the API; this page does not display it. [English](images/gallery/crm-06-rejected-en.png) |

报价是 `/quote-discount.html` 与 `/api/crm` 上的隔离合成案例，固定销售经理 → 财务两步。这里的申请清单不是共享待办。结果卡片显示状态、当前步骤及业务快照，不展示逐人审批意见或完整历史；这些记录由接口校验。共享独立端、若依和 H5 工作区尚不支持报价；没有真实 CRM／LLM 连接、客户通知、付款或业务回写。窄屏只查看和审批，新建使用桌面窗口。

Quotes run on the separate `/quote-discount.html` and `/api/crm` entry points, with fixed manager → finance steps. The quote list is not the shared inbox. Result cards show status, current stage and business fields, but not individual review notes or full history; the capture tests verify those through the API. Shared standalone, RuoYi and H5 workspaces do not support quotes. There is no real CRM/LLM connection, customer notification, payment or writeback. Narrow-screen quote UI supports review only. [报价案例 / Quote case](CRM_QUOTE_CASE.md)

<a id="other-clients"></a>

## 若依与 H5：同一规则，不同入口 / Other supported clients

原生若依 ANY 组部分拒绝图与 H5 已办图是滚动后的视口截图，顶部导航或账号栏可能不在画面内；其他截图可能为全页截图。

The native RuoYi partial-ANY and H5 handled images are scrolled viewport captures, so the top navigation or account header may be outside the image; other captures may be full-page.

### 原生若依 / Native RuoYi

| 编辑人员组 | ANY 组部分拒绝后仍等待 |
| --- | --- |
| [![若依原生人员选择和分组配置](images/gallery/ruoyi-group-editor-zh.png)](images/gallery/ruoyi-group-editor-zh.png) | [![若依 ANY 组部分成员拒绝，其他成员仍可处理](images/gallery/ruoyi-any-partial-zh.png)](images/gallery/ruoyi-any-partial-zh.png) |
| 使用若依真实账号目录、菜单与权限。图中配置固定参与人，不按角色或部门动态选人。 | 一位成员拒绝不会立即结束 ANY 组；另一个成员仍可同意。该图是合成测试中的另一个请求。 |

RuoYi uses its own identities, menus and permissions. Its native group editor selects fixed users. The ANY example shows a real partial rejection, rather than a terminal rejection. [接入说明 / Integration](../examples/ruoyi-vue3/README.md)

### H5 手机浏览器 / H5 mobile browser

<a href="images/gallery/h5-handled-zh.png"><img src="images/gallery/h5-handled-zh.png" width="260" alt="H5 采购已办列表和完整单据卡片"></a> <a href="images/gallery/h5-procurement-review-zh.png"><img src="images/gallery/h5-procurement-review-zh.png" width="260" alt="H5 采购详情及同意、拒绝按钮"></a> <a href="images/gallery/h5-completed-zh.png"><img src="images/gallery/h5-completed-zh.png" width="260" alt="H5 完成审批后的记录"></a>

这里分别展示 CNY 599.97 采购单的已办卡片和审批控制，以及另一份请假组申请通过后的完整历史。它们来自两个合成测试场景，不冒充同一笔业务连续状态。

These captures show a CNY 599.97 procurement request’s handled card and review controls, plus completed leave-group history from a separate test case. H5 can review existing leave/procurement requests; it cannot author requests, design flows or review quotes. Captures use a 390px Chromium viewport, not physical-device or native-app testing. [H5 guide](../examples/approval-mobile/README.md)

<a id="provenance"></a>

## 版本、来源与复现 / Versions, sources and reproduction

新设计器及 OA／ERP／CRM 状态由专用截图用例驱动真实后端；ALL／ANY、若依和 H5 来自已通过的 main `c4b3135a` 浏览器验收。逐图提交、工作流、原始产物路径、尺寸及 SHA-256 见[来源清单](images/gallery/provenance.json)。所有 PNG 保留原始字节，未裁剪、重绘、修图或生成 UI。

Dedicated gallery tests drive the real backend for the new designer and business states. Additional group, RuoYi and H5 captures come from passing main `c4b3135a` browser acceptance. The [manifest](images/gallery/provenance.json) records each image’s exact commit, workflow, artifact path, dimensions and checksum. PNG bytes are unchanged; no UI was generated, retouched or cropped.

[截图复现命令与环境](GALLERY_CAPTURE.md)记录通过的采集运行与本地浏览器限制。图片说明各自版本的合成案例，不代表生产就绪、真实客户采用或后续提交已通过测试。CI 产物保留 7 天；仓库图片不依赖该保留期。

[Capture instructions and environment](GALLERY_CAPTURE.md) distinguish passing CI capture runs from the local browser limitation. Screenshots are evidence of synthetic cases at their listed versions, not production readiness, customer adoption or passing tests at later commits. Repository copies outlive the seven-day CI artifact retention period.

此前 10 张案例图片的[原始来源清单](images/cases/provenance.json)保留不变；[早期设计器](DESIGNER_SHOWCASE.md)和[早期若依图集](RUOYI_SHOWCASE.md)仍可查阅。
