# Source module boundaries

Phase 1 implements `domain`, configuration snapshot validation/identity, the minimal
structured-logging support, and the harmless CLI entry point. Snapshot validation does not confer
operator authorization; a later acquisition boundary must establish configuration provenance. The
placeholder directories reserve the approved modular-monolith locations for later phases without
introducing implementations or abstractions early:

- `git` — Phase 2
- `classification` — Phase 3
- `risk` — Phase 4
- `policy` — Phase 5
- `planning` — Phase 6
- `execution` — Phase 7
- `evidence` and `verdict` — Phase 8
- `jobs` and `persistence` — Phase 10
- `api` — Phase 11

Domain contracts for these concepts live in `domain`; the future modules will implement behavior.
