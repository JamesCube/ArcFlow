# 采购审批体验

<!-- Legacy fragments remain entry points after the language split. -->
<a id="入口与边界--entry-points-and-scope"></a>
<a id="只读快照与重试--saved-snapshots-and-retries"></a>
<a id="采购审批体验--procurement-approval-experience"></a>
<a id="金额与数量--exact-amounts-and-quantities"></a>
<a id="验证方法--verification-method"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](PROCUREMENT_UI.en.md) · [文档目录](README.md)

<!-- topic:entry-points-and-scope -->
## 入口与边界

独立 Vue 与官方若依可在请假/采购之间选择。采购使用 `/api/documents` 或 `/arcflow/documents`，共用已发布流程、权限、定义快照、逐步骤投票与历史。旧请假仍用 `/requests` 和原载荷，不迁移旧申请。列表可混合旧请假、类型化请假/采购，详情按保存业务类型和不可变快照显示，不能从兼容 days 字段推断请假。

H5 仅查看/审批已有单据，没有发起入口或表单；验收数据由后端测试夹具创建。

这是本地合成演示。提交/通过不向供应商下单或传信息、不预留资金、付款、换汇或回写，也不证明这些操作已发生。默认请假/采购共用 `leave-approval`；宿主需自行定义路由和资格。

<!-- topic:exact-amounts-and-quantities -->
## 精确金额与数量

- 数量：整数 1–100,000。
- 单价：正十进制，≤1,000,000,000，最多两位小数。
- 币种：CNY/USD/EUR/GBP/JPY，JPY 整数。
- 业务 ID：1–128 ASCII 字母/数字及 `._:/-`，字母/数字开头。
- 品名：非空且 ≤240 字符，标题/原因沿用后端限制。

客户端拒绝零、负数、指数、分组分隔符、超精度及畸形金额，不舍入或静默作零；后端仍为权威。总额使用精确十进制，不做 JavaScript 浮点乘法。显式显示币种，JPY 无小数，其余两位。最大总额 100,000,000,000,000.00，不能通过不安全整数分币舍入。不计算税、汇率、运费或折扣。

<!-- topic:saved-snapshots-and-retries -->
## 保存快照与重试

审批页不能改已提交业务字段；类型化响应检查支持的 schema、精确字段、有效值及兼容投影一致性。未知/畸形单据明确失败，不显示成零天请假。权限和审计由共享后端负责。

桌面每种单据独立保存内存草稿及一个未确认键。响应丢失/畸形时，保留原端点、规范化意图和冻结流程版本重试，匹配映射返回旧申请。切换类型保留两种意图，返回未变表单复用原键/版本。修改规范化内容只取消该表单意图，成功只清该表单；退出清两份草稿/键。重载会丢键，应先刷新并查看已有申请，见[提交契约](SUBMISSION_IDEMPOTENCY.md)。

<!-- topic:verification-method -->
## 验证方法

两套 Vue 测试覆盖精确小数、schema、混合单据、中英文与重试；独立端/若依/H5 使用合成真实后端 Chromium 流程，含中英窄屏、只读采购、键盘/重复导航、当前成员决定与审计。截图仅在认证和真实操作后采集，不保存认证 trace、视频、storage state 或密码图。

除现有单元/构建命令外，运行：

```bash
cd examples/approval-ui
npm run test:e2e -- --grep 'procurement:'
# Official RuoYi: follow its README and run tests/smoke.py, which invokes browser.py.
# H5: follow examples/approval-mobile/README.md and run npm run test:e2e.
```

结果以精确提交 GitHub Actions 与打包验证清单为准；本文描述覆盖，不独立声称某提交通过。真机 App/小程序和生产采购集成仍在范围之外。
