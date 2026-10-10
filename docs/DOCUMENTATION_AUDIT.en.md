# Documentation audit and migration

[简体中文](DOCUMENTATION_AUDIT.md)

<!-- topic:baseline -->
## Audited source

This restructuring starts from main `199db7548f6faba5dfef105eaaf7311972adb388`, tree `8dbfcf3392478be422671f596f449bf0b3c6d1e6`. The tree was compared before editing. It contained 64 Markdown files and only two English companion files: the repository README and API reference.

Four language patterns coexisted: full Chinese/English blocks, interleaved paragraphs, Chinese-only pages and English-only pages. Navigation mixed setup, design rationale, API fields and historical implementation evidence. Some module guides still called merged features candidates or described four scenarios while the current catalog contained six. An English site link also led to a mixed-language developer page.

<!-- topic:decisions -->
## Structural decisions

- Preserve original `.md` paths for Chinese; add `.en.md` companions. Existing paths and heading fragments remain entry points. Do not stack two translations on one maintained page.
- Use task-based indexes for tutorials, how-to guides, explanations and references. Keep historical evidence clearly separate rather than moving every existing path and breaking links.
- Treat the application artifact version, process schema, file wrapper, SQL revision, release tag and evidence commit as different concepts. Current source is not a promise about an older tag.
- Consolidate module introductions around runnable steps and boundaries. Preserve replaced source bytes in the [history archive](history/README.en.md), with provenance and SHA-256. Historical source artifacts retain their original language; their localized entry pages have equal scope and access.
- Reuse actual controller, DTO, catalog and test contracts. Publish offline OpenAPI 3.1 for standalone and RuoYi separately; no server route or Swagger UI is implied.

<!-- topic:api -->
## Interface scope

The baseline has 30 controller handlers: 21 standalone, including the exact raw seal-use handler, and 9 RuoYi handlers. The domain has nine business document types; six compiled scenarios have their own namespaces. Restricted runIf belongs only to payment, receiving and contract. Generic leave/procurement and dedicated quotes keep their existing boundaries.

Host security, response envelopes, request fields, errors, idempotency and examples are recorded in the [API index](api/README.en.md). No single-request GET, ArcFlow login route or HTTP revision field is invented. Operational authentication/session behavior inherited from RuoYi is described as host-owned.

<!-- topic:gates -->
## Maintenance gates

The registry inventories every maintained Markdown pair, its category and stable topic coverage. CI rejects a missing companion, missing/duplicate topic, unregistered page, broken local link/fragment, English navigation to a Chinese companion, or changed historical source bytes. The API gate compares actual handlers, document types, catalog entries, condition families and validated JSON examples; negative tests prove common drift is rejected.

These gates verify structure and selected executable contracts, not translation quality or every possible runtime invariant. Human review still checks wording and semantic parity. External URL availability is not asserted by offline link checks. Real HTTP examples run against a freshly packaged disposable backend; browser and real-database results must come from their own exact-commit jobs. A local launch failure or skipped database suite must remain visible in the delivery report.

See the [documentation standard](DOCUMENTATION_STANDARD.en.md) for contribution rules and the [categorized index](README.en.md) for reading paths.
