# Source module boundaries

Phases 1–9 implement `domain`, configuration snapshot validation/identity, the bounded read-only
Git change analyzer, deterministic classification, risk assessment, verification policy and conceptual planning,
controlled fixture execution, pure evidence interpretation/verdict evaluation, minimal structured-logging support, and the harmless CLI entry point. Snapshot
validation does not confer operator authorization; a later acquisition boundary must establish
configuration provenance. The placeholder directories reserve the remaining approved
modular-monolith locations without introducing implementations or abstractions early:

- `jobs` and `persistence` — Phase 10
- `api` — Phase 11

The `git` module may use Node.js filesystem/process infrastructure and imports domain values only
through `domain/index.ts`. Domain contracts for later concepts remain in `domain`; future modules
will implement their behavior.

The Git adapter may create and remove its own temporary bare metadata directory to isolate source
configuration and attributes; it never modifies the analyzed repository. Only
`git/bounded-process.ts`, `execution/bounded-execution.ts` and `isolation/docker-adapter.ts` own production subprocess creation.
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
Phase 10 and all later behavior remain unimplemented. Existing later-phase domain contracts are
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

`evidence` implements a pure boundary that replays the public Phase 6 plan, validates independently
trusted execution bindings, reuses Phase 7 result validation and matches independently retained
whole-result digests. The additive public `execution/results` package entry targets the existing
pure `execution/result.ts`, not the executor index or adapters. No approved Phase 1–7 source changes
are needed. `verdict` consumes public evidence validation and domain contracts; the two new modules
share private bounded canonical-data/hash/freeze utilities in `evidence/validation.ts`.

`verdict` emits a detached immutable `VerdictAssessment`: check/coverage contributions, ordered
reasons and provenance, plus `BLOCK` > `INCONCLUSIVE` > `APPROVE`. Supported optional omission is
neutral when no evidence was captured; known evidence loss and supplied optional outcomes remain
accounted for. Required coverage remains unresolved without an approved resolution contract.
Neither module has execution authority, filesystem/network access, scheduling, persistence or
deployment behavior. No canonical historical run/evidence IDs are fabricated.
See [Phase 8 verdicts](../docs/VERDICT.md) for trust prerequisites, public APIs and limitations.

`isolation` adds the separately versioned Docker Linux-container backend for controlled fixtures.
Only `docker-adapter.ts` owns Docker calls and exact-ID lifecycle management. Configuration fixes
security/mount/command roles and binds approved immutable images and verifier pins. The executor
reuses package-internal Phase 7 workspace/validation functions and public plan replay, without
modifying their source or broadening the host executor. Results explicitly wrap Phase 7 protocol
DTOs with container provenance; no verdict semantics change. There is no repository checkout,
dependency installation, image pull/build or later-phase orchestration.
See [Phase 9 isolation](../docs/ISOLATION.md) for supported platform, tests and trust limitations.
