# Development setup and verification

<!-- Legacy fragments remain entry points after the language split. -->
<a id="1-工具与构建顺序"></a>
<a id="2-启动可保留数据的本地后端"></a>
<a id="3-启动独立界面"></a>
<a id="4-验证修改"></a>
<a id="5-常见开发问题"></a>
<a id="开发环境与验证--development-setup-and-verification"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](QUICKSTART.md) · [Documentation](../README.en.md)

<!-- topic:1-tools-and-build-order -->
## 1. Tools and build order

- A full **JDK 17+**, including `java` and `javac`. The source baseline is Java 17; CI covers 17 and 21.
- **Maven 3.9+** is the recommended development setup. The root is not a reactor build: examples have independent POMs, so install local dependencies first.
- Standalone UI and H5 declare **`^22.22.2 || ^24.15.0 || >=26.0.0`** for Node, with npm. Run `npm ci` against committed lockfiles.
- Git; Bash for the interactive password commands below. Python 3.9+ for the launcher and script checks. Initial dependency downloads need network access and writable caches.

The [standalone backend](../../examples/approval-demo/backend/pom.xml) uses Spring Boot **4.1.1**. Domain and JDBC retain Boot **3.5.16** build/test parents and are not standalone Boot applications. Do not align all parents to work around resolution errors. The standalone host uses a temporary Jackson 2 bridge to preserve shared contracts; see [migration boundaries](../SUPPORTED_HOST_MIGRATION.en.md).

From the repository root:

```bash
java -version
javac -version
mvn -version
node --version
npm --version

mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml verify
```

The standalone demo needs no MySQL, Redis, RuoYi, or external account. For a disposable run, use `python3 scripts/tryout.py`; normal shutdown removes that run's data. See [the launcher guide](../TRYOUT.en.md).

<!-- topic:2-run-a-persistent-local-backend -->
## 2. Run a persistent local backend

In terminal 1 at the repository root, choose a private absolute data path. Reuse it on restart, and use synthetic data only.

```bash
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

Accounts are `alice`, `bob`, and `carol`; there are no default passwords. Choose three different demo-only passwords, each at least 12 characters and at most 72 UTF-8 bytes. Missing or out-of-range values fail startup. Alice may publish, and Bob/Carol may be assigned reviews. Keep passwords out of source, URLs, screenshots, and reports.

The backend binds to `127.0.0.1:8080`. Host properties are in [application.properties](../../examples/approval-demo/backend/src/main/resources/application.properties). Data includes the main file and adjacent quote/six-scenario files; see [backup scope](PERSISTENCE.en.md#en).

<!-- topic:3-run-the-standalone-ui -->
## 3. Run the standalone UI

In terminal 2, starting at the same repository root:

```bash
cd examples/approval-ui
npm ci
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` to the loopback backend. The default UI port is strict. If you change the hostname or port, also change `APPROVAL_UI_ORIGIN`. A custom backend port requires matching backend configuration and UI `ARCFLOW_BACKEND_PORT`; the launcher can configure both for you.

- `/`: leave/procurement, the process designer, and member inbox
- `/quote-discount.html`: separate quote-discount page, fixed Bob → Carol
- `/scenarios.html`: expense, travel, seal-use, receiving, payment, and contract catalog
- `/receiving.html`: dedicated entry into the same receiving scenario

The pages use the same demo accounts but do not share in-memory login state. Reloading or signing out requires another login. A fresh main workspace starts with Alice submitting and Bob reviewing one step. Follow [First approval](../GETTING_STARTED.en.md#english) to check publication, decisions, and restart. RuoYi and H5 need separate setup; H5 only reads/reviews existing leave/procurement requests. See [the H5 guide](../../examples/approval-mobile/README.en.md).

<!-- topic:4-verify-changes -->
## 4. Verify changes

This is a command checklist, not a passing test report. Run from the repository root and report failed, skipped, and unrun stages separately.

```bash
# Core: Maven tests and the dependency-download-free JDK checks
mvn verify
bash scripts/test.sh

# Reinstall changed domain code before building its consumer
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml verify

# UI model/DOM checks, dedicated quote tests, and production build
(cd examples/approval-ui && npm ci && npm test && node --test tests/crm-quote/*.test.mjs && npm run build)

# Optional storage: H2 runs by default; real PostgreSQL/MySQL need configuration
mvn -f examples/approval-jdbc/pom.xml verify

# Root-build, launcher, or packaging changes
python3 -m unittest discover -s scripts -p 'test_maven_build.py' -v
python3 scripts/test_tryout.py
```

For real-browser tests, package the backend first. Stop your existing 8080/5173 servers so tests can create isolated credentials and stores:

```bash
mvn -f examples/approval-demo/backend/pom.xml package
cd examples/approval-ui
npm ci
npx playwright install chromium
npm run test:e2e
```

Linux may need additional browser system libraries; CI uses `npx playwright install --with-deps chromium`. Browser-download, system-dependency, or port failures are not passing tests. See [UI acceptance](../../examples/approval-ui/README.en.md#real-browser-first-run-check), [real JDBC server verification](../../examples/approval-jdbc/README.en.md), and [CI workflows](../../.github/workflows/) for focused suites. H5 and native RuoYi changes require their own checks; standalone UI results cannot replace them.

<!-- topic:5-common-development-failures -->
## 5. Common development failures

| Symptom | Check |
| --- | --- |
| Missing `arcflow-core`/`approval-domain` | Install the root, then domain; root Maven does not recursively build examples |
| Domain edits do not appear | Reinstall domain and rebuild/restart the backend; E2E launches the packaged JAR |
| Startup rejected | Check passwords, file permissions, port 8080, and exclusive ownership of the data file |
| 401/403 or proxy errors | Check credentials, exact Origin, and proxy target; POST needs `X-Arcflow-Client: approval-demo` |
| Publication/submission returns 409 | Refresh the current version; after an uncertain submission retain its original key and intent and reconcile before retrying |
| Snapshot validation fails | Stop writers, preserve the file/backups, and check format/binary compatibility; never delete fields or lower a version to bypass validation |
