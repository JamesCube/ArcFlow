# Local JavaScript seal-use contract proposal

These pure modules are not registered with the application. They do not render UI,
submit a request, fetch document references, apply seals, upload files, or persist data.

## APIs

- `emptySealUse()` creates a fresh editable business-shaped draft with numeric
  `copyCount: 1`. Required reference/text fields are empty and therefore invalid.
- `validateSealUse(value)` returns immutable issues `{path, code, message: {zh, en}}`.
  It captures each own enumerable data-descriptor value once into a fresh ordinary
  record, then validates that record. Extra fields and accessors reject; Proxy get
  traps cannot swap validated values before normalization. The form and outer
  submit-envelope paths use the same snapshot boundary.
- `normalizeSealUse(value)` validates original lengths, trims only U+0000–U+0020
  from title/reason/documentName edges, then returns a new frozen canonical snapshot.
- `serializeSealUse(value)` and `readSealUse(rawJson)` encode/decode the nine business
  keys. The raw reader rejects duplicate/escaped-alias keys, trailing content, and
  fraction/exponent numeric lexemes. It reuses the unchanged baseline strict parser.
- `emptySealUseForm()` creates a distinct form draft whose `copyCount` is text `'1'`.
  `validateSealUseForm()` and `normalizeSealUseForm()` validate/convert this shape.
  Validation never mutates the draft. Both valid and invalid raw input stay visible
  while editing; commit normalized numbers only on successful form submission.
- `copyCountFromInput(raw)` returns `{ok, value, issue}`. Raw input is capped at
  16 UTF-16 code units before ECMAScript `trim()`. ASCII digit strings representing
  1–100 succeed, including benign pasted edge whitespace and leading zeros. Empty,
  signed, decimal, exponent, Unicode-digit and partially parsed strings fail with
  `value: null`. Thus `' 02 '` can submit as numeric `2`, while `'2copies'` cannot.
  This null is an error result, not a valid business value or a suggested form reset.
- `sealUseSummary(value)` reports the real numeric count, localized count label and
  synthetic seal category. It contains no amount, currency, total or money field.
- `serializeSealUsePayload()`/`readSealUsePayload()` are optional, pure submit-envelope
  proposals for exact `{business, processVersion}` with integer processVersion
  1–2147483647. They do not implement or enable any endpoint.
- `sealUseFormProposal` is deeply frozen compiled metadata, exactly mirrored in
  `../form-template.json`. It explicitly declares proposal/unregistered/non-runnable.

The future response shape remains `{request, total: null}`. There is no response
history validator in this phase. Existing monetary validators are unchanged.
The proposed fields include an integer kind and `lineItems: null`, both requiring
separate shared-renderer work before any registration.

## Normalization and input boundaries

String limits count raw UTF-16 code units before normalization. JavaScript in-memory
numbers do not preserve whether their source was written as `1`, `1.0`, or `1e0`;
lexical checks therefore belong at `readSealUse()` on the original JSON string.
Do not pre-parse untrusted JSON with `JSON.parse` and expect the model validator to
recover discarded lexemes or duplicate keys.

The blank rule is the fixed Unicode White_Space set plus C0 and BOM. Nonblank Unicode
edge whitespace, combining sequences, interior control characters and lone UTF-16
surrogates are preserved. No Unicode normalization is applied. References are inert
ASCII strings and are not trimmed, dereferenced or checked for existence.

Both raw business readers enforce a shared 8,000,000-UTF-16-code-unit source cap.
Tests accept space-padded valid JSON at 7,999,999 and 8,000,000 units and reject
8,000,001 using the Java test resource's shared raw-input policy. The JS reader also
inherits the unchanged baseline parser's depth limit of 64.

`prototype-intent.mjs` is an isolated test-only canonical comparison aid. Its bytes
must not become a persisted fingerprint, signature, idempotency key or new protocol.
It does not establish authenticated actor/process scoping or durable retry behavior.

## Reproduce checks

Run from the repository root, with native Node (verified using v24.19.0):

```sh
node --test --test-reporter=tap contracts/seal-use/js/*.test.mjs
node --test --experimental-test-coverage --test-coverage-include='contracts/seal-use/js/*.mjs' --test-coverage-exclude='**/*.test.mjs' --test-reporter=tap contracts/seal-use/js/*.test.mjs
```

No packages or network are needed. Shared vectors are read from the independent Java
module's test resources. `cross-language.test.mjs` verifies those vectors in JS; the
Java module's own test run is required to establish the Java side.

Test logs and source hashes are retained beside these files. Coverage is restricted
to the three new proposal modules; it excludes the imported baseline parser and all
existing renderer/registry/host/store/workflow code. No mounted Vue, browser, HTTP,
authentication, persistence, migration, database or full-repository test is claimed.
