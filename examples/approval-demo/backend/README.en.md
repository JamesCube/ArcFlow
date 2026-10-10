<!-- topic:scope -->
# Standalone approval backend

<!-- Legacy fragments remain entry points after the language split. -->
<a id="en"></a>
<a id="english"></a>
<a id="zh"></a>
<a id="存储和验证"></a>
<a id="独立审批后端--standalone-approval-backend"></a>
<a id="简体中文"></a>
<a id="身份与-http-边界"></a>
<a id="运行"></a>

[简体中文](README.md)


This local host on current `main` uses **Spring Boot 4.1.1 and Java 17+**, with a temporary Jackson 2 compatibility module to preserve shared approval contracts. Domain/JDBC build parents and native RuoYi upstream did not migrate with it; see [host migration boundaries](../../../docs/SUPPORTED_HOST_MIGRATION.en.md). Use loopback and synthetic data. Demo accounts, JSON storage, and a framework upgrade do not establish production readiness.

<!-- topic:run -->
## Run

Use a full JDK 17+, Maven 3.9+, and Bash for these interactive commands. Install local dependencies from the repository root first:

```bash
mvn install
mvn -f examples/approval-domain/pom.xml install

umask 077
mkdir -p "$PWD/examples/approval-demo/backend/data"
export APPROVAL_DATA_FILE="$PWD/examples/approval-demo/backend/data/requests.json"
export APPROVAL_UI_ORIGIN='http://localhost:5173'
read -rs -p 'Alice demo password: ' APPROVAL_ALICE_PASSWORD; echo
read -rs -p 'Bob demo password: ' APPROVAL_BOB_PASSWORD; echo
read -rs -p 'Carol demo password: ' APPROVAL_CAROL_PASSWORD; echo
export APPROVAL_ALICE_PASSWORD APPROVAL_BOB_PASSWORD APPROVAL_CAROL_PASSWORD
mvn -f examples/approval-demo/backend/pom.xml spring-boot:run
```

There are no default passwords. Choose three different demo-only values, each at least 12 characters and at most 72 UTF-8 bytes. The backend binds to `127.0.0.1:8080`; the standalone Vite UI proxies `/api`. Without `APPROVAL_DATA_FILE`, the path is `./data/requests.json` relative to the backend working directory. Reuse one absolute path on restart. If the frontend address changes, set its exact `APPROVAL_UI_ORIGIN`; there are no wildcard origins or open CORS rules.

See [development setup](../../../docs/development/QUICKSTART.en.md#en) for frontend startup, Node versions, dependency order, and troubleshooting.

<!-- topic:transport -->
## Authentication and HTTP boundaries

- `/api/**` requires Basic authentication as `alice`, `bob`, or `carol`. The server derives actors from the authenticated Principal; client JSON cannot override applicant or voter identity.
- Alice can publish; Bob/Carol can be assigned. Only eligible members of the saved current stage can vote. Publishers/administrators cannot vote on another person's behalf.
- POST uses `Content-Type: application/json` and `X-Arcflow-Client: approval-demo`. Foreign Origin, cross-site Fetch Metadata, and missing client headers are rejected. There is no form login, session authentication, or browser Basic challenge dialog.
- HTTP uses the shared strict Jackson 2 mapper: unknown/duplicate fields, trailing content, and invalid numeric/scalar coercions fail. Do not send client-computed routes, derived totals, or scripts.

The [API reference](../../../docs/api/API_REFERENCE.en.md) is the consolidated contract for paths, fields, responses, authorization, errors, and retries. [Runnable examples](../../../docs/api/examples/README.en.md) accompany it. Endpoint families are:

| Family | Accepted scope |
| --- | --- |
| `/api/process`, `/api/requests`, `/api/documents` | Main leave/procurement process, legacy leave creation, typed documents, and member inbox |
| `/api/crm` | Isolated quotes, fixed Bob → Carol, with source-version/ownership checks |
| `/api/scenarios/{scenarioId}/...` | Six exact-type scenarios; submissions require `Idempotency-Key`, with separate processes/stores |

The domain has nine types, but generic `/api/documents` accepts only `leave`/`procurement`. The six catalog IDs are `oa-expense`, `oa-travel`, `oa-seal-use`, `erp-receiving`, `erp-payment`, and `crm-contract`. Only expense, receiving, payment, and contract permit conditional definition schema 4. See [architecture](../../../docs/development/ARCHITECTURE.en.md#en) for the full map and SINGLE/ALL/ANY semantics.

<!-- topic:persistence -->
## Persistence and verification

The main file, adjacent quote file, and six scenario files each use single-writer JSON storage. Current readers strictly accept wrappers **1–13**. Files upgrade monotonically when content requires it; definition schema **4** requires wrapper **13**. SQL revision **3** belongs to the separate optional JDBC adapter; this host never switches to a database automatically.

Stop incompatible readers/writers, back up every file, and deploy compatible binaries before upgrading. Reads do not rewrite files; format increases save exact immediately-preceding bytes. Restoring an old backup loses later changes. See [persistence and migration](../../../docs/development/PERSISTENCE.en.md#en) for the version matrix and rollout steps.

```bash
# From the repository root after installing core and domain
mvn -f examples/approval-demo/backend/pom.xml verify
```

Tests cover HTTP/security and scenario boundaries. After packaging, run relevant live-HTTP and Playwright checks using the [layered checklist](../../../docs/development/QUICKSTART.en.md#en) and [host CI](../../../.github/workflows/approval-demo.yml). Test presence is not a passing current-commit result. Host dependency verification does not replace native RuoYi, H5, or database acceptance.
