# Official RuoYi integration smoke

`smoke.py` runs a packaged official RuoYi backend with **MySQL and Redis**.
It signs in through upstream `/login` and checks `/getInfo`, `/getRouters` and
`/logout` alongside the ArcFlow endpoints. Authentication is not mocked.

Use a new disposable database for every run. Before running, import the pinned upstream
`sql/ry_20260417.sql`, `sql/quartz.sql`, then this overlay's `sql/menu.sql`.
The fixture creates five test users and two roles, disables the captcha in the
fixture database, and replaces upstream demo passwords with a freshly generated
random password and BCrypt hash. No test password or JWT signing secret is stored
in the repository. The smoke process generates both in memory on each run.

The fixture gives ordinary participants read/submit/decide permission, without
publish permission. A fifth account has no ArcFlow permissions. Admin may publish but cannot
approve a request on behalf of its assigned user.

The submission tests send the optional `Idempotency-Key` header through the native
endpoint and check responses in RuoYi’s existing `AjaxResult` envelope:

- Identical and whitespace-normalized retries return the same request with one
  `SUBMIT` event; changed title, reason, days or process version return conflict.
- Missing keys retain create-on-every-call behavior. Blank, malformed, oversized,
  comma-joined and repeated header values are rejected without creating requests.
  Repeated fields are sent as separate HTTP header lines, including mixed casing.
- The same key used by different authenticated applicants creates separate
  requests without exposing either applicant's state to the other. Body-supplied
  identity or key fields remain invalid. Invalid bodies do not reserve keys.
- A cached session cannot replay while its applicant is disabled or deleted.
  After a fixture role change and re-login, an applicant who lost submission
  permission cannot replay a key they previously used either.
- Replays after later publication and decisions return the current saved request
  with its original definition. Exact replay and conflict handling survive the
  existing server restart, even with a historical reviewer deleted, without
  adding history or another request.

Typed-document API checks also cover `POST /arcflow/documents`: procurement and typed leave, strict fields and numeric validation, submission permissions, changed-intent conflicts, and mixed legacy/typed requests surviving restart with later decisions. These API checks do not establish a procurement form; the current browser journey uses the leave form.

The API smoke tests schema-2 two-step approvals and schema-3 groups through the
same native `/arcflow` endpoints:

- Publish both `ALL` and `ANY` definitions with official admin authentication;
  reject unauthorized publishers and stale versions.
- Reject duplicate, unknown, blank, non-string, missing, too few or too many group
  members; non-array member fields; invalid modes; extra/missing node fields;
  conflicting single/group assignment fields; duplicate JSON keys; and groups
  mislabeled as schema 2. Failed publications leave the active definition intact.
- `ALL`: retain partial approval, require every member before the next sequential
  step, and terminate on either an immediate rejection or rejection after another
  member approved. A participant assigned to the following stage votes separately
  there, checking that retries are scoped to both actor and step.
- `ANY`: retain an individual rejection until another member approves or every
  member rejects; one immediate approval closes the group without recording
  votes for members who have not voted.
- Read and decide as a non-first participant, whose membership comes from the
  request's pinned definition even when `approverId` names someone else. After a
  vote, the request remains visible but drops out of that actor's pending worklist.
  Outsiders and admins have no assignment bypass, permissionless actors cannot
  decide, and either group member is rejected when submitting to their own group.
- Replay identical actor/step decisions without extra history; reject opposite
  decisions, early future-step decisions, and new votes on terminal requests.
- Publish a later policy before deciding an earlier request and verify its group
  mode, stages and version remain pinned. Pending group requests also remain
  actionable after publication of a later schema-2 sequential definition.
- Disable, then soft-delete the non-first group member in the disposable fixture.
  Existing Redis sessions cannot read or decide as that actor, including retries;
  publication and new submission reject the inactive assignment. Saved completed
  and partial histories remain readable by other participants and survive restart
  exactly, while the group definition still references the deleted member.

`approverId` names the first pending member for compatibility with older clients. The HTTP smoke
derives pending membership from each real response's current step and history,
and checks the corresponding participant's actual read/decision endpoints. The
native Chromium test also checks the rendered worklist and controls.
After the API group checks, the original two-step definition and both active
fixture approvers are restored for that browser journey.

```sh
python3 -m pip install -r examples/ruoyi-vue3/tests/requirements.txt
# MYSQL_PASSWORD must match the disposable database instance.
python3 examples/ruoyi-vue3/tests/smoke.py \
  --jar /absolute/path/to/backend/ruoyi-admin/target/ruoyi-admin.jar \
  --state-directory /absolute/path/to/new-empty-test-state
```

Use local MySQL on port 3306 (`ry-vue` database), Redis on port 6379, and an unused
backend port 8080. The smoke starts the backend, performs the test, stops it,
restarts with the same state file and Redis after the sequential checks and again
after the group checks, and verifies exact history persistence. It also checks that deleting a historical actor does not make the saved history
unreadable. Processes
are terminated in `finally`; logs remain in the state directory for diagnosis.

The GitHub workflow `.github/workflows/ruoyi-integration.yml` provisions disposable
MySQL 8.4.4 / Redis 7.4.2 services, builds both official upstream applications, and
runs this smoke. Python syntax checks cannot verify this runtime behavior. Check the workflow
result for the commit you are testing.
