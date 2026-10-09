# 付款与合同浏览器验收

<!-- Legacy fragments remain entry points after the language split. -->
<a id="forty-image-matrix"></a>
<a id="local-implementation-checkpoint-2026-10-09"></a>
<a id="payment-and-contract-browser-acceptance"></a>
<a id="required-journeys"></a>

[English](COMPLEX_SCENARIOS.en.md)


<!-- topic:scope -->
`complex-scenarios.spec.mjs` 的两个场景标题都以 `complex scenarios:` 开头。测试使用新临时后端、真实演示账号和合成数据，不向银行、ERP、CRM 或客户系统写入。凭据仅在内存，不保存认证页、轨迹、HAR、视频或会话。

<!-- topic:journeys -->
## 必须完成的流程

- 付款：发票/已结算/分配/扣减及 10000.00/7000.00/500.00/6500.00 精确合计；超额分配错误；跨单据导航与发布 v2 后，丢响应仍按原 v1/键重试；默认 ALL→ANY 不变；部分 ALL、Bob 多阶段、ANY 先拒后同意、ANY 全拒、ALL 立即拒绝；新 v2 ALL→单人完成；金额和历史不变。
- 合同：期限、修订、非标准说明、三个里程碑与零差额；一分钱差额、越界日期；切为 STANDARD 时保留原说明并要求显式纠正；设计器新增 ANY v2 后，原意图仍绑定 v1；Bob 在 SINGLE→ALL 各自表决；新 SINGLE→ALL→ANY、部分 ANY 拒绝；ALL 拒绝后不执行后续 ANY；条款与里程碑不变。
- 两类都验证：中英文、桌面/390px、只读审批人、防重复点击、重载/重登录、真实固定人员、旧请假/报销流程不变和无外部写请求。

<!-- topic:captures -->
## 40 张图片矩阵

每个场景的十种状态均有 en/zh，桌面 1440×1000 全页；手机 390×844：

| 状态 | 视口 | 检查点 |
| --- | --- | --- |
| `form-filled` | 桌面 | 完整输入 |
| `form-summary` | 手机 | 精确合计且不溢出 |
| `validation-errors` | 桌面 | 明确不变量错误 |
| `designer-published` | 桌面 | 实际发布 v2 |
| `saved-original-snapshot` | 桌面 | 重试仍为原 v1 |
| `review-controls` | 手机 | 意见与 44px 决策控件 |
| `all-partial` | 桌面 | 真实部分表决 |
| `any-partial-rejection` | 桌面 | 一票驳回仍待处理 |
| `approved` | 桌面 | 仅审核结果，不声称执行业务 |
| `rejected` | 桌面 | 保留业务快照 |

设置 `ARCFLOW_CAPTURE_COMPLEX_SCENARIOS=1`，原 PNG 与 JSON 旁注仅写入输出目录下唯一 `capture-complex-<UUID>`。不变换、上传或发布图片，不替代不可访问的历史图片。

校验器拒绝缺失/重复矩阵、PNG/尺寸不符、混合源码/后端哈希或同场景多会话。CI 绑定准确源码、干净 tree、run、attempt、仓库与声明 Boot：

```sh
ARCFLOW_EXPECT_SOURCE_REVISION=<exact-head> \
ARCFLOW_REQUIRE_CLEAN_COMPLEX=1 \
ARCFLOW_EXPECT_BACKEND_RUNTIME=declared-Boot-4.1.1 \
ARCFLOW_EXPECT_CAPTURE_RUN_ID=<run-id> \
ARCFLOW_EXPECT_CAPTURE_RUN_ATTEMPT=<attempt> \
ARCFLOW_EXPECT_CAPTURE_REPOSITORY=<owner/repository> \
node scripts/verify-complex-captures.mjs <playwright-output-directory>
```

worker 配置重载必须保留继承的同一不可变后端包；不存在或非普通文件时失败，不能换成重新打包的目标。八个回归例覆盖该边界。哈希旁注说明来源，不独立证明图片从未被篡改，仍须检查实际运行和图片。

<!-- topic:history -->
## 历史实现检查点：2026-10-09

当时通过 46 个 Vitest 文件/1,394 测试、Vite 构建、差异空白检查，以及声明 Boot 4.1.1 的真实客户端 HTTP。Chromium 在打开页面前报 Unix socket EPERM，包括已批准的提升运行，因此本地浏览器断言、质量、手机布局和 40 张图均未验证。空输出正确被捕获门禁拒绝，单元测试样本不是截图证据。另一个 Boot 3 补充 HTTP 结果不作为声明运行时通过依据。

这些是旧本地检查点，不代表当前提交、已发布版本、CI、合并或视觉验收；目标提交的 CI 浏览器任务才是验收依据。
