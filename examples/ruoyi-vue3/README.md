# Official RuoYi-Vue + Vue 3 integration example

This is an **overlay on the real official RuoYi applications**, not a rebranded standalone login page. `upstream-lock.json` pins exact upstream commits. The bootstrap retains both upstream repositories and their MIT license files. ArcFlow's code remains Apache-2.0.

## Boundaries

- RuoYi owns login, JWT/Redis sessions, immutable numeric user IDs, menu routes, roles and permission checks.
- ArcFlow contributes the sequential process editor, submissions, immutable request snapshots, assigned-step decisions and audit history.
- **MySQL stores RuoYi users/roles/menus. Approval state is still a single-writer local JSON file.** This example is not a clustered/production workflow database, transaction coordinator or SQL persistence adapter. Keep the data file and backups private and persistent. Do not run two application instances against it.
- A RuoYi administrator's wildcard permission never overrides the approval's assigned user. IDs in snapshots remain readable after account deletion; new actions and new assignments require active accounts.
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
| `arcflow:request:decide` | Decide only a personally assigned current step |
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

## Verification

`.github/workflows/ruoyi-integration.yml` builds both upstream applications and exercises official login/menu/permissions against disposable MySQL and Redis. Its test-only fixture creates temporary accounts and disables CAPTCHA only in the disposable CI database. It must not be applied to a real installation. The smoke includes authorization, ordered decisions, replay/conflict and restart persistence. Read the exact commit's CI result; the presence of a workflow alone is not proof it passed.

The existing standalone demo remains supported and shares the same `approval-domain` library. Install that library before building either host. Browser interaction/visual verification and multi-instance SQL approval persistence are separate work; a production build does not establish either.

## Upstream attribution

- [RuoYi-Vue, springboot3 pin](https://github.com/yangzongzhuan/RuoYi-Vue/tree/a51a838b71b446ea27256900efe7ed2faa2a02fd), MIT, Copyright (c) 2018 RuoYi
- [RuoYi-Vue3 pin](https://github.com/yangzongzhuan/RuoYi-Vue3/tree/838965c5a18d2c61b73ec30c6e288057aaa08b63), MIT, Copyright (c) 2018 RuoYi

The bootstrap retains each upstream `LICENSE`. These upstream projects are independent; this example does not imply their endorsement.
