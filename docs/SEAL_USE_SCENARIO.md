# 用印申请审批

<!-- Legacy fragments remain entry points after the language split. -->
<a id="business-boundaries--业务边界"></a>
<a id="draft-integration-candidate"></a>
<a id="explicit-schema-compatibility"></a>
<a id="review-and-identity"></a>
<a id="seal-use-review--用印申请审批"></a>
<a id="verification-and-acceptance"></a>
<a id="what-the-form-actually-records"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](SEAL_USE_SCENARIO.en.md) · [文档目录](README.md)

<!-- topic:current-scope -->
## 当前范围

当前 main 已包含六项独立场景，统一读取 JSON wrapper 1–13。本文保留早期统一候选的验证范围和版本边界，不能将当时的“未合并”或 wrapper 10 上限理解为当前状态。当前架构和上线步骤见[架构](development/ARCHITECTURE.md)与[存储迁移](development/PERSISTENCE.md)；精确提交 CI 另行核对。

<!-- topic:historical-candidate-scope -->
## 历史候选范围

原记录为基于已验收 main `71910bfc2ac1b9d58e0f7f1b85e6bbb206321ec1` 的本地统一候选中的用印部分，当时未合并、部署或验收为交付场景。历史候选测试不证明组合 head 成功，仍要求新的 Boot 4.1.1 HTTP、真实服务器、浏览器及独立像素验证，见[统一兼容与验收](UNIFIED_SCENARIO_INTEGRATION.md)。

原编译期目录包括报销、出差、用印、收货，以类型、流程、JSON 和会话工作区隔离；当前为六项。通用/若依仍只接受请假、采购，CRM 报价保留单独源授权宿主。`contracts/seal-use` 原型是历史契约证据。

<!-- topic:what-the-form-actually-records -->
## 表单实际记录什么

不可变单据恰有九个字段：`type: "sealUse"`、`documentVersion: 1`、`businessId`、`title`、`reason`、`documentName`、`documentRef`、`sealType`、`copyCount`。表单将 reason 标为业务目的，只填写一次。印章分类为合成的 `OFFICIAL`、`CONTRACT`、`FINANCE`；份数整数 1–100。文档引用是惰性合成文本，不是待抓取 URL，也不证明真实文档存在或归申请人。

标题、目的和文档名先校验长度，再按 Java 兼容方式 trim 边缘；仅控制字符/Unicode 空白/BOM 无效。ID、引用、类别不 trim 或忽略大小写。整数 JSON 拒绝小数/指数、字符串、布尔和 null；输入期间保留份数原始文字，显示错误，仅在校验成功时规范化。未知/缺少字段、重复键及尾随内容全部拒绝。专用 HTTP 只接受有效 UTF-8 JSON，在解码前将整个原始请求外层限制为 8,000,000 个 UTF-16 单元；不限制累积快照文件或直接类型化 Java 调用。

没有币种、金额、票据表或财务总额。响应保留 `{request,total}`，用印 `total: null`；报销仍为精确金额字符串。列表和详情显示份数与合成类别，不把份数格式化为金额。

<!-- topic:review-and-identity -->
## 审批与身份

初始流程 `oa-seal-use`：提交 → Bob 文档审核（`documentReview`）→ Carol 用印审核（`sealReview`）→ 完成。共用设计器可发布 1–8 个固定成员阶段的新版本；申请保留原版本、成员、业务快照和逐阶段历史，通过仅记录审核结果。

宿主检查认证活动身份、发布权限及参与人。路径只选编译期登记项，JSON 文件是配置数据文件加 `.scenario-oa-seal-use.json`，URL 不能选文件。用印不能进入报销/通用宿主，Travel/Receiving/Expense/Leave/Procurement/Quote 不能进入用印宿主。

恰好一个有效申请人范围的 `Idempotency-Key` 必填。相同规范化意图/原流程版本在通过、拒绝或重启后返回当前持久申请；改任何字段或原版本都冲突。文档/业务引用不是唯一约束。JDBC 键跨流程按申请人全局隔离，独立 JSON 保持每文件作用域。持久化失败不发布内存状态或映射。

浏览器分别保留各场景未提交表单、未确认重试意图/键/版本、设计器草稿、选中申请与评论。响应绑定发起场景及会话，退出清空内存工作区；重载仍丢失未保存数据，不是持久草稿。

<!-- topic:historical-explicit-schema-compatibility -->
## 历史显式格式兼容

历史统一 reader 接受 **1–10** 的原始严格形状，当前使用 1–13。Travel 最低 8、Seal-use 最低 9、Receiving 最低 10；合法 8（包括空或出差）、9（出差/用印）只读打开，10 可表示当时所有类型。历史候选拒绝未知类型、未来单据版本、wrapper 11+ 及不合法的低版本载荷；当前未来 wrapper 边界见迁移指南。

- 首次用印写入至少 9，在 1–8 中拒绝。
- 写者取已有 wrapper 与全部单据/定义/键需求的最大值；已有 10 不降，旧接口/报销/出差/决定/发布也不降低 9/10。读取不强制升级。
- 每次真实升级原样备份紧邻之前字节，包括同会话早先写入；重名和重试不覆盖旧备份。
- 原子替换失败不发布申请或内存键；读取/校验失败不改快照/备份。JSON 仍单写者。
- SQL revision 3 及就绪成员投影不变，登记类型不重建；revision 2 仍需显式迁移/回填。
- 新类型写入前升级全部读写者并停旧写者，SQL revision 3 不让旧独立候选自动互相兼容。
- 备份恢复丢失后续提交、决定、发布，是历史恢复，不是无损降级。不能重编号或放松未知类型检查。

<!-- topic:verification-and-acceptance -->
## 验证与验收

运行通常的 Java 内核、领域、JDBC、界面测试和构建。同四项具名用印 JDBC 契约被 H2、PostgreSQL、MySQL 继承；CI 必须要求新服务器用例无跳过，H2 不能代替真实服务器。

宿主测试类为 `SealUseApiTest`；真实认证、流程隔离、不可变快照、拒绝与 schema 9 重启可通过以下命令检查：

```sh
python3 examples/scenarios/seal_use_http_smoke.py \
  --jar examples/approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```

该历史候选验收为完整场景前还要求精确源码宿主/服务器 CI、真实浏览器、中英文目录/表单/设计器/错误/待审/下一阶段/通过/拒绝/窄屏审批原图、来源及独立像素审查。测试发现、生成插画或报销/出差图片不能代替。原产物下载遇 HTTP 403/1010，原 PNG 与独立像素复核未验证，本记录不声称图集已验收。

<!-- topic:business-boundaries -->
## 业务边界

仅记录用印申请与人工审核结果，不实际盖章、电子签章、签约、上传文件、借出/归还印章、通知或回写。三类印章都是合成分类，不代表真实印章身份、法律权限或文档效力；审批通过不等于已用印。
