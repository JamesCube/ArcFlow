# Official RuoYi integration smoke

`smoke.py` exercises a packaged official RuoYi backend against **real MySQL and Redis**.
It never mocks authentication: all tokens come from upstream `/login`, and the test
checks upstream `/getInfo`, `/getRouters`, and `/logout` as well as ArcFlow endpoints.

Only use a new disposable database. Before running, import the pinned upstream
`sql/ry_20260417.sql`, `sql/quartz.sql`, then this overlay's `sql/menu.sql`.
The fixture creates five test users and two roles, disables the captcha in the
fixture database, and replaces upstream demo passwords with a freshly generated
random password and BCrypt hash. No test password or JWT signing secret is stored
in the repository. The smoke process generates both in memory on each run.

The fixture deliberately grants ordinary participants read/submit/decide but not
publish. A fifth account has no ArcFlow permissions. Admin may publish but cannot
approve a request on behalf of its assigned user.

```sh
python3 -m pip install -r examples/ruoyi-vue3/tests/requirements.txt
# MYSQL_PASSWORD must match the disposable database instance.
python3 examples/ruoyi-vue3/tests/smoke.py \
  --jar /absolute/path/to/backend/ruoyi-admin/target/ruoyi-admin.jar \
  --state-directory /absolute/path/to/new-empty-test-state
```

Use local MySQL on port 3306 (`ry-vue` database), Redis on port 6379, and an unused
backend port 8080. The smoke starts the backend, performs the test, stops it,
restarts with the same state file and Redis, and verifies exact history persistence.
It also proves deleted historical actors do not invalidate saved history. Processes
are terminated in `finally`; logs remain in the state directory for diagnosis.

The GitHub workflow `.github/workflows/ruoyi-integration.yml` provisions disposable
MySQL 8.4.4 / Redis 7.4.2 services, builds both official upstream applications, and
runs this smoke. A successful local Python syntax check is **not** evidence that
this real-service test passed; use the workflow result for runtime verification.
