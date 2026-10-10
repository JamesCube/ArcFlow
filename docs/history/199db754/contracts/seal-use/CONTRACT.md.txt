# 用印申请契约原型 / Seal-use request contract prototype

## Historical prototype status

This section records the earlier contract-only checkpoint. For the draft runtime implementation,
its explicit schema-8 rejection and current acceptance gates, see [Seal-use scenario](../../docs/SEAL_USE_SCENARIO.md).

This is a local-only contract/specification/test deliverable, based on approved main
`3a4c9cc27b4bf1cee4343d9d7641c8e489d2a327` (tree
`8445dfdde155cb6c501d76f089429d5634357f86`). All 384 baseline source blobs were verified.
No unaccepted Travel code is included. There is no registered Seal endpoint, runnable Seal
page, persistence migration or screenshot gallery in this phase. Nothing is published.

The prototype models a synthetic request to use a seal on named documents. Approval is only
an approval state. It does not apply a physical/electronic seal, sign a contract, upload a
file, verify a legal document, borrow a seal, record its return, or communicate externally.
The three seal categories are demonstration options, not real seal identities or legal powers.

## Version-1 business document

All nine properties are mandatory. Unknown, derived and null properties fail closed.

| Property | Contract |
| --- | --- |
| `type` | Literal `sealUse` |
| `documentVersion` | Integer JSON token, exactly `1` |
| `businessId` | 1–128 ASCII letters/digits and `._:/-`, starting with a letter/digit |
| `title` | Required text, at most 120 UTF-16 code units before normalization |
| `reason` | Business purpose, at most 2,000 UTF-16 code units before normalization |
| `documentName` | Required document name, at most 160 UTF-16 code units before normalization |
| `documentRef` | Synthetic, inert text reference, same syntax as `businessId` |
| `sealType` | `OFFICIAL`, `CONTRACT`, or `FINANCE`, explicitly labeled synthetic |
| `copyCount` | Integer JSON token from 1 through 100 |

`reason` is labeled **用途说明 / Business purpose** in the form. A second purpose field would
ask the person to enter substantially the same thing twice, so it is deliberately absent.
There is no currency, amount, unit price, receipt table, loan period or return-date field.

Common text and `documentName` trim only edge U+0000–U+0020, matching Java `String.trim()`.
Input lengths are checked before trimming. The normalized value must contain a character
outside C0, Unicode White_Space and U+FEFF; whitespace/BOM-only values are rejected. Other
content remains unchanged. IDs, references and enum values are not silently trimmed or
case-folded. These rules are shared by Java and JS contract tests.

JSON `copyCount: 1.0`, `1e0`, `"1"`, `true`, `null`, zero, fractions and overflow are invalid.
A form adapter separately retains raw count text while typing; it does not turn empty into
zero or apply `parseInt` to malformed text. Benign edge whitespace and leading zeros (for example ` 2 ` and `02`) normalize only on
successful submission. The raw count input is bounded to 16 UTF-16 units. A valid form
normalizes to an integer wire value.
Duplicate JSON keys, trailing tokens, unexpected objects/arrays and scalar coercions fail.
Raw JSON input is bounded to 8,000,000 UTF-16 code units in both prototype codecs.

Example, entirely synthetic:

```json
{
  "type": "sealUse",
  "documentVersion": 1,
  "businessId": "SEAL-DEMO-001",
  "title": "项目交付材料用印申请",
  "reason": "合成演示：提交项目交付材料审核，不执行实际盖章。",
  "documentName": "合成项目交付说明",
  "documentRef": "DEMO-DOC-001",
  "sealType": "OFFICIAL",
  "copyCount": 2
}
```

The reference is neither a URL to fetch nor proof that a document exists or belongs to the
applicant. Future source-bound contracts need a separately authorized document/revision
lookup; this prototype does not imply one. No seal image, certificate, signing key or real
contract content belongs in these fixtures.

## Form and display proposal

`form-template.json` proposes a compiled version-1 template, not an installed configuration.
It has identity, document and purpose sections; `lineItems` is explicitly null. The proposed
integer widget is not supported by the current registered renderer and must be implemented
and tested before the template is registered. Metadata must never execute scripts or accept
arbitrary object paths.

The proposal includes status and integer-input hints beyond today's Template/Field DTO. It must
not be sent directly through `/api/scenarios`. Prefer retaining the current wire DTO shape,
with the typed Seal handler owning its count bounds and the compiled widget adding integer
input support. Any richer metadata requires an explicitly coordinated versioned extension;
do not append nullable fields to every existing template and break strict Expense/Travel readers.

The form retains invalid raw count text and explains the error in Chinese or English.
Its read-only summary shows the actual copy count and synthetic seal category. It never
formats copies as money or displays a fake zero amount. Submission, pending and terminal
views must continue to say whether review is pending/approved/rejected, not whether physical
stamping or signing happened.

### Backward-compatible response proposal

Expense already returns `{request, total}` with an exact monetary string. Travel PR35 uses
the same shape but remains outside this baseline. For a future Seal registration, preserve
that envelope and return `total: null` explicitly. A registered non-monetary handler derives
its copies/seal summary from the immutable business snapshot.

Expense and Travel validators must still require their exact monetary total. Only Seal may
accept null; it must reject `"0"`, `0`, missing `total`, invented currencies or financial fields.
This is a narrow compatibility proposal, not a change to the current host or a universal
response-schema relaxation. This prototype does not validate live workflow response history.

## Fixed process proposal

`process-template.json` uses the existing process schema 2:

1. Applicant submits the request.
2. Bob reviews the named document and business purpose (`documentReview`).
3. Carol reviews the proposed seal use (`sealReview`).
4. Review completes.

The process ID is `oa-seal-use`, with immutable stable step IDs. Labels are not dynamic roles
or organizational authority. Later integration may use the existing 1–8 step designer and
SINGLE/ALL/ANY rules, but those variants need real Seal lifecycle tests. There is no condition
branch, timer, delegation, source writeback or stamp-execution action.

## Identity, immutable intent and future storage

The eventual host must use its authenticated active principal, the existing publisher and
participant checks, and a compiled registry key/file mapping. Request paths must not select
files. Proposed dedicated JSON suffix: `.scenario-oa-seal-use.json`. Generic standalone/native
routes must keep their explicit leave/procurement allowlists; other scenario hosts must reject
Seal and Seal must reject their types.

Every future submission requires exactly one applicant-scoped Idempotency-Key. Replay must
compare the original process ID/version and all normalized business fields, including document
reference, seal category and count. Changed intent conflicts; same intent returns the durable
current request after approval/rejection/restart. Business/document references are not uniqueness
constraints. No new digest, signature or submission-key protocol is introduced by this prototype.
JDBC keys remain globally applicant-scoped across processes.

### Reserved migration number, not an implemented reader

Main currently supports JSON snapshots through schema 7. The unmerged Travel candidate reserves
schema 8. Reserve schema 9 for Seal to avoid assigning the same number to different payloads.
This reservation is not a claim that this baseline can read Travel/schema 8 or Seal/schema 9.
There is no migration implementation in this deliverable.

Before enabling Seal writes on the selected common baseline:

- Reconcile both typed payloads and explicit version gates. Do not overwrite Travel's schema-8
  guard or approve mixed-version readers merely because one binary has a higher schema number.
- Deploy readers that understand every enabled payload first; stop incompatible writers and
  retain normal backups before enabling writes.
- Read compatible old snapshots without rewriting. Reject Seal when the snapshot schema is less than 9; never downgrade
  the stored schema after later Expense/Travel/legacy writes.
- Preserve the byte-exact file immediately before an upgrade; failed atomic replacement must
  publish neither state nor keys. Retry must preserve the original backup, including collisions.
- Backups are historical recovery. Restoring one loses later submissions/decisions/publications;
  it is not a lossless downgrade.
- SQL revision 3 remains the proposed baseline. Typed `request_json` still requires compatible
  readers; unchanged DDL does not make older binaries understand a new business payload.

## Shared-base integration checklist

The current main and pending Travel code both touch the same integration seams. Do not copy a
second broad form/workspace refactor into this branch. Integrate only after choosing one common
base and explicitly preserving the earlier fixes.

| Seam | Required future change and protection |
| --- | --- |
| `BusinessDocument` | Add a typed Seal subtype and discriminator without dropping existing types |
| JSON store | Add schema-9 gating, all older payload checks, exact backup/failure/restart tests |
| `ScenarioCatalog` and host registry | Add an explicit Seal entry/bean/file mapping; preserve Expense and any accepted Travel entry |
| Registered form handler | Add strict Seal codec/metadata; unknown template IDs still fail closed |
| Shared form widget | Add integer raw-input handling and count-specific errors, without money coercion |
| Lists and saved detail | Use a non-monetary summary; never blindly call money formatting for all types |
| Scenario workspace | Preserve each form, original retry key/version, designer undo, review note and selection through real Catalog switching |
| Async/auth boundaries | Late responses stay in their initiating scope; logout invalidates all scopes |
| Process publication | Preserve expected-process-ID checks and exact acknowledged content/version checks from prior fixes |
| Generic/native hosts | Continue explicit type allowlists; new domain subtype support must not expose it through a generic route |

## What these tests establish

The independent Java module and JS files exercise immutable typed values, strict raw JSON,
normalization, real count/reference rules, bilingual form errors and non-monetary summaries.
Their comparison/roundtrip checks are contract evidence, not durable idempotency, authentication,
process execution or persistence acceptance.

Remaining runnable-case gates: actual typed-domain/store/host integration; migration and fault
injection; authenticated HTTP tests; shared H2/PostgreSQL/MySQL contracts; mounted form/workspace
regressions; real-backend browser journeys; original bilingual designer/form/pending/approved/
rejected captures, per-image provenance and independent pixel review. No screenshot currently
exists for this prototype, and an Expense/Travel screenshot cannot establish Seal acceptance.

## Source anchors

- [Approved typed document boundary](../../examples/approval-domain/src/main/java/com/arcflow/approval/BusinessDocument.java)
- [Scenario registration metadata](../../examples/approval-domain/src/main/java/com/arcflow/approval/ScenarioCatalog.java)
- [Scenario lifecycle adapter](../../examples/approval-domain/src/main/java/com/arcflow/approval/ScenarioCase.java)
- [JSON schema and backup implementation](../../examples/approval-domain/src/main/java/com/arcflow/approval/JsonApprovalStore.java)
- [Current renderer](../../examples/approval-ui/src/scenarios/ScenarioForm.vue) and [field widget](../../examples/approval-ui/src/scenarios/ScenarioField.vue)
- [Strict transport parser](../../examples/approval-ui/src/scenarios/scenario-api.js)
- [Business/storage contract](../../docs/BUSINESS_DOCUMENTS.md)
