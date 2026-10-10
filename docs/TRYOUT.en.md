# Local tryout and source packaging

<!-- Legacy fragments remain entry points after the language split. -->
<a id="arcflow-local-tryout"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](TRYOUT.md) · [Documentation](README.en.md)

Run the standalone Vue approval designer and Spring Boot backend from one terminal. The launcher builds the Java core, shared approval domain, backend and UI from source. You’ll need the tools below; the bundle does not include a prebuilt app. This demo is for localhost and test data only.

RuoYi has a separate example and setup guide. This launcher starts only the standalone app, without RuoYi, MySQL or Redis.

Use current `main` for all current scenarios. The [accepted three-case checkpoint](CRM_COMPATIBILITY_READINESS.en.md#accepted-crm-checkpoint) covers its historical leave/procurement/quote scope. The designer [screenshots](DESIGNER_SHOWCASE.en.md) include the older tested commit `e1ee9c6bdb971949c4f8746fe88b9ff49e6d4c36`; that historical checkpoint does not include the current procurement and CRM examples. The older `v0.1.0-alpha.1` source archives contain the earlier sequential demo, without the Chinese-first workbench, ALL/ANY groups or JDBC adapter.

<!-- topic:requirements -->
## Requirements

- Linux or macOS with a POSIX environment. Native Windows is not supported by this launcher; use a Linux environment such as WSL.
- Python 3.9 or newer (`python3`).
- A full JDK 17 or newer (`java` and `javac`), not only a JRE.
- Maven 3.8 or newer (`mvn`), or an existing Maven executable supplied with `--maven`.
- Node.js and npm. The UI's pinned dependencies require **Node 22.22.2+ within 22.x, 24.15.0+ within 24.x, or 26+**. Node 23 and 25 do not satisfy the supported engine ranges.
- Network access for the initial Maven/npm dependency downloads and a writable checkout, Maven local repository and npm cache.
- Two available loopback ports, defaulting to backend `8080` and UI `5173`.

The launcher checks the installed tools and tells you what needs fixing. It does not install Python, Java, Maven or Node, and needs no administrator privileges. It also leaves RuoYi setup to you. Maven and npm download application dependencies, so the first build needs network access. `npm ci` uses the committed lockfile and runs the packages’ install scripts.

<!-- topic:start-from-a-checkout-or-extracted-source-bundle -->
## Start from a checkout or extracted source bundle

From the ArcFlow source root (the directory containing `pom.xml`):

```sh
# Check tools and port availability without building or starting the applications.
python3 scripts/tryout.py --check

# Build and run the standalone tryout in this terminal.
python3 scripts/tryout.py
```

Keep that terminal open. The first build can take several minutes while dependencies download. Wait for the launcher's ready message, then open the exact UI URL it prints. The default UI address is `http://127.0.0.1:5173` and the default backend address is `http://127.0.0.1:8080`.

The ready message lists three entry points on that same origin:

- **OA leave / ERP procurement:** the main workspace. Select **Request type → Procurement** to try a purchase request.
- **CRM quote discount:** `/quote-discount.html`, a separate synthetic example with fixed Bob → Carol approval. Sign in separately with the same demo accounts; its records are not in the main workspace or its inbox.

- **Scenario catalog:** `/scenarios.html` contains six dedicated scenarios in current main; the launcher’s label retains “OA expense.” See [Architecture](development/ARCHITECTURE.en.md) for scope.

For sample values and each role’s next step, follow [First approval](GETTING_STARTED.en.md). The launcher does not start RuoYi or the H5 review client. No vendor account or AI credentials are needed.

The launcher generates a different password for `alice`, `bob` and `carol`, writes them to a private temporary `credentials.json` file, and prints its path. Open the file in a local text editor. These passwords work only for this run; there are no shared or default passwords. Keep the file private and leave its contents out of issues, chat, screenshots and source control.

Custom ports or an existing Maven installation:

```sh
python3 scripts/tryout.py --backend-port 18080 --ui-port 15173
python3 scripts/tryout.py --maven /absolute/path/to/maven/bin/mvn
python3 scripts/tryout.py --help
```

Open the printed URL exactly as shown. The launcher configures the backend’s allowed UI origin and the UI proxy together, so changing only the hostname or port can break requests. Both applications bind to loopback. If a port is busy, the launcher stops and reports it.

<!-- topic:what-to-try -->
## What to try

1. Sign in as `alice` with the generated Alice password. Open **Process designer**, assign the first approval to Bob, add a second approval assigned to Carol, then choose **Publish template** (**发布流程** in Chinese) to publish the Bob → Carol sequence.
2. Submit a request with a synthetic title/reason and `1` day.
3. Sign out and sign in as `bob`. Open **Needs my review** and approve the current step. The request remains pending and advances to Carol.
4. Sign out and sign in as `carol`. Approve the final step. Sign back in as Alice to inspect the approved status, saved process definition and ordered activity history.
5. Publish a different sequence and compare an existing request: its stored definition keeps the original version.

To try groups, select a stage and choose **全员同意（ALL）** or **任一同意（ANY）**, keeping Bob and Carol selected. ALL needs both approvals, and either person can reject the request. ANY advances on one approval and rejects only after both reject. Publish, then submit a new test request. Participants are fixed for that request, and the stages still run in order.

A fresh store starts with one approval step assigned to Bob. Only Alice can publish. In the single-reviewer flow above, only the current assignee can decide the next step, and a rejection ends the request. See the [sequential contract](SEQUENTIAL_APPROVAL.en.md) for the full rules.

<!-- topic:readiness-and-stopping -->
## Readiness and stopping

- `--check` checks prerequisites only. Dependency downloads, builds, startup and browser interactions can still fail.
- Wait for the ready message after the build. The launcher first checks the backend’s authenticated API and the UI’s HTTP response.
- Try the steps above to check the app in your browser. The ready message does not mean the full test suite or browser tests have run.
- Press **Ctrl-C in the launching terminal** to stop both application processes and delete the private temporary credentials, runtime data and logs. Each new run starts with new credentials and a fresh, empty request store. The published process and requests from the previous tryout do not survive normal shutdown.
- Build outputs, installed `node_modules`, the Maven local repository and npm cache remain available for later builds. They do not contain the tryout's generated password file or approval store.
- A forced kill, OS crash or power loss can prevent cleanup. If that occurs, stop any remaining application processes, then remove the private temporary runtime directory whose location the launcher printed. Never expose that directory or use real employee, leave or health data in this demo.

To keep your data or test a normal restart, use the manual setup in [Getting started](GETTING_STARTED.en.md#english) and the [backend instructions](../examples/approval-demo/backend/README.en.md). The launcher always uses disposable data.

<!-- topic:build-a-versioned-source-bundle -->
## Build a versioned source bundle

To package a committed version, you need Python 3.9+ and Git. People running the extracted bundle do not need Git.

```sh
# Commit the intended sources before packaging HEAD.
python3 scripts/package-tryout.py

# Or package an existing commit/tag into another directory.
python3 scripts/package-tryout.py --ref YOUR_COMMIT_OR_TAG --output-dir /tmp/arcflow-bundles
```

The default destination is `dist/tryout/`. Output names are:

```text
arcflow-tryout-VERSION-COMMIT12-source.tar.gz
arcflow-tryout-VERSION-COMMIT12-source.tar.gz.sha256
```

`VERSION` is read from the selected commit's root `pom.xml`; `COMMIT12` is the first 12 characters of its Git object ID. The bundle contains `TRYOUT_BUNDLE.json` with the full commit ID, project version and commit timestamp. Packaging refuses HEAD when tracked files have unstaged or staged edits. Untracked and ignored files are never included; a named older ref is read from its committed tree regardless of working-tree edits. The selected commit must already contain the launcher, packaging script and this guide.

The packager uses `git archive`, applies explicit exclusions, normalizes tar ownership/permissions/timestamps and fixes the gzip timestamp. Repeated packaging of the same commit with the same packaging implementation and Python/zlib toolchain produces identical bytes and SHA-256 checksums; output-directory names and the current wall clock do not enter the archive. Compression output can vary across zlib implementations, so record the toolchain if reproducing a published checksum on another machine. Symlinks and other unsupported archive entries are rejected rather than dereferenced.

The source bundle includes the project's committed code, tests, docs, license and npm lockfile, including the separate RuoYi overlay source. It excludes `.git`, private `.env` files, runtime/data directories, generated build/test output, installed dependencies and disposable RuoYi upstream checkouts. It contains no prebuilt JAR, installed runtime, dependency cache, generated credentials or persisted approval data. Packaging a `SNAPSHOT` version leaves it a snapshot. Release status and CI results must be checked separately.

### Verify and extract

Keep the `.tar.gz` and `.sha256` in the same directory. Replace the example basename with the actual generated filename:

```sh
# Linux:
sha256sum -c arcflow-tryout-VERSION-COMMIT12-source.tar.gz.sha256

# macOS:
shasum -a 256 -c arcflow-tryout-VERSION-COMMIT12-source.tar.gz.sha256

# Extract into a new directory; then run from the extracted source root.
tar -xzf arcflow-tryout-VERSION-COMMIT12-source.tar.gz
cd arcflow-tryout-VERSION-COMMIT12-source
python3 scripts/tryout.py --check
python3 scripts/tryout.py
```

Get the expected checksum from a trusted source. It detects changed bytes but does not identify the publisher or replace a signature. To recreate a bundle, use the source repository and the full commit in `TRYOUT_BUNDLE.json`. The extracted directory has no Git database and cannot be repackaged by this script.

<!-- topic:release-candidate-checklist -->
## Release-candidate checklist

Before publishing a candidate, run the checks below against its exact commit with a clean tracked working tree and the documented tools. This is a checklist, not a test-results record:

```sh
# Launcher and packaging regression checks.
python3 scripts/test_tryout.py

# Real dependency build/start, non-default ports, authenticated readiness,
# private credential permissions, and SIGINT process/data cleanup.
python3 scripts/smoke-tryout.py

# UI tests and production asset build.
(cd examples/approval-ui && npm ci && npm test && npm run build)

# Package twice into separate directories and compare archive checksums.
python3 scripts/package-tryout.py --output-dir /tmp/arcflow-rc-one
python3 scripts/package-tryout.py --output-dir /tmp/arcflow-rc-two
```

- Confirm the two archive SHA-256 values printed by the packaging commands match. Use new/empty output directories so old bundles do not obscure the result.
- Verify the sidecar checksum, extract one archive into a new directory, and run `python3 scripts/tryout.py --check` followed by `python3 scripts/tryout.py` from that extracted root. Complete the Bob → Carol journey above and verify Ctrl-C stops both services and removes that run's private runtime directory.
- Check that the Java, approval-demo and browser CI jobs passed for the **same full commit** listed in `TRYOUT_BUNDLE.json`. Open the jobs themselves: the `main` badge, a successful build or the launcher’s ready message does not verify browser behavior.
- Record the OS and tool versions, full commit, checksum, and any failed or skipped checks. The demo remains experimental and local-only even when these checks pass.

<!-- topic:troubleshooting-and-boundaries -->
## Troubleshooting and boundaries

- **Tool check fails:** install or select the supported tool yourself, then rerun `--check`. Check `java -version`, `javac -version`, `mvn -version`, `node --version`, and `npm --version` in the same terminal. For a Maven installation outside `PATH`, use `--maven`.
- **A port is already in use:** choose two unused ports using the launcher flags, or stop the process you own that uses the port. Do not change the server binding to a public interface.
- **Dependency download/build fails:** inspect the reported error. Confirm access to your configured Maven/npm registries and correct proxy settings, then rerun. An extracted source bundle is not an offline installer. Never bypass TLS verification to fetch dependencies.
- **Browser authentication fails:** use the credentials file for the current run and the exact printed URL. A password from a previous run will not work.
- **Unexpected request result after a network interruption:** retry the unchanged form with its retained idempotency key. Page reload or logout loses that client key; inspect the request list before a new submission. See [durable retry boundaries](SUBMISSION_IDEMPOTENCY.en.md).
- **Need production deployment:** this package is intended for local trials. It uses demo identities and a single-writer JSON file, and the [host migration notes](SUPPORTED_HOST_MIGRATION.en.md) describe its maintained Spring Boot 4 baseline and temporary Jackson 2 compatibility bridge. Production security and clustered persistence have not been validated. The launcher does not include RuoYi, and conditions are limited to the payment, receiving, and contract scenarios rather than general routing. Timers and BPMN compatibility are unsupported. Single-reviewer and fixed-participant ALL/ANY stages are supported.

For a useful bug report, include the manifest's full commit (or checkout commit), OS, Python/Java/Maven/Node versions, command, error and expected result. Remove credentials and real personal information before sharing any log.
