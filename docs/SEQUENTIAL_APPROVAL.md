# Sequential approval contract (demo schema 2)

This document describes the independent local approval example, **not the Java DAG core**. See [setup](../examples/approval-demo/README.md) and the [HTTP API](../examples/approval-demo/backend/README.md). The supported execution model is deliberately small.

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

Array order is execution order. Definitions contain exactly one start, 1–8 approval nodes, and exactly one end, in that order. IDs are unique and stable. A definition has no edges, scripts, expressions, layout coordinates or hidden routing rules. The server rejects unsupported fields and node shapes rather than guessing their meaning.

Process ID is fixed to `leave-approval`; start/end node IDs are fixed. Other node IDs match `[A-Za-z][A-Za-z0-9_-]{0,63}`. Names are nonblank, at most 120 characters and contain no control characters. Only Bob and Carol are allowed as designated approvers in this demo. Repeating one person in different steps is permitted: those are separate decisions, not automatically skipped or grouped.

## Edit, publish, start

- Only Alice may publish. This hard-coded demo policy is not an enterprise role or Identity SPI.
- The UI edits a local draft; moving, adding or removing a node does not mutate the server's published definition.
- Publishing requires the expected current version. The server validates the entire definition and increments the version. A stale expected version conflicts, including a repeat publish after an ambiguous success.
- Each request copies the complete published definition and version. Publishing v3 does not rewrite an instance started with v2.
- Submission supplies the version the user reviewed. A changed version requires refresh and another submission; the server never silently starts a different sequence.
- An applicant cannot start a process assigning any step to themselves. Future self-approval is rejected before an instance is created.

## Step commands and visibility

The applicant and every assignee in the instance snapshot can inspect it. Only the current step's assignee may create a new decision. A decision command contains both request ID and step ID; authenticating as the correct person does not allow skipping to another step.

APPROVE completes one step. If another step exists, the request stays PENDING and exposes that next step's ID and assignee. APPROVE on the final step makes the request APPROVED. REJECT on any current step makes the request REJECTED, without creating later decisions.

A same-decision retry for an already completed step is authorized against that step's saved assignee, adds no event and returns the current instance. It cannot advance another step even if the same person is assigned again. The original step comment and time are retained. An opposite decision conflicts. The API does not promise byte-identical historical responses after subsequent steps have progressed.

Every instance exposes a read-only definition snapshot and ordered history. These are local JSON records, not a tamper-evident or regulated audit trail.

## Restart and previous demo data

The single-process store persists the published definition and all requests together by atomic file replacement. It validates restored definitions, step progress and history before serving requests. Normal process restart retains the sequence, current step and replay behavior.

Existing schema-1 single-approver records are validated before migration. Each receives a matching one-step definition and step-aware history; existing IDs, actors, decisions, comments and timestamps are preserved. Reading does not rewrite the old file. The first successful schema-2 mutation preserves a byte-exact schema-1 backup alongside the data file. An older binary cannot read the new schema: do not alternate old and new applications against one data file. Backups contain the same data and need the same OS-account access restrictions.

This is a localhost/synthetic-data example, not a distributed workflow service. Conditional branches, parallel approvals, delegation, claim/reassign, cancellation, timers, expression execution, arbitrary graph imports, BPMN compatibility and RuoYi integration remain outside this milestone. The core's synchronous DAG validation/normalization integration is unchanged.
