# 条件路由验收

<!-- Legacy fragments remain entry points after the language split. -->
<a id="conditional-routing-acceptance"></a>
<a id="local-verification-status"></a>
<a id="scope"></a>

[English](CONDITIONAL_ROUTING.en.md)


<!-- topic:scope -->
`conditional-routing.spec.mjs` 使用真实本地后端、临时账号与 JSON 存储，不操作真实付款、签约或外部系统。

<!-- topic:coverage -->
## 覆盖范围

- 付款：数值条件、审批模式切换、撤销/重做、发布、币种不匹配、低额排除路径、旧无条件申请、清除/重加条件仍保留 schema 4，以及高低路径真实 ALL/ANY 表决。
- 收货：存在/不存在不合格行的布尔事实，显式显示排除步骤。
- 合同：IN/ANY、空 IN 非法选择、标准/非标准条款的包含结果和最终路径。
- 英文桌面与中文 390px 编辑器/详情、无横向溢出和只读审批人控件；不截密码页。

`routing-receipt.json` 保存实际启动后端 SHA-256、合成定义、路径和历史。证据写入忽略的 test-results，不保存认证、HAR、轨迹、视频或浏览器存储。

<!-- topic:history -->
## 历史本地验证状态

以下是 2026-10-09 实现检查点，不是当前提交的验收结果。当时完整前端单元/DOM 与构建通过；真实后端 HTTP 验证三类事实，包括 CNY 6500/10000、布尔/枚举，排除路径 1 票与包含路径 3 票，schema 4 全无条件、旧 schema 3，以及发布后的原版本丢响应重试：

```sh
node scripts/verify-routing-http.mjs ../approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```

该本地环境 Chromium 在 process-singleton 阶段报 `socket() failed: Operation not permitted`；云浏览器也不能连到隔离 localhost，因此当时没有本地渲染或截图验收，也未降低安全设置。测试发现列出了三个场景，但不能代替实际执行。

打包后端后，在允许运行浏览器的本地/CI 环境执行：

```sh
npm run test:e2e -- e2e/conditional-routing.spec.mjs
```

不据此宣称生产就绪、跨浏览器、200% 缩放、无障碍审计或任意流程引擎能力。
