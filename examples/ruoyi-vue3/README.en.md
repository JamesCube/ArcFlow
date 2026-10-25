# Native RuoYi integration

<!-- Legacy fragments remain entry points after the language split. -->
<a id="boundaries"></a>
<a id="bounded-member-inbox-api"></a>
<a id="configure-and-vote-in-groups"></a>
<a id="connect-real-users"></a>
<a id="durable-submission-retries--持久化提交重试"></a>
<a id="official-ruoyi-vue--vue-3-integration-example"></a>
<a id="prepare"></a>
<a id="procurement-forms--采购表单"></a>
<a id="typed-business-documents--类型化业务单据"></a>
<a id="upstream-attribution"></a>
<a id="verification"></a>

[简体中文](README.md)


<!-- topic:scope -->
Applies to the current ArcFlow overlay and official RuoYi backend/Vue 3 frontend pinned by `upstream-lock.json`. RuoYi owns login, JWT/Redis, numeric user IDs, menus and permissions. ArcFlow adds ordered and ALL/ANY processes, leave/procurement, and a separate native travel graph workspace with immutable snapshots and individual history. Upstream MIT and ArcFlow Apache-2.0 licenses remain separate.

MySQL stores RuoYi users, roles and menus; approval state is still a private single-writer JSON file. This example does not automatically wire JDBC, join business SQL transactions, cluster approval storage or provide tenancy. Administrator wildcards never replace saved participant assignments. The overlay adds no second security chain or demo authentication and makes no global Jackson change.

<!-- topic:prepare -->
## Prepare the official host

Use Git, Python 3, JDK 17, Maven 3.9+, Node 22, MySQL 8.4 and Redis 7.4 with a fresh disposable local database. From the repository root:

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
python3 examples/ruoyi-vue3/bootstrap.py --directory examples/ruoyi-vue3/.work
```

The destination must be empty. Bootstrap fetches and verifies pinned commits, copies the overlay and adds a domain dependency to ruoyi-admin. It changes only the logging directory to `ARCFLOW_LOG_DIR` (default `./logs`), retaining audit appenders and authentication.

Create an empty `ry-vue` database and import `.work/backend/sql/ry_20260417.sql`, `.work/backend/sql/quartz.sql`, then this example's `sql/menu.sql`. Upstream SQL includes sample accounts: change their passwords through normal RuoYi administration and keep services on loopback. menu.sql adds menus/permissions only. Menu-ID collisions fail rather than overwrite existing menus.

<!-- topic:identity -->
## Configure users, permissions and startup

Create an applicant and two approvers in native RuoYi role/user administration. Assign the parent menu, workspace and required button permissions:

| Permission | Purpose |
| --- | --- |
| `arcflow:request:read` | Open the workspace and view the process and permitted requests |
| `arcflow:request:submit` | Submit requests |
| `arcflow:request:decide` | Vote only on a personally eligible current stage |
| `arcflow:process:publish` | Publish the next version |

Refresh or sign in again after permission changes. Every ArcFlow request rechecks database account status. Assignee selection returns only IDs/display names; disabled or deleted users cannot receive new assignments.

Set the disposable database, JWT secret, private writable data path and initial numeric approver ID required by `backend/src/main/resources/application-arcflow.yml`. Never commit credentials.

```sh
mvn -f examples/ruoyi-vue3/.work/backend/pom.xml package
java -jar examples/ruoyi-vue3/.work/backend/ruoyi-admin/target/ruoyi-admin.jar \
  --spring.profiles.active=druid,arcflow
```

In another terminal:

```sh
cd examples/ruoyi-vue3/.work/frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173`, use normal RuoYi login and CAPTCHA, then open the ArcFlow workspace. Publish two stages and complete them as applicant and assigned reviewers. Later stages cannot vote early, and existing requests retain their original version.

<!-- topic:contract -->
## Process, document and retry contracts

- Stages use SINGLE/ALL/ANY; groups require 2–16 distinct numeric-string IDs. Roles never resolve automatically to members. ALL ends on any rejection; ANY rejects only after every member rejects. Repeated participants vote separately by stage.
- New publication/submission requires active assignments. Disabled/deleted actors cannot act or replay, but saved IDs/votes remain readable. Administrators have no participant bypass.
- Legacy leave uses `POST /arcflow/requests`; typed leave/procurement use `POST /arcflow/documents` with `{business,processVersion}`. Responses retain RuoYi AjaxResult, not the standalone host's direct envelope.
- Native forms cover leave/procurement. The page-local language switch changes neither RuoYi navigation nor account preferences. Procurement preserves exact raw numbers and immutable details; `3 × USD 0.10` equals `USD 0.30`. It never pays, converts currency or sends purchase orders.
- Optional Idempotency-Key binds to the authenticated applicant. Uncertain responses retain original endpoint, normalized intent, key and process version. Equal intent returns the current original request; changed intent conflicts. A definitive stale-version rejection can reset after refresh; ambiguous errors retain the key. Reload/sign-out loses it, so inspect saved records before resubmitting.
- Native keyed calls bypass only the short-window duplicate-submit interceptor, retaining authentication and RBAC. Shared helpers must match canonical bytes; bootstrap fails on drift.
- `/arcflow/requests/inbox` uses read permission and returns `{items,nextCursor}` in AjaxResult.data. Pending/handled have independent pages and filters. Cancelled/late responses cannot enter another session. Applicant/history lists retain compatible routes.

Definition schemas 2/3, keyed wrapper 4 and typed minimum wrapper 5 are not the highest current file version. Follow [persistence and migration](../../docs/development/PERSISTENCE.en.md), back up and upgrade every reader, and never mix incompatible writers. The separate travel graph supports bounded FIRST_MATCH cost routing and parallel ALL joins; other standalone graph families are not mounted by this native host.

## Native travel graph (separate workspace)

Menu `出差图工作台` (`arcflow/graph/index`, menu ID 21006) mounts **travel only**, not the standalone multi-scenario hub. `/arcflow/graphs/travel` uses the same real JWT session and read/submit/decide/publish permission vocabulary above. Permissions do not replace active-account, selected-participant or task-assignment checks; admin cannot vote for a reviewer. Assignee choices additionally require current read and decide permissions.

Configure `ARCFLOW_TRAVEL_MANAGER_ID`, `ARCFLOW_TRAVEL_OPERATIONS_ID`, and `ARCFLOW_TRAVEL_FINANCE_ID` with existing numeric RuoYi user IDs (example defaults 101/101/102). These configure only a fresh store; they never rewrite saved definitions or historical assignments. They are explicit user assignments, not automatic role-to-user resolution. The initial route is manager → estimated-cost gateway: below CNY 10,000 finishes; at/above CNY 10,000 activates independent operations and finance tasks, then waits for both. Rejection cancels remaining work.

`ARCFLOW_TRAVEL_GRAPH_DATA_FILE` defaults to `${ARCFLOW_DATA_FILE}.travel.graph.json`. It is a distinct private, single-writer JSON file: **storage wrapper 14**, **graph schema 6**, process ID `travel-graph`. It does not migrate or overwrite sequential leave/procurement state, and it does not enable JDBC or clustering. Back up both files. Corruption or a second writer fails closed; never delete state to bypass a startup error.

Graph submissions and decisions require exactly one valid `Idempotency-Key`. Same-key/same-intent replay returns current saved state, including after restart or a newer publication; changed intent conflicts. A waiting join retains its original definition/business/tasks/history. Draft/publication revisions use optimistic concurrency. The native transport retains raw decimal parsing, uses Bearer authentication and `AjaxResult.data`, bypasses only keyed repeat-submit suppression, and discards stale responses after session changes. No standalone Basic login is copied into the native dependency closure.

This scope does not add payment/receiving/quote graph routes, external CRM, H5 graph adoption, arbitrary BPMN, or production readiness. The authored native graph smoke must run against real MySQL/Redis and the packaged official host before claiming runtime acceptance.

<!-- topic:verify -->
## Verify, recover and attribute

Follow the [test guide](tests/README.en.md) for real MySQL/Redis, official login, HTTP and official-frontend Chromium checks. Fixtures create temporary accounts and disable CAPTCHA only in the disposable CI database; never apply them to a real installation. Browser checks depend on smoke-created processes and identities; do not run browser.py alone.

Check exact source and CI results before trusting artifacts. Authored tests are not a pass. Screenshots include only signed-in workspaces, never login screens, HAR or sessions; CI retains them for seven days. For permission failures, inspect RuoYi role caches and account status. Follow JSON migration recovery for storage problems instead of deleting data to hide an error.

Continue with [native screenshots](../../docs/RUOYI_SHOWCASE.en.md), [API reference](../../docs/api/API_REFERENCE.en.md) and [member inbox](../../docs/MEMBER_INBOX.en.md). This Chromium coverage does not establish cross-browser, accessibility or production readiness.

Official sources: [RuoYi-Vue](https://github.com/yangzongzhuan/RuoYi-Vue/tree/a51a838b71b446ea27256900efe7ed2faa2a02fd) and [RuoYi-Vue3](https://github.com/yangzongzhuan/RuoYi-Vue3/tree/838965c5a18d2c61b73ec30c6e288057aaa08b63), MIT, Copyright (c) 2018 RuoYi. Bootstrap retains both LICENSE files; the example does not imply upstream endorsement.
