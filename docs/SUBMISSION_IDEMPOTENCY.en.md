# Durable submission idempotency

<!-- Legacy fragments remain entry points after the language split. -->
<a id="atomicity-races-and-failures--原子性竞争与失败"></a>
<a id="client-retry-lifetime--客户端重试范围"></a>
<a id="durable-submission-idempotency--持久化提交幂等"></a>
<a id="http-and-identity--http-与身份"></a>
<a id="intent-and-replay--请求意图与重放"></a>
<a id="typed-business-documents--类型化业务单据"></a>
<a id="upgrade-and-rollback--升级与回退"></a>
<a id="verification--验证"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](SUBMISSION_IDEMPOTENCY.md) · [Documentation](README.en.md)

The approval examples can recognize a retried submission and return the original request. This document explains how the key is saved, how to retry, and what happens during upgrades. It does not guarantee exactly-once execution for a whole workflow or its external side effects. Schemas 4/5 below are the minimum formats introduced for keys and typed documents; see [Persistence and migration](development/PERSISTENCE.en.md) for the current full version range.

<!-- topic:http-and-identity -->
## HTTP and identity

Both `POST /api/requests` (standalone) and `POST /arcflow/requests` (native RuoYi) accept one optional `Idempotency-Key` header. A key must contain 1–128 ASCII characters matching `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. Matching is exact and case-sensitive. Blank, malformed, oversized or multiple values cause an error; the server does not ignore an invalid header. Generate a cryptographically random UUID for each new submission and keep it for retries.

Keys are scoped to `(authenticated applicant ID, key)`. A JSON file has one configured process. In JDBC, this key space is shared by all process IDs in the same database schema; it is not scoped separately by process. The host session supplies the identity; request JSON cannot choose it. Two applicants can use the same key independently, without revealing each other’s requests. Retries still require an active applicant and the endpoint’s existing permissions. Before returning stored results, the service checks authorization again. This scope does not provide tenant isolation; tenants need separately authorized storage and identity integration.

<!-- topic:intent-and-replay -->
## Intent and replay

- For the legacy leave endpoint, the submission’s intent is its configured process ID, process version, integer days, and title/reason after the domain’s existing `String.trim()` normalization. Original validation limits apply before normalization, including on retries. Unicode and case handling are unchanged.
- Retrying the same intent with the same scoped key returns the original request ID and saved definition, with its **current** status and history. Later approvals may change that response. The retry itself creates no request and advances no approval step; later publication does not replace the saved definition.
- Reusing the key with a different normalized title, reason, days or process version returns HTTP 409. The existing request and key binding stay unchanged.
- An accepted submission can be retried after the process is republished, a former approver is disabled, or a new definition assigns the applicant. Those checks apply to new submissions and do not invalidate an accepted request. The applicant must still be active.
- Without a key, every successful call creates a request, as before. Legacy HTTP bodies, request/event JSON shapes and response envelopes are unchanged. Standalone returns 201 for both a new submission and a retry; native RuoYi keeps its HTTP/AjaxResult success format. You cannot tell from the status code whether the response came from a retry.

Use `submit(actor, title, reason, days, processVersion, key)` to submit with a key. The old overload passes no key. Third-party `ApprovalStore` implementations still compile because keyed methods have defaults, but those defaults reject keyed submissions until the store implements durable support. They do not fall back to an in-memory cache.

<!-- topic:atomicity-races-and-failures -->
## Atomicity, races and failures

The key binding, request and initial SUBMIT audit event are saved together. JSON processes writes serially and replaces one file atomically. JDBC takes the existing process-head lock, checks for a prior binding **before** checking the active version, and inserts all three records in one transaction. A retry inside that write transaction locks the request so a concurrent decision cannot leave the returned request and history out of sync. Ordinary lookups use a repeatable-read snapshot.

A commit can succeed even if the response is lost or connection cleanup fails. Retry with the **same key and same intent**, including the original process version. Do not generate a new key just because you received no response. An error alone does not prove the commit was rolled back. Keys have no expiry, eviction, deletion or reuse mechanism; bindings stay with their retained requests. Host tools for retention, import and restore must preserve that relationship and key scope.

The transaction does not include business tables, notifications, external handlers or another database. There is no outbox or XA guarantee. JSON still requires one process on a local filesystem and has the same file-force and atomic-replacement limits as before. Tests cover reopening a process or store. They do not verify recovery from host power loss, device failure, or a physical database restart or crash. Database durability also depends on server configuration and backups.

<!-- topic:upgrade-and-rollback -->
## Upgrade and rollback

### JSON

The definitions in this milestone keep schemas 2/3. Snapshot schema 4 adds a `submissions` collection without changing request/event JSON. This milestone read schemas 1–5; the current extended reader supports schemas 1–13 (see the [migration guide](development/PERSISTENCE.en.md)) and leaves files untouched when reading. The first successful legacy keyed creation upgrades a schema-1/2/3 snapshot to schema 4 and saves a byte-for-byte `*.schemaN.bak` of the file just before the upgrade, without replacing an existing backup. Later unkeyed writes and publications keep at least schema 4 and all bindings. Typed-document writes use schema 5; see below. A schema-5 file never downgrades when a legacy request is added. Restore fails on duplicate or dangling bindings, multiple keys for one request, or applicant mismatches. Versions without submission-key support cannot read schema 4; versions without typed-document support cannot read schema 5. Stop traffic and back up before upgrading; a rollback must not overwrite newly accepted requests with an old backup.

### JDBC

Submission keys were added in SQL revision 2, independently of process JSON schemas. This combined source requires SQL revision 3 for member worklists. For a new database, use its dialect’s current `schema-*.sql`. For a revision-1 database, apply the matching `upgrade-*-v1-to-v2.sql` once, then the explicit v2-to-v3 member migration and bounded backfill. Stop all writers, back up, and run the migration with an account authorized for it. Old requests receive no invented keys. The constructor runs no DDL and needs the new table even if clients omit keys. MySQL uses InnoDB and exact `utf8mb4_0900_bin` identity comparison. See the [JDBC host contract](../examples/approval-jdbc/README.en.md).

Upgrade every host before enabling keyed clients. An old server may ignore the header and create duplicates. Do not run old and new hosts together or downgrade while traffic is still running.

<!-- topic:client-retry-lifetime -->
## Client retry lifetime

The standalone and native RuoYi forms keep an unresolved submission’s key, payload and process version in memory while that form and authenticated account remain active. Refreshing server data leaves an uncertain submission unchanged. Editing the normalized fields starts a new intent; successful submission clears it.

Only the specific stale-process HTTP 409 proves that the attempted version created no request. After that rejection, a successful user-triggered Refresh clears the failed attempt, allowing the next Submit to use the refreshed process version and a new key. Other conflicts or uncertain failures never rotate the key automatically.

The forms write no request text or credentials to browser storage. Reloading the page, closing the tab or logging out loses the client key. If that happens, check the request list before submitting again. The server’s binding remains saved. Clients do not retry automatically, and the review-only mobile client has no submission form.

<!-- topic:verification -->
## Verification

Tests cover canonical replay, changed-intent conflicts, applicant isolation, exact case, invalid keys, concurrent same/different intent, winner→publication races before validation and during creation, current-state replay, inactive applicants/approvers, lost acknowledgement, atomic rollback, old snapshot backups, malformed bindings and store reopen. The shared JDBC contract suite runs on H2 and on PostgreSQL/MySQL servers provisioned by CI, which requires zero skipped real-server cases. HTTP/client tests cover both response formats and stable retry keys. Check the workflow results for the exact commit you plan to use.

<!-- topic:typed-business-documents -->
## Typed business documents

The typed endpoints, `POST /api/documents` and `POST /arcflow/documents`, share the legacy endpoint's applicant/key space. Replay compares process ID/version, business type, business ID and every normalized immutable business field. A key reused for legacy versus typed leave, another business type, another process or changed content returns conflict. A business ID is a reference, not a deduplication key.

Different JDBC processes lock different head rows and can race on a global key. Only a duplicate at the binding INSERT, followed by clean rollback and a fresh lookup of the durable winner, is reconciled. A foreign-process winner returns conflict; other database or cleanup failures stay errors.

Legacy keyed JSON writes require at least schema 4. The first typed write upgrades schema 1–4 to schema 5 and preserves a byte-exact backup; later writes never downgrade it. Deploy compatible readers before enabling typed writes and avoid mixed-version writers. Typed documents alone use the existing SQL payload columns; the member inbox additionally requires the explicit SQL revision-3 migration and backfill. Restoring an old JSON backup would lose later submissions and approvals; it is not a supported automatic downgrade. See [business-document compatibility](BUSINESS_DOCUMENTS.en.md).
