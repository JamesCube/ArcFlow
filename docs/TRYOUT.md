# ArcFlow local tryout

A single terminal starts the standalone Vue approval designer and Spring Boot demo backend. This is a **source tryout**, not a prebuilt application or production release. It builds the Java core, shared approval domain, backend and UI locally. Use synthetic data on localhost only.

The launcher does not start RuoYi, MySQL or Redis. The RuoYi integration remains a separate example with its own prerequisites and setup.

For the [current designer gallery](DESIGNER_SHOWCASE.md), use `main` or verified source `e1ee9c6bdb971949c4f8746fe88b9ff49e6d4c36`. The existing `v0.1.0-alpha.1` source archives are the older sequential snapshot and do not contain the Chinese-first workbench, ALL/ANY groups or JDBC adapter.

## Requirements

- Linux or macOS with a POSIX environment. Native Windows is not supported by this launcher; use a Linux environment such as WSL.
- Python 3.9 or newer (`python3`).
- A full JDK 17 or newer (`java` and `javac`), not only a JRE.
- Maven 3.8 or newer (`mvn`), or an existing Maven executable supplied with `--maven`.
- Node.js and npm. The UI's pinned dependencies require **Node 22.22.2+ within 22.x, 24.15.0+ within 24.x, or 26+**. Node 23 and 25 do not satisfy the supported engine ranges.
- Network access for the initial Maven/npm dependency downloads and a writable checkout, Maven local repository and npm cache.
- Two available loopback ports, defaulting to backend `8080` and UI `5173`.

The launcher checks installed tools and reports actionable errors. It does not install Python, Java, Maven or Node, require administrator privileges, or download a RuoYi checkout. Maven dependencies and `npm ci` are ordinary application dependency downloads, not bundled offline dependencies. `npm ci` uses the committed lockfile and runs package install scripts as part of normal npm installation.

## Start from a checkout or extracted source bundle

From the ArcFlow source root (the directory containing `pom.xml`):

```sh
# Check tools and port availability without building or starting the applications.
python3 scripts/tryout.py --check

# Build and run the standalone tryout in this terminal.
python3 scripts/tryout.py
```

Keep that terminal open. The first build can take several minutes while dependencies download. Wait for the launcher's ready message, then open the exact UI URL it prints. The default UI address is `http://127.0.0.1:5173` and the default backend address is `http://127.0.0.1:8080`.

The launcher creates three unique demo passwords in a private temporary `credentials.json` file and prints its local path. Open that file in a local text editor to find the passwords for `alice`, `bob` and `carol`. There are no shared/default passwords. Treat that file and its contents as local secrets; do not paste them into issues, chat, screenshots or source control. These are generated accounts for this disposable run only.

Custom ports or an existing Maven installation:

```sh
python3 scripts/tryout.py --backend-port 18080 --ui-port 15173
python3 scripts/tryout.py --maven /absolute/path/to/maven/bin/mvn
python3 scripts/tryout.py --help
```

Use the printed URL rather than substituting a different hostname or port: the backend's allowed UI origin and UI proxy are configured together. Both applications bind to loopback. Port conflicts fail instead of silently choosing another port.

## What to try

1. Sign in as `alice` with the generated Alice password. Open **Process designer**, assign the first approval to Bob, add a second approval assigned to Carol, then choose **发布流程** (or **Publish template** after switching the designer to English) to publish the Bob → Carol sequence.
2. Submit a request with a synthetic title/reason and `1` day.
3. Sign out and sign in as `bob`. Open **Needs my review** and approve the current step. The request remains pending and advances to Carol.
4. Sign out and sign in as `carol`. Approve the final step. Sign back in as Alice to inspect the approved status, saved process definition and ordered activity history.
5. Publish a different sequence and compare an existing request: its stored definition keeps the original version.

To try groups, select a stage and choose **全员同意（ALL）** or **任一同意（ANY）**, keeping Bob and Carol selected. ALL requires both approvals and any rejection ends the request; ANY advances on one approval and rejects only after both reject. Publish, then submit a new synthetic request. These are fixed-participant stages in an ordered sequence, not conditional graph branches.

A fresh store initially has one Bob approval. Alice alone can publish. For the single-reviewer journey above, only the current assigned approver can make the next decision and a rejection is terminal. See [the sequential contract](SEQUENTIAL_APPROVAL.md) for exact behavior.

## Readiness and stopping

- `--check` is a prerequisite check. It does not prove that dependency downloads, builds, application startup or browser interactions will succeed.
- A successful build alone is not readiness. Wait until the launcher verifies the backend's authenticated API and the UI's HTTP response, then reports ready.
- The manual journey above is the user-visible smoke test. A ready message is not a claim that the full test suite or browser tests have run.
- Press **Ctrl-C in the launching terminal** to stop both application processes and delete the private temporary credentials, runtime data and logs. Each new run starts with new credentials and a fresh, empty request store. The published process and requests from the previous tryout do not survive normal shutdown.
- Build outputs, installed `node_modules`, the Maven local repository and npm cache remain available for later builds. They do not contain the tryout's generated password file or approval store.
- A forced kill, OS crash or power loss can prevent cleanup. If that occurs, stop any remaining application processes, then remove the private temporary runtime directory whose location the launcher printed. Never expose that directory or use real employee, leave or health data in this demo.

For intentionally retained data and normal restart testing, use the explicit manual setup in [Getting started](GETTING_STARTED.md#english) and the [backend instructions](../examples/approval-demo/backend/README.md). The disposable launcher intentionally does not offer data retention.

## Build a versioned source bundle

Maintainers need Python 3.9+ and Git to produce a bundle from a committed checkout. Running the extracted bundle does not require Git.

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

The source bundle includes the project's committed code, tests, docs, license and npm lockfile, including the separate RuoYi overlay source. It excludes `.git`, private `.env` files, runtime/data directories, generated build/test output, installed dependencies and disposable RuoYi upstream checkouts. It contains no prebuilt JAR, installed runtime, dependency cache, generated credentials or persisted approval data. A `SNAPSHOT` source version remains a snapshot; packaging does not promote it to a release or prove CI passed for that commit.

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

Compare checksums obtained through a trusted source. A checksum detects byte changes; it is not a signature or proof of publisher identity. The packaging script cannot recreate a bundle from an extracted source directory because it deliberately contains no Git database; use the source repository and the full commit recorded in `TRYOUT_BUNDLE.json`.

## Release-candidate checklist

This checklist describes verification to perform; it is not a record of tests already passed. Run it against the exact committed candidate, with a clean tracked working tree and the documented toolchain:

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
- Require the existing Java, approval-demo and browser journey CI checks to be green for the **same full commit** recorded in `TRYOUT_BUNDLE.json`. Inspect the actual jobs; a badge for `main`, successful compilation or launcher readiness alone is insufficient browser evidence.
- Record the OS/tool versions, full commit and checksum with the candidate. State any checks that failed or were not run. A passing checklist does not change the experimental/local-only boundary.

## Troubleshooting and boundaries

- **Tool check fails:** install or select the supported tool yourself, then rerun `--check`. Check `java -version`, `javac -version`, `mvn -version`, `node --version`, and `npm --version` in the same terminal. For a Maven installation outside `PATH`, use `--maven`.
- **A port is already in use:** choose two unused ports using the launcher flags, or stop the process you own that uses the port. Do not change the server binding to a public interface.
- **Dependency download/build fails:** inspect the reported error. Confirm access to your configured Maven/npm registries and correct proxy settings, then rerun. An extracted source bundle is not an offline installer. Never bypass TLS verification to fetch dependencies.
- **Browser authentication fails:** use the credentials file for the current run and the exact printed URL. A password from a previous run will not work.
- **Unexpected request result after a network interruption:** retry the unchanged form with its retained idempotency key. Page reload or logout loses that client key; inspect the request list before a new submission. See [durable retry boundaries](SUBMISSION_IDEMPOTENCY.md).
- **Need production deployment:** this is not a supported deployment package. It uses demo identities and a single-writer local JSON store, and the backend's pinned Spring Boot 3 baseline has known support limitations described in its README. No production security, clustered persistence, RuoYi runtime, conditional/parallel approvals, timers or BPMN compatibility is promised.

For a useful bug report, include the manifest's full commit (or checkout commit), OS, Python/Java/Maven/Node versions, command, error and expected result. Remove credentials and real personal information before sharing any log.
