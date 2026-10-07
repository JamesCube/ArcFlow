# Parallel participant groups (domain schema 3)

共享审批领域库支持会签 `ALL` 和或签 `ANY`。参与人随申请一起保存，每人的决定与审计事件在同一次提交中写入。独立 Vue / Spring Boot 示例可以配置分组、逐人投票并查看结果；若依原生界面和接口也支持从真实用户中选择分组成员，并为他们显示待办。条件分支、任意图形汇聚、动态加签和转办还未实现，生产使用也未经验证。

## Scope and definition

These groups belong to the human-approval example. They do not add parallel execution to the dependency-free Java DAG core. Stages run in array order: start → 1–8 approval stages → end. Schema 2 keeps its existing sequential definition and node JSON. Schema 3 accepts those nodes plus `parallelApproval`:

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

A group needs 2–16 distinct stable user IDs, `assigneeId: null`, and a completion mode of `ALL` or `ANY`. The server rejects empty or single-member groups, duplicate IDs, unknown or missing fields, mixed singular/group assignments, and scalar coercion. IDs, names and the fixed process ID `leave-approval` follow the [sequential contract](SEQUENTIAL_APPROVAL.md). Each request keeps the definition and participants saved at submission. Later publications do not change it, and participants are not resolved again or added dynamically.

## Completion and rejection

| Mode | An APPROVE vote | A REJECT vote |
| --- | --- | --- |
| ALL (AND / 会签) | Wait until every participant approves, then advance | Reject the request immediately |
| ANY (OR / 或签) | Advance immediately | Wait until every participant rejects, then reject the request |

All members who have not voted can review the current group at the same time. Later stages remain inactive. When a group closes, members who did not vote get no automatic decision. A rejected group ends the request; an approved group advances to the next stage, or marks the request APPROVED if it was the last stage.

When different participants submit competing approve/reject votes, ALL rejects and ANY approves, whichever vote commits first. If the first committed vote closes the group, the other participant gets a conflict and no history entry is added for that vote. Two different decisions from the same participant conflict: the first saved decision wins, as it does for sequential steps. ANY does not give each participant a veto. Quorum, majority voting and arbitrary graph joins are not supported.

## Commands, identity and compatibility fields

Use `decide(authenticatedActor, requestId, stepId, decision, comment)`. Pass the group ID as `stepId` and obtain the actor from the trusted host session. Retries are identified by `(request ID, step ID, actor ID)`:

- The applicant and all participants in the saved definition may view the request. Responses to unrelated users do not reveal whether it exists.
- Only an active participant in the specified current stage may add a decision. Publication and new submissions check that every participant is active and eligible. A new submission fails if the applicant is assigned anywhere in the process. Accepted keyed submissions follow the [submission retry rules](SUBMISSION_IDEMPOTENCY.md#intent-and-replay--请求意图与重放).
- Retrying an existing vote with the same decision returns the current saved state and keeps the original event, comment and timestamp, even after the stage or request closes. Changing that decision conflicts.
- A participant who never voted cannot replay someone else's vote, vote after the stage closes or jump to a later stage. Repeating the same person in a later stage requires a separate decision there.
- Decision writes have a fixed 16-attempt compare-and-set budget. After the last miss, one final read rechecks live authorization and any durable participant replay without attempting another write; a concurrently committed duplicate therefore remains idempotent at the retry boundary.
- Each vote appends exactly one event and increments the revision by one. Pending group state, history and all derived fields are replay-validated on load. At most 128 decisions plus SUBMIT exist per request.

The `Request` and `Event` JSON shapes have not changed. `currentStepId` identifies the current stage. While pending, `approverId` is the first **undecided** participant in definition order; it is a compatibility representative, not the complete worklist or authorization rule. Java hosts must use `ApprovalService.pendingApproverIds(request)` for the full current worklist. An HTTP adapter must expose/derive a participant-aware worklist before enabling group definitions. `decision` and `comment` retain the latest individual vote, so a partial ANY group can correctly be `PENDING` with `decision: REJECT`. Terminal `approverId` remains the last deciding actor. History is authoritative.

## Persistence and rollout

The schema-3 change accepts JSON snapshot schemas 1, 2 and 3. Sequential writes stay at schema 2, with the old node shape, until the first schema-3 write. That write saves the latest schema-2 file bytes in `.schema2.bak`, choosing a unique name if needed. Opening a file for reading does not rewrite it. Schema-1 migration and `.schema1.bak` backups remain supported. After the upgrade, the file wrapper stays at schema 3 even if later definitions are sequential; existing request snapshots keep their original schemas. Protect backups as carefully as the source data. The JSON store still supports only one process.

The later [submission-idempotency update](SUBMISSION_IDEMPOTENCY.md#json) adds snapshot schema 4. Its upgrade rules take over when keyed submissions are used; process-definition schemas remain 2 and 3.

Groups need no changes to the JDBC tables: request/event JSON and integer revisions already allow one event per participant. Existing schema-2 versions, requests and audit rows remain readable without rewriting. Schema-3 definitions are saved as new immutable versions, with no DDL or automatic JSON import. The request state and new audit event commit together using the existing revision checks and row locks. The `approver_id` SQL index cannot serve a group inbox; the SPI reads requests and filters them by their saved participants.

Upgrade every service sharing a store before enabling schema 3. Older binaries cannot decode groups, and running old and new versions together is unsupported. Back up the whole JDBC database and plan how to deploy and restore all hosts together. File-store backups alone do not cover that.

The standalone demo accepts schema-3 publication and builds each participant’s inbox from the saved definition and history. It uses the fixed Bob/Carol accounts. The current [native RuoYi host](../examples/ruoyi-vue3/README.md#configure-and-vote-in-groups) also accepts schema 3, with participants selected from the real user directory. Upgrade older sequential-only RuoYi hosts before enabling groups so their editor, worklists and decision controls understand participants. The core and existing sequential flows are unchanged.

## Verification

Run the approval suites, including the group tests:

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-jdbc/pom.xml verify
mvn -f examples/approval-demo/backend/pom.xml verify
```

`ParallelApprovalTest` covers completion/rejection, identity, replay, stale reads, restart, strict shapes, corrupted state and schema-2 upgrades. `ApprovalRetryBoundaryTest` fixes the exact last-CAS duplicate schedule, authorization changes and read failures. `JsonSchemaUpgradeTest` verifies pending old requests across publication/restart, backup collisions and retry after a failed atomic replacement. JDBC tests cover actual independent connections, transactional races, rollback and reload. Real PostgreSQL tests run only with `ARCFLOW_PG_URL`; an H2-only pass does not verify PostgreSQL. The official RuoYi workflow covers sequential and ALL/ANY publication/votes against real MySQL/Redis, strict group shapes, assignment/RBAC checks, inactive/deleted members, replay/conflict and restart, followed by native Chromium group editing and votes. Check the completed CI run for the commit you plan to use. The standalone group UI journey covers ALL/ANY editing, non-first-member votes, partial groups, repeated clicks, reload, immutable snapshots, errors and mobile layout. See the [UI guide](../examples/approval-ui/README.md).
