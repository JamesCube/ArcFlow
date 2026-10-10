# Full-member task inbox

<!-- Legacy fragments remain entry points after the language split. -->
<a id="全成员任务收件箱--full-member-task-inbox"></a>
<a id="待办与已办的精确含义--membership-rules"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](MEMBER_INBOX.md) · [Documentation](README.en.md)

The inbox queries pending and handled work for the authenticated user with bounded cursor pagination. Legacy `GET /requests` and decision-write contracts remain compatible. The original API change was independent of typed documents and procurement UI; current adoption is described below.

The additive inbox is a **request-level** worklist, not one row per vote or stage. It uses the existing immutable request/process snapshot and authenticated host identity. It does not add administrator visibility, tenant isolation, reassignment or another approval policy.

<!-- topic:http-contract -->
## HTTP contract

- Standalone: `GET /api/requests/inbox`
- RuoYi: `GET /arcflow/requests/inbox`, with the existing `arcflow:request:read` permission; the result is wrapped in `AjaxResult.data`.
- The actor comes only from the authenticated principal or current RuoYi session. Query parameters cannot select another actor.

| Parameter | Meaning |
| --- | --- |
| `box` | `PENDING` (default) or `HANDLED`, exact uppercase |
| `limit` | Integer 1–100, default 25 |
| `status` | Optional current request status: `PENDING`, `APPROVED`, `REJECTED` |
| `processVersion` | Optional positive snapshotted process version |
| `cursor` | Optional opaque continuation returned by the previous page |

Unknown or repeated parameters, unsupported enums, malformed numbers, out-of-range limits and invalid cursors return HTTP 400. An omitted optional filter differs from an explicit empty value. Authentication is required; inactive directory identities are rejected, including revocation observed after storage I/O.

```json
{"items": [], "nextCursor": null}
```

`items` contains the unchanged full `ApprovalService.Request` records. `nextCursor: null` means no additional match was observed in that page's read snapshot. A non-null cursor can be passed with the same actor, box, status and processVersion; page size may change. There is no total count, offset, arbitrary sort expression or client-controlled actor filter.

<!-- topic:membership-rules -->
## Membership rules

- `PENDING`: the request is pending and this actor is an **unvoted member of the current snapshotted stage**. Every eligible ALL/ANY group member is included. The legacy `approverId` is only a representative and is never used as full membership.
- `HANDLED`: this actor has at least one actual APPROVE/REJECT event in the request history. SUBMIT does not count. A request may still be pending for other participants or later stages.
- A future-only assignee is not pending yet. An applicant, publisher or unrelated administrator gets no inbox entry merely because of that role.
- If ANY closes on one approval, unvoted members are removed from pending without being marked handled. The same applies to members skipped by an ALL rejection.
- An actor who voted in an earlier stage and is now pending in a later stage appears in **both** boxes. Multiple votes still produce one request row per box.
- Legacy `list(actor)` / `GET /requests` continues to show the applicant and every snapshotted participant, including future and unvoted members. That broader historical list is not interchangeable with a task inbox.

<!-- topic:ordering-and-consistency -->
## Ordering and consistency

Newest **creation Instant** first, then request ID in descending ASCII order. Creation time and request ID never change after submission. Seconds and nanoseconds are compared numerically; variable-width ISO timestamp strings are not used as lexical sort keys.

Each page is a consistent store snapshot. The cursor means “strictly older than the last returned creation position.” Updating a vote does not move a request to another ordering position. Equal timestamps are resolved deterministically by request ID.

Pages are a live worklist, not a frozen cross-request transaction. Between calls, a decision can remove a pending item or add a handled item; a new submission can sort before the continuation. Refresh from the first page to see newer or newly matching work. No exactly-once delivery or immutable multi-page snapshot is promised.

Cursor data is versioned, length-bounded and tied to exact actor/filter values. It is neither a secret nor an authorization token. Every query still resolves the server-side actor, and the domain validates exact membership, filters, order, unique IDs and the store's row bound before returning anything. Changing cursor bytes cannot grant visibility.

<!-- topic:storage-boundary -->
## Storage boundary

`ApprovalStore.inbox(InboxQuery)` returns at most `limit + 1` matching validated requests in order; the extra request is lookahead. The default SPI method fails explicitly for third-party adapters without this capability. It never silently calls `requests()` and replays an entire store.

The JSON demo builds in-memory actor/bucket ordered indexes from validated snapshots and updates them after successful atomic file publication. Reads inspect only that actor's bucket and stop after enough filtered matches; optional filters can scan more of that actor's bucket. JSON persistence still rewrites the local snapshot on mutations and retains its single-process/local-filesystem limitation.

The JDBC adapter uses a complete per-request participant projection, exact binary actor keys, binary ASCII request sort keys and epoch-second/nanosecond ordering. Creation and decision updates maintain projection, request and audit in one transaction. A page uses one read snapshot transaction, a bounded actor/process/bucket query and batched request, version, audit and member validation. PostgreSQL/MySQL use REPEATABLE_READ; H2 requires the stronger JDBC SERIALIZABLE isolation for a stable cross-table snapshot. It does not replay unrelated requests or issue one audit/version query per request. Optional filters may increase database index scanning; bounded returned rows do not claim constant database CPU or latency.

See [JDBC installation and revision-3 migration](../examples/approval-jdbc/README.en.md) for fresh schemas, the explicit upgrade, bounded resumable backfill, readiness checks and stopped-writer rollout. Constructors do not execute DDL or silently backfill old data. Mixed old/new writers are unsupported.

Validation detects inconsistent selected request snapshots, audit rows and complete member projections. It is not tamper-proof storage. Out-of-band deletion of an index row can omit that request from a query without making it a returned candidate; application-role restrictions, controlled migrations, backups and operator integrity checks remain necessary. A successful small page is not a whole-database integrity certificate.

<!-- topic:host-integration-with-typed-business-documents -->
## Host integration with typed business documents

Both hosts expose the new endpoint. The standalone desktop, native RuoYi overlay and H5/mobile consumers now use separate pending/handled cursor pages while preserving the compatible legacy applicant/history lists. See [frontend adoption and local verification](MEMBER_INBOX_UI.en.md). No UI interaction or screenshot is needed to use or verify the API itself.

The integration preserves the same actor, membership, ordering and cursor rules for legacy leave and typed leave/procurement requests. Business fields remain immutable; inbox results retain the typed snapshot. JDBC member queries bind the configured process as well as the actor, and explicit backfill resolves each request’s own retained process definition. `HANDLED` still means that actor actually voted, including a pending request with a later stage; it never means all terminal requests or all participants. The [combined report](LOCAL_INTEGRATION.en.md) separates executed checks from pending acceptance.

<!-- topic:verification -->
## Verification

- Domain tests cover full ALL/ANY membership, unvoted losers, future assignees, repeated actors, exact case/accent/trailing-space identities, revocation, keyset ties, filters and malformed/foreign cursors.
- HTTP tests cover host authentication boundaries, principal spoofing, repeated/unknown fields, envelope shape, group lifecycle and pagination; the standalone live HTTP verifier also restarts its disposable backend.
- The shared JDBC contract runs on real H2, PostgreSQL and MySQL when the corresponding server is present. It covers fixed query count, bounded rows, independent-instance decisions, page snapshot races, projection rollback, corruption and explicit bounded upgrade/backfill.
- Passing H2 or a skipped server suite is not PostgreSQL/MySQL evidence. Use the exact-commit CI run and actual recorded server versions before claiming server compatibility.
