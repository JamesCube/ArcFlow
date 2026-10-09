# Seal-use review / 用印申请审批

## Draft integration candidate

This implementation is based on accepted main `71910bfc2ac1b9d58e0f7f1b85e6bbb206321ec1`.
It introduces a separate synthetic OA request in `/scenarios.html` and the compiled
`/api/scenarios/oa-seal-use` host. It is a draft candidate and is not accepted as a delivered scenario yet.
The local verification manifest records exactly which tests ran. Boot 4.1.1 HTTP execution,
real-server database verification and original bilingual browser captures remain explicit
acceptance gates until verified against this implementation.

No unaccepted Travel implementation is included. The registered library on this branch
contains Expense and Seal-use. Existing generic/native endpoints still allow only Leave and
Procurement; the CRM quote host remains separate. The reviewed standalone contract prototype
under `contracts/seal-use` is historical contract evidence, not evidence of a deployed host.

## What the form actually records

The immutable document has exactly nine fields: `type: "sealUse"`, `documentVersion: 1`,
`businessId`, `title`, `reason`, `documentName`, `documentRef`, `sealType` and `copyCount`.
The form labels reason as business purpose, so the applicant enters the purpose only once.
Seal types are the synthetic categories `OFFICIAL`, `CONTRACT` and `FINANCE`. Copy count is
an integer from 1 to 100. A document reference is inert synthetic text, not a URL to fetch or
proof that a real document exists or belongs to the applicant.

Title, purpose and document name are length-checked before Java-compatible edge trimming.
Control/Unicode whitespace/BOM-only text is invalid. IDs, references and seal categories are
not trimmed or case-folded. Integer JSON fields reject decimal/exponent tokens, strings,
booleans and null. The form keeps raw copy-count text while typing, displays errors for
invalid inputs and only normalizes on successful validation. Unknown and missing fields,
duplicate JSON keys and trailing content fail closed. The dedicated Seal HTTP submission
accepts only well-formed UTF-8 JSON bytes and limits the entire raw JSON request envelope to 8,000,000 UTF-16 code units before decoding;
this transport bound does not cap aggregate stored snapshots or direct typed Java calls.

There is no currency, amount, receipt table or financial total. Responses preserve the
existing `{request, total}` envelope and include `total: null` for Seal-use. Expense continues
to return and validate its exact monetary string. Lists and saved detail show copies and the
synthetic seal category; copies are never formatted as money.

## Review and identity

The initial process is `oa-seal-use`: submit → Bob document review (`documentReview`) → Carol
seal-use review (`sealReview`) → review complete. The shared 1–8-stage fixed-reviewer designer
can publish a new process version. Every saved request retains its submitted process version,
reviewers, business snapshot and per-stage history. Approval records a review outcome only.

The host uses the authenticated active principal, publisher authorization and workflow
participant checks. Request paths select only compiled registry entries. The dedicated JSON
filename is the configured approval data file plus `.scenario-oa-seal-use.json`; the URL does
not choose a filesystem path. Seal submissions cannot enter the Expense or generic host,
and Expense/Leave/Procurement/Quote payloads cannot enter the Seal host.

Exactly one valid applicant-scoped `Idempotency-Key` is required. Same normalized intent and
original process version replay the current durable request after approval, rejection or
restart; any changed business field or original process version conflicts. Document and
business references are not uniqueness constraints. JDBC submission keys remain globally
applicant-scoped across processes. The separate JSON scenario stores have their existing
per-file key scope. Failed persistence must not publish an in-memory state or retry binding.

The browser keeps each scenario's unsubmitted form, unresolved retry intent/key/version,
designer draft, request selection and review note separately. Responses belong to their
initiating scenario and authentication session. Logout clears the in-memory workspaces.
Reload still loses unsaved browser state; this is not durable draft storage.

## Explicit schema compatibility

This reader accepts JSON snapshot schemas 1–7 and 9. It explicitly rejects schema 8,
reserved by the separate unaccepted Travel implementation. Schema 9 is not a superset
reader for schema 8. The schema number is a format gate, not a claim that every earlier
scenario payload is understood. Unknown document kinds are rejected even under schema 9.

- First Seal-use write selects schema 9. Seal-use payloads under schemas 1–7 are rejected.
- Opening schema 8 fails before business-state or backup writes; its bytes remain unchanged.
- Existing compatible snapshots are read without rewriting. An upgrade retains a byte-exact
  pre-upgrade backup; an existing backup is not overwritten on collision or retry.
- A failed atomic replacement publishes neither the new snapshot nor in-memory request/key
  state. Existing single-writer and filesystem-durability limits still apply.
- Subsequent Expense, Quote, typed legacy, process or approval writes never downgrade 9.
- Old schema-7-only binaries reject schema 9. Stop incompatible writers and deploy compatible
  readers before enabling Seal writes; retaining SQL revision 3 does not make old binaries
  understand the new typed request JSON.
- Restoring a historical backup loses later submissions, decisions and publications. It is
  recovery to an older point in time, not a lossless downgrade.

Accepting Travel later requires a separate combined-reader/migration review with explicit
Travel/schema-8 and Seal/schema-9 support. Do not resolve the parallel change by renumbering
one schema, loosening unknown-type checks or blindly accepting every integer up to 9.

## Verification and acceptance

Run the normal Java core, domain, JDBC and UI test/build commands. The same four named Seal
JDBC contracts are inherited by H2, PostgreSQL and MySQL suites. CI must require the new
server cases to execute without skips. H2 success alone is not a real-server claim.

The host test class is `SealUseApiTest`; live authentication, process isolation, immutable
snapshots, rejection and schema-9 restart are checked by:

```sh
python3 examples/scenarios/seal_use_http_smoke.py \
  --jar examples/approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
```

Still required before publication as a completed scenario: exact-code host/server CI, actual
browser journeys, Chinese and English original images of catalog/form/designer/validation/
pending/next stage/approved/rejected and narrow reviewer controls, image provenance and
independent pixel review. Test discovery, generated illustrations and Expense/Travel images
cannot satisfy Seal screenshot acceptance. No Seal gallery images are claimed here.

## Business boundaries / 业务边界

本示例只记录用印申请与人工审批结果，不执行实际盖章、电子签章、合同签署、文件上传、
印章借出／归还、对外通知或任何业务系统回写。三种印章类型均为合成分类，不表示真实印章
身份、法律权限或文件有效性。审批通过不等于已用印。
