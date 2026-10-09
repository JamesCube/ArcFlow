# 独立 ALL/ANY 设计器：历史本地验证

<!-- Legacy fragments remain entry points after the language split. -->
<a id="blocked-or-not-rerun"></a>
<a id="provenance"></a>
<a id="run-the-checks-in-your-development-environment"></a>
<a id="scope"></a>
<a id="standalone-allany-designer-local-verification"></a>
<a id="tests-that-passed-locally"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](PARALLEL_DESIGNER_VERIFICATION.en.md) · [文档目录](README.md)

本文记录 **2026-10-04** 的本地测试。当时尚未推送 GitHub、部署或执行远端 CI。后续浏览器结果见[设计器工作台](DESIGNER_WORKBENCH.md)；以下数量与限制只描述这次早期运行。

<!-- topic:scope -->
## 范围

- 固定顺序中的单人、ALL、ANY 阶段：修改草稿规则、选择不同成员、发布、重置和版本冲突。
- 每位成员的待办及决定控件、保存的分组快照、个人投票/评论/时间戳及完成前后的组状态。
- 已有单人流程与 HTTP 身份检查保持有效；独立演示只有 Bob、Carol，没有企业用户目录。
- 共享领域支持每组 2–16 个唯一稳定 ID；这次运行时若依只接受 schema 2，后续[原生分组支持](../examples/ruoyi-vue3/README.md#configure-and-vote-in-groups)另有文档。

<!-- topic:provenance -->
## 来源

基线：`e1a90282e374255d69869a8453f676c89bd0d471`。

恢复的分组领域补丁与原 SHA-256 一致：
`5a3ae9ebd569349a4346d78454587c40fc00461e40ba94d53a14f55e4e6c7e99`。

原始 tree：`4af0653fab36ecbcc307967d3227b5a6e19cd7fa`。本次测试在其上增加独立设计器并为 HTTP 适配器启用 schema 3；保存的原始源码产物未变。

<!-- topic:tests-that-passed-locally -->
## 本地通过的测试

- Vue/Vitest：**5 个文件、97 个测试**，包括原有 63 个。新增测试先在旧界面发现 9 处失败，修改后通过。
- 独立参考归约器：**64 种混合三阶段流程、2,304 个可达状态**，覆盖所有投票顺序、重复成员、待决成员、阶段结果与个人显示，作为 `parallel-model.test.js` 纳入 97 项。
- Vite 生产构建通过。
- 后端源码使用已安装 Java 21 编译器及现有 Spring/Jackson JAR，以 `-source 17 -target 17 -parameters` 编译通过；这**不是** Java 17 运行时或 `--release 17` 验证。
- 真实 localhost HTTP：**40 项断言**，随机一次性账号与临时存储；覆盖 Basic 认证、Origin 拒绝、仅编辑者发布、重复/无效成员、过期版本、申请人/未来步骤/其他指派人限制、部分 ALL、真实后端重启、并发重复投票、旧快照不变、ANY 部分/全员拒绝/提前通过、ALL 提前拒绝。
- 独立界面审查未发现阻断正确性、安全或会话隔离的问题；审查后明确固定演示身份、将共享存储的浏览器测试排序，并让 HTTP 工具显式使用回环地址和一次性存储。
- `git diff --check` 通过。

<!-- topic:blocked-or-not-rerun -->
## 受阻或未重跑

- **没有为这份组合修改重跑** Maven/JUnit、JDBC/H2、PostgreSQL。环境没有 Maven 和完整 Java 17 工具链，已被拒绝的安装路径没有重试；新增 JUnit HTTP 场景只存在于源码，未执行。
- 两个 Playwright 流程均尝试过，但 Chromium 因环境禁止本地 IPC socket 而在打开页面前退出；另一云浏览器尝试以 `ERR_BLOCKED_BY_CLIENT` 拒绝 localhost。没有通过的浏览器测试或截图，也未验证移动布局。
- 不包含 GitHub 推送、远端 CI、若依浏览器重测、部署或生产验证。

<!-- topic:run-the-checks-in-your-development-environment -->
## 在开发环境重跑

```sh
mvn verify
bash scripts/test.sh
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml verify
python3 examples/approval-demo/verify-parallel-http.py
cd examples/approval-ui
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

完整 JDBC 套件按模块说明运行，并明确配置 PostgreSQL 测试库。HTTP 脚本自行创建/删除测试存储，在回环端口 18080 启停后端；端口已占用时停止，不改正常演示存储。
