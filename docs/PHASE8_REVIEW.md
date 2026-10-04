# Phase 8 adversarial review

## Findings reported before correction

### Medium — optional omission incorrectly prevented approval

Location: `src/verdict/evaluator.ts`, `interpret` missing-result branch; the original Phase 8
documentation and missing-result regression encoded the same error.

Concrete reproduction: a replay-valid TEST-only plan contains optional BUILD/STATIC_ANALYSIS and
mandatory EXISTING_TESTS. Supply only the mandatory PASS and its independently captured reference.
Version 8.0.0 returns INCONCLUSIVE despite no material coverage gap or known optional execution.

The authoritative `docs/POLICY.md` strength/handling contract and `docs/PHASE5_REVIEW.md` explicitly
permit optional omission while retaining safety-relevant consequences for actual optional failures.
Phase 6 preserves strength; materialization does not upgrade optional checks to mandatory. This
was a false non-approval and policy reinterpretation, not a demonstrated false APPROVE.

Recommended and implemented correction: distinguish supported optional omission from missing
mandatory evidence, known capability unavailability and loss of independently captured results.
Correct the conflicting documentation rather than rewriting the approved Phase 5 contract.

No additional Critical, High or Low defect was confirmed in the reviewed paths. This is a bounded
code/test review, not proof that no defects remain.

## Correction and trust prerequisite

Verdict version advances to 8.1.0. A supported optional check with no supplied result and no captured
reference is explicitly MISSING / OPTIONAL_OMITTED, with a neutral SATISFIED obligation contribution,
not a fabricated execution PASS. Mandatory absence is indeterminate. Present optional results use
their approved handling: PASS satisfies, valid FAIL blocks, uncertainty remains inconclusive.
Known unsupported/unavailable capability cannot be waived by omitting a result.

The validated evidence boundary now preserves canonical trusted references. Each assessment retains
`expectedEvidence`, including references whose actual results are absent. A captured optional FAIL,
ERROR or other result cannot be hidden by deleting just the result: approval remains impossible.
The caller must supply a complete independently trusted reference collection for produced evidence.
Discarding both a result and its trusted reference violates that input assumption and cannot be
discovered without authenticated external history, which remains out of scope.

## Adversarial checks

- Existing six-state matrix and all 36 pairs remain enforced; mandatory and optional absence now
  have separate assertions. Supported optional omission, captured evidence loss and known capability
  unavailability have direct regressions.
- Three-state combinations and two FAILs retain every contribution across all six permutations.
- Conflicting duplicates, cross-plan and cross-check substitutions reject; no winner selection occurs.
- Stored BLOCK/INCONCLUSIVE cannot be relabeled APPROVE. Exact replay includes expected references,
  reasons, contributions, coverage, version and digest, with detached recursively frozen output.
- Depth, array breadth, node count, aggregate text, numeric and accessor/cyclic attacks reject.
- Review-required coverage remains unresolved; informational treatment comes from upstream policy.
- Current replay-valid empty comparisons contain only informational coverage. A zero-check plan
  with material coverage is not reachable under the approved upstream rules: forged coverage is
  rejected rather than passed to an artificial verdict-only seam. If approved future rules make it
  reachable, the coverage contribution path remains indeterminate.
- Selected nonblocking FAIL and BLOCK-on-unavailability are currently unreachable. Forged handling
  rejects at replay; tests do not pretend fabricated plans are approved policy.
- Phase 7 permits late exit zero after a winning timeout/cancellation. These remain uncertain, not
  PASS; rejecting every such record as impossible would contradict the approved process protocol.

## Identity and boundaries

The semantic fingerprint includes optional interpretation and captured-evidence guards as explicit
mutation targets, in addition to replay, protocol, coverage and precedence. Version 8.0.0 remains
recorded; prior assessments require recomputation under 8.1.0. Reason prose intentionally belongs
to the serialized identity model, so wording changes require reviewed version advancement.

Architecture guards cover the import closure and preserve the two approved process owners.
Production Phase 1–7 sources and execution tests are unchanged. Phase 8 tests use synthetic DTOs,
not verifier execution; the required full regression suite still runs existing Phase 7 fixtures.
No Phase 9, persistence/jobs, HTTP, deployment or AI behavior is added. No dependencies are added.

Replay consistency is not historical authenticity. Coverage-resolution authority, authenticated
storage and OS isolation remain intentionally deferred. See [VERDICT.md](VERDICT.md).

## Final validation

- `npm test`: 274 passed, zero failures, skips or cancellations (243 earlier-phase tests plus 31 Phase 8 tests).
- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run format:check`: passed.
- `node dist/cli.js --version`: `0.1.0`.
- `npm audit --audit-level=high`: zero vulnerabilities after the approved registry-access retry.
- `git diff --check`: passed; only Git's existing LF-to-CRLF advisory warnings were emitted.
- Earlier-phase source/fingerprint guards and unchanged Phase 7 execution/process-boundary tests passed.

Phase 8 appears ready for baseline acceptance for Phase 9, subject to human review. Phase 9 was not
started. No commit or push was made.
