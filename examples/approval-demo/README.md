# 本地审批演示

<!-- Legacy fragments remain entry points after the language split. -->
<a id="architecture-and-limits"></a>
<a id="local-human-approval-demo"></a>
<a id="run"></a>
<a id="verify"></a>

[English](README.en.md)


<!-- topic:scope -->
适用范围：当前源码，Java 工件版本 `0.1.0-SNAPSHOT`。此示例使用独立 Spring Boot 后端和 Vue 界面，演示发起、逐步审批、分组表决和不可变历史。仅在 localhost 使用合成数据，不适合直接公开部署。

<!-- topic:run -->
## 启动并完成一次审批

需要完整 JDK 17+、Maven 3.9+、符合前端 package.json 的 Node.js 和 npm。推荐先照[开发环境](../../docs/development/QUICKSTART.md)启动；下面命令从仓库根目录运行。

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
read -rs -p 'Alice demo password: ' APPROVAL_ALICE_PASSWORD; echo
read -rs -p 'Bob demo password: ' APPROVAL_BOB_PASSWORD; echo
read -rs -p 'Carol demo password: ' APPROVAL_CAROL_PASSWORD; echo
export APPROVAL_ALICE_PASSWORD APPROVAL_BOB_PASSWORD APPROVAL_CAROL_PASSWORD
mvn -f examples/approval-demo/backend/pom.xml spring-boot:run
```

三个本地演示密码必须不同，每个至少 12 个字符、至多 72 个 UTF-8 字节。另开终端：

```sh
cd examples/approval-ui
npm ci
npm run dev
```

打开 `http://localhost:5173`：

1. Alice 登录，创建 Bob → Carol 的两个审批步骤并发布。
2. Alice 提交合成请假或采购申请。
3. Bob 登录并同意。预期申请仍为待审批，当前步骤转到 Carol。
4. Carol 同意或驳回。Alice 重新查看，预期看到最终结果与逐人记录。
5. 发布不同流程，查看已有申请。预期它保留提交时的流程与业务快照。

后端监听 `127.0.0.1:8080`。前端通过 Vite 将 `/api` 代理到后端；不要把演示服务改为公网监听。

<!-- topic:boundaries -->
## 身份、流程与存储

- Alice 可发布流程；Bob、Carol 可读取自己参与的已选路线上的申请（包括未来和已处理步骤），但只能在当前合格步骤表决。申请人出现在流程任一步骤时，提交会被拒绝。
- 通用工作区支持顺序 SINGLE/ALL/ANY；条件路由只在[付款、收货、合同专用场景](../../docs/CONDITIONAL_ROUTING.md)提供。流程不支持任意图或 BPMN。
- ArcFlow 内核同步执行校验 DAG，不等待人工；人工审批状态由共享领域层负责。
- 发布带预期版本。已有申请不受后来发布影响；浏览器草稿仅在内存中，刷新整页或退出会丢失。
- 提交响应不确定时保留原键、原内容和流程版本。不要直接新建另一个申请；先查列表或按[幂等契约](../../docs/SUBMISSION_IDEMPOTENCY.md)重试。
- 默认 JSON 为本地单写者存储。使用稳定私有数据路径才能正常重启恢复；版本升级和回退以[存储迁移](../../docs/development/PERSISTENCE.md)为准。此机制不提供多租户、分布式事务或备份运维。

<!-- topic:verify -->
## 验证与排错

```sh
mvn verify
bash scripts/test.sh
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml verify
(cd examples/approval-ui && npm ci && npm test && npm run build)
```

认证失败先检查密码环境变量；写入被拒绝时检查允许的 Origin 和 `X-Arcflow-Client`；发布冲突先刷新，保留草稿后重新应用。目录缺少写权限、数据损坏或不兼容版本时，应停止并按迁移说明恢复，不能以空数据覆盖。

代码构建通过不代表浏览器或真实数据库通过。检查目标提交的 CI，再看[后端](backend/README.md)、[界面](../approval-ui/README.md)和[接口参考](../../docs/api/API_REFERENCE.md)。
