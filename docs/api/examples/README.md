# 可执行 HTTP 示例

<!-- Legacy fragments remain entry points after the language split. -->
<a id="executable-http-examples--可执行-http-示例"></a>
<a id="manual-requests--手工请求"></a>
<a id="payload-and-route-map--请求体与路由"></a>
<a id="run-the-verified-examples--运行已校验示例"></a>

[简体中文](./README.md) · [English](./README.en.md) · [开发文档](../../development/README.md) · [接口参考](../API_REFERENCE.md)

这些文件是独立宿主可接收的完整请求体，全部使用合成数据；它们不是业务回写指令或生产客户端 SDK。中英文指南共用本目录的原始 JSON 文件，避免翻译改动可执行数据或数字词法形式。

静态契约分别见[独立宿主 OpenAPI](../openapi/standalone.openapi.json)和[若依 OpenAPI](../openapi/ruoyi.openapi.json)。它们描述现有控制器，不提供运行时 Swagger 端点；若依也不能直接使用下面的独立宿主认证命令。

<!-- topic:verify -->

## 运行已校验示例

在仓库根目录先运行离线契约检查，再构建实际 Spring Boot 4.1.1 后端，并运行仅使用 Python 标准库的 HTTP 验证程序：

```sh
python3 scripts/check_api_contract.py
python3 scripts/verify_developer_docs.py
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml verify
python3 scripts/verify_api_examples.py \
  --jar examples/approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```

离线检查用于发现控制器映射、静态契约及示例之间的漂移，不替代真实 HTTP 校验。

HTTP 验证程序把每个样例文件的首次请求按原始 UTF-8 字节发送，保留数字词法规则。它自行启动回环服务器，在内存中生成密码，并使用临时数据目录。它提交九种业务文档，核对六项场景目录、发布冲突、SINGLE/ALL/ANY 决策、三种条件业务事实、权限、幂等头的必需／禁止规则、原样重试和重启恢复。结束时始终停止自己的服务器并删除临时数据，不连接现有实例、若依、MySQL、CRM 或付款服务。可用 `--java /absolute/path/to/java` 指定运行时。此检查不能替代完整 Maven／UI／JDBC 测试集。

<!-- topic:manual-requests -->

## 手工请求

先按[快速启动](../../development/QUICKSTART.md)启动临时本地后端。JSON 文件采用 `processVersion: 1`，发布示例采用 `expectedVersion: 1`，假设使用全新数据。使用前先读取当前流程；若已发布过，请审阅新定义，再有意识地调整相应版本。用旧提交键搭配改过的版本或请求体会冲突，不属于重试。

下列命令交互询问本地配置的 Alice 密码。不要把密码写入 URL、源码、Shell 历史或提交到仓库的 HTTP 客户端环境。响应不确定时，请保留原幂等键和原请求文件。HTTP 头名称不区分大小写。

```sh
# 在仓库根目录运行；curl --user alice 会交互询问密码。
BASE=http://127.0.0.1:8080
curl --fail-with-body --user alice "$BASE/api/me"
curl --fail-with-body --user alice "$BASE/api/process"
curl --fail-with-body --user alice "$BASE/api/scenarios"

# 提交类型化请假单；201 响应直接返回完整申请。
curl --fail-with-body --user alice \
  -H 'Content-Type: application/json' \
  -H 'X-Arcflow-Client: approval-demo' \
  -H 'Idempotency-Key: docs-manual-leave-001' \
  --data-binary @docs/api/examples/leave.json "$BASE/api/documents"

# 列表已包含业务字段、流程定义、适用时的冻结路由以及历史。
curl --fail-with-body --user alice "$BASE/api/requests"

# 用上方返回值替换 REQUEST_ID 和 STEP_ID；Bob 必须是当前阶段的指定审批人。
curl --fail-with-body --user bob \
  -H 'Content-Type: application/json' -H 'X-Arcflow-Client: approval-demo' \
  --data-binary '{"stepId":"STEP_ID","decision":"APPROVE","comment":"Synthetic review"}' \
  "$BASE/api/requests/REQUEST_ID/decisions"
```

没有独立的单条申请 GET 接口。场景／报价提交响应含 `request` 包装，使用 `response.request.id` 和对应宿主的决策路径；通用提交直接返回申请，使用 `response.id`。不要把响应中的摘要、历史、身份或路由计算结果作为提交字段回传。

<!-- topic:payload-routes -->

## 请求体与路由

所有行均使用 `POST`、JSON、Alice 身份及 `X-Arcflow-Client: approval-demo`。若提供 `Origin`，必须与配置的界面来源相同；命令行可以不提供。通用提交的幂等键可选，建议为安全重试保留；六场景必需且只能提供一个；报价禁止该头，改用报价版本绑定。

| 文件 | 路径 | `Idempotency-Key` |
| --- | --- | --- |
| [legacy-leave.json](legacy-leave.json) | `/api/requests` | 可选 |
| [leave.json](leave.json) | `/api/documents` | 可选 |
| [procurement.json](procurement.json) | `/api/documents` | 可选 |
| [quote-discount.json](quote-discount.json) | `/api/crm/documents` | 禁止 |
| [expense.json](expense.json) | `/api/scenarios/oa-expense/documents` | 必需 |
| [travel.json](travel.json) | `/api/scenarios/oa-travel/documents` | 必需 |
| [seal-use.json](seal-use.json) | `/api/scenarios/oa-seal-use/documents` | 必需 |
| [receiving.json](receiving.json) | `/api/scenarios/erp-receiving/documents` | 必需 |
| [payment.json](payment.json) | `/api/scenarios/erp-payment/documents` | 必需 |
| [contract.json](contract.json) | `/api/scenarios/crm-contract/documents` | 必需 |
| [publish-all.json](publish-all.json) | `/api/process` | 不使用 |
| [publish-payment-routing.json](publish-payment-routing.json) | `/api/scenarios/erp-payment/process` | 不使用 |

例如，将上方 curl 命令的路径和 JSON 文件替换为表中值。报价必须删除整个 `Idempotency-Key` 头；先读取 `/api/crm/quotes` 并核对源快照。附带报价匹配合成预设 `Q-DEMO-001` 第 1 版。源版本字段是 `QuoteVersion.revision`，提交字段是 `business.quoteRevision`；报价提交响应视图没有独立的 `revision` 字段。

发布者必须为 Alice；发布会递增版本，不能原样幂等重放。人员组发布使用流程结构版本 3，付款条件使用版本 4。其他条件谓词见[接口参考](../API_REFERENCE.md)和[路由契约](../../CONDITIONAL_ROUTING.md)。

若依使用自己的令牌、权限、响应包装和 `/arcflow` 路径，不能直接套用以上 Basic 认证命令。见[原生宿主差异](../API_REFERENCE.md#ruoyi-native-host)。
