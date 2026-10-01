# Phase 3: deterministic classification

Classification describes a change. It is neither risk nor a deployment verdict. Phase 4 is not
implemented. Public entry point: `riskverifier/classification`, `classifyChangeSet(changeSet,
gitContext, options?)`.

## Pipeline and context

The read-only Git content adapter reconstructs the input with existing factories, checks logical
repository/base/target identity equality, and re-runs the approved Phase 2 analyzer to verify every
changed-file fact and analyzer version. Equivalent input file order is canonicalized by UTF-8 path
bytes. Evidence is indexed into that canonical ChangeSet. The caller remains responsible for
binding the logical repository identity to its authorized local path; a clone with identical
objects is equivalent. This is not repository authorization.

The adapter uses the existing isolated Git object view and bounded process runner. Literal
`ls-tree` lookups obtain base/target object identities; raw `cat-file` reads fetch selected blobs.
No checkout, working-tree content read, application execution, scripts, dependency installation,
network, textconv, filters, hooks, or repository configuration evaluation occurs. As in Phase 2,
the source physical object database must remain stable during an invocation.

Pure path, manifest-delta, and TypeScript syntax rules produce intermediate facts. The classifier
combines all matches; no rule suppresses another or assigns importance. The domain factory freezes
the result and checks evidence/category/file-index invariants. Categories use the domain enum's
fixed descriptive order, facts/limitations use explicit lexical tuple order. No timestamp, random
ID, locale, current branch, or working-tree contents affects results.

## Intermediate evidence clarification

The approved baseline contained `ClassificationEvidence` requiring a complete canonical `Evidence`
with run, policy, configuration, and time context; it did **not** contain the intermediate model
referenced in the Phase 3 brief. Existing contracts remain unchanged. The additive
`ChangeClassification` factory supplies the missing intermediate boundary, without fabricated
Evidence IDs or run context. Later orchestration must attach genuine run context through the
existing canonical Evidence factory, not cast these facts into canonical Evidence.

A result contains the factual ChangeSet, classifier/rule-set version, effective inspection limits,
categories, facts, and explicit limitations. A fact records category, rule identity/version, file
index, base/target/both side, blob content effect, signal, explanatory observation, and optional
one-based source line and normalized-construct SHA-256 digest for semantic facts. The file index preserves exact path, previous path, status, and line counts.
No raw source excerpts, credential literals, dependency version values, or environment contents
are returned. Paths themselves remain untrusted repository data, not safe log text.

## Supported evidence

| Category | Current rules |
| --- | --- |
| AUTHENTICATION | Changes to calls bound to ES imports from jsonwebtoken (`verify`, `sign`), jose (`jwtVerify`), passport (`authenticate`), argon2 (`verify`, `hash`), bcrypt/bcryptjs (`compare`, `hash`). These indicate credential/token syntax, not verified identity security. |
| AUTHORIZATION | Changes to an `if` condition referencing a function parameter's `user.role`, `user.roles`, or `user.permissions`, paired with a same-function parameter receiver's `status(401/403/404)` call, or an import-bound Nest ForbiddenException/UnauthorizedException thrown or passed to a callback parameter. Nested unused callback bodies cannot supply denial evidence. |
| DATABASE | SQL files beneath a `migrations` segment; Prisma schema files beneath a `prisma` segment. Path evidence, not SQL/schema validation. |
| API | Changed literal/static-template HTTP registration on a stable imported Express/Router/Fastify receiver, simple receiver aliases (up to eight propagation passes), one `.route(path).method(handler)` chain; exported HTTP-method function in Next `app/**/route` modules; changed structural OpenAPI/Swagger endpoint maps. |
| DEPENDENCY | Exact changes in dependencies/devDependencies/peerDependencies/optionalDependencies, summarized as entry additions/removals/version changes; recognized npm/yarn/pnpm lockfile paths. Lockfile semantics are not validated. |
| CONFIGURATION | tsconfig JSON, supported vite/next/webpack/rollup/eslint config names, .env variants, .npmrc/.nvmrc, and root .github/workflows YAML paths. |
| FRONTEND | Stylesheet extensions css/scss/sass/less, or actual JSX syntax in JSX/TSX files. |
| TEST | Source files in test/tests/spec/__tests__ directories, .test/.spec source names, vitest/jest/playwright/cypress config names; explicit fixtures/__fixtures__ directories. |
| GENERAL | Whole-change fallback only when no specific rule matches, including an empty diff. Never implies safe or complete. |

## Changed-construct comparison (3.1.0)

Both sides are parsed as data, then normalized construct fingerprints are compared as multisets.
Only unmatched base/target constructs produce semantic facts; duplicate occurrences are counted,
not collapsed to the first match. Comments, formatting and line shifts do not alter fingerprints.
Calls include their own syntax/import binding and enclosing `if`/conditional expressions.
Authorization fingerprints include the role/permission condition and denial constructs/branch,
not unrelated logging statements in the same function or denial branch. API calls include their
handler argument syntax; Next function rules include the exported handler body. JSX retains UI
text; OpenAPI fingerprints canonicalize version/paths, not object insertion order.

Added/deleted files compare against an empty side. Unchanged content in a pure rename emits no
sensitive semantic category. Old/new path conventions can still emit path evidence, and movement
into a supported Next route convention can establish API context. Blob effect and file status
remain explicit. Copies compare against their recorded source; identical copied security syntax
is not newly classified, an intentional limitation. If either required side is malformed, missing,
binary, unsupported or over budget, no one-sided semantic delta is invented: a comparison limitation
is recorded. Independently sufficient path facts may remain.

This is **structural change detection**, not behavioral equivalence or changed-line dataflow.
Changes to a referenced variable/helper outside a matched construct may be missed. Moving an
identical construct between ordinary functions may cancel out. Changes to surrounding loop or
other control flow are not comprehensively modeled. A changed API handler can include incidental
logging and still be API-classified. Path-based SQL/Prisma/config/style/test/lockfile rules describe
the changed artifact convention, including comments-only changes; they do not claim changed schema
behavior or validate the artifact.

## False positives and unsupported semantics

Sensitive/API rules require AST structures, not names, comments, or string examples. Import aliases
are recognized; repeated declarations or assignments conservatively suppress import-bound rules.
This is not full lexical binding, dataflow, type analysis, or authorization logic verification.
CommonJS, re-exports, wrapped/indirect security calls, custom middleware, boolean RBAC helpers,
imported custom permission predicates, session/cookie assignments, custom decorators, many framework
controller conventions, YAML API specifications, arbitrary ORM models, and dynamic routes are unsupported.
An API-looking directory or authentication-looking filename alone is insufficient.

Path conventions can mislabel intentionally misleading filenames. Syntactically valid code can
contain dead/unreachable or deceptive operations. Known imports are not proof of the resolved
package's runtime identity. Role checks may be illustrative or irrelevant to the changed behavior.
Explicit fixtures/__fixtures__ paths suppress production security/API/database/config/dependency
interpretation and record a limitation; JSX/style plus TEST remains possible. This convention can
hide actual production code deliberately placed in a fixture directory and is not a trust grant.
Other test files can legitimately contain changed authentication/authorization constructs.
JSON duplicate keys, including escaped-equivalent names, are rejected at every object level.
OpenAPI detection requires a supported 3.0/3.1 version or Swagger 2.0, string info title/version,
paths/operation objects, and a responses map with a recognizable response key. This is recognized
structural evidence, **not full OpenAPI validation**. These limits require later corpus
evaluation. Do not infer absence of security-sensitive changes from no match.

## Bounds and errors

Trusted defaults: 256 KiB per blob, 2 MiB total fetched content, 256 files with tree inspection.
Caller overrides are capped at 1 MiB, 8 MiB, and 1024 files respectively; zero disables that budget.
The total counts both sides, including identical blobs, in canonical path/base-before-target order.
Files after the count limit retain path facts and unknown content effect. More than 4096 changed
files rejects the invocation explicitly to bound result expansion. All effective budgets are
recorded in provenance. Repository configuration cannot increase them.

Size is checked before content fetch. Binary Git changes are never decoded; NUL-containing blobs
are also treated as binary. UTF-8 decoding is fatal on malformed bytes and preserves BOM. Symlinks
and gitlinks are not read as source. Environment-file contents are never requested, even from
commits. Unsupported extensions are not fetched. Syntax inspection is limited to 50,000 tokens /
AST nodes and depth 128, at most 512 syntax matches per side, and a hard 1 MiB string ceiling;
parser stack-limit errors become explicit limitations. JSON inspection has the same byte/node/depth
ceilings. The result factory bounds plain-data graphs to depth 16, 250,000 values and 32,768 entries
per array; excessive result expansion rejects explicitly. It rejects accessors, cycles, sparse
arrays and side/effect/status contradictions before freezing a copied result. Validation is not
evidence authenticity; callers still need the trusted extraction boundary.

TypeScript is used only for `createScanner`, `createSourceFile`, `parseJsonText`, AST traversal and
syntax predicates. There is **no Program, compiler host, type checker, module resolver, plugin,
transform, transpilation or emission**. Syntax diagnostics use a narrowly isolated, runtime-checked
`parseDiagnostics` property on parser-created SourceFiles: this is not declared in the public
TypeScript interface, so the exact pinned version and contract regression test are required.
If the contract disappears, classification fails explicitly; no project-tool fallback exists.
The conservative pre-parser token bound can reject some valid complex sources. Parsing is in-process,
with bounded input/work but no independently enforceable CPU timeout; parser-runtime vulnerabilities
and hostile concurrent object-store mutation remain outside this phase's isolation guarantee.

Limits, malformed source/manifest, invalid UTF-8, binary/type skips, missing supported rules, and
unavailable dependency comparisons are visible limitations. Weaker path evidence may survive.
Git failure, timeout, cancellation, corrupt objects, or inconsistent context reject instead of
returning a confident fallback. No automatic retry changes the evidence budget or trust boundary.

## Dependency and reproducibility

TypeScript 6.0.3 moves from a development-only to a pinned runtime dependency so production-only
installs can parse source. Node has no built-in TypeScript/JSX structural parser; regular expressions
would mistake comments/strings and ambiguous identifiers for executable constructs. No new package
version is introduced. TypeScript is Apache-2.0 licensed (as recorded in the lockfile). This adds a sizeable trusted parser supply-chain/resource surface, bounded
by byte/token/node limits and guarded by tests. No TypeScript project configuration is loaded.

Reproduction requires exact commit objects and repository identity, the Phase 2 analyzer/Git
behavior, classifier version 3.1.0 (also each rule's version), TypeScript 6.0.3, and effective limits.
A regression gate pins the normalized source fingerprint for each reviewed rule-set version,
including syntax, rules, classifier, intermediate domain validation and content extraction policy.
Future source/parser changes must receive an explicit version/fingerprint review. Infrastructure failures are errors,
not reproducible successful classifications.

## Calibration and readiness

The original 14-case calibration table remains. Dedicated adversarial suites now cover misleading
names, malformed/duplicate JSON, realistic supported denial forms, explicit unsupported patterns,
and exact-commit construct changes. Real-Git tests include unrelated logging, pure renames, partial
counterparts, staged/untracked/branch isolation, dirty project configuration, and context mismatches.
Passing these development fixtures is not held-out precision/recall or a production accuracy claim.
Broader measurement remains in the approved evaluation phases. Phase 3 remains a bounded structural
classifier; absence of a category cannot establish absence of security-sensitive changes.
