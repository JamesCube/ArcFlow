# First approval

<!-- Legacy fragments remain entry points after the language split. -->
<a id="1-启动独立演示"></a>
<a id="2-完成一次审批"></a>
<a id="3-体验顺序设计器"></a>
<a id="4-试试采购与报价审批"></a>
<a id="5-验证重启恢复"></a>
<a id="first-approval--第一次审批"></a>
<a id="try-other-cases-zh"></a>
<a id="下一步"></a>
<a id="常见问题"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](GETTING_STARTED.md) · [Documentation](README.en.md)

This walkthrough follows current `main`. Historical release archives may contain fewer scenarios or older contracts; use their own bundled documentation. For source setup and module-specific tests, see the [developer quickstart](development/QUICKSTART.en.md#en).

<!-- topic:1-start-the-standalone-demo -->
## 1. Start the standalone demo

These steps start the demo in two terminals and keep its data between runs. For a temporary demo that cleans up when you stop it, use the [one-command launcher](TRYOUT.en.md).

Requirements: Git, Bash, a full JDK 17+, Maven 3.9+, Node 22.22.2 or later within 22.x, and npm. Supported alternatives for the standalone UI are Node 24.15+ within 24.x or Node 26+, as declared in its [package.json](../examples/approval-ui/package.json). This setup needs no MySQL, Redis or RuoYi installation.

Choose a new private data path and three different demo-only passwords, each at least 12 characters long and at most 72 UTF-8 bytes. Multibyte characters can reach the byte limit sooner. Use test data instead of real leave, health or personnel information. A fresh store starts with **Alice submits → Bob reviews → complete**.

In terminal 1:

```bash
git clone https://github.com/JamesCube/ArcFlow.git
cd ArcFlow
mvn install
mvn -f examples/approval-domain/pom.xml install

# Private local demo state; reuse this absolute path when restarting.
umask 077
mkdir -p "$PWD/examples/approval-demo/backend/data"
export APPROVAL_DATA_FILE="$PWD/examples/approval-demo/backend/data/requests.json"

# Choose three different demo-only passwords, each at least 12 characters and at most 72 UTF-8 bytes.
read -rs -p 'Alice demo password: ' APPROVAL_ALICE_PASSWORD; echo
read -rs -p 'Bob demo password: ' APPROVAL_BOB_PASSWORD; echo
read -rs -p 'Carol demo password: ' APPROVAL_CAROL_PASSWORD; echo
export APPROVAL_ALICE_PASSWORD APPROVAL_BOB_PASSWORD APPROVAL_CAROL_PASSWORD
mvn -f examples/approval-demo/backend/pom.xml spring-boot:run
```

In terminal 2, from the same repository root:

```bash
cd examples/approval-ui
npm ci
npm run dev
```

Keep both terminals running. Open [http://localhost:5173](http://localhost:5173) after the backend and UI are ready.

<!-- topic:2-complete-a-request -->
## 2. Complete a request

1. Open the UI and select **English** in the language menu. Choose **Alice · process designer**, enter Alice's configured password, and select **Enter workspace →**.
2. Submit `Demo leave`, reason `Synthetic test`, for `1` day. Expect **pending**, assigned to Bob.
3. Sign out. Choose **Bob · approver** and use Bob's password. Open **Needs my review**, select the request, and approve it.
4. Sign back in as Alice. Open the request in **Requests**. Expect **approved**, the saved one-step definition, and submission/approval activity.

The demo runs locally with the passwords you configure. Credentials stay in page memory and are cleared when you sign out or reload, so you’ll need to sign in again.

<!-- topic:3-try-the-designer -->
## 3. Try the designer

As Alice, open **Process designer**, keep Bob as the first approver, add Carol as the second, and publish. You can add, name, remove and reorder 1–8 approval steps. Submit a **new** request, then try the two steps:

- Bob approves the first step: the request remains **pending**, now assigned to Carol.
- Carol approves the final step: it becomes **approved**. Rejecting a current step ends it as **rejected**.
- The earlier request keeps its original one-step snapshot. Publishing never changes a running or completed request.

Only Alice can publish. Bob and Carol can decide only their current step. Signing out or reloading the page loses unpublished edits, so publish before leaving. If another publication makes your draft stale, refresh, review the new version, reset your draft and reapply the changes you still want.

<a id="try-other-cases-en"></a>

<!-- topic:4-try-procurement-and-quote-approvals -->
## 4. Try procurement and quote approvals

All three cases use the same running standalone backend and UI. No additional server, database or vendor account is needed. With the launcher, use the exact printed origin and the passwords in its private file. With the manual setup above, use `http://localhost:5173` and the passwords you configured. Keep passwords out of URLs and source files.

**ERP procurement, in the existing workspace:**

1. Sign in as Alice and open **Requests**. Choose **Procurement** under **Request type**.
2. Enter reference `PO-DEMO-001`, title `Demo equipment purchase`, item `Equipment set`, quantity `3`, unit price `0.10`, currency `CNY`, and reason `Synthetic test`. Check that the total is **CNY 0.30**, then submit.
3. Follow the reviewers in the saved process. A fresh store uses Bob only; if you published Bob → Carol above, both must approve in order. Sign back in as Alice to check the saved item, amount and history. Approval does not place an order or make a payment.

**CRM quote discount, on its own page:**

1. Open `/quote-discount.html` on the same UI origin. With the default manual setup, that is [http://localhost:5173/quote-discount.html](http://localhost:5173/quote-discount.html). Select **English** in this page's own language menu. Use a desktop-width window to submit; narrow screens only support viewing and review.
2. Sign in as Alice again with the same configured password. The two pages do not share a login. Select the preset `Q-DEMO-001` revision 1, keep the synthetic title/reason and requested unit price `850.00`. For ten items, check **CNY 8,500.00** and a **CNY 1,500.00** reduction, then submit. The saved record also shows a **15%** discount.
3. Sign out on the quote page, sign in as Bob and approve, then sign out and sign in as Carol to approve. This fixed Bob → Carol sequence is separate from the leave/procurement designer. Alice can then inspect the approved record on the quote page.

One quote revision binds to one request. Repeating the same submission returns that record; changing its price or reason conflicts. The preset source has only revision 1. For a fresh exercise, finish and stop the disposable launcher, then start a new run; do not delete a persistent store just to repeat the demo. See [the quote contract](CRM_QUOTE_CASE.en.md) for details. Quotes are not listed in the shared workspace, RuoYi or H5. This synthetic case makes no external CRM or AI calls and performs no business writeback.

**Six dedicated scenarios:** Open `/scenarios.html` on the same origin for expense, travel, seal-use, receiving, payment, and contract reviews. Each has its own process, requests, and store, separate from the main leave/procurement workspace and quote page. Only payment, receiving, and contract expose conditional routing. These are synthetic reviews, without payments, stock posting, signing, or external writeback. See the [scenario map](development/ARCHITECTURE.en.md#en) and [API examples](api/examples/README.en.md).

**Other clients:** [RuoYi](../examples/ruoyi-vue3/README.en.md) has its own installation, accounts, ArcFlow menu and role permissions. It supports leave and procurement; standalone Alice/Bob/Carol passwords do not log in to RuoYi. [H5](../examples/approval-mobile/README.en.md#run-locally--本地运行) is a separate review-only client for existing leave/procurement requests, with its own startup and origin configuration. The standalone launcher starts neither client.

<!-- topic:5-check-restart-persistence -->
## 5. Check restart persistence

Stop the backend with Ctrl+C, then rerun its `spring-boot:run` command in the same terminal, keeping the same `APPROVAL_DATA_FILE` and password variables. Sign in again and verify that the published process, requests and history remain. A pending request should continue at the same step.

If you open a new terminal, set the passwords again and set `APPROVAL_DATA_FILE` to the **same absolute path** before starting. Do not run two backends against one data file. The file store supports one local writer. It has no clustering or power-loss durability guarantee.

<!-- topic:troubleshooting -->
## Troubleshooting

| Symptom | Check |
| --- | --- |
| Maven cannot resolve `arcflow-core` or `approval-domain` | Run root `mvn install`, then `mvn -f examples/approval-domain/pom.xml install`, before starting the backend. These jars are built locally. |
| Backend refuses to start | Check all three password variables (at least 12 characters and at most 72 UTF-8 bytes each), port 8080, and data-path permissions. Another process using the same store intentionally blocks startup. |
| UI cannot connect / login fails | Wait for backend startup; use the configured account/password and exact URL `http://localhost:5173`. Check API logs, Node version, and port 5173. Keep loopback bindings. |
| UI port 5173 is already in use | Stop your other demo instance or deliberately change both the Vite port and backend `APPROVAL_UI_ORIGIN`. Avoid changing the hostname/port in only one place. |
| Publish or submit reports a conflict | Refresh to load the current published version. Review before retrying; preserve/reapply designer changes if needed. |
| A submission's response was interrupted | Keep the original form and retry with its retained idempotency key. If the page was reloaded or the key was lost, inspect the request list before a new submission. See [retry boundaries](SUBMISSION_IDEMPOTENCY.en.md). |
| Restart appears to lose data | Check the absolute `APPROVAL_DATA_FILE`; a different path creates a different store. Do not delete or edit a failing snapshot to bypass validation. |

<!-- topic:next-steps -->
## Next steps

- For development, use the [developer index](development/README.en.md#en), [API reference](api/API_REFERENCE.en.md), and [persistence/migration guide](development/PERSISTENCE.en.md#en).

- To use RuoYi’s users, login, menus and role permissions, follow the [official upstream overlay guide](../examples/ruoyi-vue3/README.en.md). It needs disposable local MySQL/Redis and additional setup. Approval data still goes into a JSON file.
- The [backend guide](../examples/approval-demo/backend/README.en.md), [UI guide](../examples/approval-ui/README.en.md) and [sequential contract](SEQUENTIAL_APPROVAL.en.md) explain the APIs, tests, security and storage limits.
- To run the non-browser standalone checks: `mvn verify`, `bash scripts/test.sh`, `mvn install`, `mvn -f examples/approval-domain/pom.xml install`, `mvn -f examples/approval-demo/backend/pom.xml verify`, then `(cd examples/approval-ui && npm ci && npm test && npm run build)` from the repository root. The root build alone does not test the examples. For the actual Chromium journey, see [real-browser first-run checks](../examples/approval-ui/README.en.md#real-browser-first-run-check).
