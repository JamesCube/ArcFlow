# Designer in action: historical captures

<!-- Legacy fragments remain entry points after the language split. -->
<a id="01--看清流程在一个面板配置节点"></a>
<a id="02--390px-窄屏流程与节点设置上下排列"></a>
<a id="arcflow-设计器--designer-in-action"></a>
<a id="design-publish-and-try-an-approval-sequence"></a>
<a id="what-has-been-tested"></a>
<a id="从源码一键试用"></a>
<a id="已有功能和使用限制"></a>
<a id="来源与验证"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](DESIGNER_SHOWCASE.md) · [Documentation](README.en.md)

<!-- topic:01-inspect-a-flow-and-configure-one-stage -->
## 01 · Inspect a flow and configure one stage

[![1440px designer with Chinese settings, an ANY group and publication state](images/designer-desktop-836e605.png)](images/designer-desktop-836e605.png)

Use a connector’s “+” button to insert a stage at that position. Cards show names, participants, and voting rules; select one to edit it in the right-hand panel. ANY is explicit: **one approval passes; only unanimous rejection rejects**. Published version, draft base version, and unpublished changes are shown separately. Undo/redo affects the local draft only.

The capture is a running standalone Vue + Spring Boot demo using synthetic Alice, Bob, and Carol accounts. At this revision only the designer offered Chinese, with an English toggle; current main also localizes login, navigation, submission, and review.

<!-- topic:02-stack-settings-below-the-flow-at-390px -->
## 02 · Stack settings below the flow at 390px

<a href="images/designer-mobile-836e605.png"><img src="images/designer-mobile-836e605.png" width="390" alt="390px designer with flow cards, settings below and publication controls"></a>

On narrow screens, settings move below the flow. The browser test selects the last stage, checks that the panel scrolls into view, and rejects horizontal overflow. This full-page capture uses a 390px Chromium viewport; physical phones and other mobile browsers require separate checks.

<!-- topic:try-it-from-source -->
## Try it from source

Install the [required tools](TRYOUT.en.md#requirements) and run at the repository root:

```sh
python3 scripts/tryout.py
```

Use current main or the tested `e1ee9c6` below. After readiness, sign in with the generated Alice password, open **Process designer**, choose single-reviewer, ALL, or ANY stages, and publish. Submit synthetic data, then sign in as Bob/Carol to review. Ctrl-C stops services and removes this run’s data. [Full walkthrough and group rules](TRYOUT.en.md#what-to-try)

The older [`v0.1.0-alpha.1`](https://github.com/JamesCube/ArcFlow/releases/tag/v0.1.0-alpha.1) source bundle has sequential approval only; it excludes these designer updates, ALL/ANY, and JDBC.

<!-- topic:tested-capabilities-and-limits -->
## Tested capabilities and limits

| Area | Tested behavior | Limits |
| --- | --- | --- |
| Standalone designer/demo | Single/ALL/ANY, individual votes, saved snapshots, desktop/narrow layouts | Fixed synthetic accounts, ordered stages, single-writer JSON by default |
| Official RuoYi reference | Native login, menus, permissions, two-stage sequential review | Current host has [ALL/ANY groups](../examples/ruoyi-vue3/README.en.md#configure-and-vote-in-groups); approval storage remains JSON; [historical captures](RUOYI_SHOWCASE.en.md) |
| Optional JDBC | Historical `e1ee9c6`: MySQL 8.0.46/8.4.11 × Java 17/21, 29 server tests per combination | Host installs/configures the adapter and schema; demos do not switch automatically; [results](../examples/approval-jdbc/MYSQL_VERIFICATION.en.md#verified-server-acceptance-2026-10-05) |

Those JDBC results cover the earlier sequential store, not the later submission-key upgrade.

ALL waits for every approval and rejects on any rejection. ANY advances on one approval and rejects only after all reject. The pictured main workspace runs stages in order without conditional branches or arbitrary graph connections. Drafts live in page memory: workspace Refresh preserves them, while browser reload/sign-out discards them. Current payment, receiving, and contract scenarios have [restricted conditions](development/ARCHITECTURE.en.md); timers, delegation, and BPMN compatibility remain unsupported. Production use is unvalidated.

<!-- topic:sources-and-verification -->
## Sources and verification

- Both images are unchanged CI originals: desktop `1440 × 1609`, narrow `390 × 2373`, from `02-workbench-any-inspector.png` and `03-workbench-narrow-inspector.png`.
- Capture commit: [`836e6051a0c1198c9348e58c094e40cdcf11f3f1`](https://github.com/JamesCube/ArcFlow/commit/836e6051a0c1198c9348e58c094e40cdcf11f3f1). The [passing capture workflow](https://github.com/JamesCube/ArcFlow/actions/runs/37257554086) produced artifact `11323062579`, retained seven days; repository copies remain available.
- Merge: [`e1ee9c6bdb971949c4f8746fe88b9ff49e6d4c36`](https://github.com/JamesCube/ArcFlow/commit/e1ee9c6bdb971949c4f8746fe88b9ff49e6d4c36). Both commits have tree `302ecb8d9041429d8aabad2851ec7388f3b653e9`.
- All five merge workflows passed: [Java](https://github.com/JamesCube/ArcFlow/actions/runs/37258262044), [designer/API/Chromium](https://github.com/JamesCube/ArcFlow/actions/runs/37258262057), [JDBC](https://github.com/JamesCube/ArcFlow/actions/runs/37258262111), [native RuoYi](https://github.com/JamesCube/ArcFlow/actions/runs/37258262058), [launcher](https://github.com/JamesCube/ArcFlow/actions/runs/37258262036). These results apply to that commit; check another revision’s own CI.
- [Workbench browser tests](https://github.com/JamesCube/ArcFlow/blob/836e6051a0c1198c9348e58c094e40cdcf11f3f1/examples/approval-ui/e2e/workbench.spec.mjs) cover insertion, invalid-group focus, local undo, Escape focus return, the narrow panel, and publication. Browser-native text undo, 200% zoom, other browsers, and a formal accessibility audit remain unverified.
