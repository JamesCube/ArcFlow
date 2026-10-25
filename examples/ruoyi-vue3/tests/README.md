# 若依集成测试

<!-- Legacy fragments remain entry points after the language split. -->
<a id="local-native-inbox-ui-checks-no-browser"></a>
<a id="native-procurement-ui-regression"></a>
<a id="official-ruoyi-integration-smoke"></a>

[English](README.en.md)


<!-- topic:scope -->
适用范围：当前源码。`smoke.py` 启动已打包的官方若依后端，连接真实 MySQL/Redis，经过上游 `/login`、`/getInfo`、`/getRouters`、`/logout` 和 ArcFlow 路由；认证不模拟。这些上游端点不属于 ArcFlow 自己的 30 个 controller handler。

<!-- topic:prepare -->
## 隔离环境

使用新的可丢弃 `ry-vue` 数据库，依次导入固定上游的 `ry_20260417.sql`、`quartz.sql` 和 overlay `sql/menu.sql`。fixture 创建五名用户、两角色，仅在此测试库关闭验证码，并用运行时随机密码和 BCrypt 替换样例密码；密码和 JWT secret 不保存到仓库。普通参与人无发布权限，第五账号无 ArcFlow 权限，管理员也不能代指定人员审批。

本地 MySQL 3306、Redis 6379、后端 8080 必须可用。构建与接线见[宿主指南](../README.md)。

```sh
python3 -m pip install -r examples/ruoyi-vue3/tests/requirements.txt
python3 examples/ruoyi-vue3/tests/smoke.py \
  --jar /absolute/path/to/backend/ruoyi-admin/target/ruoyi-admin.jar \
  --state-directory /absolute/path/to/new-empty-test-state
```

MYSQL_PASSWORD 必须匹配测试库。smoke 启动、停止并在相同 JSON/Redis 状态重启，核对顺序和分组历史。finally 清理自身进程，状态目录保留诊断日志。不能指向真实账号或生产库。

<!-- topic:coverage -->
## HTTP 与浏览器检查

HTTP 覆盖权限、schema 2/3、SINGLE/ALL/ANY、非首位成员、部分票、提前/相反/重复决策、重复参与人、终态、快照固定及账号禁用/删除后重授权。历史账号删除不应使已保存历史不可读。

提交检查原键及标准化意图重放、变更冲突、无键独立创建、重复/非法 header、申请人隔离、正文伪造身份拒绝、无效请求不占键，以及失去权限后不能重放。类型化请假/采购检查严格字段和原始数字、权限、重启后的混合旧新数据与继续决策。分组 malformed/duplicate/missing 字段或错误 schema 不得改变活跃定义。

浏览器使用实际构建的官方 Vue 3 前端、原生登录和 `/prod-api`，覆盖菜单、发布、只读参与人、逐步与分组审批、采购表单、语言/类型/标签切换、精确 `USD 0.30`、重载、退出、权限及中断恢复。它消费前序 HTTP 建立的账号/两步流程；通过 smoke 的 `--frontend-directory /path/to/frontend/dist` 运行，不单独调用 browser.py。

```sh
python3 -m playwright install --with-deps chromium
```

成功截图为登录后的工作区，不保留登录图、认证会话、trace 或 HAR，CI 保留七天。`.github/workflows/ruoyi-integration.yml` 提供真实服务任务，但配置存在不代表通过，必须查看精确提交的运行。

<!-- topic:local -->
## 本地模型与 DOM 回归

```sh
node --test examples/ruoyi-vue3/frontend/src/views/arcflow/approval/*.test.mjs
```

复用独立 UI 已安装的 Vue/Vitest/jsdom；overlay 不是完整上游包。在 POSIX 工作区：

```sh
test -e examples/ruoyi-vue3/frontend/node_modules || \
  ln -s ../../approval-ui/node_modules examples/ruoyi-vue3/frontend/node_modules
cd examples/ruoyi-vue3/frontend
./node_modules/.bin/vitest run --config vitest.config.mjs
```

缺依赖先按 UI 指南安装。测试 session stub 只用于模块解析，不经 bootstrap 复制到上游。另从 approval-ui 运行 `npm test`，其 NativeSubmission.test.js 挂载真实 overlay，传输层模拟不代表真实 RBAC 通过。

回归包括待办/已办独立游标、空/耗尽页、过滤、失败重试、非法游标重置、重复点击、取消/迟到响应、会话/过滤切换、卸载、非首位/重复阶段成员、旧发起/历史标签和快照缓存；旧短历史不得覆盖已确认决策。

<!-- topic:limits -->
## 结果如何解读

语法、模型、DOM 不替代服务器/浏览器；旧截图和数量不作为本次验收。真实服务不可用时标明未运行，不把跳过写成通过。原始历史说明保存在[文档历史索引](../../../docs/history/README.md)，当前行为以测试源码、接口规范和同提交 CI 相互核对。

## Native travel graph acceptance / 原生出差图验收

`smoke.py` now also invokes `graph_smoke.py` against real native sessions. It checks numeric identities/current RBAC, strict keys and raw sub-cent rejection, low/high cost routing, parallel ALL join/rejection/concurrent decisions, frozen v1 after v2 publication, actual JVM restart/replay and byte-identical sequential state. No mocked authentication is used. These are authored checks, not a runtime pass.

Offline bootstrap boundary: `python3 examples/ruoyi-vue3/tests/test_graph_bootstrap.py` verifies exact shared dependency bytes and excludes standalone authentication/hub code.

`browser.py` 新增真实原生出差菜单/直接刷新、只读设计器权限、提交、双分支审批/汇合、拒绝取消、窄屏语言切换和退出流程；实际运行时生成 24 张原生出差截图及 JSON 凭据，仅作为 CI 验收证据。仅语法检查不代表浏览器流程已运行。

For slow local cold starts, set optional `ARCFLOW_TEST_HTTP_TIMEOUT=60` (finite positive seconds; default `15`). It applies to urllib and ordered-header HTTP calls only; expected statuses, state assertions and startup deadlines remain unchanged. / 本机冷启动较慢时可增加 HTTP 等待秒数，不改变状态码和业务断言。

The travel smoke also corrupts only its disposable graph snapshot after shutdown, requires native startup to exit nonzero with the graph-corruption diagnostic (not a timeout/port failure), verifies untouched sequential bytes, restores the exact saved graph bytes in finally, then restarts and rechecks the final joined instance. / 出差验收还覆盖真实宿主的损坏拒绝启动与原字节恢复；只操作本测试临时数据。

## Native travel capture evidence / 原生出差图截图证据

Six actual lifecycle states (`designer`, `submitted`, `parallel`, `waiting`, `completed`, `rejected`) × Chinese/English × 1440/390 px produce exactly 24 original Chromium PNGs with 24 JSON receipts. Receipts bind checkout SHA, native numeric actor observed from `/arcflow/me`, real response business/definition/tasks/routes/events/commands, asserted DOM status/votes/join counters and image SHA256. No headers, credentials, HAR or login screenshots are saved. Files stay in the existing temporary CI artifact directory; nothing is added to repository images or a public gallery.

`python3 examples/ruoyi-vue3/tests/verify_graph_captures.py PATH --expected-commit SHA` rejects missing/extra cells, changed source/identity/history, duplicate pixels, PNG corruption and viewport mismatch. These integrity/identity gates do not replace human review of actual pixels. `test_graph_captures.py` tests metadata gates only and creates no screenshots. If Chromium cannot run, no capture/pixel acceptance is claimed.
