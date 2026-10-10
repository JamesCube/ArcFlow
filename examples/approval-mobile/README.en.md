# H5 mobile approval client

<!-- Legacy fragments remain entry points after the language split. -->
<a id="arcflow-mobile-approval-client--移动审批"></a>
<a id="architecture--结构"></a>
<a id="current-local-integration--当前本地组合"></a>
<a id="dependency-note--依赖说明"></a>
<a id="run-locally--本地运行"></a>
<a id="scope--边界"></a>
<a id="verification--验证"></a>

[简体中文](README.md)


<!-- topic:scope -->
Applies to the current uni-app Vue 3, H5-first client for the standalone Spring backend. Publish a process and create synthetic leave/procurement requests on desktop, then use this client for pending tasks, saved details, individual history, handled work and approve/reject decisions. Mobile submission and process editing are unsupported. No Android, iOS or mini-program build has been verified.

Ordinary browsers use real demo accounts and server results, without preloaded business data or simulated success. Feishu, WeCom and DingTalk adapters remain unconfigured; their host parameters and unknown hosts show an unconfigured page, never a fallback demo identity. No platform OAuth, SDK, notifications or enterprise application has been created.

<!-- topic:run -->
## Run locally

Use JDK 17+, Maven, Node.js matching package.json, and npm. From the repository root:

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
read -rs -p 'Alice demo password: ' APPROVAL_ALICE_PASSWORD; echo
read -rs -p 'Bob demo password: ' APPROVAL_BOB_PASSWORD; echo
read -rs -p 'Carol demo password: ' APPROVAL_CAROL_PASSWORD; echo
export APPROVAL_ALICE_PASSWORD APPROVAL_BOB_PASSWORD APPROVAL_CAROL_PASSWORD
export APPROVAL_UI_ORIGIN='http://127.0.0.1:5174'
mvn -f examples/approval-demo/backend/pom.xml spring-boot:run
```

Choose three different passwords, each at least 12 characters and no more than 72 UTF-8 bytes. Set a private absolute `APPROVAL_DATA_FILE` when retaining data. In another terminal:

```sh
cd examples/approval-mobile
npm ci
npm run dev:h5
```

Open `http://127.0.0.1:5174`. The proxy defaults to backend port 8080; `ARCFLOW_BACKEND_PORT` overrides it. localhost and 127.0.0.1 are different Origins. Writes still require `X-Arcflow-Client: approval-demo`.

To create initial requests, temporarily run the desktop UI on 5174 with `npm run dev -- --port 5174`. Stop it before starting H5; do not bind both to the same port. The compiler launcher uses upstream CI mode to disable optional update/usage reporting and machine-ID collection. App statistics are disabled.

<!-- topic:behavior -->
## Sessions, paging and decisions

- Basic credentials remain in page memory. Reload requires sign-in while preserving an opaque `?task=<id>` deep link. There is no default password or persistent browser session.
- Pending and handled use separate member pages and cursors. Handled means a real vote even when others still need to review. A person assigned again later can see the same request in both boxes.
- Details come from the compatible visible-request list; no single-request GET exists. Saved sequential/ALL/ANY definitions drive read-only display. The compatibility `approverId` is not full membership.
- Procurement displays immutable item, integer quantity, exact price, total and currency, without attachment, due-date or tenant fields. Notes belong to decisions, not an independent chat endpoint.
- Duplicate clicks are blocked and confirmation stays bound to the original request/stage/decision. Uncertain writes recover saved state; an old note cannot apply to a later stage. Identity changes, sign-out and newer refreshes invalidate older responses.

Native H5 button/input/textarea/label wrappers provide keyboard and label behavior. Other platforms still need controls, transport and navigation. A 404 or authorization test in this single-tenant demo does not establish tenancy or production SSO.

<!-- topic:verify -->
## Verify and troubleshoot

Run the first three commands from the mobile directory and the last two from the repository root. Package the backend before HTTP checks:

```sh
npm run typecheck
npm test
npm run build:h5
```

```sh
python3 examples/approval-mobile/scripts/verify-http.py
python3 examples/approval-mobile/scripts/verify-documents-http.py
```

Harnesses use isolated stores and temporary passwords; never target personnel data. Check matching credentials after login failure, Origin after rejected writes, and original filters when retrying a page. Never reuse another identity's cursor.

`src/domain/api.ts` owns endpoint allowlists and sanitized errors; `model.ts` derives display state; `workspace.ts` handles response generations, confirmation and recovery; `src/platform/` contains adapters; `Workspace.vue` provides the single-column tasks, history and safe-area controls.

[Acceptance](ACCEPTANCE.en.md), [real HTTP evidence](HTTP_VERIFICATION.en.md), [independent review](REVIEW.en.md) and [member paging history](MEMBER_INBOX_ADOPTION.en.md) record earlier revisions, not current CI. Recheck upstream compiler risks against the current lockfile; historical audit counts are not live results. Platform integration, devices, cross-browser behavior and production security require separate acceptance.
