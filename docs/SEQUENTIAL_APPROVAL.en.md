# Sequential approval contract (demo schema 2)

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](SEQUENTIAL_APPROVAL.md) · [Documentation](README.en.md)

This document records the schema-2 rules for the local approval example. Those rules still apply to sequential definitions. The current hosts also support [schema-3 ALL/ANY groups](PARALLEL_APPROVAL.en.md). For setup and endpoints, see the [example guide](../examples/approval-demo/README.en.md) and [HTTP API](../examples/approval-demo/backend/README.en.md). The Java DAG core has a separate execution model.

<!-- topic:definition -->
## Definition

```json
{
  "schemaVersion": 2,
  "id": "leave-approval",
  "version": 2,
  "name": "Leave approval",
  "nodes": [
    {"id": "start", "type": "start", "name": "Submit leave", "assigneeId": null},
    {"id": "manager", "type": "approval", "name": "Manager review", "assigneeId": "bob"},
    {"id": "finance", "type": "approval", "name": "Second review", "assigneeId": "carol"},
    {"id": "end", "type": "end", "name": "Completed", "assigneeId": null}
  ]
}
```

Nodes run in array order: one start, 1–8 approval nodes, then one end. IDs must be unique and stable. Definitions contain no edges, scripts, expressions, layout coordinates or implicit routing. The server rejects unsupported fields and node shapes.

The demos use process ID `leave-approval`. The domain also accepts configured process IDs matching `[A-Za-z][A-Za-z0-9_-]{0,127}`; publication cannot change that ID. The start/end node IDs are fixed. Other node IDs must match `[A-Za-z][A-Za-z0-9_-]{0,63}`. Names must be nonblank, contain no control characters and fit within 120 characters. The standalone demo allows only Bob and Carol as approvers. You can assign the same person to more than one step; they must decide each step separately.

<!-- topic:edit-publish-start -->
## Edit, publish, start

- Only Alice may publish in the standalone demo. That permission is fixed by the demo directory rather than enterprise role management; see the [current identity integration](development/ARCHITECTURE.en.md).
- Moving, adding or removing nodes changes only the local draft until you publish.
- Publication includes the version the editor expects. The server checks the whole definition and increments the version. If the expected version is stale, publication conflicts. This also applies when publication succeeded but its response was lost, and the client retries.
- Each request copies the complete published definition and version. Publishing v3 does not rewrite an instance started with v2.
- A new submission includes the process version the user reviewed. If it has changed, refresh and submit again so the user can review the new sequence. A retry of an accepted keyed submission returns its saved request even after publication changes; see [submission idempotency](SUBMISSION_IDEMPOTENCY.en.md).
- An applicant cannot create a new request if any step assigns them as an approver. The server checks this before creating the instance, including assignments in later steps.

<!-- topic:step-commands-and-visibility -->
## Step commands and visibility

The applicant and all assignees in the saved definition can view the request. Only the current step's assignee can add a decision. Each command includes the request ID and step ID, so even an authorized assignee cannot skip ahead.

APPROVE completes the current step. If there is another step, the request stays PENDING and returns the next step’s ID and assignee. Approving the final step makes the request APPROVED. REJECT ends the request as REJECTED, with no decisions added for later steps.

Retrying the same decision on a completed step checks the saved assignee, adds no event and returns the current instance. It keeps the original comment and timestamp. A retry cannot advance another step, even when the same person is assigned there; changing the decision conflicts. Because the response contains current state, it may differ from the original response after later steps progress.

Each instance includes a read-only definition snapshot and history in event order. These local JSON records provide no tamper-evidence or regulated-audit guarantees.

<!-- topic:restart-and-previous-demo-data -->
## Restart and previous demo data

The single-process store saves the published definition and all requests together by atomically replacing a file. On startup, it checks the restored definitions, step progress and history before serving requests. A normal restart preserves the sequence, current step and retry behavior.

Schema-1 single-approver records are checked before migration. Each gets a matching one-step definition and history with step IDs; existing IDs, actors, decisions, comments and timestamps stay unchanged. Reading the old file does not rewrite it. The first successful schema-2 write saves a byte-for-byte schema-1 backup beside the data file. Older binaries cannot read the new schema, so do not switch between old and new applications on one file. Protect backups with the same OS-account access restrictions as the original data.

Use this example on localhost with synthetic data. The original schema-2 milestone did not include parallel approvals or RuoYi integration; both were added later. These sequential hosts do not support conditional branches, delegation, claim/reassign, cancellation, timers, expression execution, arbitrary graph imports, or BPMN compatibility. Current restricted routing in three dedicated scenarios is documented [separately](CONDITIONAL_ROUTING.en.md). The core’s synchronous DAG validation/normalization integration is unchanged.

Both current HTTP hosts accept sequential definitions and [schema-3 fixed-participant ALL/ANY groups](PARALLEL_APPROVAL.en.md). Their support for groups does not change the schema-2 rules described here.
