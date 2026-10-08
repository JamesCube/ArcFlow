# Official RuoYi-Vue + Vue 3 integration example

This example adds ArcFlow to the **official RuoYi backend and Vue 3 frontend**. `upstream-lock.json` pins both upstream commits. The bootstrap keeps the upstream repositories and their MIT license files; ArcFlow’s own code remains Apache-2.0.

[View the native integration screenshots and walkthrough](../../docs/RUOYI_SHOWCASE.md) · [查看若依集成截图](../../docs/RUOYI_SHOWCASE.md#简体中文)

## Boundaries

- RuoYi handles login, JWT/Redis sessions, immutable numeric user IDs, menu routes, roles and permissions.
- ArcFlow adds the single-reviewer / ALL / ANY editor, request submission, saved definition snapshots, participant votes and audit history.
- **MySQL stores RuoYi users/roles/menus. Approval state is still a single-writer local JSON file.** The example does not provide clustered approval storage, coordinate business transactions or wire approval data into SQL. Keep the data file and backups private and persistent. Do not run two application instances against it.
- A RuoYi administrator's wildcard permission never overrides the approval's snapshotted participants. IDs in snapshots remain readable after account deletion; new actions and new assignments require active accounts.
- The overlay does not install a second security filter chain, change Jackson globally, return raw `SysUser` objects or add demo authentication.

## Prepare

Requirements: Git, Python 3, Java 17, Maven 3.9+, Node 22, MySQL 8.4 and Redis 7.4. Use a new **disposable local database**, never point the example seed scripts at production.

From the ArcFlow repository root:

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
python3 examples/ruoyi-vue3/bootstrap.py --directory examples/ruoyi-vue3/.work
```

The bootstrap needs an empty destination. It fetches and verifies the pinned commits, copies ArcFlow’s overlay files and adds one Maven dependency to `ruoyi-admin`. For logging, it changes only the directory to `ARCFLOW_LOG_DIR` (default `./logs`) and keeps all audit appenders. It leaves the source repositories and their authentication unchanged.

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

Refresh or log in again after changing roles so RuoYi reloads the cached permissions. The adapter rechecks database account status on each ArcFlow request. The assignee picker returns only ID and display name; inactive/deleted users cannot receive new assignments.

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

Each native editor stage offers **单人审批**, **全员同意（ALL）** or **任一同意（ANY）**. Switching to a group keeps the original reviewer and stable node ID; choose the other participants from RuoYi’s active user list. Groups require 2–16 distinct numeric-string user IDs. The example does not automatically turn a role into its current members.

- ALL: everyone must approve; one rejection ends the request.
- ANY: one approval completes the stage; rejection ends the request only after everyone rejects.
- Stages remain ordered. A later stage cannot vote early. One person may vote once in each stage they belong to.
- **待我审批** uses every unvoted participant in the current snapshotted stage, not the legacy `approverId` compatibility field. Partial votes keep the stage current; snapshot details show each member's vote and whether further votes are needed.
- Publication upgrades group definitions to schema 3. Existing schema-2 definitions/requests remain supported. Running requests retain their original participants and policy after later publication.
- Disabled/deleted accounts cannot publish, submit or vote. New publication and submission require every assigned participant to be active. Historical IDs/votes remain readable after deletion, using the stable ID if no display name is available.

The domain's JSON upgrade creates a private schema-2 backup on the first schema-3 write; see [migration and rollout boundaries](../../docs/PARALLEL_APPROVAL.md#persistence-and-rollout). Back up the data and upgrade the host before enabling groups; do not run an older sequential-only binary against schema-3 state. Approval storage remains single-writer JSON. JDBC integration, tenancy, conditional branches and delegation are not included here. Production use needs separate verification.

## Durable submission retries / 持久化提交重试

`POST /arcflow/requests` accepts one optional `Idempotency-Key` header, scoped to the authenticated numeric applicant ID. The native form sends a random key and keeps the original normalized fields and process version in page memory if a response is uncertain. Same-key retries return the original request's current state, even after publication or approval; different intent conflicts. A successful Refresh clears a definitively rejected stale-version attempt, while ambiguous errors keep its key. Page reload, close or logout loses the client key; inspect saved requests before starting a fresh submission. The native keyed call bypasses only RuoYi's short time-window duplicate-submit interceptor so the durable server check can resolve retries; all authentication/RBAC stays active.

若依表单会自动生成提交键，后端按申请人区分同一个键。网络异常、无法确认是否提交成功时，页面会保留原来的内容和流程版本；用同一个键重试，就能取回原申请的最新状态。刷新整页、关闭页面或退出登录会丢失这个键，请先检查申请列表再新建。原有的身份和权限检查仍然生效。

The first legacy keyed creation upgrades a schema-1/2/3 private JSON snapshot to schema 4 and saves a byte-exact backup of the preceding schema-1/2/3 snapshot. Process definitions and request/event payloads stay unchanged. Stop traffic, back up and upgrade all hosts before enabling these clients; versions without submission-key support cannot read schema 4 and can ignore the header. See [key semantics, retention and rollback limits](../../docs/SUBMISSION_IDEMPOTENCY.md). Approval persistence remains single-process local JSON unless the host explicitly adopts the JDBC module.

首次使用提交键创建旧格式请假申请时，schema-1/2/3 文件快照会升级到 schema 4，并备份旧文件；流程定义仍使用 schema 2/3。不支持提交键的旧版本无法读取 schema 4，请先暂停请求、备份数据并升级全部服务端，再启用带键提交。默认存储仍是单进程本地 JSON。

## Typed business documents / 类型化业务单据

`POST /arcflow/documents` accepts typed leave and procurement using the same authenticated user, `arcflow:request:submit` permission, optional `Idempotency-Key` and `AjaxResult` response format. The body contains `business` and `processVersion`; the [business-document contract](../../docs/BUSINESS_DOCUMENTS.md#java-与-http--java-and-http) lists every field and numeric rule. Existing request listing and decision routes are reused. The native form still submits legacy leave requests; there is no procurement form on `main`.

Typed writes use JSON snapshot schema 5, with a byte-exact backup before the first upgrade. Later legacy writes never downgrade it. Upgrade all readers before enabling typed writes; old binaries cannot read the payloads, and mixed-version writers are unsupported. Restoring an old backup would discard later approvals and submissions.

若依已提供类型化请假和采购 API，复用现有登录、提交权限、幂等键和审批接口。当前原生表单仍为请假表单。启用类型化写入前须升级全部读取端；JSON 文件会升级到 schema 5，并备份旧文件，不支持新旧版本混写或直接用旧备份回退。

## Verification

`.github/workflows/ruoyi-integration.yml` builds both upstream applications and exercises official login/menu/permissions against disposable MySQL and Redis. Its test-only fixture creates temporary accounts and disables CAPTCHA only in the disposable CI database. It must not be applied to a real installation. The smoke test covers authorization, sequential and ALL/ANY decisions, group validation, retries and conflicts, saved snapshots, inactive/deleted participants and persistence after restart. It also submits typed procurement and leave through the API, rejects malformed business fields, and checks mixed legacy/typed persistence and continued decisions after restart. The browser journey below remains leave-oriented. Check the CI result for your commit; a configured workflow does not mean the tests passed.

The same job then runs a Chromium test against the **built official Vue 3 frontend**. It serves the frontend on runner loopback and uses the normal `/prod-api` proxy to the same RuoYi server. It uses the native login, database-generated ArcFlow menu, administrator process editor/publication, read-only participant editor, applicant submission and designated two-step approvals, then ALL → ANY group publication and voting. The group journey checks a non-first participant voting first, partial-stage labels, per-person votes, removal from the pending inbox after voting, ANY rejection followed by approval, and state/history retention across reload and refresh. It also checks authenticated reload/direct navigation, audit history, logout cancellation/completion and logged-out routing. One explicitly aborted request checks the load-error message and refresh recovery; no successful API response or identity is mocked.

The browser journey consumes the two-step process and temporary accounts prepared by the preceding HTTP smoke, so run `tests/smoke.py` with `--frontend-directory /path/to/frontend/dist` rather than running `tests/browser.py` independently. Python dependencies are pinned in `tests/requirements.txt`; install its Chromium with `python3 -m playwright install --with-deps chromium`. The workflow publishes exactly six authenticated workspace screenshots (sequential editor/history, group editor, partial ALL votes, partial ANY rejection and terminal group history) as `ruoyi-native-browser-screenshots` only after success. It saves no login screenshots, browser traces, HAR, cookies or storage-state files. Screenshot artifacts expire after seven days. Check the completed CI run and its screenshots for your commit before treating the browser checks as passed.

The existing standalone demo remains supported and shares the same `approval-domain` library. Install that library before building either host. This desktop Chromium test does not cover every browser or accessibility requirement. Production readiness and multi-instance SQL approval storage still need separate work.

## Upstream attribution

- [RuoYi-Vue, springboot3 pin](https://github.com/yangzongzhuan/RuoYi-Vue/tree/a51a838b71b446ea27256900efe7ed2faa2a02fd), MIT, Copyright (c) 2018 RuoYi
- [RuoYi-Vue3 pin](https://github.com/yangzongzhuan/RuoYi-Vue3/tree/838965c5a18d2c61b73ec30c6e288057aaa08b63), MIT, Copyright (c) 2018 RuoYi

The bootstrap retains each upstream `LICENSE`. These upstream projects are independent; this example does not imply their endorsement.
