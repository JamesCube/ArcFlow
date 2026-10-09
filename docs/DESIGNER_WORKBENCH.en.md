# Approval designer workbench

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](DESIGNER_WORKBENCH.md) · [Documentation](README.en.md)

This update adds a flow canvas, a node settings panel and local undo/redo to the standalone Vue designer. The code and browser tests are in merged commit [`e1ee9c6`](https://github.com/JamesCube/ArcFlow/commit/e1ee9c6bdb971949c4f8746fe88b9ff49e6d4c36). See the [desktop and narrow-screen screenshots](DESIGNER_SHOWCASE.en.md). The approval domain, JDBC adapter and MySQL behavior are unchanged. The demo remains experimental and has not been validated for production use or feature parity with commercial approval tools.

<!-- topic:interaction -->
## Interaction

- The canvas shows the steps in order, with fixed start/end nodes. Each review card shows its name, participant names and initials, and approval rule.
- Use the button on a connector to insert a step there. Existing IDs stay the same. The new step is selected, with focus in its name field.
- The settings panel edits one selected stage. It stays on the right on wide screens and moves below the flow on narrow screens. Selecting a stage with a pointer scrolls the narrow-screen panel into view.
- At this commit, the designer opens in Chinese and has an English toggle; the rest of the demo and its server errors are in English. Current `main` also translates the surrounding workspace. See the [current UI guide](../examples/approval-ui/README.en.md).
- ALL is labelled “全员同意（ALL）”: everyone must approve; any rejection rejects the request. ANY is labelled “任一同意（ANY）”: one approval advances; only every participant rejecting rejects it. The rule is always visible in the inspector. A group remains one ordered stage, not a pair of graphical branches.
- Bob and Carol are the only demo participants. Switching a single-reviewer stage to a group selects both and announces the change. You can edit the checklist, but publication requires at least two participants.
- The panel shows the published version, the version your draft started from, and whether you have unpublished changes. “Ready to publish” appears only when the draft has valid changes, is based on the current version and has no request in progress.
- Drafts and undo history stay in page memory. Workspace Refresh keeps your edits; reloading the browser or signing out loses them. The Chinese warning explains the difference.
- Undo/redo keeps up to 50 edits and combines uninterrupted typing into one edit. It covers names, assignments, modes, participants, insertion, movement, removal and reset. Undo never sends a network request. Successful publication clears the history. Recovering an older draft by undoing a reset still requires the usual version-conflict check.
- Selecting a validation error opens the affected stage and focuses the invalid name or participant control. Errors are associated with their fields for assistive technology. Escape handling leaves IME composition alone.
- You can insert and move stages with keyboard-accessible buttons. Enter opens a card’s settings; Escape returns focus to the card. Ctrl/Cmd+Z and Shift+Z/Y control local history while focus is on the canvas. Text fields keep their normal browser shortcuts.

<!-- topic:design-references-and-deliberate-differences -->
## Design references and deliberate differences

The connector buttons and single-node settings panel draw on patterns documented in [Feishu’s approval designer](https://www.feishu.cn/hc/zh-CN/articles/360036163653-%E7%AE%A1%E7%90%86%E5%91%98%E8%AE%BE%E8%AE%A1%E6%89%B9%E6%B5%81%E7%A8%8B) and [DingTalk Yida’s approval nodes](https://docs.aliwork.com/docs/yida_support/_2/trbqg6/rq8i94). The implementation uses no copied proprietary code, artwork or assets.

Yida documents “或签” as allowing the first operator to decide the outcome. ArcFlow ANY rejects only when everyone rejects, so the settings panel spells out that rule.

Text contrast and keyboard behavior were designed with the [WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [WAI keyboard-interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/) in mind. A WCAG audit has not been performed.

<!-- topic:verification-boundary -->
## Verification boundary

The [approval CI run for this commit](https://github.com/JamesCube/ArcFlow/actions/runs/37258262057) passed 185 UI tests, 35 backend tests and all three Chromium journeys. Component and model tests cover insertion positions, stable IDs, one/eight-stage limits, local history, selected-node focus, invalid groups, read-only users, repeated interactions and requests in progress, IME Escape, keeping history during navigation, restoring stale drafts after reset, and clearing history after publication. The suite also includes the earlier sequential and group tests.

The successful [screenshot run at `836e605`](https://github.com/JamesCube/ArcFlow/actions/runs/37257554086) checked the Chinese labels, connector insertion, focus on invalid groups, local undo, Escape focus return, publication, and the stacked settings panel at 390px with no horizontal overflow. Its source tree matches merged `e1ee9c6`. The [original screenshots and their source details](DESIGNER_SHOWCASE.en.md) are saved in this repository.

Desktop and narrow-screen browser tests passed for these historical commits; this is not acceptance evidence for another revision. Browser-native text undo, 200% zoom, other browsers and accessibility still need separate checks. To rerun the tests from `examples/approval-ui`, use `npm test`, `npm run build`, then `npm run test:e2e`.
