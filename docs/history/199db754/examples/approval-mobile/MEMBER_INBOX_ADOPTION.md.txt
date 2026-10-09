# Mobile member-inbox adoption / 移动端成员收件箱

Recorded 2026-10-07. Local, uncommitted H5/mobile changes on backend commit
`cac609569807ae65d488a9e79c8cf463aebad961`. This record supersedes earlier mobile
acceptance only for the inbox adoption work described here.

## Behavior

- `GET /api/requests/inbox?box=PENDING|HANDLED&limit=25` supplies the two worklists.
  Authentication selects the actor. No actor override, offset or total is added.
- Each box has its own items, continuation, loading/error/freshness state and
  request generation. Continuations remain opaque and are URL-encoded once.
  The server's creation ordering is retained; append deduplicates request IDs.
- Optional status and positive integer process-version filters apply to both
  boxes and reset both pages. Actor changes also clear filters, search, pages,
  drafts and cached records. A deep-link ID is preserved for reauthentication.
- Search is explicitly over loaded rows. Counts are labeled as loaded counts;
  the pending badge adds `+` only when the server returned a continuation. There
  is no claim of a global search or total. End-of-list is qualified as one read
  of a live list; refresh restarts both first pages.
- Related to me and detail/deep-link refreshes retain the broader legacy
  `/requests` endpoint. It is loaded lazily. The legacy view has no inbox filters.
  Opening detail, Back, and switching tabs preserve loaded inbox pages.
- A successful decision response is accepted only after checking the original
  request ID, current actor, known status/audit shape, unchanged audit prefix and
  a new saved event matching actor, reviewed step and decision. Malformed or
  mismatched success payloads remain uncertain and trigger read reconciliation
  without a confirmed-success notice or automatic retry. The validated response
  is retained, then both boxes and selected detail are refreshed. Partial votes can remain pending overall, and an actor
  assigned to the next stage can appear in both boxes. A failed write refreshes
  before retry and never silently resubmits a prior-stage decision.
- Cancellation is backed by actor epochs and per-read generations, including
  when fetch ignores abort. An actor-scoped cache retains the record with the
  longest immutable history, preventing older pending/handled/legacy responses
  from regressing an observed vote. Cached newer records also remove obsolete
  pending/filter memberships; they never create new membership without a server
  page. Logout discards the cache.

## Executed checks

The installed dependency tree from the sibling approved mobile checkout was
used through a local `node_modules` symlink. No dependency was installed or
updated. Source `vue-tsc`, Vitest/DOM tests and the real uni H5 build were run.

An ordinary npm invocation was rejected because the review reported a registry
request outside the local-only scope. That route was stopped. Subsequent checks
used inspected installed entrypoints with a fail-closed Node preload that blocks
TCP, TLS, UDP, HTTP(S), and fetch, and CI mode disabling the uni update reporter.
No browser or external service was used for these checks.

Exact final commands in `examples/approval-mobile` (output saved in
[MEMBER_INBOX_VALIDATION.log](MEMBER_INBOX_VALIDATION.log)):

```sh
NODE_OPTIONS=--require=/tmp/member-inbox-offline-verification/no-network.cjs node node_modules/vitest/vitest.mjs run
NODE_OPTIONS=--require=/tmp/member-inbox-offline-verification/no-network.cjs node node_modules/vue-tsc/bin/vue-tsc.js --noEmit
CI=1 NODE_OPTIONS=--require=/tmp/member-inbox-offline-verification/no-network.cjs node scripts/uni.mjs build
git diff --check -- .
```

The preload is an execution-workspace safety guard, not an application runtime
or a shipped dependency. The normal project scripts remain available in README.

- Vitest: **71 passed, six files**, including **12 component DOM tests**.
- Vue/TypeScript source check: passed.
- uni-app H5 production build: passed; output under ignored `dist/build/h5`.
- Whitespace/diff check: passed.

New regressions cover independent cursors, non-representative group members,
server order, overlapping-page deduplication, end-of-list, retained rows on
continuation failure, duplicate load clicks, retry/reset, filter and actor
changes, stale responses/401s after abort, post-vote cursor invalidation,
partial-vote and same-actor next-stage overlap, cross-box/detail snapshot races,
frozen decision context, opaque cursor transport and rejected actor spoofing.
Nine response-correlation regressions cover mismatched IDs, actor, step, decision,
status/history shape, rewritten history, unknown audit actions and recovery of an
actually committed vote after a wrong-request response.
DOM tests cover loaded-only labels/search, a matching later-page row, native
filter labels/validation, page-error recovery, and detail/Back page retention.
Existing model tests still enumerate 2,304 reachable mixed-stage states.

## Verification limits

No current browser run, visual screenshot, real-device check or backend HTTP
exercise was performed for this UI change. The previously blocked Chromium
path was not retried. Earlier HTTP and CI browser evidence in ACCEPTANCE.md is
historical evidence for an earlier mobile slice, not this pagination UI.
Native App, mini-program and enterprise-host integration remain out of scope.
No commit, push, pull request, deployment or publication was made.

本次已完成本地单元/DOM、类型检查与 H5 构建；没有将 DOM 检查写成浏览器或真机验收。
分页筛选和返回列表交互仍需后续获准的真实浏览器验收。

## Later local copy reconciliation

PR #18 head `188924015b991848923aa477f9b169de0a28b17e` was then incorporated locally for frontend copy and selectors only. All new inbox keys, loaded-only counts/search, shared-filter guidance and repeated-approver wording remain intact. The 71 tests, typecheck and H5 build were rerun successfully using the same network-disabled installed runners. This does not merge PR #18 or claim new browser acceptance. See [the shared integration record](../../docs/MEMBER_INBOX_COPY_INTEGRATION.md).
