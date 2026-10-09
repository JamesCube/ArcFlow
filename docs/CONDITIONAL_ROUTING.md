# Restricted conditional routing (candidate contract)

Implementation baseline: PR41 `a30bca2934472da4fbf1609ea5c9cfd1a27a2028`, source tree `de619b40446a6d8076109332fa1a0ba1b673b12c`. Local-only implementation. Verification results will be recorded separately; this contract is not a pass or production-readiness claim.

## Definition and safety boundary

Definition schema 4 adds optional `runIf` to an approval node. Start/end cannot have it. There are still 1–8 ordered, fixed-participant stages and at least one unconditional manual stage. Rules select additional stages; they never approve or reject a business transaction. SINGLE, ALL and ANY voting retain their existing semantics. No scripts, nested expressions, reflection, JSONPath, time, network, loops, arbitrary jumps or dynamic assignees.

A rule is `{mode: "ALL" | "ANY", predicates: [...]}`. It contains 1–8 atoms; the whole definition contains at most eight atoms. Every rule in one definition targets the same business type. Atoms have exactly these fields:

- Payment: `{field:"payment.netTotal", operator:"EQ"|"GT"|"GTE"|"LT"|"LTE", currency, threshold}`. Threshold is an exact JSON number from 0 through 20000000000, at most two decimals; JPY requires whole units. Currency is CNY/USD/EUR/GBP/JPY. The business currency must match EVERY monetary predicate, even one in an ANY group that otherwise passes. Mismatch rejects submission clearly. No currency conversion or implicit false result that could remove required high-value review.
- Receipt: `{field:"receiving.hasRejectedLines", operator:"EQ", expected:boolean}`. The fact is computed from rejected line quantities, never supplied separately by the client.
- Contract: `{field:"contract.termsKind", operator:"EQ"|"IN", values:[...]}`. Values are unique STANDARD/NONSTANDARD; EQ requires exactly one, IN one or two.

Scenario publication must match the registered scenario document class. Existing generic and quote hosts cannot publish schema 4. Schema 2/3 fields and behavior remain unchanged. A schema-4 definition may retain no conditional nodes after an edit, but every resulting request still carries an explicit route.

## Frozen request contract

The full original `Request.definition` remains identical to the retained published version. It is never filtered or rewritten. A schema-4 request requires:

`routing = {schemaVersion:1, stepIds:[...], evaluations:[{stepId,result,predicates:[{field,actualValue,result}]}]}`

`stepIds` is the nonempty selected original approval IDs in original order. Evaluations contain exactly the conditional nodes, in original order, and all atom facts in atom order, without short circuiting. `actualValue` is a canonical string: `CNY 10000`, `true`, or `NONSTANDARD`, for example. Canonical money uses stripped decimal trailing zeros and plain notation. Mandatory nodes are always selected; no skipped node receives an approval event.

The immutable, typed business snapshot and immutable definition alone determine this route. Restoration recomputes and compares the entire frozen route (including order and facts); current definitions or source data are never consulted. Schema 2/3 requests must not contain routing. A single effectiveApprovals function drives vote replay, transitions, current/pending actors, authorization, and member projections. Skipped-only actors cannot read or vote and do not become pending or handled. Applicant self-approval remains forbidden anywhere in the full definition.

Submission-key lookup precedes eligibility/routing of a new intent. An exact old intent returns its current persisted request and route after configuration changes. All predicates are checked before creation. Request/route/key/projection/audit creation is atomic under the existing store contract. Voting may append only one valid event and must preserve business, definition and routing exactly.

## Migration and database contract

JSON schema 13 adds a required `routingDefinitions` array retaining every published schema-4 definition, including versions with no requests. Each schema-4 request and current definition must exactly match its retained version; duplicate, missing, conflicting or future retained versions fail closed. This checks redundant snapshot consistency, not authenticity against an attacker who rewrites the entire unsigned file.

JSON schema 13 is required for every schema-4 definition, including publication with no requests, and for every route. Readers retain strict schema 1–12 behavior, reject routing or schema 4 under lower wrappers, and reject unknown future wrappers/types/fields without mutation. Upgrade backs up exact immediately previous bytes before atomic replacement. The writer is monotonic and does not upgrade on read. Older readers cannot read schema 13. Stop incompatible writers and upgrade all readers before enabling conditions. Recovery to an old backup can lose subsequent requests/votes; it is not lossless downgrade.

SQL revision 3 already stores full definition/request JSON and has a derived member projection. No DDL change is proposed. All new projection construction and validation use effectiveApprovals. Existing schema2/3 requests have unchanged paths and unchanged ready member rows; tests must prove this. New and old binaries cannot be mixed merely because the SQL revision is unchanged. Preserve existing migration/backfill requirements, retained-version identity, transactions, global applicant/key scope and audit checks. H2, PostgreSQL and MySQL results must be reported separately, with skips distinct from passes.

## Required evidence

Domain rules and boundaries; effective-path voting/rejection/retry; participant read/write isolation; ALL/ANY/SINGLE combinations; frozen definitions and routes after publication; CAS and keyed races; JSON schema1–13 compatibility, immediate backups and tamper rejection; JDBC projection and transaction rollback; HTTP strict input/cross-scenario checks; designer/model/DOM validation; real backend browser paths for low/high payment, clean/exception receipt and standard/nonstandard contract, bilingual explanation and 390px checks. Local tests, browser results, CI, remote publication and deployment are separate claims.

## Local verification checkpoint (2026-10-09)

- Domain: 660 tests, zero failures/errors/skips; includes old-schema regression and schema13 retained-definition tamper checks.
- Standalone Boot4.1.1/JDK17: 99 HTTP/security tests, zero failures/errors/skips.
- JDBC: shared H2 contract 117 tests and real MySQL8.0.46 contract 123 tests, zero failures/errors/skips in those runs. The environment-free aggregate also ran 43 other adapter checks; PostgreSQL117 and MySQL123 were correctly skipped there. PostgreSQL and MySQL8.4 were not available for this local checkpoint.
- Frontend: 1,628 tests across 52 files; CRM26 and native RuoYi model51 regressions pass; production build passes.
- Real frontend-workspace HTTP journeys passed for payment, receipt and contract, including different selected paths, exact facts, real votes, rejected currency without a POST, unchanged old snapshots, and lost-response retry after publication. This is not rendering evidence.
- Independent review found and fixed retained-definition inconsistency and boolean coercion. Repro probes and 31 additional backend boundaries passed; a separate 40,049-case exact-decimal/route review found no outstanding blocking/high/medium issue. The low-risk zero-exponent parsing difference was also fixed and covered by seven new frontend boundaries.
- Core Maven verification, 24 plain-JDK checks and 33 packaging/build Python tests pass.
- Browser rendering remains unverified: installed Chromium failed during startup with a restricted socket; the supported cloud browser could not reach isolated localhost. Three real-backend Playwright journeys and an exact-provenance screenshot gate are prepared, not passed. No screenshot is presented as evidence.
- Native RuoYi server, mobile runtime, PostgreSQL, MySQL8.4 and remote CI were not rerun. The feature is enabled only in the three dedicated standalone scenarios; no new native/H5 routing support is claimed.

All work in this checkpoint is local. Nothing was pushed, merged or deployed. Tests do not establish production financial/inventory/contract safety. The source checkpoint and verification manifest identify the exact local tree and packaged backend; the packaged backend was forced to rebuild and its embedded domain JAR was byte-compared with the final tested domain artifact.
