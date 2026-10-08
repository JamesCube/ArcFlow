# Standalone host dependency migration

Checked against official Spring documentation on 2026-10-08.

## Scope

The standalone backend now pins Spring Boot **4.1.1**, which the [Spring project page](https://spring.io/projects/spring-boot/) lists as stable. [Spring's maintained lines](https://github.com/spring-projects/spring-boot/wiki) are 4.1 and 4.0. Boot 4.1 [still supports Java 17](https://docs.spring.io/spring-boot/system-requirements.html). This is a host migration, not a production-readiness certification.

- `arcflow-core` remains dependency-free at runtime, with its existing Java 17 source/API baseline.
- Only `examples/approval-demo/backend` changes its Boot parent. Its managed runtime moves to Spring Framework 7, Spring Security 7 and the Boot-managed embedded Servlet 6.1 server.
- `approval-domain` and optional `approval-jdbc` retain their Boot 3.5.16 build/test parents. Their public Jackson 2 APIs and source remain unchanged. A consuming host's dependency management determines its runtime versions; the standalone host must resolve only its Boot 4 managed Spring runtime.
- Native RuoYi keeps the exact upstream commits in `examples/ruoyi-vue3/upstream-lock.json`, its own dependency management, authentication and session behavior. Its Boot 3.5 line has [ended OSS support](https://spring.io/blog/2026/06/25/spring-boot-3-5-16-available-now/). This PR does not claim to modernize or production-certify that host.
- No frontend lockfile, SQL migration, process schema, approval snapshot schema or release tag changes.

## Explicit Jackson 2 bridge

The shared domain exposes Jackson 2 `ObjectMapper` / `JsonNode` signatures, and the pinned native RuoYi host uses those same contracts. Replacing them with Jackson 3 here would break that host and third-party callers.

The standalone backend therefore uses Spring's documented `spring-boot-jackson2` compatibility module. `spring.http.converters.preferred-json-mapper=jackson2` makes MVC use that mapper even while Jackson 3 is present transitively. `JsonConfig` still applies `ApprovalService.strictMapper` to the mapper used for HTTP requests. The configuration regression test verifies the selected MVC converters use that exact mapper, rather than merely checking that a Jackson 2 bean exists.

The bridge is **deprecated**, and Spring says it will be removed in a future Boot 4.x release. It is a temporary migration boundary, not a long-term Jackson solution. See [official JSON support](https://docs.spring.io/spring-boot/reference/features/json.html) and the [Boot 4 migration guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide).

Before removing the bridge, separate or migrate shared JSON interfaces deliberately, prove native-host compatibility, and rerun the JSON/file/JDBC/HTTP/browser contracts. Do not replace the mapper or enable lenient coercions just to make an upgrade pass.

## Compatibility gates

Run the existing repository workflows on the exact proposed commit:

- Java core and standalone backend on JDK 17 and 21.
- Strict unknown/missing/duplicate fields, scalar coercion, trailing JSON and exact decimal/scientific money input; legacy and typed wire shapes.
- Authenticated HTTP checks for principal-derived identity, publication permissions, client headers, Origin/Fetch-Metadata, stateless Basic auth, idempotent retries and restart.
- Shared domain tests and the existing H2, PostgreSQL 17 and MySQL 8.0/8.4 JDBC matrix. The latter retain the shared library baseline; they do not claim a Boot 4 JDBC host.
- Standalone leave/procurement/CRM browser journeys, H5 review flows, and native RuoYi integration against unchanged upstream pins.
- Launcher/packaging tests and smoke startup/cleanup.

Inspect the packaged standalone dependency graph as well: no Boot 3, Spring Framework 6 or Spring Security 6 runtime jars should survive host dependency management. Keep exact-commit CI evidence separate from local-only checks and skipped database tests.

## Upgrade limits

This change adds no data migration or new schema. Existing data still follows the [business-document](BUSINESS_DOCUMENTS.md) and [submission-idempotency](SUBMISSION_IDEMPOTENCY.md) upgrade rules. Back up and use one stopped-writer rollout; no automatic downgrade or mixed-version writer guarantee is introduced.

Use localhost and synthetic data. The single-writer JSON store, demo accounts, lack of enterprise identity integration and unvalidated production audit/availability controls remain. A supported framework line removes one dependency-lifecycle gap; it does not remove those application limits.

中文摘要：本次仅把独立示例宿主升级到 Spring Boot 4.1.1，保留 Java 17 和共享领域的 Jackson 2 接口。若依固定上游、共享领域/JDBC 构建基线及数据格式不变。Jackson 2 兼容模块已被 Spring 标记为弃用，后续需单独迁移；此更新不代表生产可用，也未解决若依宿主的依赖支持期限问题。
