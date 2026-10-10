# Executable HTTP examples

<!-- Legacy fragments remain entry points after the language split. -->
<a id="executable-http-examples--可执行-http-示例"></a>
<a id="manual-requests--手工请求"></a>
<a id="payload-and-route-map--请求体与路由"></a>
<a id="run-the-verified-examples--运行已校验示例"></a>

[简体中文](./README.md) · [English](./README.en.md) · [Developer guide](../../development/README.en.md) · [API reference](../API_REFERENCE.en.md)

These files are complete request bodies accepted by the standalone host. All data is synthetic. They are not business writeback instructions or a production client SDK. Both language guides share the original JSON files in this directory so that translation does not change executable data or numeric token forms.

See the static [standalone OpenAPI contract](../openapi/standalone.openapi.json) and [RuoYi OpenAPI contract](../openapi/ruoyi.openapi.json). These describe existing Controllers rather than exposing runtime Swagger endpoints. The standalone authentication commands below cannot be used unchanged with RuoYi.

<!-- topic:verify -->

## Run the verified examples

From the repository root, run offline contract checks, build the actual Spring Boot 4.1.1 backend, then run the standard-library Python HTTP verifier:

```sh
python3 scripts/check_api_contract.py
python3 scripts/verify_developer_docs.py
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml verify
python3 scripts/verify_api_examples.py \
  --jar examples/approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```

The offline check detects drift between Controller mappings, static contracts and examples. It does not replace real-HTTP verification.

The HTTP verifier sends the first request for each bundled file as its original UTF-8 bytes, preserving numeric lexical rules. It starts its own loopback server with generated, in-memory passwords and a temporary data directory. It submits all nine business types, checks the six-entry catalog, publication conflicts, SINGLE/ALL/ANY decisions, all three conditional business facts, authorization, required/forbidden idempotency headers, exact replay, and restart recovery. It always stops its server and removes its temporary data. It does not connect to a running instance, RuoYi, MySQL, a CRM, or a payment service. Use `--java /absolute/path/to/java` to choose the runtime. This check does not replace the full Maven/UI/JDBC test suites.

<!-- topic:manual-requests -->

## Manual requests

Start a disposable local backend using the [quickstart](../../development/QUICKSTART.en.md). The JSON files use `processVersion: 1` and the publication examples use `expectedVersion: 1`; they assume a fresh store. Read the live process before use. If you previously published, review the new definition and deliberately update both relevant version fields. Reusing an old submission key with a changed version or payload is a conflict, not a retry.

The commands below prompt for the locally configured Alice password. Do not put passwords in URLs, source files, shell history, or a committed HTTP client environment. Keep the original idempotency key and request file after an uncertain response. Headers are case-insensitive.

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

# The list includes saved business fields, definition, routing (if any), and history.
curl --fail-with-body --user alice "$BASE/api/requests"

# Replace REQUEST_ID and STEP_ID with values returned above; Bob must be assigned now.
curl --fail-with-body --user bob \
  -H 'Content-Type: application/json' -H 'X-Arcflow-Client: approval-demo' \
  --data-binary '{"stepId":"STEP_ID","decision":"APPROVE","comment":"Synthetic review"}' \
  "$BASE/api/requests/REQUEST_ID/decisions"
```

There is no separate single-request GET endpoint. Scenario/quote submissions return a `request` wrapper; use `response.request.id` and that host's decision path. Generic submissions return the request directly; use `response.id`. Never send returned summaries, history, actor IDs, or routing decisions back as submission fields.

<!-- topic:payload-routes -->

## Payload and route map

All rows use `POST`, JSON, authenticated Alice, and `X-Arcflow-Client: approval-demo`. A supplied `Origin` must equal the configured UI origin; command-line requests may omit it. Generic submission keys are optional but strongly recommended for safe retries; scenarios require exactly one key; quote submissions forbid it and bind by quote revision instead.

| File | Path | `Idempotency-Key` |
| --- | --- | --- |
| [legacy-leave.json](legacy-leave.json) | `/api/requests` | Optional |
| [leave.json](leave.json) | `/api/documents` | Optional |
| [procurement.json](procurement.json) | `/api/documents` | Optional |
| [quote-discount.json](quote-discount.json) | `/api/crm/documents` | Forbidden |
| [expense.json](expense.json) | `/api/scenarios/oa-expense/documents` | Required |
| [travel.json](travel.json) | `/api/scenarios/oa-travel/documents` | Required |
| [seal-use.json](seal-use.json) | `/api/scenarios/oa-seal-use/documents` | Required |
| [receiving.json](receiving.json) | `/api/scenarios/erp-receiving/documents` | Required |
| [payment.json](payment.json) | `/api/scenarios/erp-payment/documents` | Required |
| [contract.json](contract.json) | `/api/scenarios/crm-contract/documents` | Required |
| [publish-all.json](publish-all.json) | `/api/process` | Not used |
| [publish-payment-routing.json](publish-payment-routing.json) | `/api/scenarios/erp-payment/process` | Not used |

Substitute the path and JSON file in the curl command above. For quote submission, omit the entire `Idempotency-Key` header; first read `/api/crm/quotes` and verify the snapshot values. The bundled quote matches synthetic preset `Q-DEMO-001`, revision 1. The source field is `QuoteVersion.revision`, and the submission field is `business.quoteRevision`; the quote submission response view has no separate `revision` field.

The publisher must be Alice; publication increments the version and is not retry-idempotent. Group publication uses process schema 3; the payment rule uses schema 4. Other conditional predicates are documented in the [API reference](../API_REFERENCE.en.md) and [routing contract](../../CONDITIONAL_ROUTING.en.md).

RuoYi uses its own token, permissions, response envelope, and `/arcflow` paths. These Basic-auth commands must not be sent unchanged to RuoYi. See [native host differences](../API_REFERENCE.en.md#ruoyi-native-host).
