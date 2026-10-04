# RiskVerifier Verification Model

## 1. Purpose and principles

The verification model defines how a software change becomes an evidence-backed verdict. It is deterministic in the MVP and separates six questions:

1. What changed?
2. Which kinds of change are present?
3. What could the change affect, and how severe could that be?
4. Which verification strategies does policy require?
5. What did each planned check establish?
6. Is the collected evidence sufficient to approve, block, or remain inconclusive?

The stages are deliberately separate:

```text
ChangeSet
  -> Classification
  -> RiskAssessment
  -> VerificationPolicy
  -> VerificationPlan
  -> Execution and Evidence
  -> VerificationVerdict
```

No stage may erase an uncertainty or silently turn it into success. Every material output cites evidence and the rule or producer that created it.

## 2. Change model

### 2.1 `ChangeSet`

A `ChangeSet` is the canonical, bounded description of the difference between an immutable base commit and target commit. It includes:

- repository identity and exact commit SHAs;
- analyzer/version identity;
- an ordered collection of `ChangedFile` values;
- aggregate additions, deletions, and file counts where available;
- unsupported/omitted content and truncation indicators; and
- evidence showing how the change was obtained.

The base-to-target direction matters. Reversing the commits creates a different change set.

### 2.2 `ChangedFile`

A changed file records:

- change kind: added, modified, deleted, renamed, copied, type-changed, or unmerged/unsupported;
- normalized old and new repository-relative paths as applicable;
- old/new object identities and modes where available;
- bounded diff/hunk metadata and optional content evidence references;
- detected file/ecosystem facts; and
- flags for binary, generated, oversized, unavailable, or otherwise unsupported content.

For Phase 2 line statistics, textual changes carry nonnegative `additions` and `deletions`.
Binary changes carry an explicit binary flag and use `null` for both counts; unknown line counts are
not fabricated as zero. `ChangeSet` aggregate counts sum known textual counts and separately record
that unknown counts are present.

Rename/copy detection is an analyzer decision and must be versioned. A missing textual diff does not imply no risk; binary or oversized changes remain explicit inputs to classification/risk defaults.

Phase 2 analyzer 2.1.0 sorts changed files by ascending UTF-8 bytes of the destination/current path;
ordering has no priority or risk meaning. Decoding is strict UTF-8 and preserves a leading U+FEFF;
invalid byte sequences fail explicitly. Paths remain opaque Git paths, not authorized host paths.
Windows-invalid names or case collisions are not materialized by this analyzer; future filesystem
consumers must validate platform containment and collision rules before accessing paths.

Normal repositories, bare repositories and linked worktrees are supported. Mode-only changes are
`MODIFIED` with Git's zero line counts. Type changes use Git's reported statistics. Gitlink pointer
changes are recorded without recursion or checkout; Git's synthetic pointer-line statistics (such
as 1/1 for a changed pointer) do not describe changes inside the submodule.

Rename/copy similarity is 50% with at most 1,000 candidates for exhaustive detection. Git can report
add/delete instead of a rename when similarity or this effort limit prevents a match. Copies use
`--find-copies` without `--find-copies-harder`: unchanged files are not exhaustively searched as
sources. These are heuristic Git facts, not proof of historical author intent.

Phase 2 returns factual metadata and an analyzer version, with an empty `analysisEvidenceIds`
array explicitly permitted at this boundary. This is not a completed verification evidence chain.
The future orchestrator/evidence stage must attach actual canonical Evidence using frozen run,
policy and configuration context; the adapter never fabricates evidence IDs. Future provenance
must record the Git binary/version, analyzer version, diff-policy version, object-format identity
and trusted environment/resource profile. Equal commits alone do not promise bit-for-bit output
across Git versions. With stable object storage and the same Git/analyzer policy, source-local
config, info attributes, branch, index and working-tree state do not affect factual output.

## 3. Change categories

Classification yields a set of categories. Categories are not mutually exclusive and do not themselves encode risk.

| Category | Meaning | Example deterministic signals (illustrative, not the final rule set) |
|---|---|---|
| `AUTHENTICATION` | Establishing or maintaining identity | auth/login/session/token modules; authentication middleware; identity-provider configuration |
| `AUTHORIZATION` | Access-control decisions and enforcement | permission/role/policy middleware; ownership checks; route guards; access-control rules |
| `DATABASE` | Schema, migrations, persistence behavior, or data integrity | migration paths; ORM schema; SQL; repository/data-access code |
| `API` | Externally or internally consumed interface behavior | route/controller/handler definitions; request/response schemas; exported API contracts |
| `DEPENDENCY` | Dependency graph or package execution metadata | `package.json` dependency fields; lockfile changes; npm-related metadata |
| `CONFIGURATION` | Runtime/build/deployment configuration | environment schema; TypeScript/build config; deployment config; feature flags |
| `FRONTEND` | Browser/user-interface behavior | component, route, style, client state, or browser entry-point changes |
| `TEST` | Test code, fixtures, or test configuration | test/spec files, fixtures, snapshots, test-runner configuration |
| `GENERAL` | Supported change with no more specific match, or a cross-cutting general code change | ordinary TypeScript modules or documentation-adjacent source changes |

`GENERAL` is a classification category, not a low-risk guarantee and not a fallback that suppresses unknowns. An analyzer/classifier can report both `GENERAL` and an explicit classification limitation.

### 3.1 Classification rules

Initial deterministic rules may inspect:

- exact paths, path segments, file names, and extensions;
- Git change kind and file-mode changes;
- bounded diff content using reviewed patterns;
- TypeScript imports/exports and other syntax facts when a bounded parser is available;
- route declarations and route-to-handler bindings;
- authentication/authorization middleware references and ordering;
- API schema, persistence schema, and migration constructs; and
- configuration, package-manifest, and lockfile structural differences parsed as data, never executed.

Paths and filenames are useful signals but are not sufficient on their own for sensitive semantic categories. Future TypeScript AST-based rules fit behind the existing classifier's deterministic evidence interface; they do not require AI or a generic cross-language plugin architecture.

Rules must have stable IDs, versions, precedence/combination behavior, and tests. A rule emits a category only with at least one `ClassificationEvidence` item.

### 3.2 `ClassificationEvidence`

Each item contains:

- evidence ID and subject (`ChangedFile`, hunk, or `ChangeSet`);
- category;
- rule ID and rule-set version;
- observed fact, such as a matched normalized path or syntax construct;
- source location/reference, bounded excerpt or digest as appropriate;
- deterministic explanation; and
- any analysis limitation relevant to interpreting the match.

The system does not use numeric AI confidence in the MVP. A deterministic match may have a rule-specific strength/priority, but it is not a probability.

## 4. Risk model

### 4.1 Risk levels

| Level | Meaning |
|---|---|
| `LOW` | Limited expected blast radius and reversibility; ordinary verification may be sufficient. |
| `MEDIUM` | Meaningful behavior or interface could regress; targeted verification is warranted. |
| `HIGH` | Sensitive behavior, broad blast radius, difficult recovery, or material data/interface impact. |
| `CRITICAL` | Access control, identity, destructive/irreversible data behavior, foundational trust boundary, or similarly severe impact requires the strongest policy treatment. |

Risk estimates potential consequence and exposure. It does not assert that the change is defective.

### 4.2 Deterministic assessment

Risk rules consume the complete `ChangeSet`, all categories/evidence, and explicit contextual facts allowed by trusted configuration. Rules can:

- establish a minimum risk level for a category/fact;
- escalate for combinations such as `API + DATABASE`;
- escalate for deletions of tests or safety checks;
- escalate for broad size/blast-radius thresholds;
- escalate for binary, truncated, unanalyzable, or unsupported sensitive content; and
- apply a conservative default when classification is incomplete.

The aggregate level is normally the maximum matched level after explicit combination/escalation rules. Downgrades require a specific reviewed rule and evidence; an absence of a match is not downgrade evidence. Rule precedence and ties must be deterministic and order-independent.

### 4.3 `RiskAssessment` and `RiskEvidence`

The assessment records:

- final `RiskLevel`;
- risk-rule-set identity;
- all material matching rules, not only the winning rule;
- input classification/evidence references;
- escalation/combination path;
- limitations and conservative defaults; and
- a concise explanation.

Every `RiskEvidence` item identifies the rule, fact, contribution, source evidence, and explanation. A high/critical result is not a block by itself; it expands or strengthens verification requirements.

## 5. Risk versus verdict

Risk and verdict answer different questions and must never share an enum or overloaded field:

- `RiskLevel`: *How much harm or exposure could this change create, and therefore how much verification is required?*
- `VerificationVerdict`: *What conclusion is justified by the evidence gathered for the frozen plan?*

Consequences:

- `CRITICAL` + all mandatory evidence passes -> `APPROVE` is possible.
- `LOW` + a mandatory check validly fails -> `BLOCK`.
- Any risk + required verification cannot be completed -> normally `INCONCLUSIVE`.
- Risk cannot be inferred backward from the verdict.

## 6. Verification policy model

A `VerificationPolicy` is an immutable, versioned decision layer between risk assessment and planning. It answers, for each applicable strategy, whether it is:

- `MANDATORY`: sufficient successful evidence is required for approval.
- `OPTIONAL`: useful evidence that may be scheduled subject to configuration/budget, but omission alone does not prevent approval.
- `UNSUPPORTED`: required or relevant semantics are known, but no trusted implementation is available in the current product/configuration. This is always a non-approval condition: `INCONCLUSIVE` by default or `BLOCK` when policy explicitly treats the gap as prohibitive.
- `UNNECESSARY`: policy explicitly determines the strategy is not needed for this run and records why.

`UNSUPPORTED` is not equivalent to `UNNECESSARY`. It preserves a verification gap and can never support `APPROVE`.

### 6.1 Policy inputs

- `ChangeSet` and analysis limitations;
- classification categories/evidence;
- `RiskAssessment`;
- supported technology facts;
- immutable `PolicyVersion`; and
- strategy capability facts from the frozen trusted configuration.

### 6.2 Policy output

For each considered strategy, `StrategyRequirement` records:

- strategy type;
- disposition;
- frozen `PolicyVersion` (directly or through an immutable plan context reference);
- mandatory/optional coverage criteria;
- matched policy rule IDs;
- rationale and source evidence references;
- behavior when no trusted check implementation exists; and
- any allowed execution/result threshold.

The policy evaluates semantic need before implementation availability. If authorization verification is required but unavailable, the need must not disappear from the plan.

### 6.3 Mandatory versus optional

A mandatory strategy can map to one or more checks. Its coverage rule explicitly states whether all checks must pass, a threshold is sufficient, or a specific check is authoritative. The default is all planned mandatory checks must pass.

Optional checks:

- do not need to run for approval unless a policy rule promotes them to mandatory;
- cannot be ignored after producing a valid blocking failure if policy declares that failure safety-relevant; and
- cannot compensate for a failed or unresolved mandatory check merely by passing.

The policy must define optional-failure treatment rather than leaving it to executor or UI interpretation.

Phase 8 honors the Phase 5 optional-omission contract. Supported optional checks without captured
evidence may be omitted; known evidence loss or unsupported/unavailable capability is not a waiver.
Supplied optional outcomes retain their approved failure/unavailability treatment. See
[VERDICT.md](VERDICT.md) for the matrix and run-independent assessment/replay contract.

## 7. Verification strategies

| Strategy | Intent | Initial support expectation |
|---|---|---|
| `BUILD` | Establish that trusted build/type compilation completes | Candidate for early implementation |
| `EXISTING_TESTS` | Run an explicitly trusted exact test-runner entry point against existing tests | Candidate, but `npm test`/`npm run` script names alone are not trusted because their bodies are repository-controlled |
| `STATIC_ANALYSIS` | Run specifically configured trusted type/lint/security-oriented rules; this is not a claim of comprehensive vulnerability detection | Candidate for early implementation with exact tool definitions |
| `AUTHENTICATION_VERIFICATION` | Exercise identity/session/token behavior | Planned; may initially be unsupported |
| `AUTHORIZATION_VERIFICATION` | Exercise access-control rules and negative/positive cases | Planned; may initially be unsupported |
| `API_CONTRACT_VERIFICATION` | Check request/response or consumer contract compatibility | Planned; may initially be unsupported |
| `DATABASE_MIGRATION_VERIFICATION` | Check migration validity, compatibility, rollback/forward behavior as policy defines | Planned; may initially be unsupported |
| `DEPENDENCY_VERIFICATION` | Inspect dependency/lockfile integrity, policy, or vulnerabilities | Planned; installation is separate |
| `CONFIGURATION_VERIFICATION` | Validate configuration schema, compatibility, and safety rules | Planned |
| `FRONTEND_BEHAVIOR_VERIFICATION` | Exercise relevant user-visible browser behavior | Planned; may initially be unsupported |

Strategy identity describes intent, not a command. Trusted configuration supplies concrete check definitions later.

## 8. `VerificationPlan`

The plan is frozen before execution and contains:

- plan/run ID and canonical input digest;
- policy, configuration, classifier, and risk-rule versions;
- every considered strategy and its disposition/rationale;
- ordered `VerificationCheck` records;
- coverage mapping from requirements to checks;
- unresolved/unsupported requirements;
- resource and isolation profiles;
- dependency/order constraints between checks, if any; and
- planning evidence.

Plans do not omit inconvenient requirements. If a mandatory requirement cannot be bound to a trusted executable check, it is recorded as an unresolved mandatory requirement and will prevent approval.

Plan generation is a deterministic decision step and performs no verification execution, dependency installation, repository script invocation, or probing command. Execution begins only after the plan is frozen and accepted by the jobs orchestrator.

### 8.1 `VerificationCheck`

Each check records:

- stable check ID within the plan;
- strategy and requirement coverage;
- mandatory or optional role;
- trusted check-definition ID/version;
- structured execution specification or reference;
- timeout/resource/output profile;
- expected result parser/version;
- prerequisites; and
- policy/planning rationale.

Execution cannot add ad hoc checks that alter the verdict. Operational retries keep the same logical check ID and record distinct attempt IDs.

## 9. Check result states

Execution produces exactly one terminal state per check attempt:

| State | Meaning | Can satisfy mandatory success? |
|---|---|---|
| `PASS` | The trusted runner/parser completed and established the check's success condition. | Yes |
| `FAIL` | The check completed validly and established a verification failure. | No; normally blocking |
| `ERROR` | Infrastructure, invocation, parsing, or unexpected execution failure prevented a valid pass/fail conclusion. | No |
| `TIMEOUT` | The time limit expired and the process tree was terminated or termination status recorded. | No |
| `CANCELLED` | Execution was cancelled before a valid conclusion. | No |
| `SKIPPED` | The planned check was intentionally not executed, with reason. | No |
| `UNSUPPORTED` | No usable trusted executor/check implementation exists for this planned requirement. | No |

Missing tooling is `ERROR` or `UNSUPPORTED` according to whether support was configured but broken or never available. A non-zero exit is interpreted by the versioned result contract: it can be a valid `FAIL` or an `ERROR`, but never automatically `PASS`. Process exit zero alone is not enough when the check contract also requires a result artifact/parser.

Check and attempt states are separate so retries do not erase earlier timeouts/errors. The logical check result uses a deterministic retry policy and retains all attempt evidence.

`UNKNOWN` is not a successful check state. An absent, unrecognized, or forward-incompatible state fails validation and contributes to `INCONCLUSIVE` (or a policy-defined prohibition), never `PASS` or `APPROVE`.

## 10. Evidence model

Evidence is a typed, attributable fact—not arbitrary prose. Common evidence kinds include:

- Git/change metadata;
- bounded diff or syntax facts;
- classification rule matches;
- risk rule matches/escalations;
- policy rule matches and strategy dispositions;
- planning resolution/unsupported facts;
- process execution metadata;
- bounded stdout/stderr or result-artifact references;
- parser conclusions;
- environment/isolation profile identity; and
- verdict coverage/reason facts.

Every evidence item contains:

- evidence ID and kind;
- immutable run-context identity resolving to repository identity, base commit, target commit, `PolicyVersion`, and configuration version/hash;
- producing stage/component and version;
- subject IDs;
- verification strategy, check ID, attempt ID, and terminal result state where execution-related;
- source/provenance references;
- timestamp where relevant;
- structured fact and concise explanation;
- integrity digest for stored payloads;
- truncation/completeness status;
- sensitivity classification and retention metadata; and
- links to antecedent evidence when derived.

Evidence payloads are bounded and untrusted for rendering. Hashing shows content identity, not truth. The evidence chain and trusted producer establish why a fact is usable.

Evidence and finalized stage outputs are append-only. They are not edited in place after finalization; a correction creates an explicitly linked superseding record or a new run while preserving the original audit trail. Redaction may replace a viewable payload under retention policy, but the redaction event and non-secret integrity metadata remain auditable.

## 11. Verdict rules

Verdict evaluation operates on the frozen plan and terminal logical check results. It first validates plan/result integrity and accounts for every mandatory requirement.

### 11.1 Precedence

Default precedence is:

1. **BLOCK** when sufficient evidence establishes a policy-defined blocking condition.
2. **INCONCLUSIVE** when there is no established block but approval requirements lack sufficient evidence.
3. **APPROVE** only when all approval requirements are affirmatively satisfied.

This means a known valid failure is not diluted by an unrelated timeout. The verdict still records all reasons, including unresolved checks.

### 11.2 `APPROVE`

Return `APPROVE` only when all of the following hold:

- plan and result integrity validation succeeds;
- the run used recorded immutable policy and configuration identities;
- every mandatory strategy has complete required coverage;
- every mandatory check/coverage condition has a valid `PASS`;
- there are no unresolved mandatory requirements and no unsupported applicable verification;
- there is no valid blocking failure from a check the policy declares safety-relevant, including applicable optional checks;
- no analysis/classification limitation is designated approval-preventing by policy; and
- no cancellation or internal failure interrupted the evidence chain.

Approval is positive evidence, never the absence of failure.

### 11.3 `BLOCK`

Return `BLOCK` when at least one policy-defined blocking condition is established by sufficient evidence, including normally:

- a valid `FAIL` for a mandatory check;
- a valid `FAIL` for an optional check whose failure policy is blocking;
- a trusted static/policy check establishes a prohibited condition; or
- the policy explicitly declares a particular unsupported/absent capability or unsafe input condition blocking.

Infrastructure errors, timeouts, and missing tools are not mislabeled as test failures. They block only if policy explicitly defines the *absence condition* as blocking; otherwise they are inconclusive.

### 11.4 `INCONCLUSIVE`

Return `INCONCLUSIVE` when no blocking condition has been established but approval evidence is incomplete, including:

- mandatory `ERROR`, `TIMEOUT`, `CANCELLED`, or `SKIPPED` results;
- any applicable verification marked `UNSUPPORTED`, unless policy has already elevated that gap to `BLOCK`;
- a missing mandatory result or unresolved mandatory strategy;
- unavailable/invalid evidence or result-parser failure;
- analysis/classification limits that policy says prevent sufficient planning;
- integrity mismatch between inputs, plan, execution, or evidence; or
- an otherwise unknown state not assigned a safe explicit meaning.

### 11.5 Run failure versus verdict

A job can fail before the verdict engine can evaluate a valid plan. Such a run is terminal `FAILED`, not a fabricated domain verdict. At an external deployment boundary it must be treated at least as non-approval and may be projected as inconclusive with an explicit job-failure reason. Internal failure must never appear as `APPROVE`.

## 12. Verdict reasons and explainability

A verdict has ordered `VerdictReason` records with stable codes, such as:

- `ALL_MANDATORY_CHECKS_PASSED`
- `MANDATORY_CHECK_FAILED`
- `OPTIONAL_SAFETY_CHECK_FAILED`
- `MANDATORY_CHECK_TIMED_OUT`
- `MANDATORY_STRATEGY_UNSUPPORTED`
- `MANDATORY_RESULT_MISSING`
- `ANALYSIS_INCOMPLETE`
- `EVIDENCE_INTEGRITY_INVALID`
- `POLICY_PROHIBITION_FOUND`

Each reason references the relevant requirement, check result, and evidence. Human-facing explanations are generated from structured reasons; consumers should branch on stable codes and verdict values, not prose.

## 13. Determinism and reproducibility

For canonical inputs and identical component versions/configuration, classification, risk, policy, planning, and verdict evaluation must be deterministic. Execution itself can observe nondeterminism; therefore records must include:

- target source identity;
- tool/executor image or binary identity;
- check definition and parser version;
- resource/isolation profile;
- environment allow-list identity;
- attempt timestamps and outcomes; and
- retained evidence digests.

Reproducibility means the decision can be explained and reasonably replayed from recorded identities. It does not promise identical timing or output from inherently nondeterministic tests.

## 14. Initial unresolved model questions

- Exact deterministic classification and risk rule tables and their calibrated thresholds.
- Which optional failures should be blocking for each policy profile.
- Coverage semantics when multiple checks implement one strategy.
- Retry policy and logical result aggregation for flaky checks.
- Approval treatment for bounded/truncated but otherwise parseable output.
- How generated files and monorepo boundaries affect classification and blast radius.
- Which strategy subset can be executed without automatic dependency installation.
