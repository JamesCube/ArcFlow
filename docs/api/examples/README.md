# Executable HTTP examples / 可执行 HTTP 示例

[Developer docs / 开发文档](../../development/README.md) · [API reference / 接口参考](../API_REFERENCE.md)

These are complete request bodies for the standalone host on current `main`. All data is synthetic. They are not business writeback instructions or a production client SDK. / 这些文件是当前 `main` 独立宿主可接收的完整请求体，全部使用合成数据；它们不是业务回写指令或生产客户端 SDK。

## Run the verified examples / 运行已校验示例

From the repository root, build the actual Boot 4.1.1 backend, then run the standard-library Python verifier:

在仓库根目录构建实际 Boot 4.1.1 后端，再运行仅使用 Python 标准库的验证程序：

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml verify
python3 scripts/verify_developer_docs.py
python3 scripts/verify_api_examples.py \
  --jar examples/approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```

The verifier sends the first request for each bundled file as its original UTF-8 bytes, preserving numeric lexical rules. It starts its own loopback server with generated, in-memory passwords and a temporary data directory. It submits all nine business types, checks the six-entry catalog, publication conflicts, SINGLE/ALL/ANY decisions, all three conditional business facts, authorization, required/forbidden idempotency headers, exact replay, and restart recovery. It always stops its server and removes its temporary data. It does not connect to a running instance, RuoYi, MySQL, a CRM, or a payment service. Use `--java /absolute/path/to/java` to choose the runtime. This check does not replace the full Maven/UI/JDBC test suites.

验证程序把每个样例文件的首次请求按原始 UTF-8 字节发送，保留数字词法规则。它自行启动回环服务器，在内存中生成密码，并使用临时数据目录。它提交九种业务文档，核对六项场景目录、发布冲突、SINGLE/ALL/ANY 决策、三种条件业务事实、权限、幂等头的必需／禁止规则、原样重试和重启恢复。结束时始终停止自己的服务器并删除临时数据，不连接现有实例、若依、MySQL、CRM 或付款服务。可用 `--java /absolute/path/to/java` 指定运行时。此检查不能替代完整 Maven／UI／JDBC 测试集。

## Manual requests / 手工请求

Start a disposable local backend using the [quickstart](../../development/QUICKSTART.md). The JSON files use `processVersion: 1` and the publication examples use `expectedVersion: 1`; they assume a fresh store. Read the live process before use. If you previously published, review the new definition and deliberately update both relevant version fields. Reusing an old submission key with a changed version or payload is a conflict, not a retry.

先按[快速启动](../../development/QUICKSTART.md)启动临时本地后端。JSON 文件采用 `processVersion: 1`，发布示例采用 `expectedVersion: 1`，假设使用全新数据。使用前先读取当前流程；若已发布过，请审阅新定义，再有意识地调整相应版本。用旧提交键搭配改过的版本或请求体会冲突，不属于重试。

The commands below prompt for the locally configured Alice password. Do not put passwords in URLs, source files, shell history, or a committed HTTP client environment. Keep the original idempotency key and request file after an uncertain response. Headers are case-insensitive.

下列命令交互询问本地配置的 Alice 密码。不要把密码写入 URL、源码、Shell 历史或提交到仓库的 HTTP 客户端环境。响应不确定时，请保留原幂等键和原请求文件。HTTP 头名称不区分大小写。

```sh
# Run from the repository root. curl --user alice prompts for the password.
BASE=http://127.0.0.1:8080
curl --fail-with-body --user alice "$BASE/api/me"
curl --fail-with-body --user alice "$BASE/api/process"
curl --fail-with-body --user alice "$BASE/api/scenarios"

# A typed leave submission. 201 returns the complete request.
curl --fail-with-body --user alice \
  -H 'Content-Type: application/json' \
  -H 'X-Arcflow-Client: approval-demo' \
  -H 'Idempotency-Key: docs-manual-leave-001' \
  --data-binary @docs/api/examples/leave.json "$BASE/api/documents"

# List already includes saved business fields, definition, routing (if any), and history.
curl --fail-with-body --user alice "$BASE/api/requests"

# Replace REQUEST_ID and STEP_ID with values returned above; Bob must be assigned now.
curl --fail-with-body --user bob \
  -H 'Content-Type: application/json' -H 'X-Arcflow-Client: approval-demo' \
  --data-binary '{"stepId":"STEP_ID","decision":"APPROVE","comment":"Synthetic review"}' \
  "$BASE/api/requests/REQUEST_ID/decisions"
```

There is no separate single-request GET endpoint. Scenario/quote submissions return a `request` wrapper; use `response.request.id` and that host's decision path. Generic submissions return the request directly; use `response.id`. Never send returned summaries, history, actor IDs, or routing decisions back as submission fields.

没有独立的单条申请 GET 接口。场景／报价提交响应含 `request` 包装，使用 `response.request.id` 和对应宿主的决策路径；通用提交直接返回申请，使用 `response.id`。不要把响应中的摘要、历史、身份或路由计算结果作为提交字段回传。

## Payload and route map / 请求体与路由

All rows use `POST`, JSON, authenticated Alice, and `X-Arcflow-Client: approval-demo`. A supplied Origin must equal the configured UI origin; command-line requests may omit it. For generic submissions the key is optional but strongly recommended for a known retry intent; scenarios require exactly one key; quote submissions forbid it and bind by quote revision instead.

所有行均使用 `POST`、JSON、Alice 身份及 `X-Arcflow-Client: approval-demo`。若提供 Origin，必须与配置的界面来源相同；命令行可以不提供。通用提交的键可选，建议为了确定的重试意图保留；六场景必需且只能提供一个；报价禁止该头，改用报价版本绑定。

| File / 文件 | Path / 路径 | Idempotency-Key / 幂等键 |
| --- | --- | --- |
| [legacy-leave.json](legacy-leave.json) | `/api/requests` | Optional / 可选 |
| [leave.json](leave.json) | `/api/documents` | Optional / 可选 |
| [procurement.json](procurement.json) | `/api/documents` | Optional / 可选 |
| [quote-discount.json](quote-discount.json) | `/api/crm/documents` | Forbidden / 禁止 |
| [expense.json](expense.json) | `/api/scenarios/oa-expense/documents` | Required / 必需 |
| [travel.json](travel.json) | `/api/scenarios/oa-travel/documents` | Required / 必需 |
| [seal-use.json](seal-use.json) | `/api/scenarios/oa-seal-use/documents` | Required / 必需 |
| [receiving.json](receiving.json) | `/api/scenarios/erp-receiving/documents` | Required / 必需 |
| [payment.json](payment.json) | `/api/scenarios/erp-payment/documents` | Required / 必需 |
| [contract.json](contract.json) | `/api/scenarios/crm-contract/documents` | Required / 必需 |
| [publish-all.json](publish-all.json) | `/api/process` | Not used / 不使用 |
| [publish-payment-routing.json](publish-payment-routing.json) | `/api/scenarios/erp-payment/process` | Not used / 不使用 |

For example, substitute the path and JSON file in the curl command above. For quote, omit the entire Idempotency-Key header; first read `/api/crm/quotes` and verify the snapshot values. The bundled quote matches the synthetic preset `Q-DEMO-001`, revision 1. A publisher must be Alice; process publication increments the version and is not retry-idempotent. The group publication uses schema 3; the payment rule uses schema 4. Other conditional predicates are documented in [the API reference](../API_REFERENCE.md) and [routing contract](../../CONDITIONAL_ROUTING.md).

例如将上方 curl 命令的路径和 JSON 文件替换为表中值。报价必须删除整个 Idempotency-Key 头；先读取 `/api/crm/quotes` 并核对源快照。附带报价匹配合成预设 `Q-DEMO-001` 第 1 版。发布者必须为 Alice；发布会递增版本，不能原样幂等重放。人员组发布使用定义 schema 3，付款条件使用 schema 4。其他条件谓词见[接口参考](../API_REFERENCE.md)和[路由契约](../../CONDITIONAL_ROUTING.md)。

RuoYi uses its own token, permissions, response envelope, and `/arcflow` paths. These Basic-auth commands must not be sent unchanged to RuoYi. See [native host differences](../API_REFERENCE.md#ruoyi-native-host).

若依使用自己的 token、权限、响应包装和 `/arcflow` 路径，不能直接套用以上 Basic-auth 命令。见[原生宿主差异](../API_REFERENCE.md#ruoyi-native-host)。
