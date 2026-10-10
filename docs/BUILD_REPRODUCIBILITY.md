# 根项目构建插件与验证

<!-- Legacy fragments remain entry points after the language split. -->
<a id="ci-检查--ci-checks"></a>
<a id="为什么固定--why-these-pins-exist"></a>
<a id="根项目构建插件--root-build-plugins"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[English](BUILD_REPRODUCIBILITY.en.md) · [文档目录](README.md)

根项目 `mvn verify` 固定 resources 3.4.0、compiler 3.13.0、Surefire 3.5.2、jar 3.5.0。编译目标仍为 Java 17，内核不增加运行时依赖。resources 和 jar 版本保留此前成功的 Maven 3.9.16 构建所选版本。

<!-- topic:why-these-versions-are-pinned -->
## 固定版本的依据

同一提交 `703881052df30280a3e009d89f77893dadecd103` 的 [Java CI 第 2 次运行](https://github.com/JamesCube/ArcFlow/actions/runs/37736103438/attempts/2)使用不同 runner 镜像：

- JDK 17：`20260927.320.1`，实际 resources 3.4.0 / jar 3.5.0。
- JDK 21：`20261004.327.1`，实际 resources 3.5.0 / jar 3.5.1。

历史日志没有打印 `mvn --version`。镜像清单分别列出 [Maven 3.9.16](https://github.com/actions/runner-images/blob/ubuntu24/20260927.320/images/ubuntu/Ubuntu2404-Readme.md) 和 [Maven 3.10.0](https://github.com/actions/runner-images/blob/ubuntu24/20261004.327/images/ubuntu/Ubuntu2404-Readme.md)。当时根 POM 未固定 resources/jar，观察值与不同发行版的生命周期默认值吻合：[3.9.16 绑定](https://maven.apache.org/ref/3.9.16/maven-core/default-bindings.html)、[3.10.0 插件版本](https://maven.apache.org/ref/3.10.0/maven-core/plugin-management.html)。本地用同一个 Maven 3.9.16 在 Java 17/21 检查有效模型，也得到相同插件版本。这证明发行版默认值发生漂移，不能证明 JDK 自己选择插件版本。

第 1 次运行在测试前无法从 Central 解析 resources 3.5.0，第 2 次却成功使用同版本。该恢复的解析失败与未固定构建输入是两个问题；现有日志不能确认仓库侧具体原因，固定版本也不保证网络或仓库永远可用。

<!-- topic:ci-checks -->
## CI 检查

每个 Java 17/21 作业使用独立空 Maven 缓存，以 `--show-version` 记录实际 Maven/JDK，运行 verify 并核对实际插件与 POM 固定值；随后复用缓存离线再次 verify，冷/热清单必须一致。两个 JDK 都检查同一 POM，另运行清单检查器回归和 `scripts/test.sh` 的 24 项独立内核检查。`core-build-inventory-jdk-*` 产物保存日志和 JSON 清单 14 天，失败日志也保留。

本地使用已有 Maven 与完整 JDK 17+：

```bash
python3 -m unittest discover -s scripts -p 'test_maven_build.py' -v
mvn --batch-mode --no-transfer-progress --show-version verify
bash scripts/test.sh
```

范围仅为根项目 verify 实际执行的插件，不固定 Maven/JDK 发行包、其他生命周期或示例宿主，也不证明 JAR 字节级可复现。Maven 仍可能随 runner 更新，因此记录实际版本。
