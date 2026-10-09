# 截图复现与证据

<!-- Legacy fragments remain entry points after the language split. -->
<a id="accepted-capture-runs--已通过的采集来源"></a>
<a id="capture-contract--采集约束"></a>
<a id="evidence-and-limits--验证与限制"></a>
<a id="run--运行"></a>
<a id="截图复现--reproduce-the-gallery"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](GALLERY_CAPTURE.en.md) · [文档目录](README.md)

[设计器图集](DESIGNER_GALLERY.md) · [业务全流程](CASE_GALLERY.md) · [逐图来源](images/gallery/provenance.json)

<!-- topic:capture-contract -->
## 采集约束

- 真实 Spring Boot、Vue/CRM UI、认证 Chromium 与合成数据，不模拟成功响应、改 DOM、生成 UI 或修图。
- `ARCFLOW_GALLERY=1` 显式启用；每次调用由现有 Playwright 配置创建全新一次性存储。CRM 驳回另开一次运行，不覆盖已通过报价。
- 真实控件完成插入、排序、撤销、ALL/ANY、校验、发布、提交和决定；检查 HTTP 与状态转换。版本示例发布新定义后，比较旧申请与原快照一致。
- 报价卡不显示意见/完整历史，夹具通过真实 API 核对，不将其描述成画面可见内容。
- 认证、字体就绪和减少动画后截图，拒绝横向溢出或可见密码输入。没有认证 trace、视频、HAR 或保存登录态。
- 既有 ALL/ANY、若依、H5 取自清单精确提交的成功浏览器验收；H5 390px 不是原生应用/真机认证。

截图本身不能证明 JDBC、幂等、权限隔离或生产就绪；报价卡也不是完整审计界面。

<!-- topic:run -->
## 运行

先满足[后端](../examples/approval-demo/backend/README.md)和[界面](../examples/approval-ui/README.md)要求，构建真实 JAR 并安装锁定 UI 依赖。Playwright 自行提供临时密码、管理后端/Vite 和新存储，不可指向真实数据或共享服务。

```bash
mvn --batch-mode --no-transfer-progress install
mvn --batch-mode --no-transfer-progress -f examples/approval-domain/pom.xml install
mvn --batch-mode --no-transfer-progress -f examples/approval-demo/backend/pom.xml package
cd examples/approval-ui
npm ci
npx playwright install --with-deps chromium
# Install Noto CJK fonts through your OS for readable Chinese captures.
ARCFLOW_GALLERY=1 npm run test:e2e -- e2e/gallery.spec.mjs --output=gallery-results
ARCFLOW_GALLERY=1 GALLERY_CRM_REJECT=1 npm run test:e2e -- e2e/gallery.spec.mjs --grep "isolated CRM" --output=gallery-rejection-results
```

两次调用串行：先八种设计器状态及 OA/ERP/CRM，再独立 CRM 拒绝。两种语言是同一保存状态，场景数只计一次；各业务第六张拒绝图是另一分支。每次后端/存储独立。普通功能运行跳过可选夹具，[审批 CI](../.github/workflows/approval-demo.yml)在功能套件后显式新建后端执行，PNG 保留七天。

<!-- topic:accepted-capture-runs -->
## 已通过的采集来源

| 采集内容 | 精确提交 | 通过的运行 | 本页使用 |
| --- | --- | --- | --- |
| 设计器与 OA/ERP/CRM | `21429cd1b0adcec6ffba3f5a473b1e06f4a35aa2` | [Approval demo CI](https://github.com/JamesCube/ArcFlow/actions/runs/37775938307) | 26 个状态、52 张中英 PNG |
| ALL/ANY 行为 | `c4b3135a049654e9d6f87c042b1ba334ad6e4870` | [Main standalone](https://github.com/JamesCube/ArcFlow/actions/runs/37774389459) | 2 个状态、4 张中英 PNG |
| 原生若依 | `c4b3135a049654e9d6f87c042b1ba334ad6e4870` | [Main RuoYi](https://github.com/JamesCube/ArcFlow/actions/runs/37774389578) | 2 张中文 PNG |
| H5 | `c4b3135a049654e9d6f87c042b1ba334ad6e4870` | [Main H5](https://github.com/JamesCube/ArcFlow/actions/runs/37774389564) | 3 张中文 PNG |

共 33 个不同场景、61 张原始 PNG，语言变体不重复计场景，11,315,297 bytes。截图提交早于最终文档，后续改文档不更改图片来源。

<!-- topic:evidence-and-limits -->
## 证据与限制

清单提供每图提交、通过工作流和不可变 PNG 校验值。新夹具/工作流不改变相对 main `c4b3135a049654e9d6f87c042b1ba334ad6e4870` 的应用行为。文档变更不重新截图，也不能把历史测试变成新提交证据。

本地云环境可构建和发现测试，但 Chromium 创建 IPC socket 时失败（`Operation not permitted`）；一次获准命令提权仍遇相同运行限制，没有本地浏览器通过。既有 GitHub Actions Chromium 执行采集，下载原 PNG 后做独立像素审阅。早期夹具失败已按现有契约修复，仅收录完整通过运行的图片。本地浏览器未成功，不能声称本地像素验收通过；当前提交 CI 应另查。
