# RiskVerifier Evaluation Plan

## 1. Evaluation objectives

The capstone evaluation will measure whether deterministic risk-adaptive verification selects useful checks, detects defects beyond a conventional baseline, remains explainable, and does so at an acceptable execution cost.

The central comparison is:

```text
Conventional baseline verification
versus
Risk-adaptive verification
```

The evaluation must not be designed only around examples already encoded in rules. Fixtures, expected labels, and defect oracles are versioned and reviewed independently of implementation results where practical.

## 2. Research questions

1. How accurately does RiskVerifier assign all applicable change categories?
2. How accurately does it select the required verification strategies?
3. Does risk-adaptive verification detect faulty changes that pass conventional build/test verification?
4. What false-positive, false-negative, and `INCONCLUSIVE` rates does it produce?
5. What execution-time/check-count overhead or savings result from risk adaptation?
6. Are verdicts reproducible and supported by complete evidence chains?
7. Which change/defect categories remain systematically unsupported or weakly detected?

## 3. Experimental systems

### 3.1 Conventional baseline

The primary baseline runs the same trusted, fixed checks for every change:

- a clean TypeScript build/type check; and
- the fixture application's existing trusted test suite.

The exact commands, toolchain image, dependency snapshot, timeouts, and result interpretation are frozen before the experiment. Baseline and RiskVerifier test commands come from the trusted experiment harness and do not delegate command construction to mutable package scripts. If the application has no usable existing tests, that limitation is part of fixture selection rather than silently replaced.

A secondary baseline may add one fixed static-analysis check if that reflects the conventional CI being compared. Primary and secondary baseline results must be reported separately to prevent moving the baseline after seeing outcomes.

### 3.2 Risk-adaptive system

RiskVerifier analyzes the same base/target pair, applies a frozen classifier, risk rules, policy, and configuration, then executes its selected supported checks. Any applicable verification explicitly classified as unsupported remains in the results and contributes to `INCONCLUSIVE`/`BLOCK` according to the frozen policy.

### 3.3 Fairness controls

- Both systems use identical source commits, dependency snapshot, runtime/tool versions, resource class, and isolation backend.
- Shared checks use the same implementation and limits in both arms.
- Repository acquisition and setup time are reported separately from check execution when possible.
- Runs are randomized/interleaved to reduce host-load bias.
- Warm-cache and cold-cache modes are not mixed; if both are measured, they are separate strata.
- Each executable case is repeated (for example, three times) to identify flaky behavior; all attempts remain reported.

## 4. Fixture applications

Use small-to-medium Node.js/TypeScript/npm Git repositories with observable authentication, authorization, API, persistence, configuration, frontend, and test behavior. A useful initial corpus contains at least:

- one backend API application with authentication and role/ownership authorization;
- one API plus relational-database application with explicit migrations;
- one frontend application consuming an API or local contract;
- one shared library/package with public TypeScript API surface; and
- optionally one compact full-stack application covering multiple categories.

Fixture requirements:

- pinned Node/npm/tool versions and committed lockfile;
- a controlled, prepared dependency snapshot or environment supplied by the experiment harness; fixture execution must not silently introduce automatic `npm install`/`npm ci`;
- deterministic trusted setup outside the repository-under-test instruction channel;
- an adequate conventional test suite that still permits realistic seeded defects to escape;
- additional hidden or oracle tests not run by the primary baseline;
- documented architecture and ground-truth sensitive paths;
- fast enough execution for repeated experiments; and
- no real secrets or external production services.

Fixtures may be purpose-built or suitably licensed open-source snapshots. Exact commit snapshots and any local modifications must be preserved for reproducibility.

## 5. Dataset construction and ground truth

Each case is an immutable tuple of fixture, base commit, target commit, case type, expected categories, expected risk band, expected strategy set, expected defect status, and oracle.

Ground truth should be created before observing RiskVerifier's final result:

- Two reviewers independently label all applicable categories and mandatory strategies using a written rubric.
- Disagreements are adjudicated and recorded.
- Risk labels are reported with reviewer agreement because risk can be policy-dependent.
- Faulty cases require an executable oracle or precise static invariant showing the seeded fault.
- Safe cases require review and relevant oracle tests demonstrating intended behavior.
- Mutation scripts or patch files are deterministic and preserve exact generated commits.

The evaluation set should be held out from rule tuning. A separate development/calibration set can be used to write rules. If the same cases must be reused due to project size, report the leakage limitation and do not present accuracy as unseen generalization.

## 6. Intentional defect categories

Create realistic faults, including faults likely to pass ordinary build and existing tests:

### 6.1 Authentication

- token expiry/signature validation bypass;
- session/cookie security regression;
- incorrect handling of missing credentials;
- authentication middleware removed from a route.

### 6.2 Authorization

- role check inverted or broadened;
- ownership check removed;
- default-allow behavior on unknown role;
- authorization middleware order/binding regression;
- horizontal privilege-escalation case omitted from ordinary tests.

### 6.3 Database

- destructive or incompatible migration;
- nullable/non-null mismatch;
- forward migration works but old/new application compatibility fails;
- transaction or data-integrity constraint removed;
- query/schema drift.

### 6.4 API

- response field/type removed or renamed;
- route or status-code contract changed;
- validation relaxed or made over-restrictive;
- error payload incompatibility;
- API and persistence semantics diverge.

### 6.5 Dependency and configuration

- vulnerable/prohibited dependency version fixture using a frozen advisory dataset;
- lockfile/manifest inconsistency;
- dependency scope change that affects production;
- unsafe configuration default;
- required environment validation removed;
- security header or feature flag regression.

### 6.6 Frontend

- protected action visible/enabled for an unauthorized user;
- critical form validation or submission broken;
- API contract use no longer matches backend;
- state/error behavior fails under a targeted case absent from baseline tests.

### 6.7 Test and general changes

- meaningful assertion weakened or removed;
- test skipped while source behavior changes;
- broad shared utility boundary-condition regression;
- generated/binary/oversized change that should lead to explicit uncertainty.

Not every seeded defect must be detectable by the first implementation. Unsupported cases measure gaps and should increase `INCONCLUSIVE`, not be removed from the dataset after results are known.

## 7. Safe-change cases

Safe cases are needed to measure unnecessary blocking and cost. Include:

- documentation-only change if in repository scope;
- frontend copy/style change with unchanged behavior;
- correctly additive API field;
- backward-compatible endpoint implementation;
- safe database index addition or reviewed compatible migration;
- dependency patch update with consistent lockfile and no frozen-policy violation;
- configuration comment/nonsemantic formatting change;
- authentication/authorization refactor with unchanged behavior and complete targeted tests;
- test-only addition;
- small general-code refactor; and
- multi-category safe changes such as compatible `API + DATABASE` evolution.

Safe cases should include high/critical-risk changes that are correct, proving the model can approve based on strong evidence rather than equating risk with failure.

## 8. Dataset-size target

The planning target for a useful pilot is **approximately 60 cases** across approximately four fixture applications, subject to capstone time and fixture quality. A balanced target composition is:

- 30 faulty changes and 30 safe changes;
- at least 5 cases involving each primary category, allowing multi-label overlap;
- at least 10 multi-category cases;
- at least 8 changes assessed high or critical, including both safe and faulty cases; and
- at least 10 deliberately designed faults that pass the primary conventional baseline.

These counts are workload targets, not a sample-size calculation or guarantee of statistical significance. Diversity, independently controlled labeling, executable oracles, and separation of calibration from held-out cases matter more than reaching an arbitrary number. The final case count may be reduced or expanded based on capstone scope and available time, but the deviation and its effect on interpretation must be reported.

If resources permit, a stronger capstone target is **100–150 cases**, with broader per-category representation and roughly 15–20 faulty cases that pass baseline CI. Results must include raw counts and uncertainty intervals where appropriate; small strata remain exploratory regardless of the total corpus size.

## 9. Metrics

### 9.1 Classification accuracy

Because categories are multi-label, report:

- per-category precision, recall, and F1;
- micro- and macro-averaged precision/recall/F1;
- exact-set match rate; and
- frequency/type of missing and spurious categories.

### 9.2 Risk assessment

- exact-level accuracy against adjudicated labels;
- within-one-level accuracy;
- underestimation and overestimation rates, weighted by distance/severity;
- confusion matrix; and
- reviewer agreement to contextualize label subjectivity.

### 9.3 Verification-plan selection

Treat each case-strategy pair as a decision and report:

- mandatory-strategy precision, recall, and F1;
- exact mandatory-plan match rate;
- under-verification rate (required strategy omitted or marked unnecessary);
- over-verification rate (unnecessary strategy made mandatory);
- correct unsupported-gap preservation rate; and
- optional-strategy selection separately from mandatory accuracy.

### 9.4 Defect and verdict effectiveness

- regression detection rate/recall: faulty cases ending `BLOCK` due to defect evidence;
- false-negative rate: faulty cases ending `APPROVE`;
- false-positive rate: safe cases ending `BLOCK`;
- `INCONCLUSIVE` rate overall and by reason/category;
- safe approval rate;
- non-approval safety rate: faulty cases that are `BLOCK` or `INCONCLUSIVE`;
- number and percentage of faulty changes detected by RiskVerifier that baseline CI passes; and
- number of baseline-detected faults missed or left inconclusive by RiskVerifier.

`INCONCLUSIVE` is not counted as defect detection for the primary regression-detection metric. It is reported separately so a system cannot appear safe merely by refusing to decide.

### 9.5 Efficiency

- wall-clock end-to-end and execution time (median, p90/p95, and distribution);
- CPU time and peak memory where available;
- number of checks selected/executed;
- check-minutes per change;
- time to first blocking evidence;
- overhead/savings relative to each baseline; and
- results stratified by risk/category/outcome and warm/cold mode.

### 9.6 Explainability and reproducibility

- percentage of categories, risk assessments, requirements, checks, and verdict reasons with valid evidence references;
- percentage of runs with recorded policy/configuration/component versions;
- evidence integrity/truncation rate;
- deterministic re-evaluation match rate for classification, risk, plan, and verdict; and
- execution outcome stability across repetitions.

## 10. Comparison method

For every case, run both arms and produce a paired record. Use:

- paired contingency tables for pass/fail/non-conclusive outcomes;
- McNemar's test or exact alternative for paired binary comparisons where sample size permits;
- bootstrap confidence intervals for rate and runtime differences;
- median paired runtime/check-count deltas; and
- category/risk/fixture-stratified analysis.

Publish raw counts alongside percentages. Do not collapse `INCONCLUSIVE` into `BLOCK` or `APPROVE`; for selected safety analyses it may be grouped as non-approval, clearly labeled.

The main capstone claim should be bounded: for the frozen fixture corpus, RiskVerifier detects **N** additional faulty changes that the frozen conventional baseline passes, at the cost of **X** additional execution and **Y** false-positive/**Z** inconclusive outcomes.

## 11. Experiment procedure

1. Freeze evaluation protocol, baseline definitions, toolchain images, policy/configuration, metrics, and analysis script.
2. Split calibration and held-out cases.
3. Validate each base/target commit and ground-truth oracle.
4. Execute both arms in randomized paired order under the same resource class.
5. Repeat executable cases enough times to detect flakiness; preserve every attempt.
6. Run hidden/oracle verification after system results to establish actual fault outcome.
7. Export structured results and independently validate verdict calculations.
8. Analyze primary metrics, then strata and error cases.
9. Publish the frozen dataset manifest, component versions, exclusions, failures, and limitations.

## 12. Acceptance signals

Phase 13 should define numeric targets after the pilot, but minimum qualitative success requires:

- zero known faulty cases incorrectly approved because an error/timeout/unsupported check was treated as pass;
- complete plan accounting for all mandatory strategies;
- additional detection beyond the primary baseline on intentionally baseline-escaping faults;
- a measurable, explained `INCONCLUSIVE` rate rather than hidden failures;
- no systematic under-classification of authentication/authorization changes in the held-out set; and
- reproducible decision stages for identical versions/inputs.

Failure to outperform the baseline is a valid experimental result and should lead to rule/strategy reassessment, not metric redefinition.

## 13. Validity threats and limitations

- Purpose-built fixtures may not represent large production monorepos.
- Seeded faults may be simpler than naturally occurring defects.
- Rule authors may indirectly learn held-out cases.
- Ground-truth risk and required strategies involve policy judgment.
- Existing-test quality strongly affects the baseline.
- Tool-cache and host-load variance can dominate small timing differences.
- `INCONCLUSIVE` policy treatment affects operational usefulness.
- A 60-case pilot has wide confidence intervals, especially per category.
- Reaching the planning target does not by itself establish statistical significance or external validity.
- Evaluation of security isolation against sophisticated malicious code remains outside this experiment and threat model.

## 14. Evaluation artifacts

Phase 12/13 should produce:

- fixture repositories/snapshots and exact commit manifest;
- safe/faulty patch manifest with ground-truth labels;
- reviewer rubric and adjudication records;
- frozen baseline and RiskVerifier configuration identities;
- machine-readable run/evidence exports with redaction;
- result-analysis scripts and generated tables/figures;
- excluded/failed-case log; and
- a final report stating both improvements and unsupported gaps.
