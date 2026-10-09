# Local-only Java seal-use contract verification

## Scope

This independent Maven module is a contract prototype. It is not a subtype of the runtime `BusinessDocument`, not a registered scenario, and not a server, workflow, store, upload, signature, or stamping integration. It has no parent POM or approval-domain dependency. The root POM and the existing 384 tracked baseline files were not modified by this work. No repository publication, dependency installation, Library upload, or external action was performed.

- Build target: Java 17.
- Runtime dependency: cached Jackson core 2.21.4 only.
- Test dependency: cached JUnit Jupiter 5.11.4.
- Build plugins: explicitly pinned resources 3.4.0, compiler 3.13.0, surefire 3.5.2 and jar 3.5.0.
- `jdeps` confirms only `java.base` and Jackson core are runtime dependencies. The first diagnostic invocation omitted the required multi-release selector; the corrected `--multi-release 17` invocation passed.

## Verification actually run

From the copied repository root:

```sh
/workspace/scratch/98f00718cf29/expense-recovery/mvn -f contracts/seal-use/java/pom.xml verify
```

The supplied wrapper uses JDK 17, Maven 3.9.16 and the cached expense-recovery Maven repository with offline mode enabled. It did not resolve or load the locally installed approval-domain artifact.

Result: **452 tests passed, 0 failures, 0 errors, 0 skips.** This comprises 382 codec/record tests, five raw-source-limit checks and 65 shared fixture vectors (16 valid, 49 invalid). One test additionally exercises round-trip preservation of every one of the 65,536 UTF-16 code units as interior text. Logs are retained beside this file. No Java line or branch coverage percentage was measured.

Covered boundaries include exact required keys, missing and null fields, unknown derived/host/action fields, string type coercion, strict enum/type/version matching, duplicate and escaped-alias duplicate keys, trailing tokens, nonstandard JSON syntax, count integer lexemes and overflow, references, raw UTF-16 lengths, C0 edge trim, all fixed blank-code-point cases, immutable record shape, canonical encoding, and equivalent versus changed intent comparison.

Shared vectors are at `src/test/resources/seal-use-vectors.json`; the separate JavaScript prototype can read the same file. The tiny `src/test/resources/seal-use-raw-input-policy.json` additionally specifies padded source boundaries of 7,999,999 and 8,000,000 accepted units and 8,000,001 rejected units. Tests create padding in memory; no giant fixture is stored. A supplementary-character case checks UTF-16 code-unit counting rather than code-point counting. All samples are synthetic. This module's own verification does not claim that JavaScript tests were run.

## Exact contract

Canonical key order is `type`, `documentVersion`, `businessId`, `title`, `reason`, `documentName`, `documentRef`, `sealType`, `copyCount`. All are required; no additional business key is allowed. Raw JSON source strings are capped at 8,000,000 UTF-16 code units before parsing, matching the existing standalone JavaScript parser. Null input is rejected before reading its length. `type` is exactly `sealUse`; `documentVersion` is the integer JSON lexeme `1`.

- `businessId` and `documentRef`: unchanged strings matching `[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}`. No trimming. A URL-shaped string that matches this alphabet remains an inert reference; it is never fetched, opened or executed. Action/URL/signature fields themselves are rejected as unknown.
- `title`, `reason`, `documentName`: maximum raw UTF-16 code-unit lengths 120, 2000 and 160, checked before normalization. Edge trim removes only U+0000 through U+0020. Reject a normalized string that consists entirely of C0 characters, the fixed Unicode White_Space set, and/or U+FEFF. Other content, including nonblank Unicode edge characters, interior C0, and UTF-16 surrogate code units, is preserved. There is no NFC normalization or case folding.
- Future form label for `reason`: business purpose. There is no duplicate `purpose` field.
- `sealType`: exactly `OFFICIAL`, `CONTRACT` or `FINANCE`. These are synthetic choices and identify no real seal.
- `copyCount`: strict integer JSON lexeme 1 through 100. Null, boolean, string, fraction, exponent, leading-zero, signed-positive, negative, zero, overflow and over-limit values are rejected.

Canonical string escaping matches JavaScript `JSON.stringify`: ordinary Unicode is retained, control-code escapes use lowercase hex, and lone UTF-16 surrogates are escaped without data loss.

## Local comparison helper

Record equality compares normalized business values. `SealUseCodec.intentFingerprint` is an off-wire, local prototype/test comparison helper only. It is not a signature, source identity, idempotency key, authorization decision, persistence protocol or server guarantee. No fingerprint key is accepted or emitted in the business JSON.

For cross-language tests, the helper returns lowercase SHA-256 hex over ASCII `arcflow.sealUse.intent.v1` plus a NUL byte, followed by all nine canonical field values in the key order above. Numbers use decimal strings. Each value is prefixed with its four-byte unsigned big-endian UTF-16 code-unit length and encoded as two-byte unsigned big-endian code units. Framing preserves field boundaries and unpaired surrogates.

The baseline fixture hash is `76a52e9b367a80c35c04173647661701abe209171e557bd9419ad3308c665d95`. This value is test evidence only.

## Limits

Only the isolated Java module was compiled and tested. Root application, host, UI, workflow, store, migration, applicant/process authorization, durable idempotency, and real stamping/signing/upload behavior were not implemented or verified. Proposed future views may expose `request` plus `total: null`; this module emits neither a view nor an amount and never synthesizes a zero total. The module is not added to the root Maven reactor and is not production-ready integration.
