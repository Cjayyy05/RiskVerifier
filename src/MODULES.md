# Source module boundaries

Phases 1–7 implement `domain`, configuration snapshot validation/identity, the bounded read-only
Git change analyzer, deterministic classification, risk assessment, verification policy and conceptual planning,
controlled fixture execution, minimal structured-logging support, and the harmless CLI entry point. Snapshot
validation does not confer operator authorization; a later acquisition boundary must establish
configuration provenance. The placeholder directories reserve the remaining approved
modular-monolith locations without introducing implementations or abstractions early:

- `evidence` and `verdict` — Phase 8
- `jobs` and `persistence` — Phase 10
- `api` — Phase 11

The `git` module may use Node.js filesystem/process infrastructure and imports domain values only
through `domain/index.ts`. Domain contracts for later concepts remain in `domain`; future modules
will implement their behavior.

The Git adapter may create and remove its own temporary bare metadata directory to isolate source
configuration and attributes; it never modifies the analyzed repository. Only
`git/bounded-process.ts` and `execution/bounded-execution.ts` own production subprocess creation.
Architecture tests enumerate these exact owners; Git and verification remain separate trust domains.

`classification/classifier.ts` coordinates the public Git content adapter, pure rules, and domain
fact factories. `rules.ts` has no infrastructure imports; `syntax.ts` uses only the pinned
TypeScript in-memory syntax parser and domain types; SHA-256 binds normalized constructs without
retaining source literals. There is no compiler program/host, module resolution, configuration loading, typechecking, emission, or repository
execution. Domain never imports classification or Git.

`risk/assessor.ts` consumes only domain values through `domain/index.ts`. It has no infrastructure,
parser, Git, classifier, execution, policy-selection or verdict dependency. Its pure public entry
point is `assessRisk(changeSet, classification)`. It emits immutable intermediate
`ChangeRiskAssessment` / `RiskFact` values; no run evidence IDs are invented. `risk` is implemented;
Phase 8 and all later behavior remain unimplemented. Existing later-phase domain contracts are
not implementations.

`validateRiskAssessment` replays a supplied result against separately trusted inputs without adding
later-phase policy behavior. The domain's risk metadata and Phase 3 compatibility schema validate
evidence vocabulary; they do not parse source or assign verification strategies.

See [Phase 3 classification](../docs/CLASSIFICATION.md) for supported evidence and limitations.
See [Phase 4 risk assessment](../docs/RISK.md) for rules, source binding, uncertainty and versioning.

`policy` implements pure conceptual strategy selection through domain contracts and public risk
replay. It cannot access repositories, execute checks, construct plans or issue verdicts.
See [Phase 5 policy](../docs/POLICY.md) for intermediate contracts and capability semantics.

`planning` consumes public policy replay and domain contracts, using only Node's SHA-256 hashing
for deterministic content identity. Its immutable `ChangeVerificationPlan` binds exact source,
versions and separately supplied configuration/capabilities, with one conceptual check per selected
strategy. It does not bind executable definitions, read repositories, execute or evaluate verdicts.
See [Phase 6 planning](../docs/PLANNING.md) for the run-independent contract clarification.

`execution` replays the public Phase 6 plan against independently supplied planning inputs, resolves
one check through its separately trusted definition registry, checks an independent host executable/
verifier allow-list, and runs only a freshly allocated controlled fixture. Its sole subprocess owner
is `bounded-execution.ts`; it cannot select policy, assess risk or calculate a verdict. Local execution
is not an OS sandbox. The additive `ExecutionCheckResult` reuses domain result states and retains
plan context without inventing canonical run Evidence. Configuration/authority/workspace infrastructure
stays local to this module; the existing Phase 1 configuration schema and Phase 1–6 baselines are unchanged.
See [Phase 7 execution](../docs/EXECUTION.md) for public APIs, protocol and explicit limitations.
