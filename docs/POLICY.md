# Phase 5: deterministic verification policy

Policy requirement != execution result. Policy requirement != verdict.

`riskverifier/policy` exports `evaluatePolicy(changeSet, classification, risk, capabilities?)`
and `validatePolicyResult(changeSet, classification, risk, capabilities, supplied)`.
Both replay the approved risk 4.1.0 rules against the separate change/classification context.
No repository reads, commands, executor discovery, plans, evidence IDs, run IDs or configuration
identities are created. Phase 6 remains unimplemented.

## Architecture and provenance

Small immutable TypeScript rules declare applicability and produce contributions. The evaluator
combines them into one requirement per strategy in domain vocabulary order. Every reason records
a stable `policy.*` rule ID, policy version, reason code, fixed explanation, strength, future
unavailable handling, and indices into the embedded canonical classification/risk/uncertainty facts.
No repository text supplies policy or commands. The immutable intermediate `ChangeVerificationPolicy`
does not impersonate canonical run-bound evidence or a VerificationPlan.

`createChangeVerificationPolicy` checks shape, bounds, metadata, provenance indices, category
consistency, aggregate states and uncertainty coverage. It is a structural factory, not proof
that rules were applied completely. Use `validatePolicyResult` at storage/untrusted intake boundaries:
it replays all rules against separately trusted inputs, including the capability snapshot.
Capability claims are caller assertions, not discovered executors or operator authorization.
They are not proof that an executor is correct, safe, or adequate. Never derive this input from
repository files or accept the stored result's own capability claims as trusted replay context.

## Strategy policy

| Evidence | Baseline at LOW | Targeted strategy |
| --- | --- | --- |
| Nonempty ordinary/mixed changes | BUILD and EXISTING_TESTS mandatory; STATIC_ANALYSIS optional | Category rules below |
| TEST only | EXISTING_TESTS mandatory; BUILD and STATIC_ANALYSIS optional | None |
| FRONTEND only, all facts `path.frontend` | BUILD mandatory; EXISTING_TESTS and STATIC_ANALYSIS optional | FRONTEND_BEHAVIOR_VERIFICATION optional |
| FRONTEND with syntax or mixed categories | Ordinary baseline | FRONTEND_BEHAVIOR_VERIFICATION mandatory |
| AUTHENTICATION | Ordinary baseline | AUTHENTICATION_VERIFICATION mandatory |
| AUTHORIZATION | Ordinary baseline | AUTHORIZATION_VERIFICATION mandatory |
| API | Ordinary baseline | API_CONTRACT_VERIFICATION mandatory |
| DATABASE | Ordinary baseline | DATABASE_MIGRATION_VERIFICATION mandatory |
| DEPENDENCY | Ordinary baseline | DEPENDENCY_VERIFICATION mandatory |
| CONFIGURATION | Ordinary baseline | CONFIGURATION_VERIFICATION mandatory |
| GENERAL, nonempty | Strengthened baseline (all three mandatory) | None inferred |
| Empty comparison | All ten UNNECESSARY | None |

Stylesheet convention evidence does **not** prove a cosmetic-only change. JSX/behavioral evidence
gets a stronger frontend requirement. TEST classification is similarly bounded, not proof of no
runtime impact. Multi-category changes union targeted strategies; authentication and authorization
remain distinct. Database policy does not claim destructiveness; configuration does not imply production.

MEDIUM, HIGH and future CRITICAL strengthen all three baseline strategies to mandatory. Frontend
verification becomes mandatory at elevated risk. They do not add unrelated subsystem strategies.
Risk 4.1.0 never emits CRITICAL: `policyIntensity` understands its future conservative treatment,
but public evaluation rejects fabricated CRITICAL assessments rather than bypassing risk replay.
A future producer requires an explicitly reviewed risk/policy compatibility update.

## Strength, availability and future handling

`strength` is MANDATORY, OPTIONAL or UNNECESSARY, independently of executor support.
Capabilities describe each of the ten strategies exactly once as SUPPORTED, UNSUPPORTED
(known unsupported) or UNAVAILABLE (not currently available). Omitted capability input defaults
to all UNAVAILABLE because Phase 5 has no executor bindings.

Supported selected requirements have MANDATORY/OPTIONAL disposition. Selected unsupported or
unavailable requirements have UNSUPPORTED disposition **without weakening strength**.
Unselected requirements have UNNECESSARY disposition regardless of capability. Optional means
policy does not mandate selection, not that a selected unsupported requirement is success.
All current selected unavailable requirements retain future INCONCLUSIVE handling, including
optional ones, consistent with Phase 0 unsupported-coverage semantics. No current rule declares
absence itself prohibitive; none uses BLOCK handling. These are future obligations, not verdicts.
UNNECESSARY entries retain the same handling metadata, but have no absence obligation.

Every selected strategy also records `validFailureBehavior: BLOCK`: a future **valid check failure**
is safety-relevant even when the strategy was optional. Optional omission alone is permitted;
once run, a valid failure cannot be ignored. This is deliberate for build compatibility, existing
tests, static analysis and frontend behavior alike. An error, timeout or missing executor is not
a valid failure and must not use this field. Unselected strategies use NOT_APPLICABLE.
These are frozen future treatment rules, not a verdict computation. In particular, BLOCK on valid
failure does not authorize BLOCK on unavailability.

## Uncertainty

All risk uncertainties survive in embedded risk and one coverage record each. Ambient
BOUNDED_CLASSIFIER_COVERAGE is INFORMATIONAL and contributes optional static analysis for nonempty
changes; it does not make every future run automatically inconclusive. Other uncertainties
(classification limitations, unspecified GENERAL changes, unknown counts) strengthen baseline
checks and require separate REVIEW_REQUIRED coverage resolution. If unresolved, future handling
is INCONCLUSIVE even if selected checks pass. This phase cannot resolve coverage gaps.

GENERAL cannot distinguish documentation-only from generic unsupported source behavior. No safe
docs-only exemption or “understood GENERAL” branch can be justified from the existing contracts;
both remain conservatively checked. No category-specific strategy is invented from uncertainty.
Empty comparisons select no checks and are not approval.

## Conflict resolution and determinism

MANDATORY dominates OPTIONAL, which dominates UNNECESSARY. Exact duplicate contributions are
deduplicated; independent reasons are retained and sorted by reason code. BLOCK dominates
INCONCLUSIVE for the generic future unavailable-handling merge, though current rules use only
INCONCLUSIVE. Conflicting/unknown current reason metadata is rejected, never last-writer-wins.
Canonical input normalization and fixed strategy/reason/index ordering make repeated or reordered
equivalent inputs reproduce the same output. Embedded reference indices refer to canonical facts.
Stored risk evidence and uncertainty arrays may be reordered only with their referring indices
updated. Reconstruction maps those original indices by validated record identity before sorting;
leaving indices attached to different records is not an equivalent reorder. The embedded
classification must retain the canonical form emitted by risk replay, as required by risk 4.1.0.

Policy version is independently **5.1.0**. This review revision fixes stored-reference rebinding
and specifies valid optional-failure treatment. Old 5.0.0 results must be recomputed, not relabeled.
The source fingerprint binds rules, evaluator, factories,
domain vocabulary/validation and risk replay dependency using parsed/printed TypeScript syntax
tokens. Comments and spacing do not change it; literals, operators, selection, strength and absence
semantics do. Meaningful changes require explicit version/fingerprint review. Earlier phase version
guards remain unchanged.

## Limitations and boundary

Validated facts are not proof of actual source provenance when fabricated together by an untrusted
caller. Orchestration must establish trusted Git/classification inputs and capability authority.
Policy cannot establish runtime exposure, migration safety, executor adequacy, test sufficiency,
actual availability, or deployment safety. No commands, builds/tests against analyzed repositories,
Docker, persistence, HTTP, AI, DeployFlow, plans or verdict evaluation are implemented.
