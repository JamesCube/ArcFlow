# RuoYi integration tests

<!-- Legacy fragments remain entry points after the language split. -->
<a id="local-native-inbox-ui-checks-no-browser"></a>
<a id="native-procurement-ui-regression"></a>
<a id="official-ruoyi-integration-smoke"></a>

[简体中文](README.md)


<!-- topic:scope -->
Applies to the current source. `smoke.py` launches the packaged official RuoYi backend with real MySQL/Redis and exercises upstream `/login`, `/getInfo`, `/getRouters`, `/logout` and ArcFlow routes without mocked authentication. Those upstream endpoints are not part of ArcFlow's 30 controller handlers.

<!-- topic:prepare -->
## Prepare an isolated environment

Use a new disposable `ry-vue` database. Import pinned upstream `ry_20260417.sql`, `quartz.sql`, then overlay `sql/menu.sql`. Fixtures create five users and two roles, disable CAPTCHA only in that test database, and replace sample passwords with runtime-generated random passwords and BCrypt hashes. Passwords and JWT secrets never enter the repository. Ordinary participants cannot publish; the fifth account lacks ArcFlow permissions. Administrators cannot decide for assigned users.

Keep local MySQL 3306, Redis 6379 and backend 8080 available. Follow the [host guide](../README.en.md) for packaging and configuration.

```sh
python3 -m pip install -r examples/ruoyi-vue3/tests/requirements.txt
python3 examples/ruoyi-vue3/tests/smoke.py \
  --jar /absolute/path/to/backend/ruoyi-admin/target/ruoyi-admin.jar \
  --state-directory /absolute/path/to/new-empty-test-state
```

MYSQL_PASSWORD must match the disposable database. Smoke starts, stops and restarts against the same JSON/Redis state, checking sequential and group history. finally blocks clean up owned processes while retaining diagnostic logs. Never target real accounts or production.

<!-- topic:coverage -->
## HTTP and browser coverage

HTTP covers permissions, schemas 2/3, SINGLE/ALL/ANY, non-first members, partial votes, early/opposite/repeated decisions, repeated participants, terminal states, pinned snapshots and reauthorization after disabling/deleting users. Deleting a historical actor must not make saved history unreadable.

Submission checks cover original-key and normalized-intent replay, changed-intent conflicts, unkeyed creation, repeated/malformed headers, applicant isolation, rejected body identity, invalid requests not reserving keys, and revoked permissions preventing replay. Typed leave/procurement tests cover strict fields/raw numbers, permissions, mixed old/new persistence and continued decisions after restart. Malformed, duplicate or missing group fields and incorrect schemas cannot alter the active definition.

Browser checks use the built official Vue 3 frontend, native login and `/prod-api`: menus, publication, read-only participants, sequential/groups, procurement, language/type/tab switching, exact `USD 0.30`, reload, logout, permissions and interrupted-load recovery. They consume accounts and the two-stage process prepared by HTTP smoke. Pass `--frontend-directory /path/to/frontend/dist` to smoke rather than invoking browser.py alone.

```sh
python3 -m playwright install --with-deps chromium
```

Successful screenshots show signed-in workspaces, never login pages, authentication sessions, traces or HARs. CI retains them for seven days. `.github/workflows/ruoyi-integration.yml` provisions real services; its existence is not a pass. Inspect the exact commit's run.

<!-- topic:local -->
## Local model and DOM regressions

```sh
node --test examples/ruoyi-vue3/frontend/src/views/arcflow/approval/*.test.mjs
```

Reuse Vue/Vitest/jsdom installed for the standalone UI; the overlay is not a full upstream package. In a POSIX checkout:

```sh
test -e examples/ruoyi-vue3/frontend/node_modules || \
  ln -s ../../approval-ui/node_modules examples/ruoyi-vue3/frontend/node_modules
cd examples/ruoyi-vue3/frontend
./node_modules/.bin/vitest run --config vitest.config.mjs
```

Install missing dependencies through the UI guide first. The session stub exists only for test module resolution and is never copied upstream by bootstrap. Also run `npm test` in approval-ui; NativeSubmission.test.js mounts the actual overlay, but transport mocks do not establish real RBAC acceptance.

Regressions include independent pending/handled cursors, empty/exhausted pages, filters, retryable errors, invalid-cursor reset, duplicate clicks, cancellation/late responses, session/filter changes, unmounting, non-first/repeated-stage participants, legacy applicant/history tabs and snapshot caching. Older shorter histories cannot undo a confirmed decision.

<!-- topic:limits -->
## Interpret the result

Syntax, model and DOM checks do not replace servers or browsers. Old screenshots/counts are not current acceptance. Mark unavailable real-service checks as unrun, never passed. The [documentation history](../../../docs/history/README.en.md) preserves earlier source records. Cross-check current test code, interface specifications and exact-commit CI.
