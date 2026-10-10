# 参与贡献

<!-- Legacy fragments remain entry points after the language split. -->
<a id="en"></a>
<a id="english"></a>
<a id="zh"></a>
<a id="参与贡献--contributing"></a>
<a id="简体中文"></a>

<!-- topic:contributing -->

[English](CONTRIBUTING.en.md)


先看 [README](README.md) 的范围、[开发环境](docs/development/QUICKSTART.md#zh)与[架构](docs/development/ARCHITECTURE.md#zh)。准备增加功能时，先开 issue 说明要解决的问题、状态变化、失败处理与测试方案。

- 使用完整 JDK 17+，按文档先安装本地 core／domain 依赖；根项目不是示例模块的聚合构建。
- 提交前运行 `mvn verify` 和 `bash scripts/test.sh`，再按[分层检查清单](docs/development/QUICKSTART.md#zh)验证受影响的领域、宿主、存储和客户端。不要把跳过的数据库测试写成通过。
- 根构建变更还需 `python3 -m unittest discover -s scripts -p 'test_maven_build.py' -v`，详见[构建可复现性](docs/BUILD_REPRODUCIBILITY.md)。
- 内核不引入第三方运行时依赖。身份、Spring、数据库、Web 和企业框架接入留在对应层。
- 行为变更补回归测试；并发与事务覆盖冲突和失败，持久化变更覆盖旧数据、严格拒绝、恢复及[迁移边界](docs/development/PERSISTENCE.md#zh)。
- HTTP 变更同步更新[接口参考](docs/api/API_REFERENCE.md)与[可运行示例](docs/api/examples/README.md)。用户文档保持中英文可独立阅读，标清当前源码与历史标签；截图、测试和 CI 结论须对应准确版本。
- 不提交密码、令牌、真实个人数据或无权使用的代码／素材。提交贡献表示你有权按本仓库 Apache 2.0 许可证提供这些内容。

<!-- topic:docs -->
## 文档和接口变更

遵循[文档规范](docs/DOCUMENTATION_STANDARD.md)：中文 `.md`、英文 `.en.md` 成对维护，对应 topic 标记一致。同一次修改更新两种语言和分类登记表，历史证据原件与当前说明分开。

改动 controller、DTO、目录或条件类型时，同时更新已审阅的 [OpenAPI 契约](docs/api/README.md)、路由清单和相关可执行样例。规范的外形不能证明准确，必须对照真实宿主行为与测试。

```sh
python3 -m unittest discover -s scripts -p 'test_*docs*.py' -v
python3 -m unittest discover -s scripts -p test_documentation.py -v
python3 scripts/test_api_contract.py
python3 scripts/check_documentation.py
python3 scripts/check_api_contract.py
python3 scripts/verify_developer_docs.py
python3 scripts/verify_api_examples.py --jar examples/approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```
