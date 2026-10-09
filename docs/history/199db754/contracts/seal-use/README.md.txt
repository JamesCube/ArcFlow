# Seal-use contract prototype evidence

Historical scope: this folder preserves the reviewed local contract checkpoint. The draft
runtime integration is documented separately in [Seal-use scenario](../../docs/SEAL_USE_SCENARIO.md);
its existence does not turn these pure tests into HTTP or browser acceptance evidence.

This folder contains field/codec/form/process contracts and tests only. It does not register
a scenario or add a runnable Seal page, HTTP host or storage migration. See
[scope and compatibility plan](CONTRACT.md) before interpreting the results.

The approved source baseline is main `3a4c9cc27b4bf1cee4343d9d7641c8e489d2a327`.
Existing application files are unchanged. Travel PR35 is not incorporated.

## Run the contract tests

From the repository root, with JDK 17+, Maven and a supported Node version:

```sh
mvn -f contracts/seal-use/java/pom.xml verify
node --test contracts/seal-use/js/*.test.mjs
```

The Java module depends on Jackson core and test-only JUnit; it has no Boot or approval-domain
dependency. The JS codec imports the approved main's strict JSON parser without changing it.
No server, database, browser or external business service is started by these commands.

## Deliverables

- [Business, identity, migration and integration specification](CONTRACT.md)
- [Unregistered form proposal](form-template.json)
- [Fixed two-stage process proposal](process-template.json)
- [Independent Java model and raw codec](java/src/main/java/com/arcflow/contracts/sealuse/)
- [JS business codec and raw form adapter](js/seal-use.mjs)
- [Deeply immutable form metadata](js/seal-use-form.mjs)
- [Shared Java/JS payload vectors](java/src/test/resources/seal-use-vectors.json)
- [Shared raw-input boundary policy](java/src/test/resources/seal-use-raw-input-policy.json)

Java evidence is under `java/evidence/`; JS commands/results/hashes are in `js/VERIFICATION.json`
and its test logs. Optional prototype comparison digests are off-wire test helpers, not a
signature, proof of document ownership or a replacement for application-scoped idempotency.

The proposed non-monetary view uses explicit `total: null`; copies must never be displayed as
money. Synthetic seal categories do not identify real seals or authorize physical stamping,
contract signing, uploads, borrowing/return or external delivery.

Passing these tests establishes the bounded contract behavior. Actual host authorization,
immutable workflow snapshots, durable retries, migrations, shared-renderer behavior and real
visual captures remain separate future implementation and acceptance work.
