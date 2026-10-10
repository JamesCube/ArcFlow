# 收货浏览器验收

<!-- Legacy fragments remain entry points after the language split. -->
<a id="erp-receiving-browser-acceptance"></a>
<a id="expected-screenshots"></a>
<a id="real-behavior-exercised"></a>

[English](RECEIVING_SCENARIOS.en.md)


<!-- topic:scope -->
`receiving.spec.mjs` 的独立真实后端场景以 `receiving:` 开头，可在专门 CI 任务运行，避免普通请假/报销图集重复。使用仓库声明后端及本地临时 Playwright 配置：

```sh
ARCFLOW_CAPTURE_RECEIVING=1 \
ARCFLOW_SOURCE_REVISION="$(git rev-parse HEAD)" \
ARCFLOW_VERIFICATION_BACKEND=declared-Boot-4.1.1 \
npm run test:e2e -- e2e/receiving.spec.mjs --output=receiving-visual-results
```

采集要求干净已提交源码。证据读取完整 Git HEAD，拒绝不符的传入版本及脏文件。CI 要验 PR head 就应明确 checkout 它，而非合成 merge。`--list` 只发现测试，不运行 Chromium 或验渲染。

<!-- topic:journeys -->
## 真实行为

1. 查看 Bob+Carol ALL 检验以及 Bob 采购复核。
2. 中英文及 390px 输入 PCS/BOX 数量，数量不平衡时在 POST 前拒绝。
3. 后端实际保存后丢弃一次响应，原键重试必须返回同一申请 ID。
4. 保存两个 ALL 快照，用真实设计器改首组为 ANY、发布，核对新流程与旧 ALL 快照。
5. 用新版本提交 ANY 收货。
6. Bob 部分 ALL、Carol 完成、Bob 另行采购复核，核对阶段、参与人和最终历史。
7. Carol 驳回第二张 ALL，不能进入采购。
8. Bob 单独通过 ANY，Carol 不再需要表决，再由 Bob 单独完成采购。
9. 重载/登录后保留历史，请假/报销流程前后不变，所有浏览器 POST 都在 `/api/scenarios/erp-receiving/`。

不伪造成功响应，不保存密码输入、请求凭据、会话、轨迹、视频或自动失败截图。显式截图须在已认证收货页面且没有密码框；逐张检查溢出，手机控件检查触控高度、字号与边界。

<!-- topic:captures -->
## 预期截图

一次成功场景应有 15 张 PNG 及 15 份 JSON。均为全页，桌面 1440×1000、手机 390×844：

- `01-form-en-desktop.png`
- `02-form-zh-desktop.png`
- `03-form-zh-390.png`
- `04-quantity-error-en-desktop.png`
- `05-quantity-error-zh-390.png`
- `06-published-any-designer-en-desktop.png`
- `07-published-any-designer-zh-390.png`
- `08-immutable-all-snapshot-en-desktop.png`
- `09-all-partial-bob-vote-en-desktop.png`
- `10-all-quality-review-zh-390.png`
- `11-bob-procurement-review-en-desktop.png`
- `12-all-approved-en-desktop.png`
- `13-all-rejected-zh-desktop.png`
- `14-any-early-advance-en-desktop.png`
- `15-any-approved-zh-390.png`

JSON 包含 sourceRevision、sourceTreeClean、后端标识、可用时的 run/attempt、场景、状态、时间、视口、语言、文件名、SHA-256 与 retry。只有完整成功才写 `receiving-acceptance.json`，其 result=passed、capturedStates=15，记录 ALL/ANY 版本和请假/报销流程未变。部分截图不能算验收。

DOM/模型和构建通过不证明外观。浏览器不能启动时保留错误并标为未验证，不用模拟图替换。兼容后端必须单独标记，不能取代声明运行时验收。
