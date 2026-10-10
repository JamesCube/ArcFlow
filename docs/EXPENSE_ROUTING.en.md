# Route expense review by total amount

[简体中文](EXPENSE_ROUTING.md) · [Documentation](README.en.md)

<!-- topic:scope-and-prerequisites -->
## Scope and prerequisites

This operational case covers the current standalone OA Expense scenario (`oa-expense`) on `/scenarios.html`. It extends the existing fixed-reviewer flow with `expense.totalAmount`: Bob always reviews, while Carol reviews finance only when the exact expense total reaches the configured threshold. The default process remains unconditional until a publisher changes it. The field does not add a business type, endpoint, form field or general expression engine.

Use synthetic data and the disposable accounts from [local startup](GETTING_STARTED.en.md), or run `python3 scripts/tryout.py` at the repository root and open its printed `/scenarios.html` URL. Alice may publish and submit; Bob and Carol are fixed people, not dynamically resolved roles. Keep credentials out of commands, captures and source. If retaining data, complete [rollout and recovery](#rollout-and-recovery) before publication.

This is internal human review only: no reimbursement payment, invoice verification/upload, accounting writeback, organization/role resolution or tenancy. Native RuoYi, H5, the shared leave/procurement workspace and quote host do not acquire expense routing. A narrow standalone browser viewport is not H5 integration.

<!-- topic:configure-the-finance-threshold -->
## Configure the finance threshold

1. Sign in as Alice, select Expense, and open its process designer. Keep a mandatory SINGLE stage assigned to Bob.
2. Add or select the finance SINGLE stage assigned to Carol. Set its condition to `expense.totalAmount`, operator `GTE`, currency `CNY`, threshold `10000`. Keep the rule's matching mode `ALL` for this one predicate. Never make every stage conditional.
3. Publish using the current expected process version. Publication conflicts preserve the draft for review; refresh and reapply deliberately. Use the version returned by publication for a new submission.
4. Enter expense lines and inspect the route preview: a total below CNY 10,000 excludes finance; exactly CNY 10,000 or more includes it. The server independently validates and freezes the result.

For an API client, the equivalent publication body for a **fresh version-1** process is below. Read `GET /api/scenarios/oa-expense/process` first; if it is no longer version 1, use that current version for both version fields. Send through the authenticated host with its required Origin/client headers to `POST /api/scenarios/oa-expense/process`; see the [API transport contract](api/API_REFERENCE.en.md). Publishing changes the current definition.

```json
{
  "expectedVersion": 1,
  "definition": {
    "schemaVersion": 4,
    "id": "oa-expense",
    "version": 1,
    "name": "Synthetic expense amount review",
    "nodes": [
      {"id": "start", "type": "start", "name": "Submit", "assigneeId": null},
      {"id": "expense-review", "type": "approval", "name": "Expense review", "assigneeId": "bob"},
      {
        "id": "finance",
        "type": "approval",
        "name": "Finance review",
        "assigneeId": "carol",
        "runIf": {
          "mode": "ALL",
          "predicates": [
            {"field": "expense.totalAmount", "operator": "GTE", "currency": "CNY", "threshold": 10000}
          ]
        }
      },
      {"id": "end", "type": "end", "name": "Complete", "assigneeId": null}
    ]
  }
}
```

The condition may be attached to SINGLE, ALL or ANY approval stages. Condition `ALL`/`ANY` combines predicates; participant `ALL`/`ANY` controls voting. They are independent. Definitions retain 1–8 ordered stages, at least one unconditional human stage, and at most eight flat predicates in total. Start/end conditions, nested rules and cross-business predicates are rejected. Clearing all conditions from a schema-4 definition does not downgrade its schema.

<!-- topic:exact-total-and-currency -->
## Exact total and currency

- The immutable `BusinessDocument.Expense` has 1–20 lines. `expense.totalAmount` is the exact sum of their amounts, never a client-supplied field or the rounded display total. Each line remains positive and at most 1,000,000,000; the maximum total is 20,000,000,000.
- Operators are `EQ`, `GT`, `GTE`, `LT`, `LTE`. Threshold is a JSON number from 0 through 20,000,000,000 inclusive, at most two decimal places; JPY requires whole units. The browser keeps decimal text and exact arithmetic; the domain uses `BigDecimal`. For example, 0.10 + 0.20 equals 0.30 exactly.
- Every monetary predicate names CNY, USD, EUR, GBP or JPY. Its currency must equal the expense currency, including predicates inside `ANY` whose other predicate already passes. There is no FX conversion, implicit currency or silent false result on mismatch. A mismatch rejects submission rather than bypassing finance.
- The existing `{request,total}` response keeps a display string with two decimal places except whole JPY. Frozen predicate evidence uses a canonical string such as `CNY 10000`, stripping decimal trailing zeros and avoiding exponent notation. These distinct formats represent the same exact amount.

See the [expense field contract](EXPENSE_SCENARIO.en.md) for required dates, references, categories and text limits. A valid routing predicate cannot make an invalid expense document valid.

<!-- topic:independent-case-matrix -->
## Independent case matrix

Use a distinct synthetic business reference and submission key for each new intent. The baseline below is the published CNY `GTE 10000` process above. These are acceptance steps and expected outcomes, not a record of passing runs. Keep approval and rejection branches as separate requests.

| Case | Input or action | Expected observable outcome |
| --- | --- | --- |
| Below threshold | CNY 9,999.99 | Selected IDs contain only `expense-review`; finance evidence is false. Bob's approval completes the request without a Carol event. |
| Exact boundary | Two CNY lines, 6,000 and 4,000 | Exact total 10,000; selected IDs are `expense-review`, `finance`. Bob's approval leaves Carol pending. Carol's approval completes it. |
| Above threshold | CNY 10,000.01 | Same two-stage route. No rounding can remove finance. |
| Mandatory rejection | A separate low-value request; Bob rejects | Request is REJECTED; no finance vote is fabricated. |
| Finance rejection | A separate at/above-threshold request; Bob approves, Carol rejects | Request is REJECTED with both real stage events and unchanged business/definition/route. |
| Currency mismatch | USD expense under the CNY condition | Submission is rejected with a currency explanation; no request, key binding, initial audit or member projection is created. Test direct HTTP as well as UI prevention. |
| Exact small decimal | In a separate process publication, use `EQ CNY 0.30`; submit lines 0.10 and 0.20 | Predicate matches exactly. Re-enter a fresh key/version for this distinct intent. |
| Threshold/line limits | Try negative, over-20-billion or three-decimal thresholds; fractional JPY; 0 or 21 lines; nonpositive/over-limit line amounts | Publication or document validation rejects the corresponding invalid input. Valid thresholds 0 and 20 billion remain allowed. |
| All-conditional/cross-type | Add a condition to the only mandatory stage, or use `payment.netTotal` on `oa-expense` | Publication is rejected; current version stays unchanged. |
| Publish new, freeze old | Submit CNY 15,000 at threshold 10,000, then publish threshold 20,000; submit a new CNY 15,000 intent | Old request still includes finance with its full original definition and facts; the new request skips finance. Repeat after restarting the store. |
| Retry after publication | Replay the old key, exact original body and original process version after the new publication or a lost response | Return the same persisted request, its current review state and original route; do not reevaluate against the new threshold. Changing the intent under that key conflicts. |
| Permission boundary | Try Carol on the low route; try Carol voting before Bob on the high route; try Alice/self-assignment | Skipped-only Carol cannot see or vote on the low request. Selected Carol may see the high request but cannot vote until current. Alice cannot approve her request; assigning Alice anywhere in the full definition prevents submission, even on a skipped stage. |

Also exercise SINGLE/ALL/ANY groups, repeated reviewers, forged/stale client responses and route-tamper restoration through the existing [conditional-routing requirements](CONDITIONAL_ROUTING.en.md). A skipped node is visibly excluded, never labeled approved. Historical expense screenshots predate this field and do not establish these cases.

<!-- topic:frozen-state-and-permissions -->
## Frozen state and permissions

Each schema-4 request retains the entire published definition, the immutable expense business snapshot and `routing.schemaVersion:1`. Selected step IDs stay in original order. Evaluations include every conditional stage and every predicate's exact fact/result without short circuiting, including excluded stages. Mandatory stages are always selected, and there is never an approval event for a skipped stage.

Replay, current reviewers, voting permissions, visible requests and stored member projections all use the same effective route. A person present only in skipped stages receives no access from those assignments and does not become pending or handled. Someone appearing in another selected stage still has that stage's existing rights. Handled membership requires a real saved vote. Full-definition self-approval checks still run before submission.

New publication changes only future intents. Retrying an exact saved intent returns its stored route, even after publication, decisions or restart. Restoration recomputes the route from the saved business and full saved definition, comparing all IDs, facts and order. It never substitutes the latest configuration. Missing or altered route data fails closed; this consistency check is not cryptographic proof against rewriting an entire unsigned store.

<a id="rollout-and-recovery"></a>

<!-- topic:rollout-and-recovery -->
## Rollout and recovery

The version numbers remain independent: expense `documentVersion:1`, definition schema 4, frozen routing schema 1, JSON wrapper 13, JDBC SQL revision 3. An unconditional expense document needs at least wrapper 7; publishing any schema-4 expense definition requires wrapper 13 **before any request exists**. The writer never downgrades and reading alone never upgrades.

1. Identify every reader/writer's supported fields, not just its wrapper number. A pre-extension binary that understands wrapper 13 but not `expense.totalAmount` must reject publication-only definitions and saved requests with that field. Do not mix binaries or strip the field to make a rollback appear compatible.
2. Stop/drain incompatible readers and writers. Back up all active files or the database consistently before publication. Record the code revision and configuration. An already-wrapper-13 store has no wrapper upgrade to trigger an automatic upgrade backup for this new field, so the operational backup is essential.
3. Deploy compatible domain, host, UI and JDBC components. Test a backup copy, including retained definitions without requests, old unconditional expenses, pending conditional expenses, decisions, submission-key retries and selected member projections.
4. Preserve every published schema-4 definition in `routingDefinitions`, including old or unused versions, and preserve every request's full original definition and frozen route. JSON wrapper upgrades save the exact immediately preceding bytes before atomic replacement. No lower-wrapper routing or unknown field may be silently accepted.
5. JDBC already stores full definition/request JSON and derived members at SQL revision 3; this field adds no DDL and does not rebuild ready schema-2/3 projections. Existing revision-1/2 migration and bounded-backfill duties remain. Unchanged tables do not authorize mixed binaries.
6. If validation or recovery fails, stop writes and retain the originals, backups and logs. Restore only a reviewed consistent backup with compatible binaries. Restoring pre-publication data can lose later requests, votes and keys; it is not a lossless downgrade. Removing conditions or renumbering the wrapper cannot make saved conditional history safe for old readers.

Read the full [persistence and migration guide](development/PERSISTENCE.en.md) before using retained data.

<!-- topic:verification-and-evidence -->
## Verification and evidence

Follow [development verification](development/QUICKSTART.en.md) for core, domain, standalone HTTP, UI and optional JDBC checks. Run the independent matrix against a freshly packaged backend and the matching frontend; stale embedded domain JARs are not the intended candidate. Test old-reader fail-closed behavior with the actual old binary and verify rejected files remain byte-identical.

Run these commands from the repository root, using JDK 17+, Maven and the supported Node version in [development setup](development/QUICKSTART.en.md). The HTTP script creates a private temporary store and loopback backend, generates in-memory credentials, stops its process and removes temporary data on completion. Optional `--output-dir` retains synthetic JSON receipts for review; manage that directory separately. Browser tests also use disposable data and need free ports 8080/5173; do not run competing suites together.

```sh
mvn install
mvn -f examples/approval-domain/pom.xml install
mvn -f examples/approval-demo/backend/pom.xml package
python3 examples/approval-demo/backend/scripts/verify-expense-routing-http.py \
  --jar examples/approval-demo/backend/target/approval-demo-0.1.0-SNAPSHOT.jar
(cd examples/approval-ui && npm ci && npx playwright install chromium && \
  npm run test:e2e -- e2e/expense-routing.spec.mjs)
```

The [bundled API examples](api/examples/README.en.md) use `GTE CNY 0.30` and totals 0.29/0.30/0.31 for compact exact-decimal boundary checks. They are separate from this guide's CNY 10,000 business case. The HTTP script checks real requests, decisions, currency rejection without writes, original-version retries and restart; the [browser suite](../examples/approval-ui/e2e/expense-routing.spec.mjs) exercises the actual bilingual workspace. Listing a command does not say it passed.

The browser evidence uses a second configuration to exercise group voting: an optional high-value ALL stage with Bob and Carol comes before a mandatory finance stage assigned to Carol. Below the threshold, Bob has no membership or access; Carol completes the only selected stage. At the threshold, both group votes are required before the final finance review. This is distinct from the simpler Bob → conditional Carol tutorial above. Language and viewport variants are views of the same business states, not additional scenario types.

Report unit/HTTP/browser results, H2/PostgreSQL/MySQL, skips and unrun checks separately. Real browser acceptance must cover Chinese/English configuration, low/high preview, saved route details, approval and rejection, publication without altering old requests, permissions and a 390px viewport. Tie any new screenshots to the exact source/backend/run/hash. The [original expense gallery](EXPENSE_SCENARIO.en.md#gallery) and [older three-scenario routing gallery](galleries/conditional-routing/README.en.md) remain historical evidence with their original scope; neither is new expense-routing proof. This case guide itself asserts no new passing run, CI result, capture, publication or deployment.

Sources: [ConditionalRouting](../examples/approval-domain/src/main/java/com/arcflow/approval/ConditionalRouting.java), [BusinessDocument](../examples/approval-domain/src/main/java/com/arcflow/approval/BusinessDocument.java), [ScenarioCase](../examples/approval-domain/src/main/java/com/arcflow/approval/ScenarioCase.java), [frontend routing](../examples/approval-ui/src/routing.js), and [process designer](../examples/approval-ui/src/ProcessDesigner.vue).
