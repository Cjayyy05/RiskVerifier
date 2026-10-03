# Phase 6: deterministic VerificationPlan generation

VerificationPlan != execution. VerificationPlan != result. VerificationPlan != verdict.

## Purpose and public interface

`riskverifier/planning` exposes:

```typescript
generateVerificationPlan(input: PlanningInput): ChangeVerificationPlan;
validateVerificationPlan(input: PlanningInput, supplied: ChangeVerificationPlan): ChangeVerificationPlan;
```

`PlanningInput` contains separately supplied `changeSet`, `classification`, `risk`, `policy`,
`configuration` (ConfigurationIdentity), and `capabilities`. None defaults from the stored policy.
The trusted caller must acquire these through the approved extraction/configuration boundaries.
The planner calls public `validatePolicyResult`, which replays approved risk 4.1.0 and policy 5.1.0
against classification 3.1.0. It does not duplicate category/risk/strategy selection logic.

The only non-domain dependency besides public policy replay is Node's built-in SHA-256 hashing.
No repository reads, Git invocation, tool discovery, execution, commands, script authority,
dependencies installation, execution timeout, results, Docker, persistence, HTTP, AI or DeployFlow
are added. Phase 7 has not been started.

## Domain compatibility clarification

The original canonical `VerificationPlan` requires a real run ID, timestamp and run-bound
`RiskEvidence`; its `VerificationCheck` requires a trusted executable-definition identity.
Phase 6's inputs provide none of these. Fabricating them or weakening the approved contracts would
misrepresent provenance and executability. Following Phases 3–5, the additive `ChangeVerificationPlan`
and `PlannedVerificationCheck` represent the complete **run-independent conceptual plan** instead.
Existing canonical contracts remain unchanged. Later orchestration must bind genuine run/evidence
context and trusted execution definitions; there is no automatic cast or promotion here.

This is one concrete, frozen plan, not an executable plan or a runner. Conceptual check identity
describes the intended strategy instance, never proof of an available trustworthy verifier.

## Contents and invariants

| Field | Meaning |
| --- | --- |
| `id` | `plan:sha256:<digest>` of canonical plan contents |
| `plannerVersion` | Independent materialization/identity contract version, 6.0.0 |
| `context` | Exact repository, base, target, analyzer/classifier/risk/policy versions and configuration version/hash |
| `policy` | Complete canonical Phase 5 result, including classification, change metadata, categories, risk facts, uncertainty, capability snapshot, all ten dispositions and coverage obligations |
| `requirements` | Selected requirement IDs with strategy links into `policy.requirements` |
| `checks` | Exactly one conceptual check per selected mandatory or optional requirement |

Each check records ID, requirement ID, strategy, strength, disposition, availability, unavailable
handling, valid-failure handling, policy rule IDs and a factual materialization explanation.
Its stable requirement strategy link leads to full policy reasons and exact upstream evidence.
The planner adds no positional cross-record references. Phase 5's existing evidence indices remain
within its validated embedded canonical records, including its reviewed stored-reference remapping.

All selected strategies, including UNSUPPORTED/UNAVAILABLE ones, receive an intended check. Their
gap remains visible; the check does not assert runtime support. UNNECESSARY strategies remain
documented in the embedded policy but receive no selected requirement or check.
No duplicates, orphan checks, missing selected requirements, changed strength/handling, unknown
strategy, fabricated rule references, or contradictory context survive the structural factory.

## Mechanical materialization and ordering

Requirements/checks follow the approved strategy enum order. Policy reasons, uncertainty and
coverage retain upstream canonical ordering; rule references use corresponding lexical ordering.
This is serialization order, **not execution order**. No dependencies or scheduling constraints are
invented. Requirements link by strategy-derived ID rather than mutable array position.

One selected BUILD becomes one BUILD check. No rule says HIGH adds another check: risk influence
was already resolved by policy. Optional remains optional and mandatory remains mandatory.
The generic two-requirement materialization test creates exactly BUILD and EXISTING_TESTS checks.
It intentionally exercises only the structural materializer: current policy 5.1.0 also selects
STATIC_ANALYSIS for every nonempty change, so public generation rejects a forged two-only policy.

An empty comparison has zero selected requirements/checks and retains ambient classifier coverage.
It is not verification success or approval. GENERAL material uncertainty and explicit classifier
limitations remain in policy coverage; material obligations are not resolved by creating a plan.

## Handling semantics

Planning copies all handling fields from policy unchanged. Under current policy:

- missing/unsupported/unavailable selected verification retains future INCONCLUSIVE handling;
- valid executed failure retains future BLOCK treatment, including optional selected checks;
- optional omission alone is allowed;
- errors/timeouts/absence are not valid failures; and
- material REVIEW_REQUIRED coverage obligations retain future INCONCLUSIVE handling if unresolved.

These are metadata obligations for later stages, not evaluated outcomes. A SUPPORTED declaration
does not prove a Phase 7 implementation exists, is safe, is correct or covers the intended behavior.

## Configuration and source binding

Configuration identity has a validated version and SHA-256 hash using the existing domain contract.
The planner does not parse an execution schema or recalculate a snapshot hash from nonexistent
execution definitions. The existing Phase 1 snapshot parser remains available for its supported
identity-only schema. The caller must supply an independently trusted configuration identity and
the capability declarations associated with its intended snapshot; the identity itself neither
authorizes nor authenticates them. Both configuration identity and capabilities enter the plan digest.
Changing either changes plan identity, even if an operator mistakenly reuses a configuration version.

Stored replay compares against separately supplied trusted configuration and capability inputs.
A self-consistent altered stored plan cannot substitute its own configuration or capabilities as
replay authority. A syntactically valid arbitrary hash is not proof of an approved snapshot.

Exact repository/base/target identities remain in context and embedded evidence. Moving to another
target changes the digest and cannot pass replay against the original context. No deployment artifact
is fabricated: binding a future artifact to the exact verified target remains a later integration
obligation, not a Phase 6 claim.

## Identity and versioning

Check ID: `check:` followed by lower-case strategy with underscores changed to hyphens.
Requirement ID: the same strategy transformation with `requirement:` prefix. IDs are unique within
one plan; external references must use `(plan.id, check.id)`, not the local check ID alone.

Plan ID hashes UTF-8 `riskverifier:verification-plan\n` plus `JSON.stringify(contents)` after factories
construct fixed-key normalized objects and canonical arrays; `contents` contains every field except
the ID itself. The complete policy provenance, handling, capability snapshot and configuration
identity are included. No timestamp, UUID randomness, locale, host, filesystem path or process state
enters identity. Equivalent collection and object-key ordering produces identical plans/digests.
Source formatting/comments do not enter the content hash. Upstream factual prose is retained as
evidence and intentionally bound; changed evidence metadata may therefore change the identity.

Planner **6.0.0** is independent because schema, identity derivation, check linkage and materialization
can change even with fixed risk/policy/configuration. A syntax-based source fingerprint guards the
planner, domain contract and relevant replay/validation dependencies. Mutation tests cover selection
filter, check identity, strength, failure handling and digest namespace. Comments/spacing are ignored,
while syntax/literals and automatic-semicolon-insertion semantics remain distinguishable.
The SHA-256 digest is content identity, never cryptographic authorization or a signature.

## Runtime validation, immutability and replay

Factories rebuild plain serializable data and deep-freeze all nested values. Graph validation rejects
accessors without reading getters, functions, symbols, cycles, sparse arrays, non-plain objects and
excessive data. The composite planning input/result uses the existing 600,000-node, depth-20,
32,768-array-entry bounds; stricter upstream contracts still apply. A very large otherwise valid
upstream result may exceed the aggregate planning budget and fail explicitly rather than lose data.
This is not a sandbox for hostile JavaScript Proxy objects or a transport byte limit.

`createVerificationPlanContents` is the shared mechanical domain materializer.
`createChangeVerificationPlan` validates structural linkage/context and canonicalizes stored arrays;
it checks digest syntax, **not digest truth or upstream rule completeness**. Neither is an authority
boundary. At any storage/API intake use `validateVerificationPlan` with independent trusted inputs:
it rebuilds the stored value, replays policy/risk, regenerates the content digest and compares the
entire canonical plan. Even a syntactically valid changed digest or consistently substituted
configuration fails this replay. No persistence/API is implemented by providing these DTO boundaries.

## Limitations

Replay proves consistency, not authenticity of coherently fabricated input evidence. Use the actual
approved extraction path or a future authenticated provenance boundary. Embedded classification in
stored results must retain risk 4.1.0's canonical representation; public separate inputs may be
reordered equivalently. Planning cannot establish actual availability, executor adequacy, test
coverage, runtime safety, source authenticity, or deployment safety. It creates no runtime IDs,
execution definitions, output/result records, artifact attestations or final verdicts.
