# Focused approval designer workbench

This milestone improves the standalone Vue designer. The implementation and real-browser acceptance are included in merged source [`e1ee9c6`](https://github.com/JamesCube/ArcFlow/commit/e1ee9c6bdb971949c4f8746fe88b9ff49e6d4c36); see the [desktop/mobile gallery](DESIGNER_SHOWCASE.md). It does not change the approval domain, JDBC adapter or MySQL behavior. It is a bounded interaction upgrade, not a claim of production or commercial-product parity.

## Interaction

- A compact ordered canvas shows fixed start/end boundaries and named review cards with participant initials, names and completion-mode summaries.
- Every connector inserts at that exact position. Existing IDs remain stable; the new step is selected and its name receives focus.
- One right-hand inspector edits the selected stage. It is sticky on wide layouts; the stacked narrow layout brings it into view after pointer selection.
- The standalone designer starts in Chinese and has an English toggle. The surrounding demo workspace and server error messages remain English; this is deliberately not a full application i18n system.
- ALL is labelled “全员同意（ALL）”: everyone must approve; any rejection rejects the request. ANY is labelled “任一同意（ANY）”: one approval advances; only every participant rejecting rejects it. The rule is always visible in the inspector. A group remains one ordered stage, not a pair of graphical branches.
- The fixed demo participant directory remains Bob and Carol. Switching from single to group preselects those two people and announces that change. Participants can be changed in the checklist, but an invalid single-member/empty group cannot publish.
- Published version, draft base version and unsaved state are separate. A current, valid, changed idle draft shows “ready to publish”; stale, clean or in-flight drafts do not.
- Drafts and history live in page memory only. Workspace Refresh preserves local edits; browser reload and sign out discard them. The Chinese warning distinguishes these actions explicitly.
- Local undo/redo retains up to 50 edits, coalesces uninterrupted typing, and covers names, assignments, modes, participants, insert/move/remove and reset. It never replays a network request. Confirmed publication clears local undo history; undoing a reset to recover an older draft cannot bypass version-conflict protection.
- Validation summaries select the affected stage and focus its invalid name/participant control. Name and participant errors have accessible associations. IME composition is not interrupted by Escape handling.
- Native buttons provide keyboard insertion and movement. Enter opens a card’s inspector; Escape returns focus to that card. Canvas Ctrl/Cmd+Z and Shift+Z/Y control local history. Text fields retain their browser keyboard handling.

## Design references and deliberate differences

The interaction direction was informed by official [Feishu approval-designer documentation](https://www.feishu.cn/hc/zh-CN/articles/360036163653-%E7%AE%A1%E7%90%86%E5%91%98%E8%AE%BE%E8%AE%A1%E6%89%B9%E6%B5%81%E7%A8%8B) and [DingTalk Yida approval-node documentation](https://docs.aliwork.com/docs/yida_support/_2/trbqg6/rq8i94): connector insertion and focused node configuration are useful patterns. No proprietary code, artwork or assets were copied.

Yida’s documented “或签” behavior can be decided by the first operator. ArcFlow ANY has a different rejection rule. The UI therefore uses explicit completion semantics instead of implying exact product compatibility.

Text contrast and keyboard decisions follow the intent of [WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [WAI keyboard-interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/). This is not a claim of audited WCAG compliance.

## Verification boundary

The [exact-commit approval CI](https://github.com/JamesCube/ArcFlow/actions/runs/37258262057) passed 185 UI tests, 35 backend tests and all three Chromium journeys. Component/model tests cover insertion positions, stable IDs, one/eight-stage limits, local history, selected-node focus, invalid groups, read-only users, repeated/in-flight interactions, IME Escape, navigation history retention, stale reset recovery and confirmed-publication boundaries. Existing sequential and parallel tests remain part of the suite.

The successful [capture run at `836e605`](https://github.com/JamesCube/ArcFlow/actions/runs/37257554086) exercised Chinese-first labels, connector insertion, invalid-group focus, local undo, Escape focus return, the 390px stacked inspector with no horizontal overflow, and publication. Its source tree matches merged `e1ee9c6`. [Unmodified screenshots and provenance](DESIGNER_SHOWCASE.md) are checked into this repository.

This closes the earlier desktop/narrow browser-execution gap. It does not establish browser-native text undo, 200% zoom behavior, other browsers or audited accessibility compliance. Run `npm test`, `npm run build`, then the repository’s `npm run test:e2e` to reproduce; review these remaining boundaries separately.
