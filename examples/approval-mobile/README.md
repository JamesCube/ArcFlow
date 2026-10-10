# H5 移动审批客户端

<!-- Legacy fragments remain entry points after the language split. -->
<a id="arcflow-mobile-approval-client--移动审批"></a>
<a id="architecture--结构"></a>
<a id="current-local-integration--当前本地组合"></a>
<a id="dependency-note--依赖说明"></a>
<a id="run-locally--本地运行"></a>
<a id="scope--边界"></a>
<a id="verification--验证"></a>

[English](README.en.md)


<!-- topic:scope -->
适用范围：当前 uni-app Vue 3、H5 优先的客户端，连接独立 Spring 后端。先在桌面端发布流程、创建合成请假或采购，再在这里查看待办、明细、逐人历史和已办，填写意见并同意/驳回。它不提供手机发起或流程编辑，也没有验证 Android、iOS 或小程序构建。

普通浏览器使用实际演示账号与服务端结果，没有预置业务数据或假成功。飞书、企微、钉钉适配器仍未配置；对应 host 参数及未知 host 显示未配置页，绝不回退到演示身份。没有创建平台 OAuth、SDK、通知或企业应用。

<!-- topic:run -->
## 本地启动

需要 JDK 17+、Maven、符合 package.json 的 Node.js 与 npm。从仓库根目录：

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
read -rs -p 'Alice demo password: ' APPROVAL_ALICE_PASSWORD; echo
read -rs -p 'Bob demo password: ' APPROVAL_BOB_PASSWORD; echo
read -rs -p 'Carol demo password: ' APPROVAL_CAROL_PASSWORD; echo
export APPROVAL_ALICE_PASSWORD APPROVAL_BOB_PASSWORD APPROVAL_CAROL_PASSWORD
export APPROVAL_UI_ORIGIN='http://127.0.0.1:5174'
mvn -f examples/approval-demo/backend/pom.xml spring-boot:run
```

三个密码各至少 12 字符、至多 72 UTF-8 字节且互不相同。需要保留数据时设置私有绝对 `APPROVAL_DATA_FILE`。另开终端：

```sh
cd examples/approval-mobile
npm ci
npm run dev:h5
```

打开 `http://127.0.0.1:5174`。代理默认连接后端 8080，`ARCFLOW_BACKEND_PORT` 可更改。localhost 与 127.0.0.1 是不同 Origin；写入仍需 `X-Arcflow-Client: approval-demo`。

若先创建申请，可暂时在同一个 5174 端口运行桌面 UI：`npm run dev -- --port 5174`。创建后停掉桌面服务器，再启动 H5，不要同时占用端口。编译启动器使用上游 CI 模式关闭可选更新/使用报告和机器标识采集，应用统计关闭。

<!-- topic:behavior -->
## 会话、分页和决策

- Basic 凭据只在页面内存中；刷新须重新登录，但保留不透明 `?task=<id>` 深链。无默认密码或浏览器持久会话。
- 待办/已办分别使用成员分页及独立游标。已办表示实际决策，即使申请仍待其他成员审批。同一个人后续再次审批时可同时出现在两类列表。
- 详情来自兼容的可见申请列表，无单申请 GET。服务端保存的顺序/ALL/ANY 定义驱动只读显示；兼容 `approverId` 不是完整成员列表。
- 采购显示不可变品名、整数数量、精确价格、合计与币种，不添加附件、到期或租户字段。意见属于这次表决，不是独立聊天接口。
- 重复点击被抑制；确认绑定原申请/步骤/决策。不确定写入先查保存状态，旧意见不能流入下一步。身份切换、退出和更新的刷新令旧响应失效。

客户端使用原生 H5 button/input/textarea/label 包装保证键盘与标签行为；其他平台控件、传输和导航仍需实现。单租户示例的 404/权限测试不能证明租户隔离或生产 SSO。

<!-- topic:verify -->
## 验证和排错

在移动目录执行前三项，从仓库根目录执行后两项；HTTP 检查前须打包后端：

```sh
npm run typecheck
npm test
npm run build:h5
```

```sh
python3 examples/approval-mobile/scripts/verify-http.py
python3 examples/approval-mobile/scripts/verify-documents-http.py
```

检查使用隔离存储和临时密码，不能指向人员数据。登录失败检查匹配账号密码，403 写入检查 Origin，分页失败按原过滤条件重试，身份变化后不要复用旧游标。

`src/domain/api.ts` 负责允许端点与错误清理；`model.ts` 转为显示模型；`workspace.ts` 管理响应世代、确认和恢复；`src/platform/` 保存平台适配；`Workspace.vue` 提供单列任务视图、历史和安全区操作栏。

[验收记录](ACCEPTANCE.md)、[真实 HTTP 记录](HTTP_VERIFICATION.md)、[独立审阅](REVIEW.md)、[成员分页历史](MEMBER_INBOX_ADOPTION.md)保留旧版本结论，不替代当前 CI。上游编译依赖风险需按当前锁文件重新检查，历史审计数字不可当作实时结果。正式平台接入、真机、跨浏览器与生产安全仍需单独验收。
