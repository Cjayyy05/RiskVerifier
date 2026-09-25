# Source module boundaries

Phases 1–2 implement `domain`, configuration snapshot validation/identity, the bounded read-only
Git change analyzer, minimal structured-logging support, and the harmless CLI entry point. Snapshot
validation does not confer operator authorization; a later acquisition boundary must establish
configuration provenance. The placeholder directories reserve the remaining approved
modular-monolith locations without introducing implementations or abstractions early:

- `classification` — Phase 3
- `risk` — Phase 4
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
owns production subprocess creation in Phases 1–2. Later execution infrastructure requires an
explicit boundary/test update rather than bypassing that guard.
