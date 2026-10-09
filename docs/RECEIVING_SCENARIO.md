# 收货验收 / Goods receipt review

> Draft review candidate based on main `71910bfc2ac1b9d58e0f7f1b85e6bbb206321ec1`. Not merged or released. JSON schema 10 is reserved for this isolated candidate, not a compatibility promise.

## 中文

独立 ERP 收货验收场景 `erp-receiving`，入口 `/receiving.html`，使用演示后端相同的账号与本次启动密码。请仅使用合成数据。它是手工录入的订单和验收快照，不连接真实采购订单，也不计算其他申请已收数量。

示例：Alice 填写 `GR-DEMO-001`、订单 `PO-DEMO-001`、东区演示仓和收货日期。第一行合成传感器，单位“件”，订购 20、本次到货 10、合格 8、不合格 2，异常原因为“外壳损坏”；第二行合成线缆，单位“箱”，订购 10、到货 5、合格 5、不合格 0。

默认审批：仓库与质量 ALL 会签（Bob + Carol）→ 采购复核（Bob）。Bob 第一次同意后仍等待 Carol；Carol 也同意才进入采购复核，Bob 必须在新节点另投一票。任一 ALL 成员拒绝即结束。这里 Bob 兼任仓库和采购，是固定账号演示，不保证职责分离，也没有动态部门/角色解析。

Alice 可用现有流程设计器调整顺序、人员、SINGLE/ALL/ANY，然后发布新版本。旧申请保存提交时的业务和流程快照，不受新版本影响。流程变化只影响后续申请，没有字段条件分支。

### 数量与边界

- 单据固定版本 1；头字段：单号、标题、说明、合成订单引用、仓库 EAST/WEST、有效 YYYY-MM-DD 收货日期。
- 1–20 行；稳定 lineId 与订单行引用均须在本单内唯一。每行包含物料说明、单位 PCS/BOX、订购/到货/合格/不合格数量、异常原因。
- 数量仅接受 JSON 整数，不接受小数、指数、字符串、布尔、null 或隐式浮点转整数。每项 0–100000，订购数量必须大于 0。
- 本次到货不超过该行手工录入的订购数；合格 + 不合格 = 本次到货。允许零到货行，但整单至少一行实际到货。
- 不合格数大于 0 时异常原因必填，最多 1000 UTF-16 代码单元；其他行可留空。
- 摘要分“件”和“箱”分别列到货、合格、不合格数量，显示物料行数与异常行数。不把不同单位加为一个总数，没有货币金额。
- 单次申请人 + 幂等键 + 同内容 + 原流程版本可重试；同键改任何数量、引用、单位、说明或行顺序返回冲突。不同键可创建相同 PO 的新申请；不提供跨单去重、累计扣减、余额锁定或防止重复入库的承诺。
- 通过只表示这份验收申请的人工审批通过；不会入库、付款、执行退货、更新供应商/订单或对外写回，也不证明现实质检已完成。

## English

`erp-receiving` is a separate goods-receipt review scenario at `/receiving.html`. Sign in with the demo backend accounts and passwords for this run. Use synthetic data only. Purchase-order and inspection fields are manually entered snapshots, without real PO lookup or cross-request cumulative balances.

Sample: Alice submits `GR-DEMO-001`, purchase order `PO-DEMO-001`, East demo warehouse and a delivery date. Line 1: demo sensors, PCS, ordered 20, received 10, accepted 8, rejected 2, reason “Damaged casing”. Line 2: demo cables, BOX, ordered 10, received 5, accepted 5, rejected 0.

Default route: warehouse and quality ALL review (Bob + Carol), then procurement review (Bob). Bob’s first vote waits for Carol; after both approve, Bob casts a separate procurement vote. One ALL rejection ends the request. Bob holds two responsibilities in this demo: these are fixed accounts, without separation-of-duties guarantees or dynamic role/department resolution.

Alice can change ordered stages, named participants and SINGLE/ALL/ANY in the existing designer, then publish a new version. Submitted business data and routing remain immutable snapshots. There is no field-based conditional routing.

### Contract

Version 1 has a business reference, title, context, synthetic PO reference, EAST/WEST warehouse, valid YYYY-MM-DD delivery date, and 1–20 lines. Each line has stable lineId, unique-within-document PO line reference, material description, PCS/BOX unit, ordered/received/accepted/rejected integer counts and an exception reason.

Counts are integer JSON tokens in 0–100000; ordered must be positive. Fractional or exponent tokens, strings, booleans and null are rejected rather than coerced. Received cannot exceed the manually entered ordered count; accepted + rejected must equal received. Zero-delivery lines are allowed if another line has a positive delivery. Rejected quantities require a meaningful reason of at most 1000 UTF-16 code units.

The response is `{request,total:null,summary:{kind:"receiving",lineCount,exceptionLineCount,quantities:[{unit,received,accepted,rejected}]}}`. Unit groups are PCS then BOX, only when present. Existing expense responses remain `{request,total}`. Units are never added into a misleading global quantity or currency amount.

An applicant-scoped idempotency key replays the persisted result for the same canonical document, line order and original process version, including after restart or final approval. A changed intent with that key conflicts. A different key may submit the same PO again: there is no cross-document deduplication, inventory reservation or cumulative receiving ledger.

Approval only finishes this request’s review. It does not post stock, pay, return goods, update suppliers/orders, write to another system or certify real-world inspection.

## Persistence and compatibility gate

- Main’s schemas 1–7 remain readable. Receiving writes reserved local schema 10 and keeps byte-exact original snapshots before an upgrade.
- Schema 8 and 9 are explicitly rejected, even for otherwise recognizable data. This candidate does not include the unmerged travel or seal-use contracts and must not be presented as their migration superset.
- Unsupported types, downgraded receiving snapshots and tampered quantity relationships fail closed on restore. Raw negative-zero tokens are rejected before polymorphic/type-last or request/tree buffering can normalize them.
- Isolated hosts reject wrong-business-type records at startup and before mutation. Each typed decision rechecks its target on every CAS attempt, so a stale preflight cannot append a vote to another document type.
- JDBC uses the existing versioned request payload with strict decoding; no new SQL migration is required for this local candidate. Tested H2 does not imply tested MySQL/PostgreSQL.
- Before merging or releasing: reconcile schema allocation and optional summary shape with the other candidates; rerun all final checks against the intended integrated source. The draft CI checks out its exact head, tests the declared Boot 4.1.1 host, requires named receiving cases without skips on PostgreSQL 17 and MySQL 8.0/8.4, and captures 15 authenticated bilingual Chromium states with commit/hash provenance. Pixel review remains a separate gate.

## Verification

Run domain tests, JDBC tests and the declared backend tests separately:

```sh
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-jdbc/pom.xml verify
mvn -f examples/approval-demo/backend/pom.xml verify
cd examples/approval-ui && npm test && npm run build
```

Focused coverage includes strict numeric lexemes, boundary quantities and text, zero-delivery rows, per-unit summaries, duplicate references, all-zero/empty/overlong documents, ALL partial voting and rejection, ANY custom publication, same-person cross-stage voting, access isolation, idempotency conflicts, concurrent retries, file/JDBC reopen, migration backups and failed atomic publication.
