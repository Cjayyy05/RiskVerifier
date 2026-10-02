# Phase 4: deterministic risk assessment

## Scope and contract

Risk means **potential consequence and verification importance**, not probability, defect confidence,
vulnerability proof, or a deployment verdict. The pipeline remains classification → risk → later
policy. LOW is not approval; HIGH is not blocking. There is no policy selection, plan generation,
check execution, AI, or verdict implementation in Phase 4.

`riskverifier/risk` exports `assessRisk(changeSet, classification)`,
`validateRiskAssessment(changeSet, classification, suppliedAssessment)`, `RISK_RULE_SET_VERSION`
(`4.1.0`) and `SUPPORTED_CLASSIFIER_VERSION` (`3.1.0`). It is synchronous and pure, imports only the
domain public contract, and never reads source text, paths on disk, manifests, environment, time,
network or Git. Callers obtain classification through the approved Phase 3 pipeline.

### Intermediate evidence, not invented provenance

The result is an immutable `ChangeRiskAssessment` with `level`, `ruleSetVersion`, a normalized full
`classification`, ordered `evidence: RiskFact[]`, and ordered `uncertainties: RiskUncertainty[]`.
Each risk fact carries rule ID/version, stable machine-readable `reasonCode`, contribution,
observation, categories, classification-fact indices and changed-file indices. Those indices refer
to the **embedded normalized classification**, not the caller's original order. Constructs retain
the Phase 3 side, line and digest through the referenced fact. Breadth rules reference file indices
directly; an empty-change reason has no file reference.

Phase 1 canonical `RiskAssessment` / `RiskEvidence` require canonical `Evidence` with genuine run,
configuration, policy and timestamp context. The two Phase 4 inputs do not supply that context.
Following the approved Phase 3 intermediate-evidence approach, this phase adds domain factories
instead of manufacturing IDs or weakening the canonical contracts. Later orchestration must bind
these results to genuine run evidence; that promotion is not implemented here. The existing
canonical factories now reject accessor-bearing, cyclic, sparse and non-plain DTOs before reading
them. Their generic aggregation semantics are unchanged; the new intermediate factory enforces
this phase's explicit maximum-contribution invariant.

## Rule set 4.1.0

Version 4.1.0 hardens provenance schemas, uncertainty preservation, result validation and fingerprinting
after adversarial review. Category minimums, thresholds, combinations and deletion contributions are
unchanged from 4.0.0. Old intermediate result versions must be recomputed, not silently relabeled.

All matched rules remain visible even when another rule contributes a higher level. Rule IDs are
`risk.` followed by the lower-case reason code; the version is recorded on every contribution.

| Reason / factor | Contribution | Evidence and limits |
|---|---|---|
| `EMPTY_CHANGE` | LOW | Zero changed files; not a statement about the whole repository |
| `CATEGORY_FRONTEND`, `CATEGORY_TEST` | LOW | Narrow classified frontend/test change; not proof of cosmetic-only behavior or harmlessness |
| `CATEGORY_API`, `CATEGORY_DATABASE`, `CATEGORY_DEPENDENCY`, `CATEGORY_CONFIGURATION` | MEDIUM | At least one corresponding classification fact |
| `CATEGORY_GENERAL` | MEDIUM | Nonempty unsupported/unspecified change, not presumed safe |
| `CATEGORY_AUTHENTICATION`, `CATEGORY_AUTHORIZATION` | HIGH | Corresponding supported classification; ordinary edits are not CRITICAL |
| `COMBINED_AUTHORIZATION_API`, `COMBINED_AUTHENTICATION_API` | HIGH | Co-occurring category evidence; does not prove a public endpoint or runtime coupling |
| `COMBINED_DATABASE_API` | HIGH | Database and API changes in one comparison; cross-category verification importance, not proof of destructive exposure |
| `COMBINED_DEPENDENCY_CONFIGURATION` | HIGH | Dependency and configuration co-occurrence, including changes also classified TEST |
| `COMBINED_AUTHENTICATION_AUTHORIZATION` | HIGH | Both security categories; no automatic exceptional-risk claim |
| `FILE_BREADTH` | MEDIUM at 5 files; HIGH at 20 | All changed files, including renames and unknown content |
| `LINE_BREADTH` | MEDIUM at 300 lines; HIGH at 1500 | Known additions plus deletions; unknown binary counts are not estimated |
| `DATABASE_BREADTH` | HIGH at 200 lines | Known additions/deletions across distinct database-classified files; not proof of destructive schema changes |
| `DELETED_{category}_FILE` | HIGH | A BASE fact for AUTHENTICATION, AUTHORIZATION, DATABASE, API or CONFIGURATION on a DELETED file |
| `DELETED_TEST_FILE` | MEDIUM | BASE test classification on a DELETED file; does not infer deleted assertions from line churn |
| `SENSITIVE_CONSTRUCT_BREADTH` | HIGH at 5 observations | Changed semantic locations in AUTHENTICATION, AUTHORIZATION, DATABASE and API evidence, as defined below |

Construct breadth accepts only one-sided facts with a line and digest and a changed content effect.
It deduplicates identical line/digest observations within each side/file/category, then takes the
maximum of BASE and TARGET counts per file/category and sums those maxima. This avoids blindly
double-counting the before/after forms of an edit. Different categories or overlapping syntax nodes
can still describe one runtime behavior: the metric is explicitly a count of semantic location
observations, **not distinct controls**. Path hints, prose changes and duplicate facts cannot inflate
this count. A BASE-only fact in a MODIFIED file is not called a removed security control. Deleted
files may have been replaced elsewhere; deletion rules make that limitation explicit.

Thresholds are deliberate review-importance heuristics, not empirically calibrated probabilities.
File and line breadth use all changes, whereas database breadth uses only classified database files.
Dependency manifest/lockfile details remain in referenced Phase 3 facts; this version does not infer
runtime versus dev impact, package vulnerabilities or supply-chain compromise. Configuration
subsystems not proven by classification likewise receive no invented sensitivity.

## Aggregation and CRITICAL

Final level is the maximum **explicit contribution across category, combination, breadth and
deletion rules**, not whichever rule ran last and not merely the highest category. This monotonic
minimum model is intentionally understandable: e.g. DATABASE + API becomes HIGH although both
individual category minimums are MEDIUM; broad frontend changes can also become HIGH. Redundant
auth/API combination reasons remain as an audit explanation even when the auth minimum is HIGH.

This is not an additive score. API + CONFIGURATION and API + DEPENDENCY intentionally remain MEDIUM
without another matched escalation: no supported semantics justify a special combined consequence
for those pairs yet. API + DATABASE + CONFIGURATION is HIGH because the database/API pair matches;
AUTHENTICATION + FRONTEND is HIGH; FRONTEND + TEST remains LOW below breadth/deletion thresholds.
Several facts describing one event do not sum their levels. The explicit pair table, not the mere
number of category labels, defines which moderate combinations escalate.

The four-level domain vocabulary includes CRITICAL, but **no rule in 4.1.0 emits it**. Phase 3 does
not establish public exposure, destructive migration behavior, actual security-control removal,
or cross-boundary consequences strongly enough to justify exceptional risk. Broad auth changes
remain HIGH. Earlier planning-document CRITICAL examples are illustrative future directions, not
the implemented Phase 4 rules. Future CRITICAL rules require stronger input semantics and a rule
version/fingerprint update, not fabricated test cases.

## Uncertainty

Every assessment includes `BOUNDED_CLASSIFIER_COVERAGE`: supported syntax/path rules are not a
complete program analysis, even when no specific limitation was reported. Explicit Phase 3
limitations are retained in full and referenced by `CLASSIFICATION_LIMITATIONS`. Binary metadata
adds `UNKNOWN_LINE_COUNTS`. Nonempty GENERAL adds `UNSPECIFIED_CHANGE`.

Uncertainty is independent from level: a TEST classification with skipped/unsupported semantics can
remain LOW with prominent limitations, and GENERAL has a MEDIUM review floor but no certainty of
safety. Missing semantics are neither guessed nor automatically inflated to HIGH/CRITICAL. Future
policy must consume these uncertainty records, not just the level. Zero files still means only an
empty comparison, not repository-wide assurance.

## Validation and determinism

Factories rebuild nested domain values and deep-freeze new output. Input binding compares repository,
base/target commits, analyzer version, every changed-file field and analysis evidence IDs. Contradictory
aggregates or category summaries are rejected, not silently trusted. Files must have unique destination
paths, with a maximum of 4096. Unknown classifier versions or mixed fact versions are rejected.
The compatibility schema also checks analyzer 2.1.0, Phase 3 inspection-policy caps, known
rule/category pairings and producer evidence shape. Syntax facts require a side, line and digest;
JSON API, manifest, path and fallback facts have their own shapes. Equal base/target commits cannot
claim changed files. These checks validate declared provenance without rescanning paths or source.

Intermediate risk factories enforce known rule IDs/reason codes, current rule version, allowed
contributions/categories, exact source-file references, and no duplicate reason records. Required
uncertainty records/codes and their exact indices must survive reconstruction, even with no explicit
classifier limitation. Risk reasons and uncertainty records are sorted at the public factory boundary.

The risk DTO walk rejects accessors without executing getters, non-plain objects, symbols, cycles,
sparse arrays, nonfinite numbers and excessive graphs (600,000 nodes, depth 20, array length 32,768).
The existing stricter classification bounds also apply. Canonical run-risk factories allow depth 80
to preserve the existing Evidence fact depth allowance. These are already-materialized DTO bounds,
not a transport byte budget or a hostile-JavaScript sandbox; Proxy traps are not sandboxed.

Factories validate shape, references and invariants, not truth or authenticity. A fabricated but
internally consistent category/fact can still be supplied by an untrusted caller. There is no signed
provenance, persistence or transport trust boundary yet. Production orchestration must invoke the
approved classifier directly or establish a trusted provenance boundary. A structurally valid stored
assessment is not proof that all applicable rules were evaluated. Domain factories validate contracts,
not full rule applicability/completeness. At an intake boundary use `validateRiskAssessment` with a
separately trusted ChangeSet and classification: it replays the single risk evaluator and rejects
missing/extra rules, incorrect contributions/wording, or substituted context. It accepts reordered
risk reasons/uncertainties, but expects the embedded canonical classification emitted by `assessRisk`.
Passing attacker-controlled replacements as both trusted inputs and the supplied result is not
authentication; provenance still requires trusted extraction or a later authenticated boundary.

Canonicalization sorts file paths with locale-independent JavaScript string comparison, remaps fact
and limitation indices, normalizes category ordering, sorts/deduplicates exact facts and limitations,
and treats analysis evidence IDs as a set. Rules then produce reasons sorted by code and numeric
reference indices sorted ascending. Equivalent reordered inputs produce identical JSON output;
no clock, random value or mutable working-tree state enters risk. Paths are opaque labels used for
identity/order only, never keywords. The assessment factory preserves an already-computed result's
source order so its evidence indices remain valid; canonicalization belongs at `assessRisk` input.

The version is independent of package/CLI version `0.1.0`. A SHA-256 source-fingerprint test pins
rule set `4.1.0` across the risk entry points, domain exports, rule metadata, classification compatibility
schema, risk factories, ordinal enums and shared classification/change/validation/identity helpers.
TypeScript 6.0.3 parses and prints source, then syntax tokens are hashed: comments, formatting and
line endings are ignored, while operators, literals, template text and automatic-semicolon-insertion
semantics remain distinguishable. Mutation tests prove ordinal and threshold changes alter the digest.
Rule or evidence-semantic changes require explicit version/fingerprint review. The existing Phase 3
fingerprint remains unchanged and separately binds its rules, parser and extraction implementation.

## Examples and verification

A committed one-line CSS color change produces FRONTEND → LOW plus coverage uncertainty. A narrow
API modification produces MEDIUM. A known authz guard and API route change produces HIGH with both
category reasons and a combination reason. Database-classified files with 200 changed lines produce
HIGH without claiming a destructive operation. A filename containing `authorization` without supported
semantics stays GENERAL → MEDIUM, retaining the classifier's limitation.

Tests cover all category minimums, combinations, exact breadth thresholds, semantic deduplication,
deleted files versus modified BASE-only constructs, uncertainty, input/context forgery, output-reference
forgery, getters/sparse/cyclic data, immutability, reorder equivalence, real Git/classifier integration,
and architectural separation. Existing Phases 1–3 regression tests remain mandatory.

No new dependency, CLI assessment command, repository execution, Phase 5 behavior, deployment decision,
or external service is introduced.

## Breadth limits and review outcome

File breadth is changed-artifact scope, not unique runtime blast radius. The inputs have no trusted
generated-file marker or logical-change grouping, so generated files are counted like other changed
files; risk does not guess exclusions from names. One Git rename record counts once, not once per
side. Git may represent a move as add/delete, in which case the recorded two artifacts remain two;
normalizing them would require stronger upstream evidence. Minified identical same-line constructs
can collapse to one line/digest observation because Phase 3 has no column/span identity. These are
explicit measurement limits, not severity claims. Calibration remains deferred to corpus evaluation.

Adversarial review found no risk-to-verdict conversion, hidden probability calculation, filename
reclassification, or automatic CRITICAL escalation. Confirmed provenance, uncertainty and validation
gaps were corrected in 4.1.0; detailed findings are in [the review report](PHASE4_REVIEW.md).
