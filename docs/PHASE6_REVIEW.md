# Phase 6 adversarial review

Reviewed planner **6.0.0** on 2026-10-03 against approved classifier 3.1.0, risk 4.1.0
and policy 5.1.0. Findings were reported before edits. This review adds only this
record: no production corrections, new dependencies, version changes, commit or push.
Phase 7 has not been started.

## Findings

Critical: none confirmed. High: none confirmed. Medium: none confirmed. Low: none
confirmed in the reviewed generation and replay paths. This is a bounded review,
not proof that every possible defect is absent.

The structural factory boundary deserves explicit attention. In
`src/domain/plan-facts.ts`, `createChangeVerificationPlan` validates structure,
internal correspondence and digest syntax; it does not establish digest truth or
replay upstream policy. A changed configuration hash with an unchanged plan ID is
accepted by this factory. The public `validateVerificationPlan` in
`src/planning/planner.ts` rejects it by regenerating the plan from independently
trusted inputs and comparing canonical contents, including the ID. This separation
is already documented in `PLANNING.md`; no current integrity bypass through public
generation/replay was established. Never use the structural factory alone to trust
a stored plan, or use the stored plan itself as the source of trusted replay inputs.

## Mechanical planning and completeness

The planner validates policy through the public Phase 5 replay boundary and
materializes every selected MANDATORY or OPTIONAL strategy exactly once. It does
not infer strategies from categories or risk. STATIC_ANALYSIS originates in policy
5.1.0, not a separate planner rule. Existing tests distinguish a synthetic two-check
materialization example from the fuller selection required by real policy replay.

Requirement strength, availability, disposition, unavailable handling, valid-failure
handling and provenance are preserved. Full policy reasons and uncertainty/coverage
records remain embedded. Unavailable and unsupported selected strategies are not
removed. Empty policy selection yields zero checks without implying success.
Strategy-derived check IDs have exact, distinct mappings, independent of input
ordering; they are local to a plan, not globally unique execution IDs.

## Identity and replay

The digest is SHA-256 over UTF-8 bytes of `riskverifier:verification-plan\n` followed
by compact JSON of the factory-canonical plan contents, excluding the ID. Factories
construct fixed-key objects and canonical record ordering; arbitrary caller object
insertion order is not hashed directly. Maps, sets and other non-DTO values reject.

The digest binds repository, base/target commits, analyzer/classifier/risk/policy/
planner versions, configuration version/hash, complete policy including capability
context, requirements, checks, handling, reasons and uncertainty/coverage. Explanatory
text is also included: changing generated prose changes identity. It does not depend
on source-file formatting, pretty printing, random values or timestamps.

Replay rebuilds from separately supplied ChangeSet, classification, risk, policy,
configuration identity and capabilities. Altered or stale values must satisfy the
upstream replay validators and match the regenerated plan. Version/schema changes
cannot be silently relabeled. The syntax-token source fingerprint covers meaningful
planning and validation dependencies while ignoring comments and formatting.
Planner 6.0.0's passing reviewed fingerprint remains:

`b968f0c982e172588758d55a320a00083b3e341c4f31283ac26a6f716be68beb`

## Runtime protection and phase separation

Factories rebuild validated DTOs and recursively freeze outputs. Exact fields,
bounded graphs, plain objects, dense arrays and value constraints reject malformed
nested input, accessors, cycles and unsupported runtime values. The additive
`ChangeVerificationPlan` remains distinct from the older run-bound canonical plan:
it contains no executable definition, run evidence or claim of execution readiness.

Architecture guards pass. No Phase 7 implementation, executable command schema,
verification execution, verdict evaluator, new production process boundary, HTTP,
Docker, persistence, AI or DeployFlow behavior was introduced. Future failure and
absence treatment remain data, not current BLOCK/INCONCLUSIVE/APPROVE outcomes.

## Adversarial checks

Existing permanent tests already cover semantic digest changes, record permutations,
policy correspondence, optional/unavailable retention, upstream and nested forgery,
immutability, replay, version fingerprints and real-Git integration. No confirmed
weakness required a correction, so no new permanent regression tests were added.

Additional one-off, read-only probes against the compiled modules produced:

- 433 single-field stored-plan mutations rejected by public replay.
- 20 capability substitutions (each strategy changed from supported to unavailable
  or unsupported) changed generated identity and failed replay against original input.
- Missing, duplicate and unknown-strategy capability collections all rejected.
- Three coherent wrong-context replays rejected: different repository, different
  target, and reversed base/target.
- Deep object-key insertion-order reversal preserved generation and replay results.
- An independent hash calculation matched the generated ID. All 384 primitive-leaf
  mutations in a separate plan body changed its calculated hash; this byte-coverage
  check does not imply those mutated bodies are valid plans.
- All 158 visited nested objects/arrays were frozen and rejected property injection.
- Empty comparison generation produced a deterministic zero-check plan.
- The structural-factory limitation above was reproduced; public replay rejected
  the configuration substitution.

These probe counts describe the selected fixtures, not exhaustive state-space proof.

## Remaining limitations

Hash identity is not authentication, a signature or authorization. Configuration
binding means only that the plan was generated for that trusted identity; callers
must bind capabilities to their approved configuration snapshot. Declared support
or availability is not proof an executor can run safely or successfully. Replay
cannot authenticate arbitrary self-consistent source facts without trusted
acquisition/orchestration. Composite DTO bounds can reject very large input graphs.

Later conversion must supply and validate run, evidence and executable context;
check identity references outside this plan need both plan ID and check ID. Execution
quality, actual availability, verification sufficiency and deployment safety remain
outside Phase 6. Existing bounded upstream analysis limitations remain unchanged.

## Final validation

- `npm test`: 213 passed, 0 failed/skipped/cancelled, including Phase 1-5 and
  architecture regressions.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npm run build`: exit 0.
- `npm run format:check`: exit 0.
- `node dist/cli.js --version`: 0.1.0.
- `npm audit --audit-level=high`: exit 0, zero vulnerabilities after authorized
  registry access; the sandboxed attempt could not reach the audit endpoint.
- `git diff --check`: exit 0; Windows line-ending notices only.
- `npm ls --omit=dev --depth=0`: only typescript@6.0.3.

Phase 6 is ready to become the baseline for Phase 7 with the stated trust boundaries
and deferred execution responsibilities. This review does not implement Phase 7.
