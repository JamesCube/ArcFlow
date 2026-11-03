# Independent graph reference model

[简体中文](GRAPH_REFERENCE_MODEL.md)

<!-- topic:purpose -->
## Why this change

At baseline `ec6e1b0134185060d35ac3ea6643f6d4ed3320a6`, `GraphEngine.validateInstance` rebuilds state using the same production `start` and `decide` methods that created it. That is valuable replay-integrity checking, but an implementation and its replay can agree on the same semantic mistake. Existing randomized tests also use this validator. This change adds an independent, bounded semantic oracle; it does not add scenarios or change production behavior.

<!-- topic:expert-practice -->
## What an expert adds

- State safety properties before counting tests: voting thresholds, terminal cancellation, barrier release, unique activation, and preservation of actual votes.
- Distinguish implementation consistency from correctness against an independently written specification.
- Explore every bounded schedule and rejection path, rather than only random all-approval paths.
- Deliberately inject incorrect semantics to prove the checker is sensitive to the defects it claims to detect.
- Report the model's boundary and residual risks. Neither a screenshot nor a green CI run proves all production behavior.

<!-- topic:original-sources -->
## Original materials

This work inspected exact-commit production source and test code, not a feature summary:

- `examples/approval-domain/src/main/java/com/arcflow/approval/graph/GraphEngine.java`: transition and replay logic.
- `examples/approval-domain/src/test/java/com/arcflow/approval/graph/GraphEngineTest.java`: existing examples and randomized approval schedules.
- `examples/approval-jdbc/src/test/java/com/arcflow/approval/jdbc/GraphStoreContract.java`: existing restart, concurrent decision, lost-acknowledgement and direct SQL projection checks. These already exist; this change does not claim to introduce them.
- `examples/approval-domain/src/main/java/com/arcflow/approval/graph/JsonGraphApprovalStore.java`: atomic snapshot and compare-and-set boundaries.

For production acceptance, the next original materials would be authorized, minimized command/request traces, database transaction outcomes, actual approval policies and role definitions, failure logs, and raw browser/network evidence. No production records, real-user usability study, or external audit were available for this change. Synthetic cases cannot establish those facts.

<!-- topic:method -->
## Concrete method

`GraphReferenceModelTest` uses JUnit 5, Java 17 and a depth-first traversal. It builds one explicit fork → two voting groups → join → final approval graph. Each group has two people, and ALL/ANY gives four configurations. The oracle uses only integer votes and approval thresholds: approval is enough yes votes; rejection means remaining possible yes votes cannot reach the threshold. Its expected-state calculations never call `GraphEngine`, `validateInstance`, or another production reducer. Production calls are solely the system under test.

The traversal derives its choices from the reference model, not the actual engine's list of active tasks. It checks every prefix's request status, task existence/status, exact vote map, revision, command count, branch arrivals, unique join event and final completion event. It also attempts forbidden first votes before task activation and after termination.

This fixed model explores **916 prefixes, 912 legal decisions, 560 terminal paths and 1,816 forbidden decisions**. Those counts are assertions, so accidentally dropping coverage fails the test. Histories are finite; replay aliases, arbitrary topology and an unbounded scheduler are outside this enumeration.

`verify_graph_reference_mutations.py` runs a positive baseline and five isolated altered source copies. It requires exactly one executed test and zero skips for every run, a clean positive baseline, and exactly one JUnit assertion failure with zero test errors for each killed mutant. Missing reports, compilation failures, exceptions and timeouts are not successful detections. It never changes the checkout's production source.

Five targeted mutations: ALL approves too early; ANY rejects too early; join fires on first arrival; duplicate join event; terminal rejection leaves a sibling active. This is a focused sensitivity check, **not** a general mutation-coverage score.

<!-- topic:reproduce -->
## Reproduce

From a complete repository checkout with JDK 17 and Maven:

```sh
mvn install
mvn -f examples/approval-domain/pom.xml verify
python3 scripts/verify_graph_reference_mutations.py --maven mvn --output /tmp/graph-reference-mutations.json
```

For offline environments with already available dependencies:

```sh
python3 scripts/verify_graph_reference_mutations.py --maven /path/to/mvn -- -o -Dmaven.repo.local=/path/to/cache
```

The mutation runner compiles fresh temporary module copies. The root core artifact must first be installed into the same Maven repository. A timeout, missing dependency or compilation failure is a blocker, not a passing test or a killed mutant.

<!-- topic:evidence-and-limits -->
## What can corroborate the result

- Anyone can rerun the exact source and inspect Surefire XML, rather than trust a prose test count.
- A separate mathematical oracle compares against the production interpreter.
- Deliberately broken implementations must fail, proving that green results are not unconditional.
- Exact Git source identities and the new commit bind evidence to code. A later remote CI run should refer to the exact published commit, not an older successful run.
- An independent reviewer can inspect the threshold specification and its relation to actual business rules. No such review has yet been claimed.

Limits: this test covers one bounded topology, group sizes of two, a final singleton, single-process reducer semantics, and synthetic payment data. It does not prove all graph definitions, all routing conditions, SQL isolation, authorization revocation, frontend rendering, crash recovery or production throughput. Existing tests for those areas remain necessary. No production behavior was found incorrect by this model; the verified improvement is stronger independent evidence, not a claimed runtime bug fix.

<!-- topic:provenance -->
## Local audit provenance

The local audit checkout is an extracted 68-file subset containing the root core and complete approval-domain module, obtained from the exact remote baseline above. Each original file was checked against its remote Git blob SHA. Its local baseline commit is a new extraction commit, not the remote commit and not a full repository tree. The added change commit applies only the test/tool files and registered documentation pair; it must not be pushed as a replacement repository history. For publication, apply that change onto a full checkout of the intended base and rerun exact-head CI. Local module verification does not stand in for full-host or remote CI verification.