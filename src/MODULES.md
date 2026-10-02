# Source module boundaries

Phases 1–4 implement `domain`, configuration snapshot validation/identity, the bounded read-only
Git change analyzer, deterministic classification and risk assessment, minimal structured-logging support, and the harmless CLI entry point. Snapshot
validation does not confer operator authorization; a later acquisition boundary must establish
configuration provenance. The placeholder directories reserve the remaining approved
modular-monolith locations without introducing implementations or abstractions early:

- `policy` — Phase 5
- `planning` — Phase 6
- `execution` — Phase 7
- `evidence` and `verdict` — Phase 8
- `jobs` and `persistence` — Phase 10
- `api` — Phase 11

The `git` module may use Node.js filesystem/process infrastructure and imports domain values only
through `domain/index.ts`. Domain contracts for later concepts remain in `domain`; future modules
will implement their behavior.

The Git adapter may create and remove its own temporary bare metadata directory to isolate source
configuration and attributes; it never modifies the analyzed repository. Only `bounded-process.ts`
owns production subprocess creation in Phases 1–4. Later execution infrastructure requires an
explicit boundary/test update rather than bypassing that guard.

`classification/classifier.ts` coordinates the public Git content adapter, pure rules, and domain
fact factories. `rules.ts` has no infrastructure imports; `syntax.ts` uses only the pinned
TypeScript in-memory syntax parser and domain types; SHA-256 binds normalized constructs without
retaining source literals. There is no compiler program/host, module resolution, configuration loading, typechecking, emission, or repository
execution. Domain never imports classification or Git.

`risk/assessor.ts` consumes only domain values through `domain/index.ts`. It has no infrastructure,
parser, Git, classifier, execution, policy-selection or verdict dependency. Its pure public entry
point is `assessRisk(changeSet, classification)`. It emits immutable intermediate
`ChangeRiskAssessment` / `RiskFact` values; no run evidence IDs are invented. `risk` is implemented;
Phase 5 and all later behavior remain unimplemented. Existing later-phase domain contracts are
not implementations.

`validateRiskAssessment` replays a supplied result against separately trusted inputs without adding
later-phase policy behavior. The domain's risk metadata and Phase 3 compatibility schema validate
evidence vocabulary; they do not parse source or assign verification strategies.

See [Phase 3 classification](../docs/CLASSIFICATION.md) for supported evidence and limitations.
See [Phase 4 risk assessment](../docs/RISK.md) for rules, source binding, uncertainty and versioning.
