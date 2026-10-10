# Root build plugins and verification

<!-- Legacy fragments remain entry points after the language split. -->
<a id="ci-检查--ci-checks"></a>
<a id="为什么固定--why-these-pins-exist"></a>
<a id="根项目构建插件--root-build-plugins"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](BUILD_REPRODUCIBILITY.md) · [Documentation](README.en.md)

The root `mvn verify` lifecycle pins resources 3.4.0, compiler 3.13.0, Surefire 3.5.2, and jar 3.5.0. The compiler target remains Java 17 and the core gains no runtime dependency. The resources and jar pins preserve the selection from the previously successful Maven 3.9.16 build.

<!-- topic:why-these-versions-are-pinned -->
## Why these versions are pinned

[Java CI attempt 2](https://github.com/JamesCube/ArcFlow/actions/runs/37736103438/attempts/2) for the same commit, `703881052df30280a3e009d89f77893dadecd103`, used different runner images:

- JDK 17: image `20260927.320.1`, executing resources 3.4.0 / jar 3.5.0.
- JDK 21: image `20261004.327.1`, executing resources 3.5.0 / jar 3.5.1.

The historical logs did not print `mvn --version`. Their image manifests list [Maven 3.9.16](https://github.com/actions/runner-images/blob/ubuntu24/20260927.320/images/ubuntu/Ubuntu2404-Readme.md) and [Maven 3.10.0](https://github.com/actions/runner-images/blob/ubuntu24/20261004.327/images/ubuntu/Ubuntu2404-Readme.md), respectively. The root POM pinned neither resources nor jar, so the observations match distribution lifecycle defaults: [3.9.16 bindings](https://maven.apache.org/ref/3.9.16/maven-core/default-bindings.html) and [3.10.0 plugin versions](https://maven.apache.org/ref/3.10.0/maven-core/plugin-management.html). A local effective-model check with the same Maven 3.9.16 on Java 17 and 21 also selected identical versions. This is evidence of distribution-default drift, not of the JDK choosing plugins.

Attempt 1 failed before tests while resolving resources 3.5.0 from Central; attempt 2 used the same version successfully. That recovered resolution failure is separate from unpinned inputs. The logs do not establish its exact repository-side cause, and pinning cannot guarantee network or repository availability.

<!-- topic:ci-checks -->
## CI checks

Each Java 17/21 job starts with an isolated empty Maven repository, records the actual Maven/JDK with `--show-version`, runs verify, and checks executed plugins against the POM pins. It then verifies offline with the same cache; cold/warm inventories must match. Both JDKs check the same POM. Inventory-checker regressions and the 24 independent core checks in `scripts/test.sh` also run. The `core-build-inventory-jdk-*` artifacts retain logs and JSON inventories for 14 days, including failed logs.

Run locally with an existing Maven installation and a full JDK 17+:

```bash
python3 -m unittest discover -s scripts -p 'test_maven_build.py' -v
mvn --batch-mode --no-transfer-progress --show-version verify
bash scripts/test.sh
```

This covers only plugins executed by root verify. It does not pin Maven/JDK distributions, other lifecycles, or example hosts, and does not establish byte-for-byte reproducible JARs. Maven may still change with the runner, so its actual version is recorded.
