# Phase 4 adversarial review

Reviewed rule set: 4.0.0. Corrected baseline candidate: 4.1.0. Classification remains 3.1.0,
Git analyzer remains 2.1.0, package/CLI remains 0.1.0. Findings were reported before code changes.

## Findings, ordered by severity

### Critical / High

None confirmed in the current execution path. There is no deployed transport/persistence boundary,
and no result here authorizes deployment. The validation gaps below matter before future consumers
rely on accepted intermediate records.

### Medium: invented classification provenance accepted

**Location:** `src/risk/assessor.ts` input version check and `src/domain/risk-facts.ts` `createRiskInput`.

**Problem/reproduction:** A Phase-3-shaped AUTHORIZATION fact with `ruleId: "invented.rule"`, no
source line and no construct digest was accepted and assessed HIGH. Version equality alone did not
establish that the claimed producer could emit this category/evidence shape.

**Scenario:** A malformed adapter or hand-constructed record labels a path hint AUTHORIZATION, and
the risk result presents it as supported structural evidence. Conversely, relabeling a semantic fact
as TEST can suppress its intended importance if provenance/category compatibility is unchecked.

**Fix:** Validate the approved 3.1.0 rule-ID/category/shape vocabulary, analyzer version, inspection
caps and equal-commit invariant in the Phase 4 input boundary. Syntax evidence requires a line/digest;
JSON API, dependency, path and fallback evidence retain their approved distinct shapes. This checks
metadata, not paths, source or runtime semantics. It is not producer authentication.

### Medium: arbitrary risk facts could replace computed evidence

**Location:** `src/domain/risk-facts.ts` `buildRiskFact` / `createChangeRiskAssessment`.

**Problem/reproduction:** Replacing a HIGH assessment's evidence with an invented LOW reason having
empty categories, fact indices and file indices, and setting `level: LOW`, passed the public factory.
The maximum-contribution check alone could not establish applicability or even known provenance.

**Scenario:** A consumer reconstructs a cached/hand-edited record through the factory and mistakes
structural acceptance for having evaluated all risk rules. Omitting a database/API combination could
likewise lower a result while retaining otherwise well-formed individual category facts.

**Fix:** Enforce known risk IDs/reasons, allowed category/contribution metadata, current version,
applicable nonempty provenance, exact source-file references, no duplicate rule records, and stable
reason ordering. Add `validateRiskAssessment` to replay the single evaluator against separately trusted
inputs and reject missing/extra rules, fabricated wording/contributions or source-context substitution.
Do not duplicate the full evaluator inside domain factories. Generic Phase 1 canonical run-evidence
contracts remain distinct from the version-specific intermediate evaluation contract.

### Medium: uncertainty could disappear on reconstruction

**Location:** `src/domain/risk-facts.ts` `createChangeRiskAssessment` uncertainty validation.

**Problem/reproduction:** An assessment with no explicit classification limitations accepted
`uncertainties: []`, dropping `BOUNDED_CLASSIFIER_COVERAGE`. The factory only checked coverage of
existing limitation indices, so other required flags/codes were not protected.

**Scenario:** A stored LOW or GENERAL assessment is rehydrated without coverage/unknown-line warnings,
leaving a future policy consumer to assume fuller understanding than the classifier established.

**Fix:** Derive the exact required uncertainty record set through one shared helper and enforce it
at the factory boundary, including codes, limitation indices and affected files. Reject deletion,
renaming, duplication or rebinding of these records. Keep uncertainty independent from ordinal level.

### Low: incomplete and formatting-sensitive fingerprint coverage

**Location:** `test/risk/rule-set-version.test.ts` source list and raw-text hashing.

**Problem:** Imported `RISK_LEVELS` and other decision-relevant validation contracts were outside the
two-file hash. Editing them could change behavior without changing the risk fingerprint; comments
and whitespace inside the hashed files unnecessarily changed it.

**Scenario:** A shared enum/validation edit changes assessment behavior under the same risk identity,
or repeated formatting-only failures encourage mechanically updating the fingerprint.

**Fix:** Cover risk entry points, domain exports/metadata/schemas and relevant shared contracts.
Hash parsed/printed syntax tokens with pinned TypeScript 6.0.3. Tests verify comments/spacing do not
matter but thresholds, ordinal ordering, operators, literals, template text and ASI semantics do.

## Conclusions on challenged model choices

- Aggregation remains maximum explicit contribution, not addition of category scores. Named
  DATABASE+API and DEPENDENCY+CONFIGURATION combinations elevate individually moderate signals;
  auth/API and authn/authz pairs provide explicit co-occurrence evidence. Unlisted moderate pairs
  remain MEDIUM unless breadth or deletion rules apply. Three labels alone do not imply HIGH.
- Repeated category/deletion/breadth descriptions of one event do not numerically add risk. Exact
  classification duplicates are normalized; semantic breadth deduplicates side/file/category/line/digest
  observations. Different descriptions at one location cannot inflate that count.
- Narrow FRONTEND/TEST or empty comparisons can be LOW, never safe/verified/approved. Mixed API,
  configuration, dependency or auth evidence still contributes its independent minimum.
- GENERAL remains MEDIUM plus structured uncertainty; explicit Phase 3 limitation codes are retained.
  The current classifier cannot reliably identify a fully understood harmless GENERAL subset.
- Authn/authz remain HIGH, including ordinary structural additions, edits and deletions. Deletion
  wording does not claim that a live security control was removed. Database breadth is not data-loss
  evidence; API classification is not public internet exposure; dependency classification is not
  a vulnerability scan; configuration classification does not prove production use.
- CRITICAL is intentionally not emitted. Stronger verified control-removal, destructive-data or
  cross-boundary exposure evidence could support future reviewed rules, but current facts cannot.
- Generated artifacts are not identified upstream, so file breadth counts recorded artifacts without
  guessing from names. A rename counts once; add/delete moves remain two Git records. Same-line
  identical semantic occurrences lack distinct column/span identities. These limitations are now
  explicit and remain appropriate upstream/corpus work, not hidden Phase 4 semantic inference.
- Production search found verdict enums/contracts only in approved domain types, not risk-to-verdict
  evaluation. Architecture tests keep risk pure and later implementation directories empty.

## Regression coverage

New attacks cover unknown/mismatched classifier rule provenance, missing semantic locations, invalid
versions/budgets/equal-commit records, unknown/unreferenced risk evidence, result-order normalization,
duplicate reasons, loss/rebinding of every uncertainty code, replay of partial/mutated/substituted
results, mixed-category matrices, threshold minus/at/plus one, duplicate underlying observations and
rename records. Real committed fixtures cover auth additions/modifications/deletions, dependency
addition/version changes, a package named `security`, lockfile-only and broad lockfile changes,
dependency+configuration and an exact equal-commit empty comparison. Earlier integration tests retain
cosmetic CSS, unsupported keywords, supported authz/API evidence and dirty-worktree independence.

## Remaining trust boundary

Schema validation does not authenticate source facts. Replay establishes consistency with its trusted
inputs, not truth if those inputs themselves are attacker-controlled. Consumers must use the approved
Git/classifier extraction path or a future authenticated provenance mechanism. No transport, persistence,
policy engine, plan generation, execution, verdict evaluator or AI was introduced. No commit/push.

## Final validation (2026-10-01)

| Check | Result |
|---|---|
| `npm test` | 158 passed; 0 failed, skipped or cancelled; includes approved Phase 1–3 tests and architecture guards |
| `npm run typecheck` | Exit 0 |
| `npm run lint` | Exit 0 |
| `npm run build` | Exit 0 |
| `npm run format:check` | Exit 0; all matched files formatted |
| `node dist/cli.js --version` | `0.1.0` |
| `npm audit --audit-level=high` | Exit 0; 0 vulnerabilities after authorized registry access |
| `git diff --check` | Exit 0; only Windows line-ending notices |
| `npm ls --omit=dev` | Only `typescript@6.0.3` |
| Built package export smoke check | Risk version `4.1.0`; replay validator exported as a function |

The 4.1.0 implementation is ready to become the Phase 4 baseline for subsequent Phase 5 work,
with the documented bounded-analysis and provenance limitations. Phase 5 was not started.
