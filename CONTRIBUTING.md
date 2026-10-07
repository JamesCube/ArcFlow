# 参与贡献 / Contributing

先看 README，了解已经实现的功能和限制。准备增加功能时，请先开 issue 说清楚要解决的问题、状态如何变化、失败时怎么办，以及打算怎么测试。

- 使用完整 JDK 17+，提交前运行 `mvn verify` 和 `bash scripts/test.sh`。
- 内核不引入第三方运行时依赖。Spring、数据库、Web 和企业框架接入放在各自的适配层。
- 改变行为时，请补上 `EngineChecks` 或独立 JUnit 测试。涉及并发或事务时，也要测试冲突和失败的情况。
- 不要提交密码、令牌、个人数据，或未经许可的代码和素材。
- 提交贡献表示你有权按本仓库的 Apache 2.0 许可证提供这些内容。

Read the README for current features and limits. Before adding a feature, open an issue explaining the problem, how state will change, what happens on failure, and how you plan to test it.

- Use a full JDK 17+. Run `mvn verify` and `bash scripts/test.sh` before submitting.
- Keep third-party runtime dependencies out of the core. Put Spring, database, web and enterprise-framework integrations in their own adapters.
- Cover behavior changes in `EngineChecks` or a separate JUnit test. For concurrency or transaction changes, include conflict and failure cases.
- Don't commit passwords, tokens, personal data, or code and assets you don't have permission to use.
- By contributing, you confirm that you can provide your contribution under this repository's Apache 2.0 license.
