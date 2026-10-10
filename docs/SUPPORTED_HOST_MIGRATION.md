# 独立宿主依赖迁移

<!-- Legacy fragments remain entry points after the language split. -->
<a id="compatibility-gates"></a>
<a id="explicit-jackson-2-bridge"></a>
<a id="scope"></a>
<a id="standalone-host-dependency-migration"></a>
<a id="upgrade-limits"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](SUPPORTED_HOST_MIGRATION.en.md) · [文档目录](README.md)

本迁移记录对照 Spring 官方文档核验于 **2026-10-08**。外部维护状态可能变化；以下是该日期的记录，实际使用时还需检查精确依赖和当前上游公告。

<!-- topic:scope -->
## 范围

独立后端固定使用 Spring Boot **4.1.1**，核验当日 [Spring 项目页](https://spring.io/projects/spring-boot/)将其列为稳定版本，[维护分支](https://github.com/spring-projects/spring-boot/wiki)为 4.1 和 4.0；Boot 4.1 [仍支持 Java 17](https://docs.spring.io/spring-boot/system-requirements.html)。这是宿主迁移，不是生产就绪认证。

- `arcflow-core` 保持零第三方运行时依赖及 Java 17 源码/API 基线。
- 仅 `examples/approval-demo/backend` 更换 Boot parent，托管运行时升级到 Spring Framework 7、Spring Security 7 与 Boot 管理的内嵌 Servlet 6.1 服务器。
- `approval-domain` 和可选 `approval-jdbc` 保留 Boot 3.5.16 构建/测试 parent，Jackson 2 公共 API 与源码不变。消费宿主的依赖管理决定运行版本；独立宿主必须只解析 Boot 4 管理的 Spring 运行时。
- 原生若依保持 `examples/ruoyi-vue3/upstream-lock.json` 的精确上游提交及自身依赖管理、认证与会话。其 Boot 3.5 分支[已结束 OSS 支持](https://spring.io/blog/2026/06/25/spring-boot-3-5-16-available-now/)。这次迁移不声称现代化或生产认证该宿主。
- 不修改前端锁文件、SQL 迁移、流程 schema、审批快照 schema 或发布标签。

<!-- topic:explicit-jackson-2-bridge -->
## 显式 Jackson 2 兼容层

共享领域公开 Jackson 2 `ObjectMapper` / `JsonNode` 签名，锁定的若依宿主也使用这些契约。直接换成 Jackson 3 会破坏该宿主及第三方调用者。

因此独立后端采用 Spring 官方的 `spring-boot-jackson2` 兼容模块。`spring.http.converters.preferred-json-mapper=jackson2` 让 MVC 在传递依赖包含 Jackson 3 时仍使用 Jackson 2。`JsonConfig` 继续将 `ApprovalService.strictMapper` 应用于 HTTP mapper；回归测试检查 MVC 转换器确实使用该实例，而非只确认有 Jackson 2 bean。

兼容层**已弃用**，Spring 表示会在未来 Boot 4.x 移除。它是临时迁移边界，不是长期方案，见[官方 JSON 支持](https://docs.spring.io/spring-boot/reference/features/json.html)及 [Boot 4 迁移指南](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide)。

移除前应明确拆分或迁移共享 JSON 接口，证明原生宿主兼容，并重跑 JSON/文件/JDBC/HTTP/浏览器契约。不能为了让升级通过而更换 mapper 或放宽强制转换。

<!-- topic:compatibility-gates -->
## 兼容性门槛

对提议的精确提交运行现有仓库工作流：

- Java 内核与独立后端：JDK 17、21。
- 严格未知/缺少/重复字段、标量强制转换、尾随 JSON，以及精确十进制/科学计数法金额；旧接口与类型化载荷。
- 认证 HTTP：Principal 身份、发布权限、客户端头、Origin/Fetch-Metadata、无状态 Basic 认证、幂等重试与重启。
- 共享领域和现有 H2、PostgreSQL 17、MySQL 8.0/8.4 JDBC 矩阵。后者保留共享库基线，不证明 Boot 4 JDBC 宿主。
- 独立请假/采购/CRM 浏览器流程、H5 审批，以及上游版本不变的原生若依集成。
- 启动器、打包、烟测启动与清理。

还需检查独立端打包依赖图，不应留下 Boot 3、Spring Framework 6 或 Spring Security 6 运行 JAR。精确提交 CI、本地检查与被跳过的数据库测试应分开报告。

<!-- topic:upgrade-limits -->
## 升级限制

本迁移不新增数据迁移或 schema。已有数据仍按[业务单据](BUSINESS_DOCUMENTS.md)和[提交幂等](SUBMISSION_IDEMPOTENCY.md)升级规则处理；备份后停写统一上线，不提供自动降级或混合版本写者保证。

仅使用 localhost 与合成数据。单写者 JSON、演示账号、缺少企业身份接入及未验证的生产审计/可用性控制仍是限制。受维护的框架分支只解决一项依赖生命周期问题，不消除应用限制。
