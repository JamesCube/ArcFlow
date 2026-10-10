# Native RuoYi integration: historical captures

<!-- Legacy fragments remain entry points after the language split. -->
<a id="01--在原生菜单中设计与发布"></a>
<a id="02--在同一个宿主里完成审批"></a>
<a id="boundaries-and-attribution"></a>
<a id="reproduce-and-verify"></a>
<a id="ruoyi--arcflow--原生集成--native-integration"></a>
<a id="two-step-approval-in-ruoyi"></a>
<a id="从熟悉的若依工作台完成一次两级审批"></a>
<a id="使用限制和许可证"></a>
<a id="运行方法和截图来源"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](RUOYI_SHOWCASE.md) · [Documentation](README.en.md)

<!-- topic:complete-two-stage-approval-in-the-native-workspace -->
## Complete two-stage approval in the native workspace

These captures show an earlier sequential revision of **official RuoYi-Vue (Spring Boot 3) + RuoYi-Vue3**. RuoYi supplies the sidebar, header, login sessions, users, and permissions. ArcFlow manages definitions, requests, and individual review steps.

1. An administrator opens **ArcFlow → Approval workspace → Process design**, configures Team review → Final review with two RuoYi users, and publishes.
2. A synthetic applicant submits leave, saving the active definition version.
3. The first reviewer approves, then the second. After both approvals the request is Approved, retaining the definition snapshot and history.

<!-- topic:01-design-and-publish-from-native-menus -->
## 01 · Design and publish from native menus

[![ArcFlow two-stage designer in native RuoYi navigation](images/ruoyi-native-process-editor.png)](images/ruoyi-native-process-editor.png)

The capture shows published v3 assigned to CI first (101) and CI second (102). It is the sequential editor from that revision; ALL/ANY came later. Conditional routing and BPMN design remain unsupported in this host.

<!-- topic:02-complete-review-in-the-same-host -->
## 02 · Complete review in the same host

[![Approved request with two-stage snapshot and history in RuoYi](images/ruoyi-native-approved-history.png)](images/ruoyi-native-approved-history.png)

The second reviewer has no pending task left, and the selected request is Approved with Team review and Final review complete. Applicant/reason are synthetic. Both unedited Chromium captures are `1440 × 1080`; click for originals.

<!-- topic:run-it-and-inspect-capture-sources -->
## Run it and inspect capture sources

- [Prerequisites, native roles/permissions, and setup](../examples/ruoyi-vue3/README.en.md) · [Exact upstream pins](../examples/ruoyi-vue3/upstream-lock.json)
- Capture commit: [`48f9b68340ad84fc4b782cd6917903c39345ada1`](https://github.com/JamesCube/ArcFlow/commit/48f9b68340ad84fc4b782cd6917903c39345ada1). Its [RuoYi integration CI passed](https://github.com/JamesCube/ArcFlow/actions/runs/37091568795). Original artifact `ruoyi-native-browser-screenshots` had seven-day retention; copies remain in the repository.
- [Browser tests](../examples/ruoyi-vue3/tests/browser.py) cover native login, menus, publication, submission, assigned two-step review, reload/direct navigation, history, logout, and load-error recovery. CAPTCHA is disabled only in disposable CI databases; normal installations keep it.
- Without a RuoYi environment, start with the [standalone launcher](TRYOUT.en.md) and [first approval](GETTING_STARTED.en.md).

<!-- topic:limits-and-licenses -->
## Limits and licenses

RuoYi uses MySQL for users, roles, and menus. ArcFlow review state remains a private **single-writer local JSON** file, without SQL approval wiring or shared multi-instance support. History is not validated as a production audit system. Use localhost and synthetic data. Desktop Chromium checks do not cover all browsers or establish accessibility conformance.

Upstream [RuoYi-Vue](https://github.com/yangzongzhuan/RuoYi-Vue) and [RuoYi-Vue3](https://github.com/yangzongzhuan/RuoYi-Vue3) retain MIT licenses; ArcFlow code is Apache-2.0. This ArcFlow reference is not endorsed by upstream and does not cover other RuoYi forks or open-source hosts.

Current source supports [native ALL/ANY configuration and individual votes](../examples/ruoyi-vue3/README.en.md#configure-and-vote-in-groups). These older images deliberately preserve the two-stage sequential milestone. Check corresponding RuoYi CI for group behavior; storage remains single-writer JSON.
