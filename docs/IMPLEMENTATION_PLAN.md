# RiskVerifier Implementation Plan

## 1. Delivery principles

- Build a standalone TypeScript/Node.js modular monolith.
- Keep domain and decision logic independent of HTTP, database, local processes, Docker, and DeployFlow.
- Make deterministic behavior and evidence traceability testable at every phase.
- Introduce execution only after plan semantics and trust boundaries exist.
- Treat repository content as untrusted data and RiskVerifier configuration as the only command-authority source.
- Do not automatically install dependencies in early phases.
- Keep unsupported capabilities explicit and fail closed.
- Complete and validate each phase before expanding scope; avoid speculative adapters for unsupported ecosystems.

## 2. Cross-phase quality gates

Every implementation phase should include:

- unit/contract tests for new invariants and failure states;
- stable rule/component versioning where decisions are introduced;
- structured evidence for new decisions;
- security-negative tests for new input/execution surfaces;
- bounded input/output behavior;
- documentation updates; and
- no path by which unknown, error, timeout, missing tooling, or unsupported behavior becomes success.

No phase should require modifying DeployFlow before Phase 14.

## 3. Phases

### Phase 0 — Architecture and specification

**Objective:** Establish product semantics, boundaries, security assumptions, verification rules, evaluation design, and delivery sequence before code.

**Deliverables:**

- `docs/PRODUCT_SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/VERIFICATION_MODEL.md`
- `docs/EVALUATION_PLAN.md`
- `docs/IMPLEMENTATION_PLAN.md`

**Exit criteria:** Required concepts and modules are defined; risk/verdict distinction and fail-closed rules are unambiguous; threat-model exclusions are explicit; deferred decisions are recorded. No application code is implemented.

### Phase 1 — Project foundation and domain model

**Objective:** Create the TypeScript project and encode domain vocabulary/invariants without infrastructure coupling.

**Deliverables:**

- Node.js/TypeScript project structure for the documented modules;
- lint/format/type-check/test configuration selected and pinned;
- immutable domain types/value objects for all core objects and enums;
- error/result conventions and stable identifiers;
- serialization contract tests for canonical domain records; and
- architecture/dependency-boundary tests.

**Key decisions/tests:** Runtime and TypeScript versions; package format; schema-validation approach at boundaries; timestamp/ID strategy. Test impossible states, category multiplicity, distinct risk/verdict types, evidence references, and version identities.

**Exit criteria:** Domain tests pass without Git, process, database, HTTP, Docker, or DeployFlow dependencies.

### Phase 2 — Git change analyzer

**Objective:** Safely convert repository plus base/target commit SHAs into a bounded `ChangeSet`.

**Deliverables:**

- safe Git process adapter using executable/argument arrays;
- commit resolution/validation and immutable SHA recording;
- changed-file parser covering add/modify/delete/rename/type/binary cases;
- bounded diff metadata/content extraction;
- analyzer evidence and explicit unsupported/truncation states; and
- adversarial Git/path fixture tests.

**Security focus:** End-of-options handling, ambiguous revisions, external diff/text conversion, repository config, replace objects, submodules/LFS, path traversal, symlinks, case collisions, time/output/repository-size limits.

**Exit criteria:** Deterministic `ChangeSet` output for fixtures; malformed/adversarial/oversized input fails explicitly; no repository hook/script execution.

### Phase 3 — Deterministic change classifier

**Objective:** Assign multiple supported categories using reviewed deterministic rules and evidence.

**Deliverables:**

- versioned rule representation and evaluator;
- initial path/manifest/diff/syntax rules for all categories;
- deterministic TypeScript semantic evidence for imports/exports, route declarations, middleware references, and relevant schema/migration constructs where needed;
- structured `ClassificationEvidence` with rule and source references;
- conservative handling of binary/truncated/unparseable content; and
- a labeled calibration fixture suite.

**Exit criteria:** Multi-label output is order-independent and reproducible; every category has evidence; `GENERAL` does not erase uncertainty; preliminary precision/recall is measured on calibration cases.

### Phase 4 — Deterministic risk engine

**Objective:** Produce evidence-backed `LOW`/`MEDIUM`/`HIGH`/`CRITICAL` assessments independently of verdict.

**Deliverables:**

- versioned risk rules, minimum levels, combination/escalation rules, and conservative defaults;
- deterministic aggregation and tie/precedence behavior;
- `RiskAssessment`/`RiskEvidence`; and
- decision-table and boundary tests.

**Exit criteria:** Identical inputs/versions yield identical assessment; all escalations are traceable; tests explicitly prove critical risk does not imply block and low risk does not imply approve.

### Phase 5 — Verification policy engine

**Objective:** Map change/classification/risk to explicit strategy dispositions.

**Deliverables:**

- immutable, validated `VerificationPolicy` representation and `PolicyVersion`;
- policy evaluator for `MANDATORY`, `OPTIONAL`, `UNSUPPORTED`, and `UNNECESSARY` dispositions;
- absence/unsupported and optional-failure treatment; and
- complete decision-table/coverage tests across category/risk combinations.

**Exit criteria:** Every considered strategy has a rationale; semantic requirements remain visible even when implementation support is missing; policy evaluation has no execution dependency.

### Phase 6 — `VerificationPlan` generation

**Objective:** Freeze an explainable plan and bind policy requirements only to trusted configured checks.

**Deliverables:**

- trusted configuration schema, canonicalization, validation, and hash/version identity;
- check-definition registry for the supported MVP subset;
- planner, coverage mapping, ordering/prerequisite model, and unresolved-requirement representation;
- immutable plan digest and planning evidence; and
- tests proving repository content cannot add/alter executable definitions.

**Exit criteria:** Every mandatory requirement maps to explicit checks or remains explicitly unresolved; every unsupported applicable strategy remains visible and non-approvable; plan/configuration/policy identities are stable; planning has no side effects or command execution.

### Phase 7 — Controlled check execution

**Objective:** Execute approved checks through a narrow port with local defense-in-depth controls suitable for trusted development fixtures.

**Deliverables:**

- `Executor` port and initial controlled process adapter;
- structured executable/argument invocation without a shell;
- explicit prohibition of `child_process.exec`, `execSync`, `{ shell: true }`, and equivalent shell-launch or untrusted command-chaining mechanisms;
- executable/argument allow-list validation;
- isolated per-attempt workspace, minimal environment, working-directory containment;
- timeout, cancellation, process-tree, concurrency, and output limits;
- attempt/result states and trusted result-parser contracts; and
- initial implementations for a deliberately small strategy subset.

**Constraint:** Do not automatically run `npm install` or `npm ci`; do not treat package scripts as trusted merely because they exist. Allow-listing `npm test` or `npm run <name>` is not enough because it delegates to a repository-controlled script body.

**Exit criteria:** Adversarial command/path/output/resource tests pass; failure/error/timeout/cancellation/missing-tool states remain distinct and never pass; limitations of local execution are prominently documented.

### Phase 8 — Evidence and verdict engine

**Objective:** Create an auditable evidence chain and deterministic final verdict.

**Deliverables:**

- typed evidence normalization, bounded payload/reference handling, digests, sensitivity/truncation metadata;
- plan/result integrity and coverage validation;
- deterministic verdict evaluator with `BLOCK` > `INCONCLUSIVE` > `APPROVE` precedence as specified;
- stable `VerdictReason` codes and human-readable projection; and
- exhaustive truth-table/property tests for result combinations.

**Exit criteria:** Approval requires affirmative complete mandatory evidence; valid mandatory failures block; incomplete evidence is inconclusive unless frozen policy explicitly defines a block; every verdict reason resolves to evidence.

### Phase 9 — Isolation/container executor

**Objective:** Replace or supplement local process execution with a hardened, reproducible execution backend.

**Deliverables:**

- container executor implementing the unchanged `Executor` port;
- pinned image digests and toolchain provenance;
- non-root/no-capability/read-only-root/no-new-privileges controls where supported;
- resource, process, filesystem, output, and default-deny network policy;
- source/output mount rules and cleanup/reaper behavior; and
- isolation conformance tests.

**Exit criteria:** Existing executor contract tests pass; controller secrets/control sockets are unavailable; network/resource/path controls are demonstrated. Security documentation still states containers are not protection against sophisticated escape attacks.

### Phase 10 — Persistence and job lifecycle

**Objective:** Make long-running verification durable, retry-aware, cancellable, and idempotent.

**Deliverables:**

- selected persistence schema/adapters for runs, stage outputs, checks, attempts, reasons, and evidence references;
- atomic monotonic lifecycle transitions;
- queue worker/lease/heartbeat and retry boundaries;
- cancellation and stale-job recovery;
- canonical idempotency identity from repository/base/target/policy/configuration;
- explicit behavior for duplicate active/completed requests, identity conflicts, changed policy/configuration, and retries after failed/cancelled runs; and
- retention/redaction/audit behavior.

**Exit criteria:** Crash/restart/concurrency tests prevent duplicate logical execution and lost terminal states; every run records frozen versions; failed/cancelled work cannot be observed as approved.

### Phase 11 — REST API

**Objective:** Expose versioned asynchronous service contracts without leaking internal models.

**Deliverables:**

- request submission with idempotency;
- run status/result and authorized/redacted evidence retrieval;
- cancellation endpoint;
- explicit API DTO/schema/version/error semantics;
- authentication/authorization integration point, quotas, input limits, and operational endpoints; and
- OpenAPI/contract tests and threat review.

**Exit criteria:** Submission returns promptly; retries are deterministic; long-running work is asynchronous; DTO compatibility is tested; domain logic has no HTTP dependency.

### Phase 12 — Evaluation fixture repositories

**Objective:** Build the controlled corpus defined in `EVALUATION_PLAN.md`.

**Deliverables:**

- a planning target of approximately four fixture applications for the pilot, adjustable to capstone scope while preserving meaningful diversity;
- pinned setup/tool/dependency environments;
- deterministic safe/faulty patches and immutable base/target commit manifest;
- hidden/oracle tests and ground-truth labeling rubric;
- independent labels/adjudication; and
- calibration versus held-out split.

**Exit criteria:** The documented pilot target is pursued but may be adjusted for capstone scope. The final corpus size and composition are justified; category/risk/fault diversity, held-out separation, and oracle/label quality are assessed explicitly; every faulty case has an oracle; no real credentials or external production dependency is used. Reaching a particular count is not treated as proof of statistical significance.

### Phase 13 — Experimental evaluation

**Objective:** Compare frozen conventional baseline and RiskVerifier configurations on paired cases.

**Deliverables:**

- repeatable experiment runner and machine-readable result export;
- classification/risk/plan/detection/error/inconclusive/efficiency metrics;
- paired statistical analysis with counts and confidence intervals;
- evidence-completeness and reproducibility audit;
- categorized error analysis; and
- final report with raw limitations and additional detections beyond baseline.

**Exit criteria:** The full protocol runs reproducibly; no result is silently excluded; `INCONCLUSIVE` remains separate; conclusions are bounded to the corpus. Findings may require revisiting earlier phases before integration.

### Phase 14 — DeployFlow integration

**Objective:** Integrate through the stable external boundary after RiskVerifier is independently validated.

**Deliverables:**

- agreed versioned contract and authentication/service identity;
- idempotent submission of immutable commit pairs;
- polling and/or authenticated callback/event handling;
- explicit mapping of `APPROVE`, `BLOCK`, `INCONCLUSIVE`, and job failure to DeployFlow behavior;
- trusted binding from the candidate deployment artifact digest/provenance to the exact RiskVerifier-approved repository and target commit;
- retry, timeout, outage, and evidence-link behavior; and
- end-to-end tests and operational runbooks.

**Exit criteria:** No shared database/internal imports; DeployFlow never treats unreachable/failed/inconclusive verification as approval; an artifact/commit provenance mismatch cannot reuse an approval; compatibility/rollback is tested.

### Phase 15 — Optional AI-assisted enhancements

**Objective:** Explore bounded AI assistance only after deterministic behavior is measured and retained as the authority boundary.

**Possible uses:** Suggest classifications or checks, summarize evidence, prioritize reviewer attention, or propose new deterministic rules.

**Required safeguards:**

- AI output is untrusted and cannot authorize commands, weaken policy, or directly approve;
- deterministic/evidence-based fallback remains available;
- model/prompt/input/output versions and provenance are recorded;
- sensitive data controls and prompt-injection defenses are threat-modeled;
- accuracy is evaluated against held-out data and the deterministic baseline; and
- human or policy approval is required before promoted rule/configuration changes.

**Exit criteria:** Only adopt an enhancement with measured benefit, acceptable privacy/security risk, explainable failure behavior, and no regression of fail-closed guarantees.

## 4. Proposed dependency order

Phases are intentionally mostly sequential because later semantics depend on earlier invariants:

```text
domain
  -> Git facts
  -> classification
  -> risk
  -> policy
  -> plan
  -> controlled execution
  -> evidence/verdict
  -> container backend
  -> durable jobs
  -> API
  -> evaluation corpus/experiment
  -> DeployFlow
  -> optional AI
```

Some work can overlap without violating the dependency direction: evaluation fixture design can begin after Phase 0; container threat-model prototypes can run alongside Phases 6–8; API schema sketches can be reviewed before implementation. Production claims should still wait for the required upstream gates.

## 5. Key decision checkpoints

- **After Phase 2:** Are Git/path controls sufficient on intended host platforms, or should execution standardize on Linux earlier?
- **After Phase 3/4:** Do deterministic rules achieve useful calibration accuracy without overfitting?
- **After Phase 6:** Which strategies have trusted implementations, and what policy outcome is acceptable for unsupported mandatory strategies?
- **Before Phase 7:** How are dependencies provisioned without automatic untrusted installation?
- **Before Phase 9:** Is container isolation sufficient for the actual repository trust level, or are disposable VMs/dedicated hosts required?
- **Before Phase 10:** What durability, tenancy, retention, and throughput requirements determine storage/queue choices?
- **After Phase 13:** Is measured detection benefit worth false positives, inconclusive rate, and execution cost?
- **Before Phase 14:** What exact DeployFlow failure, retry, authentication, and latency semantics are required?

## 6. Major unresolved implementation risks

- Useful targeted verification may require repository-specific harnesses without trusting repository instructions.
- Real npm builds frequently require dependency installation and lifecycle behavior excluded from early phases.
- Static path/content rules may miss indirect authentication/authorization behavior or over-classify naming conventions.
- Strong process/network/filesystem isolation varies by host and container runtime.
- Tool output parsers and evidence redaction are additional untrusted-input surfaces.
- Large/monorepo diffs may exceed bounds or require scope-aware planning.
- Flaky tests complicate failure versus inconclusive semantics and retry policy.
- Policy/configuration governance, signing, and rollout/rollback need an operational owner.
- Evaluation fixtures can overstate real-world generalization.

## 7. Phase 0 completion status

Phase 0 is complete when the six specification documents are reviewed and accepted. Phase 1 is intentionally not implemented as part of this deliverable.
