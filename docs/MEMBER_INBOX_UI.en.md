# Member inbox frontend adoption: historical checkpoint

<!-- Legacy fragments remain entry points after the language split. -->
<a id="pr-18-文案整合--local-copy-integration"></a>
<a id="使用方式--behavior"></a>
<a id="尚未验证--remaining-gates"></a>
<a id="成员收件箱前端接入--member-inbox-frontend-adoption"></a>
<a id="本地验证--local-validation"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](MEMBER_INBOX_UI.md) · [Documentation](README.en.md)

This is a historical local checkpoint for the stated input tree. See [the later combination](LOCAL_INTEGRATION.en.md) and exact-commit CI for subsequent source.

The patch used backend `cac609569807ae65d488a9e79c8cf463aebad961`, tree `a1dc75ae7e14f822a2b581d27238a8aadd1b52dc`. It changed only three frontends, their tests, and documentation; not domain, storage, backend APIs, or procurement UI. PR #18 copy was incorporated locally without merging that PR. No branch, PR, deployment, or upstream change was published.

<!-- topic:behavior -->
## Behavior

- Standalone pending/handled boxes have separate current-status/saved-version filters and Load more; applicant/participant history keeps the compatible list.
- RuoYi pages and filters each box independently. My requests and participation history retain the legacy list, native authentication, and read permission; queries cannot select another actor.
- H5 has independent cursors with explicitly shared status/version filters that reset both. Search covers loaded rows only. Detail navigation and box switches preserve paging; participation/history deep links load the compatible list as needed.
- Handled means an actual individual decision. A partial ALL request can remain pending, and one actor can appear in both boxes at a later stage.
- Counts are loaded rows, not a total. Refresh from page one to find new requests/membership; pages are a live list, not a frozen snapshot.
- Logout, identity, and filter changes cancel old reads. Actor/session epochs, AbortSignals, and read generations reject late successes/errors. Shared caches cannot replace a longer saved decision history with an older snapshot.
- Uncertain decisions never retry automatically. Standalone attempts history recovery and locks that request’s actions on recovery failure; RuoYi asks for refresh; H5 protects with detail freshness and confirmation context.

<!-- topic:local-validation -->
## Local validation

- Standalone: 271 unit/component/DOM tests and Vite production build.
- Native overlay: 44 pure Node and 11 mounted DOM tests; the standalone suite also contains 10 existing native submission compatibility cases.
- H5: 71 unit/DOM tests, Vue TypeScript checking, and production build.
- Real client/HTTP: 22 assertions, 27 synthetic requests, fresh Java 17 backend, actual API transport/pager; two pages, membership, partial ALL, later-stage pending/handled overlap, filter reset, and logout cleanup.
- Independent review covered sessions, stale replies, caches, partial votes, and page preservation. Native legacy reconciliation, mobile route paging, and uncertain-decision recovery findings were fixed and regression-tested.

Final JavaScript checks used installed tools without downloads. Unit/DOM/build checks used a fail-closed network-blocking preload; HTTP used its own disposable loopback backend. An earlier npm route stopped at a registry restriction and is not final verification evidence.

<!-- topic:remaining-gates -->
## Remaining gates

No Chromium/other browser, screenshots, remote CI, or complete pinned RuoYi frontend/server build and native login/permission/browser acceptance ran; that full environment was absent. H5 does not establish App/mini-program, physical-device, accessibility, or cross-browser behavior. Vite/SFC, DOM, and local HTTP are not visual or production acceptance. Old captures/commits cannot certify this patch. The backend producer’s database matrix is separate and is not extended by frontend checks.

<!-- topic:pr-18-copy-integration -->
## PR #18 copy integration

Exact source `188924015b991848923aa477f9b169de0a28b17e` supplied 12 frontend/selector files locally. Flow, pagination, cancellation, and session isolation stayed intact. New DOM coverage checks language changes, page two, logout, and late replies from an old identity. At this checkpoint PR #18 remained unmerged and backend base stayed `cac6095`; launcher text and root package description were excluded. [Reconciliation record](MEMBER_INBOX_COPY_INTEGRATION.en.md)
