# 条件路由图集：来源、对照与复现

[English](CAPTURE.en.md) · [图集入口](README.md) · [文档目录](../../README.md)

<!-- topic:historical-identity -->
## 历史身份

- 采集提交：[`cb3f1077fc725e0031620b1210a819917d8684a4`](https://github.com/JamesCube/ArcFlow/commit/cb3f1077fc725e0031620b1210a819917d8684a4)，tree `9572d7e400261f7e49760b77edf7c1b86b7d955f`。
- [GitHub Actions 运行 38016643460](https://github.com/JamesCube/ArcFlow/actions/runs/38016643460)，attempt 1；历史条件路由 job 成功，6 条浏览器旅程通过。它不是本次文档提交的 CI。
- 产物 `conditional-routing-browser-evidence`，ID `11655974545`；原始 ZIP SHA-256：`c733d1de07bedf1488252cff418264a748cb0e6053a75d09a799e655dece52c0`。本次重新核对了该 ZIP 与每个原始文件。
- 80 PNG、80 原始 sidecar、6 原始旅程回执、1 原始运行时报告，共 167 份原件，均未改字节。付款 28 图、收货 32 图、合同 20 图。
- 20 个采集状态包含 3 个设计器状态和 17 个申请检查点；每个均有中英文与桌面／390px 四种组合。语言和视口不是新增业务场景。
- 历史运行时报告记载 Spring Boot 4.1.1、Spring Framework 7.0.9、Spring Security 7.1.1。后端 JAR SHA-256：`746006781e407bef377f8125d36e29a5995d486347bb57bb32c929572b1cc89c`。

[完整来源清单](../../images/conditional-routing/cb3f1077/provenance.json)映射原产物路径、公开路径、字节数、SHA-256、状态、requestId、视口与图片尺寸。[原始证据清单](../../images/conditional-routing/cb3f1077/source-evidence-manifest.json)原字节保留；[原始运行时报告](../../images/conditional-routing/cb3f1077/runtime/routing-runtime.json)也可直接读取。图集无需下载临时 CI 产物或登录 Library 才能查看原图。

<!-- topic:source-comparison -->
## 与文档基线的精确对照

对照基线为 main [`10e092fae22720b8c125d1a28a75f6fc559cfce8`](https://github.com/JamesCube/ArcFlow/commit/10e092fae22720b8c125d1a28a75f6fc559cfce8)。这是一项源码对照，不是当前 main 重拍或重新运行后端的证明。

以下目录的 Git tree 完全相同：核心 `src`、领域 `examples/approval-domain/src`、独立后端 `examples/approval-demo/backend/src`、前端 `examples/approval-ui/src` 和前端验证脚本 `examples/approval-ui/scripts`。构建清单、条件路由 spec／fixture／契约／验证器和应用工作流也逐文件相同。精确 tree ID 与 12 份文件摘要记录在清单的 `baseline.sourceComparison` 中。

整个 UI 目录摘要并不相同：

- 历史 `uiSourceTreeSHA256`：`238a4e4c2696b782a1cdbeb5046d1b08c509e51bad7d3951cf53a55f85267921`
- 文档基线对应摘要：`84366fc96ac26a6a45e8929ca5262ef3fcb15bdb3a8240b42d3eb97ea9dd1cac`

差异仅为 UI README 及 e2e 下 COMPLEX_SCENARIOS、CONDITIONAL_ROUTING、RECEIVING_SCENARIOS、VISUAL_SCENARIOS 共 5 份文档改写，另新增它们的 5 份英文配对。清单记录这 10 条路径的新旧 SHA-256。Git tree ID、目录内容 SHA-256 与 JAR SHA-256 是不同标识，不互相替代。

<!-- topic:reading-limits -->
## 如何读这些图片

- 先看每页的申请 ID 对照表。同一语言、同一 ID 的状态才是一段连续旅程；另一语言、另一金额或最终驳回使用独立申请。
- 付款的高金额恰为 CNY 10,000，条件是 GTE；合同的条件 ANY 不等于审批 ANY。每个设计器示例只有一个条件项，不据此宣称已视觉覆盖多条件组合。
- 合同部分票的累计决定数为 2，其中 1 次来自前面的商务初审。收货驳回是独立申请，终态中采购复核未到达。
- 1440×1000 与 390×844 是浏览器视口。80 张都是 full-page，实际图片更高。预览使用同一原始 PNG，仅限制显示高度；没有裁剪、修图或合成界面。
- 一些中文列表仍含较早的英文合成标题。窄屏顶部导航在自己的横向区域滚动。原始长页需要放大或滚动查看。
- 条件仅用于付款、收货、合同。所有账号与业务数据为合成数据。通过不会付款、签约、库存入账，也没有真实 ERP／CRM 写回。
- PNG 编码、hash、sidecar 与回执核验不能代替独立真实性认证、权限、幂等、跨浏览器、实体手机、无障碍或生产验收。

本次按原字节复用已验收采集，并重看了各状态原图。新的文档／官网入口仍须由本次提交的检查验收。本地 Chromium 启动遇到 process-singleton socket 的权限限制，没有绕过，也不把未运行的浏览器检查写成通过。

<!-- topic:verify-public-copy -->
## 检查公开副本

从包含本图集的仓库根目录执行。Python 检查使用标准库；严格 PNG／回执检查需要 Node 24。

```bash
python3 -m unittest discover -s scripts -p 'test_conditional_gallery.py' -v
python3 scripts/verify_conditional_gallery.py
ARCFLOW_EXPECT_SOURCE_REVISION=cb3f1077fc725e0031620b1210a819917d8684a4 \
ARCFLOW_EXPECT_CAPTURE_RUN_ID=38016643460 \
ARCFLOW_EXPECT_CAPTURE_RUN_ATTEMPT=1 \
ARCFLOW_EXPECT_CAPTURE_REPOSITORY=JamesCube/ArcFlow \
ARCFLOW_EXPECT_RUNTIME_REPORT=docs/images/conditional-routing/cb3f1077/runtime/routing-runtime.json \
node examples/approval-ui/scripts/verify-routing-captures.mjs docs/images/conditional-routing/cb3f1077
python3 scripts/check_documentation.py
python3 scripts/verify_scenario_galleries.py
python3 website/scripts/build.py
python3 website/scripts/check.py
```

新门禁独立锁定 167 份原件、20×4 组合、双语页面对全部原图的覆盖、申请身份及来源。旧 104 图目录与旧清单没有改动，两套门禁分别执行。检查不会重拍、合并或部署；当前目标提交的实际 CI 以对应 PR／Actions 结果为准。

<!-- topic:recapture-separately -->
## 如需重新采集

在可丢弃的独立检出目录中准备 JDK、Node 与 Chromium，按[条件路由采集说明](../../../examples/approval-ui/e2e/CONDITIONAL_ROUTING.md)运行。历史行为可检出 `cb3f1077`；测试新行为则使用新的精确提交。后端与 UI 使用临时演示账号和数据，不连接真实业务系统。

保留新提交、运行身份、运行时报告、全部 PNG／sidecar／旅程回执，再单独登记。新截图不替换本历史目录；它们的申请 ID、日期或像素可能不同，不能假称重现相同字节。
