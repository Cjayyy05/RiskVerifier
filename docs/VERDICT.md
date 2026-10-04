# Phase 8 — Evidence interpretation and deterministic verdicts

## Purpose and scope

Version `8.1.0` answers: given this replay-validated plan and independently bound execution
evidence, were the policy-selected verification obligations satisfied? It returns immutable data,
not a deployment action. It never executes or retries checks, reads files, accesses the network,
uses the clock/randomness/environment, reclassifies changes, reassesses risk, or selects policy.
No Phase 9 isolation, persistence, job lifecycle, HTTP, AI or DeployFlow integration is implemented.

The approved classifier `3.1.0`, risk `4.1.0`, policy `5.1.0`, planner `6.0.0`, executor `7.1.0`,
and their source/fingerprint baselines remain unchanged.

```text
PASS != APPROVE
FAIL != BLOCK by itself
ERROR != FAIL
TIMEOUT != FAIL
CANCELLED != FAIL
UNSUPPORTED != FAIL
```

## Public boundaries and trusted inputs

- `riskverifier/evidence`: `captureExecutionEvidence`, `validateExecutionEvidence`, and DTO types.
- `riskverifier/verdict`: `evaluateVerdict`, `validateVerdictAssessment`, assessment types and `VERDICT_VERSION`.
- `riskverifier/execution/results`: additive pure entry point to the existing Phase 7
  `ExecutionBinding`, `ExecutionCheckResult`, `validateBoundResult`, `resultState` and `noProcess`.
  This exposes no executor, workspace allocator, authority grant or process adapter. The existing
  validator implementation is reused without modification. Its low-level binding argument must
  already be trusted and validated; it is not an untrusted-binding validator.

The evaluator consumes:

```ts
evaluateVerdict({ planningInput, plan, results }, trustedReferences);
```

`planningInput` must come from the separately trusted upstream context. Phase 6 replay checks the
supplied plan against it, transitively replaying policy and risk. Every present result needs an
independently retained `ExecutionEvidenceReference`: an exact trusted execution binding and a
SHA-256 digest of the complete validated result. The binding includes plan/context/check,
executor version, authority ID, definition ID/version/output and timeout limits, and single-use
workspace ID/snapshot hash. A substituted repository, commit, strategy, configuration, definition,
executor, authority or workspace does not satisfy the original reference.

At a trusted Phase 7 output boundary, the caller can use:

```ts
const reference = captureExecutionEvidence(
  trustedPlanningInput,
  replayedPlan,
  independentlyKnownExecutionBinding,
  trustedResult,
);
```

The helper replays the plan, validates the binding and result with the existing Phase 7 validator,
and returns a detached frozen reference. Retain that reference independently before transport or
untrusted storage. It does **not** establish trust by itself. Never reconstruct the reference from
the same untrusted historical result being evaluated. Supplying attacker-controlled results and
matching attacker-controlled references defeats the trust assumption. Phase 8 provides neither
authenticated storage nor an authority acquisition mechanism; callers must establish this trust.
No historical check is re-executed to obtain a reference. Without one, a present result is rejected.

References for selected checks whose results are absent are permitted and validated, but do not
substitute for the missing result. A reference need not exist for a check that never produced a
result. Duplicate or unselected references are invalid. The trusted reference collection must be
complete for produced evidence; its completeness is a caller trust prerequisite. Dropping a known
optional result while retaining its reference prevents approval. A caller that discards both a
result and its trusted reference has violated this prerequisite; hashes cannot discover that loss.

## Interpretation matrix

Present-result interpretation applies to all selected checks, mandatory or optional. Absence differs:
a supported optional check with no captured evidence may be omitted under approved policy 5.1.0.

| State                                                     | Approved metadata consulted                                         | Contribution under current policy |
| --------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------- |
| `PASS`                                                    | Selected check association and complete Phase 7 protocol validation | `SATISFIED`                       |
| `FAIL`                                                    | `validFailureBehavior` must be `BLOCK`                              | `BLOCKING_FAILURE`                |
| `ERROR`                                                   | `unavailableBehavior`                                               | `INDETERMINATE`                   |
| `TIMEOUT`                                                 | `unavailableBehavior`                                               | `INDETERMINATE`                   |
| `CANCELLED`                                               | `unavailableBehavior`                                               | `INDETERMINATE`                   |
| `UNSUPPORTED`                                             | `unavailableBehavior`                                               | `INDETERMINATE`                   |
| Missing mandatory/captured result or known unavailability | `unavailableBehavior`                                               | `INDETERMINATE`                   |
| Supported optional omission with no captured reference    | `strength: OPTIONAL`                                                | Neutral `SATISFIED`, not PASS     |

`FAIL` means the trusted verifier returned the reserved valid-negative exit status (42), not an
arbitrary nonzero exit. Other exits and execution faults remain `ERROR`. Timeouts and cancellations
retain their stop outcome even if a zero exit follows the winning stop request. Infrastructure
uncertainty is not presented as a factual failure of the software change. `SKIPPED` has no Phase 7
terminal protocol and cannot be smuggled in as an alternative satisfying outcome.

Current policy records `BLOCK` on valid failures and `INCONCLUSIVE` on unavailability for selected
checks. The evaluator consults those fields, not hard-coded state-to-verdict equivalence. Its
unavailability branch can honor an approved future `BLOCK` rule; current plan replay rejects
fabricating such a rule. Unsupported future failure semantics reject until explicitly implemented.

## Verdicts and precedence

For an optional check with `SUPPORTED` availability, no result and no independently captured
reference, the contribution is `SATISFIED` (neutral), code `OPTIONAL_OMITTED`, state `MISSING`,
and null execution evidence. This means the policy obligation permits omission, **not** that the
check passed. Mandatory absence, known captured-but-missing results and known unsupported/unavailable
capability remain indeterminate. Supplied optional outcomes always use the matrix above.

All inputs are validated **before** combining contributions:

1. Any policy-defined `BLOCKING_FAILURE` produces `BLOCK`.
2. Otherwise, any `INDETERMINATE` check or required coverage obligation produces `INCONCLUSIVE`.
3. Otherwise, `APPROVE`.

`BLOCK` means validated evidence violated an approved condition requiring blocking. It does not
prove malicious code or a particular vulnerability, nor does it mean an external deployment was
stopped. `INCONCLUSIVE` means evidence was insufficient to establish approval and no established
blocking condition takes precedence. `APPROVE` means all approval-required verification obligations under the
validated policy for this exact plan were satisfactorily resolved, without blocking or unresolved
conditions. It is not a claim of defect-free, vulnerability-free or production-safe software.

Valid failure plus timeout is `BLOCK`; both reasons remain in the assessment. Array order never
changes precedence. Risk level never directly determines a verdict.

## Completeness and optional selection

Every planned check receives exactly one assessment entry. An absent result is explicitly
`MISSING`, with null evidence and `RESULT_MISSING`, not an invented execution outcome. Legitimate
incomplete execution can be evaluated. Duplicate results (even identical passes), conflicting
results, unknown/extra checks and results without independent references are rejected. Attempt IDs
and single-use workspace IDs cannot be reused across present results. No first/last/worst-wins merge
is performed. No result is required for a strategy that the plan did not select.

Optional omission alone is permitted by [POLICY.md](POLICY.md) and the approved
[Phase 5 review](PHASE5_REVIEW.md). Phase 6 materialization does not promote OPTIONAL to MANDATORY.
Version 8.0.0 incorrectly required every optional result; 8.1.0 corrects this semantic defect.
Supported optional omission with no captured evidence is neutral. A captured result missing at
intake is evidence loss, not omission; its reference remains in `expectedEvidence`. Supplied optional
FAIL can block; supplied ERROR/TIMEOUT/CANCELLED/UNSUPPORTED remain inconclusive under current policy.
Known unsupported/unavailable capability also remains inconclusive, even without a produced result.

## Coverage and empty plans

Each policy coverage record is copied with its exact uncertainty index and underlying risk
uncertainty. `INFORMATIONAL` coverage is recorded as satisfied/nonblocking; the ambient bounded
classifier limitation therefore does not prevent every approval. `REVIEW_REQUIRED` remains
indeterminate, even if every existing check passes. The approved contracts define no coverage
resolution evidence or linkage proving that a check resolves a review obligation. Phase 8 does not
invent one, a manual waiver, or an assumption that execution completion removes uncertainty.

Consequently, GENERAL changes with material `UNSPECIFIED_CHANGE` coverage remain inconclusive unless
a valid blocking condition takes precedence. This is intentional preservation of unresolved
uncertainty, not reclassification. A future resolution contract requires explicit design/review.

A replay-valid zero-check plan with no unresolved required coverage is approved vacuously, with
`NO_CHECKS_REQUIRED`. This means only that policy required no checks for this exact change. A stripped
nonempty plan fails replay. Any required coverage would still prevent empty-plan approval.

## Assessment, reasons and provenance

`VerdictAssessment` is a run-independent intermediate, not the canonical persisted `Verdict` /
`Evidence` contract. It invents no run IDs, canonical Evidence IDs or timestamps. It contains:

- independent verdict version, deterministic assessment ID, plan ID and source/configuration context;
- one entry per check with full selected-check identity, strategy, strength, requirement ID,
  policy rule IDs, handling semantics, terminal/missing state, contribution and structured reason;
- present-result provenance: attempt ID, full validated binding and whole-result digest;
- `expectedEvidence`: the independently captured reference or null, retained even if its result is missing;
- coverage obligations, indexed uncertainty facts, contributions and structured reasons; and
- an aggregate verdict reason, without discarding lower-precedence reasons.

Stable check codes are `CHECK_PASSED`, `VALID_FAILURE_BLOCKS`, `CHECK_ERROR`, `CHECK_TIMEOUT`,
`CHECK_CANCELLED`, `CHECK_UNSUPPORTED`, `RESULT_MISSING`, `OPTIONAL_OMITTED`. Coverage uses `COVERAGE_REVIEW_REQUIRED`
and `COVERAGE_INFORMATIONAL`. Aggregate codes are `POLICY_BLOCK_REQUIRED`, `VERIFICATION_INCOMPLETE`,
`ALL_OBLIGATIONS_SATISFIED` and `NO_CHECKS_REQUIRED`.

Reasons resolve through their containing check/coverage entry and top-level plan context. Missing
evidence has no fabricated attempt. Raw diagnostics are validated and included in the evidence
digest but omitted from the verdict projection; the separately retained result remains necessary
for replay. Diagnostic sensitivity remains Phase 7 `SENSITIVE`; this is not a public-output
redaction or declassification mechanism. Opaque digests themselves are not guaranteed secret.

## Runtime integrity, determinism and versions

Boundary data is copied before use, rejects unknown fields at schema boundaries, cycles, accessors
without invoking them, hidden/symbol properties, unsupported prototypes, sparse/oversized arrays
and non-JSON values. The envelope is bounded to depth 32, 600,000 nodes, 32,000,000 aggregate string
and property-name characters, 1,500,000 characters per string/name and 32,768 entries per structural
array. Result/reference sets permit at most ten entries (the strategy vocabulary). Phase 6/7 apply
their stricter semantic limits afterward, including the 1 MiB diagnostic cap. These are plain DTO
defenses, not a sandbox for adversarial JavaScript Proxy traps or other same-process code.

The existing Phase 7 validator rejects contradictory terminal state/exit/output/termination data.
Whole-result digest comparison additionally catches coherently altered diagnostics, duration,
attempt or provenance. Invalid evidence rejects the entire evaluation, even if another result
would already block. It is never silently turned into an inconclusive contribution.

Results/references may arrive in any order. Checks and coverage follow canonical replayed plan
order. Object keys are sorted for hashing/comparison; stored assessment arrays must match the
canonical order. Returned values are detached and recursively frozen; caller data is not frozen.

Evidence digest: SHA-256 of `riskverifier:execution-evidence\n` plus canonical complete validated
result JSON. Assessment ID: `verdict:sha256:` plus SHA-256 of
`riskverifier:verdict-assessment\n` plus canonical assessment fields excluding its own ID. The
assessment binds version, plan/context, all contributions/reasons, result digests and provenance.
No clocks, random values or environment inputs participate.

`validateVerdictAssessment(input, trustedReferences, supplied)` recomputes the entire expected
assessment, not just its hash. Changed verdict, version, reasons, associations, handling, coverage,
contributions, provenance or digest reject. Equivalent object key insertion order is accepted.

Verdict version `8.1.0` has a semantic source fingerprint guard over all evidence/verdict source
and its relative import/export dependency closure, including plan replay and the Phase 7 result
protocol. The pinned TypeScript `6.0.3` printer/token normalization ignores formatting/comments,
not semantic changes. Current fingerprint:
`c1d0b314e271f18e39c4ef639c83dc9f21d0c4a329719c930fd614dcdf4d3b67`.
The 8.0.0 fingerprint remains recorded in the guard. Old assessments must be recomputed, not relabeled.
Generated reason text intentionally participates in identity and exact replay: editorial reason
changes require reviewed version/fingerprint advancement just like other serialized-contract changes.
Mutation checks cover missing-result treatment, precedence, coverage, failure handling, independent
digest checks, DTO validation, plan/policy replay and the exit-42 protocol.

## Approval-route audit and validation

The sole approval branch is reached only after full plan replay, all result/reference validation,
independent digest matching, a contribution for every selected check and every coverage obligation,
and absence of both blocking and indeterminate contributions. Missing mandatory or captured evidence,
known unavailability, and supplied unsupported/error/timeout/cancelled results cannot reach that branch.
Genuine supported optional omissions are neutral, never execution PASS. Malformed evidence exits via validation error, not a
verdict. The only empty-plan exception is the explicit replay-valid/no-required-coverage case.

Tests cover the six-state matrix across mandatory and optional checks, every pair of mixed states,
missing/empty/coverage cases, bindings and diagnostic tampering, exact cardinality, malformed DTOs,
stored reconstruction, immutability, deterministic ordering and semantic fingerprints. Architecture
tests prohibit runtime execution authority or filesystem/network dependencies in the verdict import
closure and preserve both approved subprocess owners. Existing Phase 1–7 tests remain regression
requirements; new Phase 8 tests use synthetic protocol fixtures and execute no verifier.

## Limitations

Replay consistency != historical authenticity. Hashes establish content identity, not that a
serialized execution truly occurred, that a verifier was trustworthy, or that upstream caller
inputs/references are authentic. Phase 7's fixture execution is still not OS isolation. There is no
coverage-resolution authority, authenticated persistence, run orchestration, retry, deployment gate
or general-purpose real-repository execution in this phase. Phase 8 stops at assessment data.
