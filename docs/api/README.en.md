# HTTP API contracts

[简体中文](README.md) · [English](README.en.md) · [Developer guide](../development/README.en.md)

This directory describes the HTTP hosts actually implemented in this repository. The Java core does not provide an HTTP server. These static files add no login, detail-read, Swagger UI or `/v3/api-docs` endpoint.

<!-- topic:navigation -->

## Choose a starting point

- Call the API and understand authorization/retries: [API reference](API_REFERENCE.en.md)
- Run complete requests: [executable examples](examples/README.en.md), comprising 16 synthetic request files
- Import into OpenAPI 3.1-compatible tools: [standalone host](openapi/standalone.openapi.json), [RuoYi host](openapi/ruoyi.openapi.json)
- Inspect reusable models: [JSON Schema](openapi/schemas.json), covering commands, responses, errors, nine business types, processes and finite conditions
- Compare controllers: [30-route inventory](endpoint-inventory.json)

The standalone contract has 21 operations across generic approval, six scenarios and the dedicated quote example. RuoYi has 9 operations and uses native identity, permissions and envelopes. The literal seal-use path and parameterized scenario path are two real handlers; do not merge their counts. Both contracts share models, but their authentication, status codes and response shapes are not interchangeable.

<!-- topic:format-scope -->

## Format and scope

The artifacts use [OpenAPI 3.1.0](https://spec.openapis.org/oas/v3.1.0.html) and [JSON Schema 2020-12](https://json-schema.org/draft/2020-12). Machine artifacts have one canonical copy, with protocol identifiers and descriptions in English; narrative Chinese and English documentation is maintained separately. References are repository-relative. Preserve the complete `openapi` directory and adjacent `examples` directory when importing into a tool rather than copying one isolated file.

- Models distinguish commands from results. Identity, history, summaries, derived totals and frozen routing are not submission fields.
- `runIf` supports only expense total, payment net total, receiving rejection flag and contract terms kind. It does not execute expressions or scripts.
- JSON Schema describes structure. Live identity, versioning, concurrency, quote-source checks and exact cross-field rules still belong to the domain and host.
- Java UTF-16 lengths, integer lexemes, `BigDecimal` scale and blank-text rules are documented through `x-*` extensions. General-purpose OpenAPI tools may ignore them; structural validation does not guarantee server acceptance.
- Controlled standalone errors use `{message}`; controlled native errors use AjaxResult `code/msg`. Host authentication failures and unhandled exceptions retain unspecified default responses. A universal error envelope is not promised.

<!-- topic:offline-checks -->

## Offline checks

Run from the repository root. Only the Python standard library is required:

```sh
python3 scripts/check_api_contract.py
python3 scripts/test_api_contract.py
python3 scripts/verify_developer_docs.py
```

The checker compares real controllers with the inventory and OpenAPI paths/methods/handlers/return types/success statuses, native permissions, required headers, request/response wrappers, JSON references, Java record fields, business types, registered scenarios and condition families. It validates all 16 request examples while preserving numeric lexemes and checks implemented cross-field invariants. Negative tests deliberately mutate source, contracts or examples to prove invalid changes fail.

This is a fail-closed checker for the schema keywords used here, not a general OpenAPI or JSON Schema validator. Add validation and tests when introducing another structural keyword; do not rely on ignored keywords. It starts no server and does not establish authentication, persistence or complete runtime coverage. Also run the [real HTTP example verifier](examples/README.en.md#run-the-verified-examples) and full test suites.

<!-- topic:change-workflow -->

## Change workflow

1. Review controllers, DTOs, domain validation and host security first, including compatibility and migration consequences.
2. Update both narrative references, the applicable OpenAPI host contract, shared models, examples and relevant tests together.
3. Run offline checks and actual HTTP verification. Never invent a route or relax runtime validation merely to satisfy documentation.
4. The [behavior review manifest](openapi/source-contract.json) records token-level digests of 18 relevant Java sources, ignoring comments and whitespace. Semantic changes fail the gate and require reviewing behavior that structural checks cannot prove. Update a digest only after reviewing the contract and tests; this manifest does not generate implementation and must not be refreshed just to silence a failure.
5. For deliberate route changes, review first, then use the existing `python3 scripts/verify_developer_docs.py --write-inventory` to update the inventory, and revise operation counts and regression tests. CI never refreshes it automatically.
