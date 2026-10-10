# Contributing

<!-- Legacy fragments remain entry points after the language split. -->
<a id="en"></a>
<a id="english"></a>
<a id="zh"></a>
<a id="参与贡献--contributing"></a>
<a id="简体中文"></a>

<!-- topic:contributing -->

[简体中文](CONTRIBUTING.md)


Read the [README](README.en.md) for scope, then [development setup](docs/development/QUICKSTART.en.md#en) and [architecture](docs/development/ARCHITECTURE.en.md#en). Before adding a feature, open an issue describing the problem, state changes, failure handling, and tests.

- Use a full JDK 17+ and install local core/domain dependencies in order. The root build does not aggregate example modules.
- Run `mvn verify` and `bash scripts/test.sh`, then use the [layered checklist](docs/development/QUICKSTART.en.md#en) for affected domain, host, storage, and client code. A skipped database test is not a pass.
- For root-build changes, also run `python3 -m unittest discover -s scripts -p 'test_maven_build.py' -v`; see [build reproducibility](docs/BUILD_REPRODUCIBILITY.en.md).
- Keep third-party runtime dependencies out of the core. Identity, Spring, database, web, and enterprise integrations belong in their own layers.
- Cover behavioral changes with regression tests. Include conflict/failure cases for concurrency and transactions, and legacy data, strict rejection, restore, and [migration boundaries](docs/development/PERSISTENCE.en.md#en) for storage changes.
- Update the [API reference](docs/api/API_REFERENCE.en.md) and [runnable examples](docs/api/examples/README.en.md) when HTTP changes. Keep user-facing Chinese/English documentation independently readable and distinguish current source from historical tags. Tie screenshots, tests, and CI claims to the exact revision.
- Do not commit credentials, real personal data, or code/assets you lack permission to use. By contributing, you confirm you can provide the material under this repository's Apache 2.0 license.

<!-- topic:docs -->
## Documentation and API changes

Follow the [documentation standard](docs/DOCUMENTATION_STANDARD.en.md). Use Chinese `.md` and English `.en.md` companions; keep corresponding topic markers aligned. Update both languages and the categorized registry in the same change. Preserve original historical evidence separately from current instructions.

When changing a controller, DTO, catalog or condition family, update the reviewed [OpenAPI contracts](docs/api/README.en.md), route inventory and applicable executable examples. A generated-looking schema is not evidence: compare it with actual host behavior and tests.

```sh
python3 -m unittest discover -s scripts -p 'test_*docs*.py' -v
python3 -m unittest discover -s scripts -p test_documentation.py -v
python3 scripts/test_api_contract.py
python3 scripts/check_documentation.py
python3 scripts/check_api_contract.py
python3 scripts/verify_developer_docs.py
python3 scripts/verify_api_examples.py --jar examples/approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```
