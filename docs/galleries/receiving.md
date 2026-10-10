# ERP 收货 · 真实界面图集

[简体中文](receiving.md) · [English](receiving.en.md) · [五类图集](README.md) · [业务契约](../RECEIVING_SCENARIO.md)

两行合成收货单覆盖 80 PCS 与 10 BOX，记录验收与拒收数量。先配置 ALL／ANY，再看旧申请保留 ALL、部分投票、采购复核及新 ANY 申请提前推进。不同单位分别汇总。

全部图片是提交 [`8c26d95`](https://github.com/JamesCube/ArcFlow/commit/8c26d953e53991d3e445aa69c530726f1d81daae) 的原始截图，来自[运行 37918452685](https://github.com/JamesCube/ArcFlow/actions/runs/37918452685)，不是当前 main 的重新采集。界面与相关应用源码在文档基线 [`199db754`](https://github.com/JamesCube/ArcFlow/commit/199db7548f6faba5dfef105eaaf7311972adb388) 保持一致；这不代表新提交通过了测试。每张图片下方标注实际语言、视口、PNG 尺寸和采集状态。点击图片查看原图。

<!-- topic:scope-and-limits -->
## 能力与边界

无真实采购订单余额、库存入账或 ERP 回写。收货图不具备逐状态中英文配对：两种语言页均标注每张原图的真实语言。390px 收货及路由图均为长页截图，并非一屏可见；条件路由收货截图仍为 PENDING，不能当作通过截图。

所有账号和业务资料均为合成演示数据。390px 是 Chromium 浏览器视口，不是原生 H5 客户端或实体手机验收；长页高度不是视口高度。中英文只是界面语言，合成标题／流程名可能保留双语。

<!-- topic:process-configuration-and-business-states -->
## 流程配置与业务状态

### 流程设计器：将新版本发布为 ANY

<a href="../images/scenarios/receiving/06-published-any-designer-en-desktop.png"><img src="../images/scenarios/receiving/06-published-any-designer-en-desktop.png" width="1000" alt="流程设计器：将新版本发布为 ANY"></a>

界面语言: English · 浏览器视口: 1440×1000 · 全页原图: 1440×1667 px

采集状态: `06-published-any-designer-en-desktop` · [PNG SHA-256](../images/scenarios/provenance.json): `d15ee1075d8deec2ba215c36e12b2c146b9ed4592e47b5458725350b67d54864`

### 390px 流程设置长页

<a href="../images/scenarios/receiving/07-published-any-designer-zh-390.png"><img src="../images/scenarios/receiving/07-published-any-designer-zh-390.png" width="300" alt="390px 流程设置长页"></a>

界面语言: 中文 · 浏览器视口: 390×844 · 全页原图: 390×1900 px

采集状态: `07-published-any-designer-zh-390` · [PNG SHA-256](../images/scenarios/provenance.json): `39c9a3bae4de6f2870a72021c21b571a5fc4a5ff7850300ea93a342abd237796`

### 两行收货明细：数量按单位汇总

<a href="../images/scenarios/receiving/01-form-en-desktop.png"><img src="../images/scenarios/receiving/01-form-en-desktop.png" width="1000" alt="两行收货明细：数量按单位汇总"></a>

界面语言: English · 浏览器视口: 1440×1000 · 全页原图: 1440×2159 px

采集状态: `01-form-en-desktop` · [PNG SHA-256](../images/scenarios/provenance.json): `dd598377e583b4b8ab140f7547dc66690decd1a2fddb668d38a7b27dd780ab7c`

### 同一表单的中文界面

<a href="../images/scenarios/receiving/02-form-zh-desktop.png"><img src="../images/scenarios/receiving/02-form-zh-desktop.png" width="1000" alt="同一表单的中文界面"></a>

界面语言: 中文 · 浏览器视口: 1440×1000 · 全页原图: 1440×2159 px

采集状态: `02-form-zh-desktop` · [PNG SHA-256](../images/scenarios/provenance.json): `d601237f15f066ee3f0794b6aca4fd595a112b3dc8bcdd2baf970617223144d3`

### 390px 收货表单长页

<a href="../images/scenarios/receiving/03-form-zh-390.png"><img src="../images/scenarios/receiving/03-form-zh-390.png" width="300" alt="390px 收货表单长页"></a>

界面语言: 中文 · 浏览器视口: 390×844 · 全页原图: 390×3331 px

采集状态: `03-form-zh-390` · [PNG SHA-256](../images/scenarios/provenance.json): `10785692981f53091e34255269a08079668ba3fe34821cccf53cf694edaa15ab`

### 验收加拒收必须等于收货数量

<a href="../images/scenarios/receiving/04-quantity-error-en-desktop.png"><img src="../images/scenarios/receiving/04-quantity-error-en-desktop.png" width="1000" alt="验收加拒收必须等于收货数量"></a>

界面语言: English · 浏览器视口: 1440×1000 · 全页原图: 1440×2270 px

采集状态: `04-quantity-error-en-desktop` · [PNG SHA-256](../images/scenarios/provenance.json): `d8355077fb22a1cf36e07c46f29464a3d0f15dd7b8919d50767ffd4dc7bd8813`

### 390px 数量错误长页

<a href="../images/scenarios/receiving/05-quantity-error-zh-390.png"><img src="../images/scenarios/receiving/05-quantity-error-zh-390.png" width="300" alt="390px 数量错误长页"></a>

界面语言: 中文 · 浏览器视口: 390×844 · 全页原图: 390×3438 px

采集状态: `05-quantity-error-zh-390` · [PNG SHA-256](../images/scenarios/provenance.json): `3aaa2cd317d9f18d43000ca22fe9ae8e87f3cb7f3cf2dd7b1489f6642ef98d42`

### 旧申请保留 ALL，不随新 ANY 版本改变

<a href="../images/scenarios/receiving/08-immutable-all-snapshot-en-desktop.png"><img src="../images/scenarios/receiving/08-immutable-all-snapshot-en-desktop.png" width="1000" alt="旧申请保留 ALL，不随新 ANY 版本改变"></a>

界面语言: English · 浏览器视口: 1440×1000 · 全页原图: 1440×2232 px

采集状态: `08-immutable-all-snapshot-en-desktop` · [PNG SHA-256](../images/scenarios/provenance.json): `247b022066b48fcd019039f526325dfac6e00a592cbce283dea9a006a7265d16`

### Bob 已通过：ALL 仍等待 Carol

<a href="../images/scenarios/receiving/09-all-partial-bob-vote-en-desktop.png"><img src="../images/scenarios/receiving/09-all-partial-bob-vote-en-desktop.png" width="1000" alt="Bob 已通过：ALL 仍等待 Carol"></a>

界面语言: English · 浏览器视口: 1440×1000 · 全页原图: 1440×2388 px

采集状态: `09-all-partial-bob-vote-en-desktop` · [PNG SHA-256](../images/scenarios/provenance.json): `2e454de858348806e98385c579b8497f98b4e69665efe876879d620b6f4dc4c5`

### Carol 质量审核：390px 长页

<a href="../images/scenarios/receiving/10-all-quality-review-zh-390.png"><img src="../images/scenarios/receiving/10-all-quality-review-zh-390.png" width="300" alt="Carol 质量审核：390px 长页"></a>

界面语言: 中文 · 浏览器视口: 390×844 · 全页原图: 390×3614 px

采集状态: `10-all-quality-review-zh-390` · [PNG SHA-256](../images/scenarios/provenance.json): `cb85a8a82a588180a42f7292aba3e9611cd8605fff77843e8b3139c3db85e69b`

### Bob 再次作为采购复核人处理

<a href="../images/scenarios/receiving/11-bob-procurement-review-en-desktop.png"><img src="../images/scenarios/receiving/11-bob-procurement-review-en-desktop.png" width="1000" alt="Bob 再次作为采购复核人处理"></a>

界面语言: English · 浏览器视口: 1440×1000 · 全页原图: 1440×2702 px

采集状态: `11-bob-procurement-review-en-desktop` · [PNG SHA-256](../images/scenarios/provenance.json): `50a5b38060c358d0f85dd0cc665c02fc542d0c4d54f239b70156a36394493a72`

### 原 ALL 申请：两级审批、三次投票后完成

<a href="../images/scenarios/receiving/12-all-approved-en-desktop.png"><img src="../images/scenarios/receiving/12-all-approved-en-desktop.png" width="1000" alt="原 ALL 申请：两级审批、三次投票后完成"></a>

界面语言: English · 浏览器视口: 1440×1000 · 全页原图: 1440×2700 px

采集状态: `12-all-approved-en-desktop` · [PNG SHA-256](../images/scenarios/provenance.json): `bba6e227cf9f64a9cabfa49dd9089245decf5786983782ada1a30201ead9259b`

### 另一份 ALL 申请被驳回

<a href="../images/scenarios/receiving/13-all-rejected-zh-desktop.png"><img src="../images/scenarios/receiving/13-all-rejected-zh-desktop.png" width="1000" alt="另一份 ALL 申请被驳回"></a>

界面语言: 中文 · 浏览器视口: 1440×1000 · 全页原图: 1440×2288 px

采集状态: `13-all-rejected-zh-desktop` · [PNG SHA-256](../images/scenarios/provenance.json): `bd0a2a28bf6879089bcf4afff3fcb7dd8209190189f8b906557ad12d47d0a2f1`

### 新 ANY 申请：一人同意后推进

<a href="../images/scenarios/receiving/14-any-early-advance-en-desktop.png"><img src="../images/scenarios/receiving/14-any-early-advance-en-desktop.png" width="1000" alt="新 ANY 申请：一人同意后推进"></a>

界面语言: English · 浏览器视口: 1440×1000 · 全页原图: 1440×2609 px

采集状态: `14-any-early-advance-en-desktop` · [PNG SHA-256](../images/scenarios/provenance.json): `e00799655d35ca477261a3d93165b8493197ca7e067cadd3faaa345454d83f44`

### ANY 申请通过：390px 长页

<a href="../images/scenarios/receiving/15-any-approved-zh-390.png"><img src="../images/scenarios/receiving/15-any-approved-zh-390.png" width="300" alt="ANY 申请通过：390px 长页"></a>

界面语言: 中文 · 浏览器视口: 390×844 · 全页原图: 390×3270 px

采集状态: `15-any-approved-zh-390` · [PNG SHA-256](../images/scenarios/provenance.json): `00c439f81bc1d85bacef43ea40261994d101ba44bc2ed1e2cc991a2500484cc3`

<!-- topic:conditional-routing-supplement -->
## 条件路由补充用例

以下图片来自另一独立用例。条件在提交时求值，路径与解释随申请保存；这是有类型的受限条件，不是任意 BPMN、脚本或自由分支引擎。截图保留真实语言与宽度，没有人为补齐不存在的语言／视口版本。

### 无拒收行：冻结跳过附加复核的路径，仍待审批

<a href="../images/scenarios/receiving/receiving-clean-frozen-desktop.png"><img src="../images/scenarios/receiving/receiving-clean-frozen-desktop.png" width="1000" alt="无拒收行：冻结跳过附加复核的路径，仍待审批"></a>

界面语言: English · 浏览器视口: 1440×1000 · 全页原图: 1440×2406 px

采集状态: `receiving-clean-frozen-desktop` · [PNG SHA-256](../images/scenarios/provenance.json): `af24a39e7d6c665e4d14eb7ed3423413fbd7bb46ce9d6ec996bf2f4395c48062`

### 中文 390px 收货路径长页，仍待审批

<a href="../images/scenarios/receiving/receiving-clean-zh-390px.png"><img src="../images/scenarios/receiving/receiving-clean-zh-390px.png" width="300" alt="中文 390px 收货路径长页，仍待审批"></a>

界面语言: 中文 · 浏览器视口: 390×844 · 全页原图: 390×3279 px

采集状态: `receiving-clean-zh-390px` · [PNG SHA-256](../images/scenarios/provenance.json): `1e55edb0b7642a2f65bd400f6d8f33a5b6890c2f63e6bfd68cb1418b0d31d581`

<!-- topic:sources-and-reproduction -->
## 来源与复现

- [历史采集运行](https://github.com/JamesCube/ArcFlow/actions/runs/37918452685) · [commit](https://github.com/JamesCube/ArcFlow/commit/8c26d953e53991d3e445aa69c530726f1d81daae)
- [Playwright fixture](https://github.com/JamesCube/ArcFlow/blob/8c26d953e53991d3e445aa69c530726f1d81daae/examples/approval-ui/e2e/receiving.spec.mjs)
- [Conditional-routing fixture](https://github.com/JamesCube/ArcFlow/blob/8c26d953e53991d3e445aa69c530726f1d81daae/examples/approval-ui/e2e/conditional-routing.spec.mjs)
- [逐图来源与 SHA-256](../images/scenarios/provenance.json)
- [采集命令、验证范围与缺口](CAPTURE.md)
