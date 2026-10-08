# OA 费用报销 / Expense scenario

场景库第一条独立模板包含真实结构的费用明细、不可变业务快照和可视化固定审批流程。
全部使用合成数据。票据仅为文字引用；通过审批不会打款、上传票据、验证发票或写入财务系统。

This is a bounded synthetic example, not a complete reimbursement system. Form sections/widgets
come from compiled, versioned ScenarioCatalog metadata. The server validates explicit
BusinessDocument.Expense data. Arbitrary drag-and-drop fields, scripts and formula execution are not supported.

[查看全部实拍 / Open the full visual walkthrough](#gallery)

## Start / 启动

Run `python3 scripts/tryout.py` from the repository root. After READY, open its printed
`/scenarios.html` URL. Use the disposable Alice/Bob/Carol passwords from the private credentials
file; never put passwords in screenshots, URLs or source. This page signs in separately and
keeps credentials only in memory. The manual [startup instructions](GETTING_STARTED.md) also apply.
Static builds must retain `dist/scenarios.html` and its generated assets.

## Fields and rules / 字段与规则

- businessId/title/reason, costCenter (ENGINEERING/SALES/OPERATIONS), currency and1–20 expense lines.
- Each line: stable lineId, spentOn, category (TRAVEL/MEALS/OFFICE/OTHER), description, amount, receiptRef.
- lineId and receiptRef are each unique within a claim. They do not provide cross-claim invoice verification.
- References use1–128 ASCII characters, begin with a letter/digit, and otherwise allow letters/digits plus `._:/-`.
- Title≤120, reason≤2000, description≤240 characters. Text must remain nonblank after normalization.
- Dates must be real YYYY-MM-DD dates in years0001–9999. No company calendar, tax or expense-period policy is inferred.
- Every amount is positive and≤1,000,000,000 with at most2 decimal places. JPY must be whole.
  CNY/USD/EUR/GBP/JPY are supported; no exchange-rate conversion occurs.
- Java BigDecimal and browser decimal text/BigInt preserve exact amounts. Total is derived, never submitted:
  0.10 + 0.20 = 0.30. Receipt references are synthetic text, not file uploads.

默认 Bob 做费用审核，Carol 做财务复核。Alice 可编辑、发布1–8个固定审批步骤，支持 SINGLE/ALL/ANY。
人名与步骤名称不是动态组织角色。表单结构在当前版本固定；设计器编辑审批流程。
已提交的申请保留原业务数据、流程定义及版本。APPROVED/REJECTED只表示审批状态，不触发付款。

The dedicated standalone page is separate from shared leave/procurement lists, native RuoYi and
the H5 application. It does not introduce a cross-scenario inbox or external business connector.

## HTTP and authorization

- GET `/api/scenarios`: form metadata.
- GET/POST `/api/scenarios/oa-expense/process`: read/publish process; publication body is `{expectedVersion,definition}`.
- GET `/api/scenarios/oa-expense/requests`: caller-visible requests.
- POST `/api/scenarios/oa-expense/documents`: `{business,processVersion}` and exactly one `Idempotency-Key`.
- POST `/api/scenarios/oa-expense/requests/{id}/decisions`: `{stepId,decision,comment}`.

Business has `type:"expense"`, `documentVersion:1`, and all fields above. Amounts are JSON numbers,
not strings. Response is `{request,total}`; total is an exact display string fixed to2 decimals,
except whole JPY. Compatibility request.days is0; consumers must inspect business.type.

Identity comes from the authenticated principal. Existing Origin/client-header and domain
publication/participant permissions apply. Unknown fields, duplicate keys, malformed decimal
values, client-supplied identity/process/status/derived totals fail closed. Generic standalone
`/api/documents` and native `/arcflow/documents` explicitly allow only leave/procurement.

## Retry and storage / 重试与存储

Same caller/key and normalized intent replay the current durable request, including terminal
state or after restart. Changing any header/line or original process version with the same key
returns409. New key means new intent; businessId alone is not a uniqueness constraint. JDBC key
scope remains global `(applicant_id,submission_key)` across processes.

The host uses process `oa-expense` and `approval.data-file + ".scenario-oa-expense.json"`.
A compiled registry maps ids to runtimes; untrusted paths never select filenames.

- JSON schemas1–6 remain readable without rewriting. First Expense write uses schema7.
- Expense inside schema5/6 is rejected. Schema7 never downgrades after later legacy writes.
- Preserve exact bytes immediately before upgrade. Failed atomic replacement publishes neither
  request nor retry binding; retry preserves the pre-upgrade backup.
- JDBC stays SQL revision3: typed values use request_json and existing member projections.
  Existing stopped-writer revision3/backfill requirements still apply; no new DDL is introduced.
- Upgrade all readers and stop incompatible writers before Expense writes. Schema6 readers do
  not understand Expense/schema7. Backups are historical recovery, not a lossless downgrade.

## Verification

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml verify
mvn -f examples/approval-jdbc/pom.xml test
python3 examples/scenarios/http_smoke.py --jar examples/approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
cd examples/approval-ui
npm ci
npm test
npm run build
npm run test:e2e -- e2e/scenarios.spec.mjs
```

Missing PostgreSQL/MySQL settings mean skipped tests, not server verification. Unit/MVC passes
are not browser evidence. Check exact-candidate reports. Capture designer/form/pending/approved/
rejected images only from authenticated real UI and a disposable real backend, in both languages;
no mock success, altered DOM, image generation or retouching. Preserve per-image commit/run/hash provenance.

<a id="gallery"></a>
## Gallery / 全流程实拍

以下16张原始截图来自隔离演示账号和真实浏览器/后端，包含中英文的场景入口、表单、设计器、
待审、通过、驳回及390px审批视口。图片未经修改，页面里只有合成数据。

Capture source: `90007fc8d0499b45ca38a04d010029888ab5cbef`. [Passing browser run](https://github.com/JamesCube/ArcFlow/actions/runs/37803754153) · [Per-image provenance and SHA-256](images/expense/provenance.json).

Each language pair shows the same saved state. Approved and rejected requests are separate
branches. Workflow v3/v4, form v1 and storage schema 7 are independent versions. The narrow
images show the scrolled review controls in a 390px browser viewport; they are not native-app or
physical-phone certification. Approval does not issue payment.

### 场景入口 / Scenario catalog

中文

![场景入口 / Scenario catalog — 中文](images/expense/01-catalog-zh-desktop.png)

English

![场景入口 / Scenario catalog — English](images/expense/01-catalog-en-desktop.png)

### 填写费用 / Itemized expense form

中文

![填写费用 / Itemized expense form — 中文](images/expense/02-filled-expense-zh-desktop.png)

English

![填写费用 / Itemized expense form — English](images/expense/02-filled-expense-en-desktop.png)

### 流程设计器 / Workflow designer

中文

![流程设计器 / Workflow designer — 中文](images/expense/03-designer-zh-desktop.png)

English

![流程设计器 / Workflow designer — English](images/expense/03-designer-en-desktop.png)

### 申请已提交 / Submitted, awaiting review

中文

![申请已提交 / Submitted, awaiting review — 中文](images/expense/04-request-detail-pending-zh-desktop.png)

English

![申请已提交 / Submitted, awaiting review — English](images/expense/04-request-detail-pending-en-desktop.png)

### 当前审批 / Current reviewer

中文

![当前审批 / Current reviewer — 中文](images/expense/05-review-pending-zh-desktop.png)

English

![当前审批 / Current reviewer — English](images/expense/05-review-pending-en-desktop.png)

### 390px 窄屏审批 / Narrow-screen review

中文

![390px 窄屏审批 / Narrow-screen review — 中文](images/expense/06-review-pending-zh-390.png)

English

![390px 窄屏审批 / Narrow-screen review — English](images/expense/06-review-pending-en-390.png)

### 审批通过 / Approved request

中文

![审批通过 / Approved request — 中文](images/expense/07-request-detail-approved-zh-desktop.png)

English

![审批通过 / Approved request — English](images/expense/07-request-detail-approved-en-desktop.png)

### 审批驳回 / Rejected request

中文

![审批驳回 / Rejected request — 中文](images/expense/08-request-detail-rejected-zh-desktop.png)

English

![审批驳回 / Rejected request — English](images/expense/08-request-detail-rejected-en-desktop.png)


