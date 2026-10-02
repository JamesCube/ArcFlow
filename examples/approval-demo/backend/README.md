# Approval demo backend

Local-only Spring Boot 3.5.16 / Java 17+ example. Spring Boot 3.5 has reached the end of open-source support; this requested Boot 3 baseline is **not a production recommendation**. Use an appropriately supported framework release and production security/persistence before deployment. Source: https://spring.io/blog/2026/06/25/spring-boot-3-5-16-available-now/

## Run

From the ArcFlow repository root, install the unchanged core first:

```sh
mvn install
export APPROVAL_ALICE_PASSWORD='replace-with-your-unique-alice-password'
export APPROVAL_BOB_PASSWORD='replace-with-your-unique-bob-password'
export APPROVAL_CAROL_PASSWORD='replace-with-your-unique-carol-password'
mvn -f examples/approval-demo/backend/pom.xml spring-boot:run
```

No default passwords. All three passwords must have at least 12 characters; startup fails otherwise. Set real unique values locally and do not commit them. Backend binds 127.0.0.1:8080, and the frontend's Vite development proxy forwards `/api`. Passwords are held in the browser's page memory only by the UI. Basic credentials are sent explicitly on each call. Use HTTPS for any non-loopback deployment (this demo should remain local).

`APPROVAL_DATA_FILE` defaults to `./data/requests.json` relative to the backend working directory; set an absolute path for predictable restarts. `APPROVAL_UI_ORIGIN` defaults to `http://localhost:5173`; set it to the exact frontend origin if using another port/hostname. No wildcard origins or CORS are enabled.

## Contract

Every endpoint requires HTTP Basic authentication. Users: `alice`, `bob`, `carol`. All can submit; only `bob` and `carol` can be selected as approvers, and self-approval is rejected. Actor identity always comes from the authenticated principal. Unknown JSON fields, including forged `applicantId`, are rejected.

- `GET /api/me`: `{id, displayName}`
- `GET /api/people`: array of the three demo identities
- `GET /api/process`: versioned neutral process description, with layout in a separate sibling object
- `GET /api/requests`: only requests submitted by, or assigned to, the authenticated user
- `POST /api/requests`: `{title, reason, days, approverId}`; creates a pending request (201)
- `POST /api/requests/{id}/decisions`: `{decision:"APPROVE"|"REJECT", comment?}`; only the assigned approver may decide

Every POST must include `Content-Type: application/json` and `X-Arcflow-Client: approval-demo`, as well as Authorization. Browser requests from foreign Origin / cross-site Fetch Metadata are rejected. The custom header prevents simple cross-origin forms from changing state even if a browser caches Basic credentials. No form login, cookie/session authentication, or Basic challenge dialog is used. Basic being stateless alone does not prevent CSRF: https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html

Request response fields: `id,title,reason,days,applicantId,approverId,status,createdAt,updatedAt,decision,comment,processId,processVersion,history`. Status is `PENDING`, `APPROVED`, or `REJECTED`. Ordered immutable history entries are `{actorId,action,comment,at}`; action is `SUBMIT`, `APPROVE`, or `REJECT`.

Repeated same decisions return the original result without adding history or changing the comment/time. An opposite decision returns 409. Rejection is terminal. An unrelated user gets 404 for decisions; the applicant who is not the approver gets 403. Error body is `{message}`. Submission retries create new requests: submission has no idempotency key; refresh after an uncertain result before retrying.

## Architecture and boundaries

`SubmissionWorkflow` calls the real dependency-free `ArcFlowEngine` using a two-node `validate → normalize` DAG. This performs synchronous business input processing. The existing core is **not modified** and does not suddenly gain human-task or durable workflow execution capabilities.

`ApprovalService` is the example-specific human-wait state layer: it starts a request in PENDING, authorizes the assigned person, then records exactly one terminal decision. `process.json` describes this supported single-approval shape with version 1. It is display/interchange metadata, not a general executable workflow language: editing it does not change the hard-coded service behavior. There is no arbitrary graph deployment, BPMN, gateway engine, multi-step configurable approval, enterprise identity provider, or production audit store.

All mutations serialize on one service monitor. The store takes a process-exclusive file lock and writes a complete JSON snapshot through a same-directory temporary file, forced to disk before atomic replace. Unsupported atomic moves fail closed. The in-memory result is published only after replacement. Startup restores records, and corrupt/unsupported snapshots fail startup. The lock prevents a second process from opening the same store on a supported local filesystem.

This is a small **single-JVM/local-filesystem** demo, not a database: no distributed coordination, bounded retention, encryption at rest, secure multi-tenant audit, schema migration, backup, or directory fsync/power-loss guarantee. Network filesystems and multiple replicas are unsupported. OS/process crashes after rename can leave a committed action whose response was lost; decision retry is safe. Abrupt power loss may lose the latest directory entry. Do not store real personnel/health data. Restrict the local data directory to your OS account.

## Verification

```sh
mvn -f examples/approval-demo/backend/pom.xml test
```

Tests cover real Basic authentication, forged actor rejection, validation, forbidden origins/missing anti-CSRF header, ownership filtering, assigned approver enforcement, approve/reject, duplicate decisions, concurrent duplicate/opposite decisions, immutable history, restart restoration, second-writer refusal and corrupt snapshot refusal. Test credentials are test-only and never applied to a normal run.
