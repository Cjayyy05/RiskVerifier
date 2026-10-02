# Phase 5 adversarial review

Reviewed 5.0.0 on 2026-10-03; corrected candidate: **5.1.0**. Findings were reported before
production edits. Approved Git 2.1.0, classifier 3.1.0 and risk 4.1.0 sources/guards remain unchanged.
Package/CLI stays 0.1.0. No new dependency, commit, push or Phase 6 implementation.

## Findings, ordered by severity

### Critical / High

None confirmed in the current policy path. No executable plan, command selection, repository script
execution, verdict evaluator, external transport, Docker, persistence, AI or DeployFlow was found.

### Medium: sorting stored risk silently rebinds policy provenance

**Location:** `src/domain/policy-facts.ts`, `createChangeVerificationPolicy` and `reason`.

**Problem:** Reconstructing risk sorts evidence and uncertainties, but policy indices were interpreted
against the new positions without remapping them. Reversing two uncertainties while keeping policy
references unchanged passed `validatePolicyResult`; reversing them with correctly updated reason
and coverage indices was rejected. Risk-fact references have the same issue.

**Scenario:** A serializer/storage adapter reorders records, or a tampered stored result changes
what index zero denotes. A material review obligation can appear to refer to ambient coverage in
the stored record, yet reconstruction silently repairs its meaning and accepts it. Conversely,
equivalent correctly linked data is rejected. This is provenance-integrity loss, not a demonstrated
deployment approval bypass: replay still reconstructs the approved strategy set.

**Correction:** After risk validation establishes unique identities, map original evidence positions
by reason code and uncertainty positions by code to the canonical arrays. Remap every reason and
coverage reference before checking invariants. Out-of-range indices fail closed. Do not change the
approved risk factory or duplicate its evaluator. Preserve the existing requirement that embedded
classification is the canonical form emitted by risk replay.

### Medium: optional valid-failure treatment was unspecified

**Location:** `src/domain/policy-facts.ts`, `PolicyRequirement`; `src/policy/evaluator.ts`.

**Problem:** Phase 0's verification model section 6.3 and Phase 5 implementation-plan deliverables
require optional-failure treatment. The 5.0.0 result contained only unavailable treatment.

**Scenario:** A future planner/verdict consumer sees a supported optional frontend/static/build/test
check fail validly and must invent whether to ignore that failure. Different consumers could give
different treatment to the same frozen policy.

**Correction:** Version 5.1.0 explicitly sets `validFailureBehavior: BLOCK` on selected strategies
and NOT_APPLICABLE on unselected strategies. Optional omission alone is permitted, but an actually
run valid failure is safety-relevant. This is a deliberate conservative policy for compatibility,
regression, static-analysis and frontend checks, not an executor judgment or result evaluation.
Absence, errors, timeouts and missing tools are not valid failures: unavailable handling remains
INCONCLUSIVE for every current selected requirement. Factories and replay reject substituted
failure treatment. No final verdict is produced.

### Low

No additional confirmed issue.

## Challenged invariants

- Public policy evaluation replays risk 4.1.0, rejecting altered levels, missing/fabricated evidence,
  stripped/renamed/partial uncertainty, versions, and mismatched repository/commit context.
- Classification producer IDs, category/shape compatibility and versions use approved risk schema
  checks. This is not proof that arbitrary consistent caller-supplied facts came from Phase 3.
  Trusted orchestration must supply actual extraction results; no authentication is fabricated here.
- Capabilities are a separate exact-vocabulary, immutable, validated input. Self-consistent stored
  SUPPORTED claims fail replay against separately trusted UNAVAILABLE input. Neither claim changes
  strength, classification or risk; neither proves executor correctness/safety.
- MANDATORY > OPTIONAL > UNNECESSARY. Exact contributions deduplicate; distinct reasons survive.
  Strategy order is fixed, reasons and indices canonical. Capability duplicates/conflicts reject;
  there is no last-writer-wins support merge.
- Generic future absence precedence remains BLOCK > INCONCLUSIVE, but current known reasons permit
  only INCONCLUSIVE. Supplying BLOCK in reasons and aggregate handling fails even when consistent.
- All risk uncertainties survive with explicit coverage treatment. Material gaps require review
  and strengthen baseline checks. No material-free GENERAL case exists in current risk rules.
- TEST mixed with DEPENDENCY/CONFIGURATION/API does not weaken baseline. FRONTEND mixed with API or
  authorization is not stylesheet-only. Partial frontend evidence retains material coverage and
  stronger baseline. Path conventions remain bounded upstream evidence, not proof of safe behavior.
- Authentication and authorization stay separate and targeted; API does not imply either. Database,
  dependency and configuration reasons assert neither destructiveness, vulnerabilities nor production
  impact. Static analysis is complementary, not comprehensive security analysis.
- Empty comparisons select no verification and imply no success. HIGH strengthens baseline but does
  not select everything. CRITICAL is understood by the intensity helper but unreachable through
  approved risk replay; no forged CRITICAL acceptance was introduced.
- The syntax-token fingerprint covers applicability, selected strategies, strength, absence/conflict
  semantics, factories and replay dependencies; comments/spacing are ignored. Policy 5.0.0 stored
  results must be recomputed under 5.1.0, never silently relabeled.

## Adversarial coverage

The original provenance-permutation regression failed before the fix and passes after it. Added
coverage attacks stored record/index permutations, explicit optional-failure semantics, capability
substitution and accessors, unknown/duplicate capability states, risk level/evidence/uncertainty
forgery, producer/context mismatches, injected absence BLOCK, modified reasons, missing requirements,
mixed category strengthening and rotations of all built-in rules. Existing real-Git integration,
empty comparisons, earlier phase tests and architecture guards remain required.

## Remaining limitations

Pure replay proves consistency with trusted inputs, not source authenticity or operator authorization.
It cannot establish executor quality, actual availability, runtime exposure, migration safety, test
sufficiency or deployment safety. No signed provenance or execution is added. Bounded path/syntax
classification can miss behavior or over-classify misleading conventions. These are documented
upstream/execution/acquisition limitations, not reasons to weaken requirements.

## Final validation

| Check | Result |
| --- | --- |
| `npm test` | 186 passed, 0 failed/skipped/cancelled; includes all Phase 1–4 regressions and architecture guards |
| `npm run typecheck` | Exit 0 |
| `npm run lint` | Exit 0 |
| `npm run build` | Exit 0 |
| `npm run format:check` | Exit 0 after formatting the new test additions |
| `node dist/cli.js --version` | 0.1.0 |
| `npm audit --audit-level=high` | Exit 0, 0 vulnerabilities after authorized registry access |
| `git diff --check` | Exit 0; Windows line-ending notices only |
| `npm ls --omit=dev --depth=0` | Only typescript@6.0.3 |

The reviewed 5.1.0 policy fingerprint is
`6a1238bdda85b87a15ce2fc7a29e67ffdf26889f455fa3061419da47d4c8e839`.
Earlier classifier/risk fingerprint tests still pass. The corrected Phase 5 is ready to become
the baseline for Phase 6 with the stated trusted-input and bounded-analysis limitations.
Phase 6 has not been started.
