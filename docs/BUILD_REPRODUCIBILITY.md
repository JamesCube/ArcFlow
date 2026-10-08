# 根项目构建插件 / Root build plugins

根项目的 `mvn verify` 固定执行以下插件：resources 3.4.0、compiler 3.13.0、Surefire 3.5.2 和 jar 3.5.0。编译目标仍为 Java 17，内核没有新增运行时依赖。

The root `mvn verify` lifecycle explicitly pins resources 3.4.0, compiler 3.13.0, Surefire 3.5.2 and jar 3.5.0. The compiler target remains Java 17; the core gains no runtime dependency. The resources and jar versions retain the previously successful Maven 3.9.16 build's selection.

## 为什么固定 / Why these pins exist

同一提交 `703881052df30280a3e009d89f77893dadecd103` 的 [Java CI 第 2 次运行](https://github.com/JamesCube/ArcFlow/actions/runs/37736103438/attempts/2) 使用了不同 runner 镜像：

- JDK 17：镜像 `20260927.320.1`，实际执行 resources 3.4.0 / jar 3.5.0。
- JDK 21：镜像 `20261004.327.1`，实际执行 resources 3.5.0 / jar 3.5.1。

The historical logs did not print `mvn --version`. Their linked image manifests list [Maven 3.9.16](https://github.com/actions/runner-images/blob/ubuntu24/20260927.320/images/ubuntu/Ubuntu2404-Readme.md) and [Maven 3.10.0](https://github.com/actions/runner-images/blob/ubuntu24/20261004.327/images/ubuntu/Ubuntu2404-Readme.md), respectively. The root POM pinned neither resources nor jar, so the observed selections match the different distributions' lifecycle defaults: [3.9.16 bindings](https://maven.apache.org/ref/3.9.16/maven-core/default-bindings.html) and [3.10.0 plugin versions](https://maven.apache.org/ref/3.10.0/maven-core/plugin-management.html). A local effective-model check with the same Maven 3.9.16 on Java 17 and 21 also selected identical resources/jar versions. This is evidence of distribution-default drift, not evidence that the JDK itself chooses plugin versions.

第 1 次运行在测试开始前无法从 Central 找到 resources 3.5.0，第 2 次同版本插件成功。该问题与未固定插件是两个不同的问题；现有日志不足以确认仓库端失败的具体原因。固定版本不能保证网络或仓库永远可用。

Attempt 1 failed before tests while resolving resources 3.5.0 from Central; attempt 2 successfully used that same version. This recovered resolution failure is separate from unpinned build inputs. The available logs do not establish its exact repository-side cause, and pinning cannot guarantee network or repository availability.

## CI 检查 / CI checks

Java CI 在 JDK 17 和 21 分别执行：

1. 从本任务独立的空 Maven 缓存运行 `verify`，记录实际 Maven/JDK 版本。
2. 检查 POM 中固定的版本与日志中实际执行的插件/目标一致。
3. 使用同一个缓存离线再次运行 `verify`，比较两次版本清单。
4. 运行独立的 24 项内核检查，保留成功或失败的构建日志及版本清单。

Each Java 17/21 job starts with an isolated empty Maven repository, records the real Maven/JDK version with `--show-version`, checks executed plugins against the explicit POM pins, then verifies again offline using that same cache. Cold/warm inventories must match. Both JDK jobs check against the same POM. Inventory-checker regression tests and `scripts/test.sh` also run. The `core-build-inventory-jdk-*` artifacts retain logs and JSON inventories for 14 days, including failed build logs.

本地可使用已有 Maven 与完整 JDK 17+ 运行：

```bash
python3 -m unittest discover -s scripts -p 'test_maven_build.py' -v
mvn --batch-mode --no-transfer-progress --show-version verify
bash scripts/test.sh
```

本检查只覆盖根项目 `verify` 执行的插件。它不固定 Maven/JDK 分发包、其他生命周期或示例宿主，也不证明 JAR 字节级可复现。Maven 版本仍可能随 CI runner 更新，因此清单会记录它。

The guarantee is intentionally limited to plugins executed by the root `verify` lifecycle. Maven/JDK distributions, other lifecycles and example hosts are not pinned by this check. It does not claim byte-for-byte reproducible JARs. Maven may still change with the runner image, which is why its actual version is recorded.
