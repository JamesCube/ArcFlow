# 出差申请审批

<!-- Legacy fragments remain entry points after the language split. -->
<a id="form-and-business-rules"></a>
<a id="host-identity-and-isolation"></a>
<a id="schema-8-rollout-and-recovery"></a>
<a id="status-and-scope"></a>
<a id="verification-and-visual-acceptance"></a>
<a id="出差申请审批--business-travel-review"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](TRAVEL_SCENARIO.en.md) · [文档目录](README.md)

<!-- topic:current-scope -->
## 当前范围

当前 main 已包含六项独立场景，统一读取 JSON wrapper 1–13。本文保留早期统一候选的验证范围和版本边界，不能将当时的“未合并”或 wrapper 10 上限理解为当前状态。当前架构和上线步骤见[架构](development/ARCHITECTURE.md)与[存储迁移](development/PERSISTENCE.md)；精确提交 CI 另行核对。

<!-- topic:historical-candidate-and-scenario-scope -->
## 历史候选与场景范围

本页原记录是基于已验收 main `71910bfc2ac1b9d58e0f7f1b85e6bbb206321ec1` 的 Travel/Seal-use/Receiving 本地组合候选中的出差部分；当时未合并、未部署。历史单项候选结果不等于新组合 head 的结果，见[组合兼容及验收](UNIFIED_SCENARIO_INTEGRATION.md)。

编译期 `oa-travel` 使用共用目录、可视化表单渲染、设计器和审批生命周期，单据是独立的 `travel` 版本 1。它记录合成行程和预计预算；通过不预订交通/住宿、不报销、不预留资金、不付款、不发通知或回写，无敏感文件上传或外部集成。

<!-- topic:form-and-business-rules -->
## 表单与业务规则

必填 `businessId`、`title`、`reason`、`destination`、`startDate`、`endDate`、`purpose`、`estimatedCost`、`currency`、`costCenter`，并带 `type: travel`、`documentVersion: 1`。审批全过程保持全部字段不变。

- 业务引用为 1–128 个 ASCII 字母/数字和 `._:/-`，以字母/数字开头。
- 标题 ≤120、原因 ≤2,000、目的地 ≤160 字符，规范化后仍非空。目的地与公共文本 trim，业务引用精确保留。
- 真实公历 `YYYY-MM-DD`，年份 0001–9999；结束不早于开始，含首尾共 1–90 天，支持同日和闰日。它们是本地日历日期，不推断时区转换或按当前日期过期。
- 目的为 `CUSTOMER_VISIT`、`PROJECT_DELIVERY`、`TRAINING`、`CONFERENCE`、`OTHER`。
- 预计金额为精确 JSON 数字，>0 且 ≤1,000,000,000，最多两位小数；JPY 为整数。币种 CNY/USD/EUR/GBP/JPY，不换汇。
- 成本中心为 ENGINEERING、SALES、OPERATIONS。
- 天数由不可变日期派生，不接受 `durationDays` 或总额输入；兼容字段 `request.days` 为 0，因为这不是请假。

默认流程：提交 → Bob 行程审核 → Carol 预算审核 → 完成。设计器可发布 1–8 个固定审批步骤和 SINGLE/ALL/ANY 规则；出差不提供金额路由、动态组织角色、定时器或 outbox。

<!-- topic:host-identity-and-isolation -->
## 宿主、身份与隔离

原四场景候选的 `/scenarios.html` 在报销、出差、用印和收货间共享内存认证会话；当前目录扩为六项。每个场景保留独立草稿、未确认键/原意图、加载流程版本、设计器草稿、申请及审批评论。切换不把在途响应放进另一场景，退出清空全部会话草稿与键。

编译期注册表仅暴露 `/api/scenarios/oa-travel/{process,requests,documents}` 和申请决定。未知场景 404，路径不能选文件。数据文件为 `approval.data-file + .scenario-oa-travel.json`，与报销、用印、收货、CRM 及旧请假/采购隔离。通用独立/若依单据端点只接受请假/采购；每个场景拒绝其他类型。

每次使用认证活动身份；发布沿用发布权限，决定按冻结成员及活动用户检查。每次提交必须有精确、申请人范围的 `Idempotency-Key`，绑定全部规范化字段、场景/流程 ID 与流程版本；相同重试返回当前持久状态，包括通过/拒绝后，不同意图冲突。JDBC 键仍跨配置流程按申请人全局隔离；业务引用不是唯一约束。

<!-- topic:historical-schema-8-rollout-and-recovery -->
## schema 8 上线与恢复记录

早期候选要求所有相关 JSON/JDBC 读取端先部署 schema 1–10 统一 reader，停不兼容写者、备份后再启用出差；当前须使用前述 1–13 reader。支持的 1–10 快照只读打开，保留原严格校验。首次出差修改最低 8，Travel 在 9/10 有效，在 1–7 拒绝；报价最低 6、报销最低 7。后续旧接口/报销/发布不降低已有 8/9/10；写者取单调最大值，不强制指定 8。出差流程定义仍为 2/3。

首次升级在私密 `.schemaN.bak` 保存紧邻升级前的精确字节，重名选新名。原子替换失败不发布申请或键映射；重试保留备份。恢复会丢失后续申请、决定、发布，是历史恢复而非无损降级。schema 7 程序不能读取出差/schema 8。

SQL revision 3 不变，沿用严格 `request_json` 与成员投影，登记类型不重建就绪索引。没有自动 DDL、回填或回退迁移；仍需原有停写迁移、数据库备份及兼容升级。

<!-- topic:verification-and-visual-acceptance -->
## 验证与视觉验收

发布要求新的领域/JSON 迁移与重启测试、明确执行出差用例的 H2/PostgreSQL/MySQL 契约、独立认证 HTTP、完整共用界面回归/构建，以及真实后端中英桌面/窄屏浏览器流程。报销的测试和截图不能代替出差证据。

真实采集目录、已填表单、设计器、验证错误、待审、下一审批人、通过、拒绝的中英文画面，记录精确源码 SHA、视口、运行和图片 hash。不得用模拟图或生成插画替代。检查间距、焦点、键盘、可读错误、总额与日期、无横向裁切、草稿/重试恢复和审批中的冻结数据。该历史候选没有独立验收的出差图集；原产物下载遇 HTTP 403/1010，原 PNG 字节与独立像素复核未验证。
