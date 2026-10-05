# Official RuoYi-Vue + Vue 3 integration example

This is an **overlay on the real official RuoYi applications**, not a rebranded standalone login page. `upstream-lock.json` pins exact upstream commits. The bootstrap retains both upstream repositories and their MIT license files. ArcFlow's code remains Apache-2.0.

[View the native integration screenshots and walkthrough](../../docs/RUOYI_SHOWCASE.md) · [查看原生集成实拍](../../docs/RUOYI_SHOWCASE.md#简体中文)

## Boundaries

- RuoYi owns login, JWT/Redis sessions, immutable numeric user IDs, menu routes, roles and permission checks.
- ArcFlow contributes the single-reviewer / ALL / ANY stage editor, submissions, immutable request snapshots, per-participant votes and audit history.
- **MySQL stores RuoYi users/roles/menus. Approval state is still a single-writer local JSON file.** This example is not a clustered/production workflow database, transaction coordinator or SQL persistence adapter. Keep the data file and backups private and persistent. Do not run two application instances against it.
- A RuoYi administrator's wildcard permission never overrides the approval's snapshotted participants. IDs in snapshots remain readable after account deletion; new actions and new assignments require active accounts.
- No alternative security filter chain, global Jackson customization, raw `SysUser` response or demo authentication is installed.

## Prepare

Requirements: Git, Python 3, Java 17, Maven 3.9+, Node 22, MySQL 8.4 and Redis 7.4. Use a new **disposable local database**, never point the example seed scripts at production.

From the ArcFlow repository root:

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
python3 examples/ruoyi-vue3/bootstrap.py --directory examples/ruoyi-vue3/.work
```

Bootstrap requires an empty destination, fetches and verifies the exact commits, then copies only ArcFlow's overlay files and adds one Maven dependency to `ruoyi-admin`. It changes only the upstream log directory to `ARCFLOW_LOG_DIR` (default `./logs`), retaining all audit appenders. It does not modify the source repositories or replace their authentication.

Create an empty database named `ry-vue`, then import these files in order using your normal MySQL client:

1. `.work/backend/sql/ry_20260417.sql`
2. `.work/backend/sql/quartz.sql`
3. `sql/menu.sql` from this example

The upstream SQL contains its own sample accounts. Keep services bound to localhost, change sample passwords using RuoYi's supported account administration, and never expose this database or server publicly. `menu.sql` adds only menu/permission rows; it does not add users or passwords. Menu ID collisions intentionally fail instead of overwriting existing menus.

## Connect real users

In RuoYi's native role/user management, create an applicant and two approvers. Assign the ArcFlow parent/page menu and appropriate button permissions to their roles:

| Permission | Meaning |
| --- | --- |
| `arcflow:request:read` | Open the page, see the process and own/assigned requests |
| `arcflow:request:submit` | Submit a request |
| `arcflow:request:decide` | Vote only as a personally assigned, not-yet-voted current-stage participant |
| `arcflow:process:publish` | Publish the next process version |

Refresh/login again after role changes, as RuoYi owns permission caching. The adapter rechecks database account status on each ArcFlow request. The assignee picker returns only ID and display name; inactive/deleted users cannot receive new assignments.

Set the profile's required environment variables (see `backend/src/main/resources/application-arcflow.yml`) for your disposable database, JWT secret, private writable data path and initial approver's numeric user ID. Never check credentials into source control.

```sh
mvn -f examples/ruoyi-vue3/.work/backend/pom.xml package
java -jar examples/ruoyi-vue3/.work/backend/ruoyi-admin/target/ruoyi-admin.jar \
  --spring.profiles.active=druid,arcflow
```

In a second terminal:

```sh
cd examples/ruoyi-vue3/.work/frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173`, use RuoYi's actual login (including its normal CAPTCHA), then open **ArcFlow → 审批工作台**. Publish a process with two different approvers. Log in as the applicant to submit, then as each approver in order. The later approver cannot jump ahead. Existing requests retain the process version they were submitted against.

## Configure and vote in groups

Each native editor stage offers **单人审批**, **全员同意（ALL）** or **任一同意（ANY）**. Switching to a group keeps the original reviewer and stable node ID; choose the other participants explicitly from RuoYi's active directory. Groups require 2–16 distinct numeric-string user IDs. No role membership is expanded dynamically.

- ALL: everyone must approve; one rejection ends the request.
- ANY: one approval completes the stage; rejection ends the request only after everyone rejects.
- Stages remain ordered. A later stage cannot vote early. One person may vote once in each stage they belong to.
- **待我审批** uses every unvoted participant in the current snapshotted stage, not the legacy `approverId` compatibility field. Partial votes keep the stage current; snapshot details show each member's vote and whether further votes are needed.
- Publication upgrades group definitions to schema 3. Existing schema-2 definitions/requests remain supported. Running requests retain their original participants and policy after later publication.
- Disabled/deleted accounts cannot publish, submit or vote. New publication and submission require every assigned participant to be active. Historical IDs/votes remain readable after deletion, using the stable ID if no display name is available.

The domain's JSON upgrade creates a private schema-2 backup on the first schema-3 write; see [migration and rollout boundaries](../../docs/PARALLEL_APPROVAL.md#persistence-and-rollout). Back up the data and upgrade the host before enabling groups; do not run an older sequential-only binary against schema-3 state. Approval storage remains single-writer JSON. This does not wire JDBC into RuoYi or add tenancy, conditional branches, delegation or production guarantees.

## Verification

`.github/workflows/ruoyi-integration.yml` builds both upstream applications and exercises official login/menu/permissions against disposable MySQL and Redis. Its test-only fixture creates temporary accounts and disables CAPTCHA only in the disposable CI database. It must not be applied to a real installation. The smoke includes authorization, ordered and ALL/ANY decisions, strict group shapes, replay/conflict, pinned snapshots, inactive/deleted group participants and restart persistence. Read the exact commit's CI result; the presence of a workflow alone is not proof it passed.

The same job then runs one Chromium journey against the **built official Vue 3 frontend**, served on runner loopback with its normal `/prod-api` proxy to that same RuoYi server. It uses the native login, database-generated ArcFlow menu, administrator process editor/publication, read-only participant editor, applicant submission and designated two-step approvals, then ALL → ANY group publication and voting. The group journey checks a non-first participant voting first, partial-stage labels, per-person votes, removal from the pending inbox after voting, ANY rejection followed by approval, and state/history retention across reload and refresh. It also checks authenticated reload/direct navigation, audit history, logout cancellation/completion and logged-out routing. One explicitly aborted request checks the load-error message and refresh recovery; no successful API response or identity is mocked.

The browser journey consumes the two-step process and temporary accounts prepared by the preceding HTTP smoke, so run `tests/smoke.py` with `--frontend-directory /path/to/frontend/dist` rather than running `tests/browser.py` independently. Python dependencies are pinned in `tests/requirements.txt`; install its Chromium with `python3 -m playwright install --with-deps chromium`. The workflow publishes exactly six authenticated workspace screenshots (sequential editor/history, group editor, partial ALL votes, partial ANY rejection and terminal group history) as `ruoyi-native-browser-screenshots` only after success. It saves no login screenshots, browser traces, HAR, cookies or storage-state files. Screenshot artifacts expire after seven days. A configured test is not a pass: check the exact commit's terminal CI and artifact before claiming browser verification.

The existing standalone demo remains supported and shares the same `approval-domain` library. Install that library before building either host. This one desktop Chromium path is not comprehensive browser/accessibility coverage or proof of production readiness. Multi-instance SQL approval persistence remains separate work.

## Upstream attribution

- [RuoYi-Vue, springboot3 pin](https://github.com/yangzongzhuan/RuoYi-Vue/tree/a51a838b71b446ea27256900efe7ed2faa2a02fd), MIT, Copyright (c) 2018 RuoYi
- [RuoYi-Vue3 pin](https://github.com/yangzongzhuan/RuoYi-Vue3/tree/838965c5a18d2c61b73ec30c6e288057aaa08b63), MIT, Copyright (c) 2018 RuoYi

The bootstrap retains each upstream `LICENSE`. These upstream projects are independent; this example does not imply their endorsement.
