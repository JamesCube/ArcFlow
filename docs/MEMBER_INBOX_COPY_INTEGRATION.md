# 本地整合 PR #18 文案 / Local PR #18 copy reconciliation

This is a historical local checkpoint for its stated input tree. For the later combined source, see [LOCAL_INTEGRATION](LOCAL_INTEGRATION.md) and the exact commit’s CI results.

- Backend base remains `cac609569807ae65d488a9e79c8cf463aebad961`.
- Previous reviewed inbox tree: `5e848595537dc837bf8710248471110e475e687e`.
- Copy source: [PR #18](https://github.com/JamesCube/ArcFlow/pull/18), exact head `188924015b991848923aa477f9b169de0a28b17e`, based on `9333bdba4743bc8d490f00d2dc48323553c205e6`.
- Read-only verification on 2026-10-07 found that PR open, draft and unmerged. Its current 14-file diff matched the preserved source; only its 12 frontend/selector files are included here.

本次是本地源码整合，没有推送、提交 PR、合并或部署。没有纳入 PR #16、采购界面或 PR #17 文档重写。PR #18 的根 `pom.xml` 描述和 `scripts/tryout.py` 提示不属于此次前端补丁，保持后端基础版本原样。

## Reconciliation

The desktop and mobile copy maps retained every inbox-specific key while taking the accepted login, help, empty-state, saved-decision and integration text. The mobile `savedPending` guidance still explains that the same person may need to review a later stage. Loaded counts, loaded-only search, independent paging, shared mobile filters and live-list caveats were not replaced by older copy.

RuoYi's newer transition sentence is exactly “当前节点已通过，等待下一节点审批。” and its browser assertions use the same text. The process guidance and self-approval warning also match PR #18. Existing state reconciliation, receipt validation and session protection remain intact.

## Verification

- Standalone: **271** unit/component/DOM tests and production build passed.
- Mobile: **71** unit/DOM tests, Vue TypeScript checking and H5 build passed.
- Native overlay: **44** pure and **11** mounted DOM tests passed.
- One new standalone DOM regression checks the updated English/Chinese sign-in headings, a language switch during page two without another fetch, logout cancellation, and rejection of the old actor's late page after another login.
- Script AST comparison for the nine affected JS/TS/Vue copy files found only string-value changes. Vue test IDs, event/model bindings, Python assertion structure, non-description manifest data and non-title HTML are unchanged.
- Independent source review found no blocking issue. Chinese/English copy keys remain aligned; no old exact-copy assertions remain.

All reruns used already-installed tools with network I/O disabled. No npm/registry retry, dependency install or browser run occurred. The 22 real client/HTTP assertions retained from the original inbox work remain evidence for the unchanged transport and pager, not a newly executed browser or copy-integration HTTP run. Full pinned RuoYi runtime/build and remote CI are still unrun for this combined local tree.
