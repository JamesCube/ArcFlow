# 参与贡献 / Contributing

[简体中文](#zh) · [English](#en) · [开发文档 / Developer guide](docs/development/README.md)

<a id="zh"></a>
## 简体中文

先看 [README](README.md) 的范围、[开发环境](docs/development/QUICKSTART.md#zh)与[架构](docs/development/ARCHITECTURE.md#zh)。准备增加功能时，先开 issue 说明要解决的问题、状态变化、失败处理与测试方案。

- 使用完整 JDK 17+，按文档先安装本地 core／domain 依赖；根项目不是示例模块的聚合构建。
- 提交前运行 `mvn verify` 和 `bash scripts/test.sh`，再按[分层检查清单](docs/development/QUICKSTART.md#zh)验证受影响的领域、宿主、存储和客户端。不要把跳过的数据库测试写成通过。
- 根构建变更还需 `python3 -m unittest discover -s scripts -p 'test_maven_build.py' -v`，详见[构建可复现性](docs/BUILD_REPRODUCIBILITY.md)。
- 内核不引入第三方运行时依赖。身份、Spring、数据库、Web 和企业框架接入留在对应层。
- 行为变更补回归测试；并发与事务覆盖冲突和失败，持久化变更覆盖旧数据、严格拒绝、恢复及[迁移边界](docs/development/PERSISTENCE.md#zh)。
- HTTP 变更同步更新[接口参考](docs/api/API_REFERENCE.md)与[可运行示例](docs/api/examples/README.md)。用户文档保持中英文可独立阅读，标清当前源码与历史标签；截图、测试和 CI 结论须对应准确版本。
- 不提交密码、令牌、真实个人数据或无权使用的代码／素材。提交贡献表示你有权按本仓库 Apache 2.0 许可证提供这些内容。

<a id="en"></a>
## English

Read the [README](README.en.md) for scope, then [development setup](docs/development/QUICKSTART.md#en) and [architecture](docs/development/ARCHITECTURE.md#en). Before adding a feature, open an issue describing the problem, state changes, failure handling, and tests.

- Use a full JDK 17+ and install local core/domain dependencies in order. The root build does not aggregate example modules.
- Run `mvn verify` and `bash scripts/test.sh`, then use the [layered checklist](docs/development/QUICKSTART.md#en) for affected domain, host, storage, and client code. A skipped database test is not a pass.
- For root-build changes, also run `python3 -m unittest discover -s scripts -p 'test_maven_build.py' -v`; see [build reproducibility](docs/BUILD_REPRODUCIBILITY.md).
- Keep third-party runtime dependencies out of the core. Identity, Spring, database, web, and enterprise integrations belong in their own layers.
- Cover behavioral changes with regression tests. Include conflict/failure cases for concurrency and transactions, and legacy data, strict rejection, restore, and [migration boundaries](docs/development/PERSISTENCE.md#en) for storage changes.
- Update the [API reference](docs/api/API_REFERENCE.en.md) and [runnable examples](docs/api/examples/README.md) when HTTP changes. Keep user-facing Chinese/English documentation independently readable and distinguish current source from historical tags. Tie screenshots, tests, and CI claims to the exact revision.
- Do not commit credentials, real personal data, or code/assets you lack permission to use. By contributing, you confirm you can provide the material under this repository's Apache 2.0 license.
