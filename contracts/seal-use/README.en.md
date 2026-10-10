# Seal-use contract prototype evidence

<!-- Legacy fragments remain entry points after the language split. -->
<a id="deliverables"></a>
<a id="run-the-contract-tests"></a>

[简体中文](README.md)


<!-- topic:scope -->
This directory preserves an early local contract prototype based on `3a4c9cc27b4bf1cee4343d9d7641c8e489d2a327`, before the then-pending Travel PR35. Runtime integration was added separately; see the [current seal-use scenario](../../docs/SEAL_USE_SCENARIO.en.md). Pure prototype tests are not acceptance evidence for current hosts, storage or browsers.

The prototype contains fields, codecs, form/process contracts and tests only. It registers no runtime scenario, server or storage migration. Its comparison digests are offline test helpers, not signatures, ownership proofs or application idempotency keys.

<!-- topic:run -->
## Run the pure contract tests

From the repository root with JDK 17+, Maven and a supported Node version:

```sh
mvn -f contracts/seal-use/java/pom.xml verify
node --test contracts/seal-use/js/*.test.mjs
```

Java uses Jackson core and test-only JUnit, without Boot/domain dependencies. JS imports the strict JSON parser. These commands start no server, database, browser or external business service.

<!-- topic:artifacts -->
## Artifacts and boundaries

- [Original contract and integration plan](CONTRACT.en.md)
- [Unregistered form proposal](form-template.json), [fixed two-stage process](process-template.json)
- [Java model and raw codec](java/src/main/java/com/arcflow/contracts/sealuse/)
- [JS codec](js/seal-use.mjs), [immutable form metadata](js/seal-use-form.mjs)
- [Shared vectors](java/src/test/resources/seal-use-vectors.json), [raw-input policy](java/src/test/resources/seal-use-raw-input-policy.json)
- [Historical Java verification](java/evidence/VERIFICATION.en.md), plus `js/VERIFICATION.json` and test logs

The nonmonetary view uses explicit `total:null`; copy counts must never be shown as money. Synthetic categories identify no real seal and authorize no stamping, signing, upload, borrowing/return or external delivery. Passing prototype tests establishes that bounded contract only. Current identity, immutable workflows, durable retries, migration, shared rendering and real images require runtime-specific checks.
