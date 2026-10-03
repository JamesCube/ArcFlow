# Record the real standalone demo

This optional launch-asset recorder uses the actual local UI and backend, with synthetic data. It captures the authenticated workspace only. Account login and role switches happen outside the capture. It does not mock API responses or alter application code.

## GitHub Actions

`Record standalone demo` runs on pushes to `demo/real-ui-video` and declares `workflow_dispatch`. GitHub's manual Run workflow control requires the workflow to be registered on the default branch; adding this file to a feature branch alone may not make that control available. The recording branch is not permission to merge it.

A successful run uploads `arcflow-real-demo-video` for seven days: MP4, poster, provenance and codec verification. No credentials, session exports, HAR, traces or server logs are uploaded. The job has only `contents: read` permission.

## Local reproduction

Use the prerequisites in TRYOUT.md, plus FFmpeg and Playwright Chromium (`npx playwright install chromium` from `examples/approval-ui`).

1. Start `python3 scripts/tryout.py` at the repository root. Keep its terminal open.
2. Set `ARCFLOW_RECORD_CREDENTIALS` to the private credentials.json path printed by the launcher. Do not paste its contents into a terminal or recording.
3. In another terminal, run from `examples/approval-ui`:

```sh
node --input-type=module -e '
  import fs from "node:fs";
  const credentials = JSON.parse(fs.readFileSync(process.env.ARCFLOW_RECORD_CREDENTIALS, "utf8"));
  for (const [user, password] of Object.entries(credentials)) {
    process.env[`APPROVAL_${user.toUpperCase()}_PASSWORD`] = password;
  }
  await import("./record-demo.mjs");'
```

4. Inspect `demo-output/ArcFlow-demo.mp4` and poster before publishing. Confirm readable text, complete sequential approvals and final history, no authentication frames, and a 30–60-second H.264 video. Provenance must identify the actual checked-out commit; when running locally set `GITHUB_SHA=$(git rev-parse HEAD)` in the recording command environment.
5. Stop the launcher with Ctrl-C. It deletes its disposable credentials and demo data. Do not distribute runtime directories.

The recorder fails rather than emitting a substitute if the real UI journey, assertions, browser capture or encoding fails. Recorded output still needs visual inspection; static syntax checks are not a successful recording.
