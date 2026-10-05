# Parallel participant groups (domain schema 3)

共享审批领域库现支持会签 `ALL` 与或签 `ANY`，按固定参与人快照执行，并沿用单条决定与审计事件的原子提交。独立 Vue 编辑器与 Spring Boot 发布入口已支持分组配置、逐人投票与 ALL/ANY 状态展示；若依编辑器与发布入口仍只支持顺序 schema 2。没有条件分支、自由图形汇聚、动态加签、转办或生产就绪承诺。

## Scope and definition

This is the human-approval example domain, not parallel execution in the dependency-free Java DAG core. Stages still run in array order: start → 1–8 approval stages → end. Schema 2 retains its exact sequential definition and node JSON. Schema 3 permits those same nodes and the explicit `parallelApproval` shape:

```json
{
  "schemaVersion": 3,
  "id": "leave-approval",
  "version": 1,
  "name": "Joint leave review",
  "nodes": [
    {"id": "start", "type": "start", "name": "Submit", "assigneeId": null},
    {"id": "review", "type": "parallelApproval", "name": "Joint review", "assigneeId": null,
     "assigneeIds": ["202", "303"], "completionMode": "ALL"},
    {"id": "final", "type": "approval", "name": "Final review", "assigneeId": "404"},
    {"id": "end", "type": "end", "name": "Complete", "assigneeId": null}
  ]
}
```

A group has 2–16 distinct stable user IDs, `assigneeId: null`, and exactly `ALL` or `ANY`. Empty/single-member groups, duplicate IDs, unknown fields, missing fields, mixed singular/group assignments and scalar coercion are rejected. IDs/names and the fixed `leave-approval` process ID follow the existing [sequential contract](SEQUENTIAL_APPROVAL.md). Published versions are immutable snapshots; changing future routing does not change running requests. Participants are not resolved again or added dynamically after submission.

## Completion and rejection

| Mode | An APPROVE vote | A REJECT vote |
| --- | --- | --- |
| ALL (AND / 会签) | Wait until every participant approves, then advance | Reject the request immediately |
| ANY (OR / 或签) | Advance immediately | Wait until every participant rejects, then reject the request |

All undecided members of the current group are eligible concurrently. Later stages are inactive. Closing a group does not synthesize decisions for unvoted members. A rejection closes the request; an approved group advances to the next stage, or makes the request APPROVED when it is the last stage.

The policy is deterministic over committed events. Distinct participants' competing approve/reject votes in ALL lead to rejection; in ANY they lead to approval, regardless of which commits first. If a closing vote wins first, the unvoted loser receives a conflict and contributes no history entry. Different outcomes from the same participant are conflicting commands: the first durable decision wins, just as for sequential steps. This is not a veto-on-every-rejection ANY policy, a quorum/majority policy, or an arbitrary graph join.

## Commands, identity and compatibility fields

Continue using `decide(authenticatedActor, requestId, stepId, decision, comment)`. A group ID is the `stepId`; the actor comes from the trusted host session. Replay identity is `(request ID, step ID, actor ID)`:

- The applicant and every assigned participant in the request snapshot may see it. Unrelated actors get no request-existence disclosure.
- Only a participant in the specified current stage may add a decision. The live actor must still be active. Publication and submission verify every participant's active/eligible status; any applicant assignment anywhere prevents self-approval.
- A same-decision retry by a participant who already voted returns current durable state without replacing the original event, comment or timestamp, even after the stage/request closes. An opposite-decision retry conflicts.
- A participant who never voted cannot replay someone else's vote, vote after the stage closes or jump to a later stage. Repeating the same person in a later stage requires a separate decision there.
- Decision writes have a fixed 16-attempt compare-and-set budget. After the last miss, one final read rechecks live authorization and any durable participant replay without attempting another write; a concurrently committed duplicate therefore remains idempotent at the retry boundary.
- Each vote appends exactly one event and increments the revision by one. Pending group state, history and all derived fields are replay-validated on load. At most 128 decisions plus SUBMIT exist per request.

The `Request` and `Event` JSON shapes have not changed. `currentStepId` identifies the current stage. While pending, `approverId` is the first **undecided** participant in definition order; it is a compatibility representative, not the complete worklist or authorization rule. Java hosts must use `ApprovalService.pendingApproverIds(request)` for the full current worklist. An HTTP adapter must expose/derive a participant-aware worklist before enabling group definitions. `decision` and `comment` retain the latest individual vote, so a partial ANY group can correctly be `PENDING` with `decision: REJECT`. Terminal `approverId` remains the last deciding actor. History is authoritative.

## Persistence and rollout

JSON reads snapshot schemas 1, 2 and 3. Existing schema-2 mutations remain schema 2, with exactly the old sequential node shape. The first successful schema-3 write preserves the latest durable schema-2 bytes in a `.schema2.bak` backup (or a uniquely named backup if that name exists). Read-only opening does not rewrite files. Existing schema-1 migration and its `.schema1.bak` remain supported. Once upgraded, a file's wrapper stays schema 3 even if future routing is sequential; old request snapshots retain their original schema. Backups contain the same private data and require the same protection. The JSON store remains single-process only.

The JDBC tables do not change: request/event JSON and integer revisions already store one event per participant. Existing schema-2 retained versions, request JSON and audit rows remain readable without rewriting. Schema-3 definitions are new immutable versions; no DDL or automatic JSON import is performed. The request state and appended audit event still commit atomically under the existing revision/row-lock protocol. The `approver_id` SQL index is **not** a group inbox index; this small SPI reads requests then filters by all snapshotted participants.

Upgrade every service sharing a store before enabling schema 3; mixed old/new binaries are unsupported. An old binary intentionally cannot decode groups. Back up the whole JDBC database before rollout; file-store backups do not replace a coordinated deployment/restore plan. The standalone demo supports schema-3 publication and derives a participant-aware inbox from each saved definition and history. It uses only the fixed Bob/Carol demo accounts. Do not point the sequential-only RuoYi host at a schema-3 store; its publication endpoint still rejects schema 3. The core and existing sequential flows remain unchanged.

## Verification

Run the existing suites plus the new group tests:

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-jdbc/pom.xml verify
mvn -f examples/approval-demo/backend/pom.xml verify
```

`ParallelApprovalTest` covers completion/rejection, identity, replay, stale reads, restart, strict shapes, corrupted state and schema-2 upgrades. `ApprovalRetryBoundaryTest` fixes the exact last-CAS duplicate schedule, authorization changes and read failures. `JsonSchemaUpgradeTest` verifies pending old requests across publication/restart, backup collisions and retry after a failed atomic replacement. JDBC tests cover actual independent connections, transactional races, rollback and reload. Real PostgreSQL tests run only with `ARCFLOW_PG_URL`; an H2-only pass must not be reported as PostgreSQL verification. The existing official RuoYi workflow verifies sequential behavior and the schema-3 publication guard. The standalone group UI journey covers ALL/ANY editing, non-first-member votes, partial groups, repeated clicks, reload, immutable snapshots, errors and mobile layout. See the [UI guide](../examples/approval-ui/README.md).
