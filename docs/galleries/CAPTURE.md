# 五类图集的复现与核验

[简体中文](CAPTURE.md) · [English](CAPTURE.en.md) · [图集总入口](README.md)

## 历史采集身份

- 应用精确提交：[`8c26d953e53991d3e445aa69c530726f1d81daae`](https://github.com/JamesCube/ArcFlow/commit/8c26d953e53991d3e445aa69c530726f1d81daae)
- Git tree：`45de9943bc651bef4e377d5b9c1ef38f52670619`
- [Approval demo CI 运行 37918452685](https://github.com/JamesCube/ArcFlow/actions/runs/37918452685)：push 事件、第 1 次运行，已成功完成。这是历史图片来源，不是本次文档提交的 CI。
- 采集时间：2026-10-09 10:37:30.430–10:39:28.741 UTC。
- 104 张未改动的原始 PNG，共 23,292,297 bytes：82 张桌面、22 张窄屏；92 张全页、12 张视口；英文界面 53 张、中文界面 51 张。语言和视口变体不重复计作业务场景。
- [逐图来源清单](../images/scenarios/provenance.json)保留原始 sidecar、产物 ID／名称／路径、原产物归档摘要、图片 SHA-256 和尺寸。本次重新核对的是 PNG 与 sidecar；归档摘要是留存来源信息，不声称重新取得或核验了原始产物 ZIP。

采集提交 `8c26d95` 与文档基线 [`199db7548f6faba5dfef105eaaf7311972adb388`](https://github.com/JamesCube/ArcFlow/commit/199db7548f6faba5dfef105eaaf7311972adb388) 的相关应用源码相同：核心 `src`、整个审批 UI（包含采集用例）、领域 `src` 和独立后端 `src`。清单记录精确 Git tree 对象。后续文档、官网和 CI 变更不会将历史截图变成新 head 的重新采集。

出差与用印的共享目录有两组按语言对应的同字节原图：104 个来源文件、102 个唯一 PNG。清单明确声明这些重复组，它们是相同目录状态。

## 真实应用与证据边界

用例驱动真实独立 Spring Boot 后端与 Chromium 界面，使用临时登录账号和合成数据。没有生成 UI、改写成功画面或裁剪／修饰原图。丢响应测试在后端真实保存后才中断返回，不伪造保存结果。不公开登录截图、密码、HAR、视频或认证状态。

桌面视口为 1440×1000，窄屏视口为 390×844。全页 PNG 的高度可能远大于浏览器视口。出差／用印／付款／合同的窄屏审核操作或汇总图为视口截图；收货及条件路由的窄屏图为长页截图。这些都是独立端响应式页面，不是另一个 H5 客户端、若依或实体手机验收。

收货和条件路由没有为每种状态补齐两种语言和宽度，图集按真实原图标注。条件路由收货图仍为 PENDING。付款“高额”是恰好 CNY 10,000，满足 GTE CNY 10,000；“低额”为 CNY 6,500。合同条件匹配 ANY、`IN {NONSTANDARD}` 与节点 ALL 会签是不同概念。ALL 部分通过和 ANY 部分拒绝尚未终止。通过与驳回示例可能属于不同申请或流程版本，不拼接成同一笔交易。

本组没有币种错误截图。浏览器断言检查过该错误，但断言不能代替图片。截图不能证明数据库兼容性、权限、幂等、无障碍认证、跨浏览器／实体设备支持、外部业务动作或生产就绪。历史本地 Chromium 启动受 IPC socket 限制，原图来自上面成功的 GitHub Actions 运行。本次文档工作不宣称新完成本地应用浏览器验收。

## 在隔离检出目录复现

先按[开发环境文档](../development/QUICKSTART.md#zh)准备完整 JDK 和支持的 Node 版本。在可丢弃的目录检出采集 SHA，复现历史应用。Playwright 配置会创建临时存储与密码并启动独立后端和 UI，不要指向真实数据或共享服务。在允许运行浏览器的环境安装 Chromium 与 Noto CJK 中文字体。

```bash
git checkout 8c26d953e53991d3e445aa69c530726f1d81daae
mvn --batch-mode --no-transfer-progress install
mvn --batch-mode --no-transfer-progress -f examples/approval-domain/pom.xml install
mvn --batch-mode --no-transfer-progress -f examples/approval-demo/backend/pom.xml package
cd examples/approval-ui
npm ci
npx playwright install --with-deps chromium
ARCFLOW_SOURCE_REVISION="$(git rev-parse HEAD)" ARCFLOW_CAPTURE_TRAVEL_SCENARIOS=1 npm run test:e2e -- e2e/travel-scenarios.spec.mjs --output=gallery-results/travel
ARCFLOW_SOURCE_REVISION="$(git rev-parse HEAD)" ARCFLOW_CAPTURE_SCENARIOS=1 npm run test:e2e -- e2e/seal-use.spec.mjs --output=gallery-results/seal
ARCFLOW_CAPTURE_RECEIVING=1 npm run test:e2e -- e2e/receiving.spec.mjs --output=gallery-results/receiving
ARCFLOW_CAPTURE_COMPLEX_SCENARIOS=1 npm run test:e2e -- e2e/complex-scenarios.spec.mjs --output=gallery-results/complex
npm run test:e2e -- e2e/conditional-routing.spec.mjs --output=gallery-results/routing
```

串行运行以上命令。保留新 sidecar、实际 commit、工作流／运行身份、视口、状态与 SHA-256，不要把本地结果冒充原 CI 运行。日期、申请 ID 等细节可能改变，复现行为不等于逐字节重现图片。测试当前源码时另用当前检出目录，并按真实 head 标注。

## 检查本次文档

在包含本次图集的检出目录运行，不要在历史采集 SHA 上运行新增的检查脚本：

```bash
python3 -m unittest discover -s scripts -p 'test_scenario_galleries.py' -v
python3 scripts/verify_scenario_galleries.py
python3 scripts/verify_developer_docs.py
python3 website/scripts/build.py
python3 website/scripts/check.py
```

图集检查会核对 PNG 字节／尺寸、来源提交／运行／状态／语言／视口、五类完整文件清单、本地链接和原图覆盖。变异测试必须拒绝篡改或不一致的证据。这是离线文档完整性检查，不是应用验收。新增 Gallery documentation CI 只执行不会部署的检查；现有应用和官网工作流另行检验 PR 的精确 head。合并与部署不在本次图集变更内。
