# 用印契约原型证据

<!-- Legacy fragments remain entry points after the language split. -->
<a id="deliverables"></a>
<a id="run-the-contract-tests"></a>
<a id="seal-use-contract-prototype-evidence"></a>

[English](README.en.md)


<!-- topic:scope -->
此目录保留早期本地契约原型，原基线 `3a4c9cc27b4bf1cee4343d9d7641c8e489d2a327`，未含当时的 Travel PR35。当前运行时已经另行集成，见[用印场景](../../docs/SEAL_USE_SCENARIO.md)。不要把此目录的纯测试当作当前宿主、存储或浏览器通过证据。

原型仅含字段、codec、表单、流程契约及测试，不注册运行场景，也不提供服务端或存储迁移。其内容保持独立；比较摘要是离线测试 helper，不是签名、所有权证明或应用幂等键。

<!-- topic:run -->
## 运行纯契约测试

从仓库根目录，使用 JDK 17+、Maven 和受支持 Node：

```sh
mvn -f contracts/seal-use/java/pom.xml verify
node --test contracts/seal-use/js/*.test.mjs
```

Java 仅依赖 Jackson core 和测试 JUnit，不依赖 Boot/domain。JS 引用严格 JSON parser。命令不启动服务器、数据库、浏览器或外部业务服务。

<!-- topic:artifacts -->
## 内容与边界

- [原契约与集成计划](CONTRACT.md)
- [未注册表单提案](form-template.json)、[固定两步流程](process-template.json)
- [Java 模型与原始 codec](java/src/main/java/com/arcflow/contracts/sealuse/)
- [JS codec](js/seal-use.mjs)、[不可变表单元数据](js/seal-use-form.mjs)
- [共享向量](java/src/test/resources/seal-use-vectors.json)、[原始输入策略](java/src/test/resources/seal-use-raw-input-policy.json)
- [Java 历史验证](java/evidence/VERIFICATION.md)、JS 的 `js/VERIFICATION.json` 与测试日志

非金额视图明确 `total:null`，不能把份数显示为金额。合成印章类别不代表真实印章，不授权盖章、签约、上传、借还或外部投递。通过原型测试只证明其契约；当前身份、不可变流程、持久重试、迁移、共享渲染和真实截图需按运行时另验。
