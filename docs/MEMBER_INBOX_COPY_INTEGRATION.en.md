# Local PR #18 copy reconciliation

<!-- Legacy fragments remain entry points after the language split. -->
<a id="本地整合-pr-18-文案--local-pr-18-copy-reconciliation"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](MEMBER_INBOX_COPY_INTEGRATION.md) · [Documentation](README.en.md)

This is a historical local checkpoint for its stated input tree. For the later combined source, see [LOCAL_INTEGRATION](LOCAL_INTEGRATION.en.md) and the exact commit’s CI results.

- Backend base remains `cac609569807ae65d488a9e79c8cf463aebad961`.
- Previous reviewed inbox tree: `5e848595537dc837bf8710248471110e475e687e`.
- Copy source: [PR #18](https://github.com/JamesCube/ArcFlow/pull/18), exact head `188924015b991848923aa477f9b169de0a28b17e`, based on `9333bdba4743bc8d490f00d2dc48323553c205e6`.
- Read-only verification on 2026-10-07 found that PR open, draft and unmerged. Its current 14-file diff matched the preserved source; only its 12 frontend/selector files are included here.

This was local source reconciliation, without push, PR creation, merge, or deployment. It excluded PR #16, procurement UI, and the PR #17 documentation rewrite. PR #18’s root `pom.xml` description and `scripts/tryout.py` prompts were outside this frontend patch and retained the backend base values.

<!-- topic:reconciliation -->
## Reconciliation

The desktop and mobile copy maps retained every inbox-specific key while taking the accepted login, help, empty-state, saved-decision and integration text. The mobile `savedPending` guidance still explains that the same person may need to review a later stage. Loaded counts, loaded-only search, independent paging, shared mobile filters and live-list caveats were not replaced by older copy.

RuoYi's newer transition sentence is exactly “当前节点已通过，等待下一节点审批。” and its browser assertions use the same text. The process guidance and self-approval warning also match PR #18. Existing state reconciliation, receipt validation and session protection remain intact.

<!-- topic:verification -->
## Verification

- Standalone: **271** unit/component/DOM tests and production build passed.
- Mobile: **71** unit/DOM tests, Vue TypeScript checking and H5 build passed.
- Native overlay: **44** pure and **11** mounted DOM tests passed.
- One new standalone DOM regression checks the updated English/Chinese sign-in headings, a language switch during page two without another fetch, logout cancellation, and rejection of the old actor's late page after another login.
- Script AST comparison for the nine affected JS/TS/Vue copy files found only string-value changes. Vue test IDs, event/model bindings, Python assertion structure, non-description manifest data and non-title HTML are unchanged.
- Independent source review found no blocking issue. Chinese/English copy keys remain aligned; no old exact-copy assertions remain.

All reruns used already-installed tools with network I/O disabled. No npm/registry retry, dependency install or browser run occurred. The 22 real client/HTTP assertions retained from the original inbox work remain evidence for the unchanged transport and pager, not a newly executed browser or copy-integration HTTP run. Full pinned RuoYi runtime/build and remote CI are still unrun for this combined local tree.
