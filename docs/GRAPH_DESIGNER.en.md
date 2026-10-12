<!-- topic:scope -->
# Structured approval graph workspace

[简体中文](GRAPH_DESIGNER.md)

The standalone approval host and Vue UI include a separate payment graph workspace. In **Process designer**, choose **Graph**; use **Graph requests** in the main navigation to submit synthetic payments and work on tasks. The existing sequential designer, scenario APIs, RuoYi integrations and mobile clients keep their previous contracts. They do not acquire graph support automatically.

This is a bounded approval interpreter, not a general BPMN editor. Canvas positions are presentation only. The published version-5 definition contains stable node IDs, stable edge IDs, ordered branches and reciprocal split/merge pairs. The server validates and executes that semantic definition. UI validation helps editing; it cannot authorize publication or decisions.

<!-- topic:limits -->
## What is supported

- One start and one end; single approvals; ALL/ANY participant groups; exclusive choice/merge; parallel fork/join.
- At most 32 nodes, 48 edges, 16 human nodes, 16 participants per group, two nested regions and two to four branches per region. There are at most 32 predicate atoms per definition and eight per rule.
- Single-entry, single-exit paired regions. No loops, detached nodes, cross-region connections, shared branch nodes, mismatched joins or complete executions without human approval. An empty branch may enter its own paired merge/join; a parallel join still waits for all sibling branches.
- Exclusive branches use FIRST_MATCH in stored edge-array order. Exactly one unconditional default branch must come last. Overlapping conditions are ordered choices, not a promise of disjointness.
- Conditions use only `payment.netTotal`, with `EQ`, `GT`, `GTE`, `LT`, `LTE`, and exact monetary thresholds. ALL/ANY combines a rule's atoms. One definition uses one condition currency. An incompatible document type or currency fails submission rather than selecting the default branch.

`GET /api/graphs/payment/capabilities` reports these limits, fact operators/currencies, node types, the current actor's publication permission, and the supported host/storage boundary. `GET /users` supplies current eligible reviewers; the UI does not invent participants.

<!-- topic:authoring -->
## Authoring and versioning

Choose a connection's **+** to insert an approval or a complete paired conditional/parallel region. Select a branch to edit its name, amount rule and priority in Properties; moving a condition earlier changes FIRST_MATCH priority. The default branch remains last and cannot be deleted independently. Select an approval to choose current eligible people and its SINGLE/ALL/ANY voting rule. Deleting a region removes its split, paired join and contained branches together; Undo restores that whole operation.

Narrow canvases show each split as an enclosed set of separately numbered branch tracks. These tracks are alternative or concurrent paths, not sequential steps: the heading explains FIRST_MATCH or waiting for every parallel path, and the paired join is outside the branch group. On desktop, **Full-width canvas** makes more room for side-by-side branches; returning to Properties retains the selection. On phones, switch between Graph and Properties, or press Escape to return to the selected graph item. Tab and Enter work without dragging; Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo/redo graph edits without taking over text-input undo.

Save unfinished work as a draft. A structurally incomplete graph, such as one with disconnected nodes, may be saved and reloaded when its fields, IDs and bounds are valid. Publication requires full server validation plus current reviewer eligibility. Draft revision, published version and definition schema version are separate numbers.

Saving requires the last observed draft revision. Publication requires both the current published version and draft revision. A stale operation returns 409 without overwriting another edit. Successful publication increments the published version and atomically resets the draft to that published definition with a new draft revision. Preview uses the supplied graph and business payload without saving a draft, creating a request, or changing publication.

The graph uses the existing `paymentRequest` business contract: supplier reference, currency, requested date and one to twenty invoice-allocation lines. The server computes net total as the exact sum of allocation amounts minus deductions across all lines. It never accepts `netTotal`, route, task, status or applicant fields from a submission. This synthetic review does not reserve invoices, send money, sign documents or initiate bank instructions.

<!-- topic:execution -->
## Execution and authorization

Submission freezes the graph definition, normalized business document and selected routes. Future publications affect only new submissions. A task has its own ID, node-instance ID, participants, votes and status; one user can have multiple active tasks in the same request. Encode task IDs when constructing decision URLs.

A parallel fork saves its expected branch-edge IDs under one fork activation. Each completion records its branch arrival. The paired join fires exactly once after every expected branch arrives; only then can downstream work become active. State, tasks, fork arrivals and events persist together under a request revision compare-and-swap. The service retries conflicts by rereading and reauthorizing, so different task commands cannot silently overwrite each other.

For ALL, one rejection rejects the request. For ANY, a rejection leaves the group active while another participant can approve; approval completes the group, and rejection occurs only after all participants reject. A terminal rejection cancels every other active task atomically. No duplicate decision may resurrect cancelled work.

Only the applicant and participants on the frozen selected path may read a request. That includes selected future reviewers and excludes unselected branches. Publication rights do not grant blanket request access or authority to vote for others. Every command checks the authenticated actor against the current active directory and the exact task's participant list.

<!-- topic:http -->
## HTTP contract

Base: `/api/graphs/payment`. All endpoints require the standalone host's Basic authentication. Writes also require `Content-Type: application/json`, `X-Arcflow-Client: approval-demo`, and the existing Origin/Fetch Metadata protections. Actor identity always comes from authentication.

| Method and suffix | Body | Response |
| --- | --- | --- |
| GET `/capabilities` | none | Supported limits, facts and actor permissions |
| GET `/process` | none | Published `GraphDefinition` |
| GET `/workspace` | none | `{storageSchemaVersion:14,definition,draft,requests:[]}`; publisher only |
| GET `/users` | none | Current eligible `{id,displayName}` people |
| PUT `/draft` | `{expectedRevision,definition}` | Saved `{revision,baseVersion,definition}`; publisher only |
| POST `/validate` | `GraphDefinition` | `{diagnostics:[{code,message,nodeId,edgeId}]}`; publisher only |
| POST `/preview` | `{definition,business}` | Nonpersistent `GraphInstance`; publisher only |
| POST `/publish` | `{expectedVersion,expectedDraftRevision}` | Published definition; publisher only |
| GET `/requests` | none | Visibility-filtered `GraphInstance[]` |
| GET `/requests/{id}` | none | Visible `GraphInstance` |
| POST `/requests` | `{expectedVersion,business}` | `GraphInstance`, HTTP 201; `Idempotency-Key` required |
| POST `/requests/{id}/tasks/{taskId}/decision` | `{decision,comment}` | `GraphInstance`; `Idempotency-Key` required |

`decision` is `APPROVE` or `REJECT`; `comment` is a required string, at most 2,000 characters, and may be empty. Idempotency keys are one header value, 1–128 safe characters. Keep the same key and original payload after an uncertain response. A reused key with changed payload returns 409. Submission keys are scoped to applicant; command keys are scoped to request. Replaying the exact same key and payload does not append events or votes. A same-actor/same-task/same-decision retry under a fresh key durably binds that new key as a `COMMAND_REPLAYED` receipt, increments command revision once, and preserves the original vote/comment and all task state. Its key cannot later be reused for a changed payload. A request accepts at most 768 fresh-key replay receipts and reserves up to 256 original-vote slots (1,024 total command keys). New replay aliases beyond their budget return 409 without mutation; alias traffic cannot consume the slots needed by outstanding real votes. Exact-key retries remain read-only even after the budget is reached. An opposite decision by the same actor on the same task is a conflict.

All definition, node and edge properties are required. Nullable fields must be explicitly `null`; unknown fields, duplicate keys, trailing JSON and invalid numeric/scalar coercions fail. Definition shape:

- Definition: `schemaVersion`, `id`, `version`, `name`, `nodes`, `edges`.
- Node: `id`, `type`, `name`, `assigneeIds`, `completionMode`, `pairId`.
- Edge: `id`, `source`, `target`, `label`, `condition`, `defaultBranch`.
- Instance: `id`, `submissionKey`, `applicantId`, `status`, `createdAt`, `updatedAt`, `commandRevision`, `definition`, `business`, `tasks`, `forks`, `routes`, `events`, `commands`.

Business input remains the strict raw payment contract documented in the [API reference](api/API_REFERENCE.en.md). Runtime state is output only. There is no single `currentStep` projection. `commandRevision` advances once per durable human command, independent of the event sequence. Errors are 400 invalid input, 401 unauthenticated, 403 forbidden, 404 missing request/task, 409 stale/conflicting operation, and 503 unconfirmed storage operation.

<!-- topic:storage -->
## Storage, restart and host boundary

The standalone host uses a new adjacent file: `<APPROVAL_DATA_FILE>.graph.json`, with storage schema **14** and a separate writer lock. It is seeded with the payment graph and never converts existing instances or overwrites legacy files. Existing JSON readers for wrappers 1–13 must not open this file. Reads validate saved state by replaying the frozen definition, business and commands, including task/fork/event projections.

The optional JDBC library has separate `arc_graph_*` tables and graph schema metadata version **1**. Install the appropriate graph SQL explicitly in a dedicated/tested database. The old `arc_request` schema and revisions are unchanged. Adding the library or schema does not switch the standalone host to JDBC. Database integration needs explicit host wiring and acceptance tests. Neither RuoYi nor mobile clients are graph hosts in this delivery.

The independent version axes are: definition schema 5, monotonically increasing publication version, draft revision, JSON wrapper 14, JDBC graph schema 1, request command revision and event sequence. They are not interchangeable. Back up the dedicated graph file/tables, stop incompatible writers and retain compatible binaries for restore. Restoring a backup loses later changes.

<!-- topic:verification -->
## Build and verification

From the repository root, use JDK 17+ and Maven 3.9+:

```bash
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml verify
```

The standard standalone [backend run instructions](../examples/approval-demo/backend/README.en.md) apply. The host test suite includes graph auth/Origin/strict-JSON boundaries, incomplete drafts and publication CAS, server-side multi-line payment preview with no writes, frozen definitions and visibility, concurrent decisions on different tasks, join release, rejection cancellation, and real loopback HTTP across complete host shutdown/restart. Domain and JDBC suites cover interpreter and storage boundaries independently. Presence of these tests is not a claim that an untested environment or commit passed.
