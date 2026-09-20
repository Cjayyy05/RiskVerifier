# RiskVerifier Product Specification

## 1. Purpose

RiskVerifier is a standalone system that evaluates a software change before deployment and produces an explainable, evidence-backed verification verdict.

Its core flow is:

```text
repository + base commit + target commit
  -> change analysis
  -> deterministic classification
  -> deterministic risk assessment
  -> deterministic verification policy
  -> verification plan
  -> approved check execution
  -> evidence collection
  -> verdict
```

RiskVerifier separates **risk** from **verdict**. Risk describes the potential impact of a change and determines how much verification is required. A verdict describes what the collected verification evidence supports. A critical-risk change can be approved after sufficient successful verification, while a low-risk change can be blocked by a failed mandatory check.

## 2. Problem statement

Conventional deployment pipelines commonly run the same build and test suite for every change. That approach is simple, but it may under-test sensitive changes, over-test routine changes, and provide weak explanations for why a deployment was allowed or stopped.

RiskVerifier addresses this by selecting verification based on the actual change. It must make every classification, risk decision, plan decision, check result, and final verdict traceable to evidence. Unknown, unsupported, incomplete, or failed execution must never silently become approval.

## 3. Intended users

- Software engineers seeking pre-deployment feedback about a proposed change.
- Reviewers and release engineers who need to understand why a check was required and what it found.
- Platform and security engineers who define trusted verification policy and configuration.
- CI/CD systems that need a stable machine-readable verification result.
- DeployFlow, in a future phase, as an external consumer of completed RiskVerifier results.

## 4. Goals

The product will:

- Analyze the Git diff between an explicit base commit and target commit.
- Represent additions, modifications, deletions, renames, and relevant metadata as a `ChangeSet`.
- Assign one or more deterministic change categories with supporting evidence.
- Assign a deterministic `RiskLevel` with supporting evidence.
- Apply a versioned `VerificationPolicy` to decide which strategies are mandatory, optional, unsupported, or unnecessary.
- Create an immutable, explainable `VerificationPlan` before executing checks.
- Execute only commands authorized by trusted RiskVerifier configuration.
- Collect bounded, structured evidence from analysis and execution.
- Produce one of `APPROVE`, `BLOCK`, or `INCONCLUSIVE` according to explicit rules.
- Retain enough input, policy, configuration, and evidence identity to reproduce and audit a decision.
- Provide a stable integration boundary for future consumers without coupling the domain model to HTTP or DeployFlow.

## 5. Non-goals

The MVP will not:

- Modify or integrate with DeployFlow.
- Support Python, Java, Go, Rust, Maven, Gradle, Yarn, pnpm, or arbitrary language ecosystems.
- Use an LLM, generative AI, or probabilistic classification.
- Execute commands copied from repository README files, comments, documentation, AI output, or package scripts merely because the repository declares them.
- Automatically run `npm install` or `npm ci`.
- Claim protection from intentionally malicious repositories attempting kernel, container, Docker, hypervisor, verifier-runtime, or hardware exploits.
- Provide a general-purpose CI system, arbitrary workflow language, or remote code-execution service.
- Act as a generic vulnerability scanner or claim comprehensive vulnerability detection.
- Provide production-grade multi-tenant isolation, authorization, or service guarantees.
- Begin as microservices or optimize for distributed scale.
- Guarantee that deterministic rules identify every semantic defect.

## 6. MVP scope

### 6.1 Supported repositories

The MVP supports repositories that are all of the following:

- Git repositories;
- Node.js applications or libraries;
- primarily TypeScript;
- npm-based, using npm as the supported package manager; and
- available to RiskVerifier through a trusted repository acquisition mechanism.

Architecture may expose narrow adapter boundaries for future ecosystems, but v1 will contain only concrete Node.js/TypeScript/npm behavior. Unsupported ecosystems must be reported as unsupported evidence and lead to `INCONCLUSIVE` or `BLOCK` as policy requires.

### 6.2 Supported change categories

A change can have multiple categories:

- `AUTHENTICATION`
- `AUTHORIZATION`
- `DATABASE`
- `API`
- `DEPENDENCY`
- `CONFIGURATION`
- `FRONTEND`
- `TEST`
- `GENERAL`

For example, a change to a database-backed API handler may be both `API` and `DATABASE`.

### 6.3 Planned verification strategies

- `BUILD`
- `EXISTING_TESTS`
- `STATIC_ANALYSIS`
- `AUTHENTICATION_VERIFICATION`
- `AUTHORIZATION_VERIFICATION`
- `API_CONTRACT_VERIFICATION`
- `DATABASE_MIGRATION_VERIFICATION`
- `DEPENDENCY_VERIFICATION`
- `CONFIGURATION_VERIFICATION`
- `FRONTEND_BEHAVIOR_VERIFICATION`

The strategy vocabulary is broader than the first executable subset. A known but unavailable strategy is explicitly `UNSUPPORTED`; it is never treated as passing.

## 7. Inputs

A verification request ultimately contains:

- a repository identity from a trusted acquisition source;
- an exact base commit SHA;
- an exact target commit SHA;
- a `PolicyVersion` or a server-selected active policy recorded on the run;
- a `ConfigurationVersion` or cryptographic configuration hash;
- optional caller metadata that does not affect decisions unless explicitly modeled; and
- a future idempotency key or sufficient canonical inputs to derive one.

Branch names and moving tags are not durable decision inputs. If accepted at an outer boundary for usability, they must be resolved once to immutable commit SHAs and the resolved SHAs recorded before analysis.

Repository content is untrusted input. It may inform classification, but it may not authorize execution.

## 8. Outputs

The primary output is a `VerificationRun` containing:

- immutable repository, base SHA, and target SHA identity;
- lifecycle status and timestamps;
- `ChangeSet` and change-analysis evidence;
- categories and `ClassificationEvidence`;
- `RiskAssessment`, `RiskLevel`, and `RiskEvidence`;
- applied policy and configuration identities;
- `VerificationPlan` with the policy disposition and rationale for every considered strategy;
- zero or more `CheckResult` records;
- bounded evidence references, hashes, and provenance;
- final `VerificationVerdict`: `APPROVE`, `BLOCK`, or `INCONCLUSIVE`; and
- ordered `VerdictReason` values explaining the outcome.

Outputs must be available in a stable, serializable form suitable for persistence and a future REST API. Human-readable summaries are derived views, not the canonical record.

## 9. Example workflows

### 9.1 Authorization middleware change

1. The Git analyzer records modifications to authorization middleware.
2. Deterministic rules classify the change as `AUTHORIZATION`, with file-path and changed-symbol/line evidence.
3. Risk rules assign `CRITICAL` because the change affects an access-control enforcement point.
4. Policy requires build, static analysis, existing tests, and authorization verification.
5. Planning resolves each requirement to a supported, trusted check or marks it unsupported.
6. The executor runs only the approved command specifications under resource limits.
7. The verdict engine approves only if every mandatory requirement has sufficient passing evidence. A failed mandatory authorization check blocks. An unavailable mandatory verifier is inconclusive unless policy explicitly makes its absence blocking.

### 9.2 Routine frontend copy change

1. The change is classified as `FRONTEND` and assessed as `LOW` risk.
2. Policy may require a build and make frontend behavior verification optional.
3. A successful mandatory build can support approval even when the optional check is not selected, provided no blocking or unresolved mandatory evidence exists.

### 9.3 Unsupported repository or tooling

1. Analysis determines that the repository uses an unsupported package manager or required tool is unavailable.
2. The condition is recorded as evidence, never converted to `PASS`.
3. The outcome is `INCONCLUSIVE` by default, or `BLOCK` if the active policy explicitly treats that unsupported condition as a deployment prohibition.

### 9.4 Verification failure

1. A mandatory check executes and produces a valid failing result.
2. The evidence includes the exit status, bounded output metadata, check identity, and execution context.
3. The verdict is `BLOCK`, regardless of whether the assessed risk was low.

## 10. Success criteria

The MVP is successful when it can demonstrate, on a defined fixture dataset, that:

- identical canonical inputs and versions produce the same classification, risk assessment, and plan;
- every material decision can be traced to structured evidence and a rule identifier;
- every mandatory check is accounted for as passed, failed, errored, timed out, cancelled, skipped, or unsupported;
- no error, timeout, missing tool, unsupported strategy, or unclassified required behavior can produce `APPROVE`;
- execution accepts only trusted, structured command specifications without shell interpolation;
- output limits, timeouts, working-directory controls, and environment restrictions are enforced;
- the three verdicts are mutually exclusive and determined by documented precedence;
- policy and configuration identity are frozen when a run is accepted and retained on completed, failed, and cancelled records; and
- evaluation can compare risk-adaptive verification with a conventional baseline using repeatable metrics.

Quantitative targets for classification accuracy, regression detection, false positives, false negatives, inconclusive rate, and execution cost will be set after the initial fixture corpus is calibrated rather than invented before data exists.

## 11. Future DeployFlow integration

DeployFlow remains outside the RiskVerifier codebase and is not changed during initial phases. The future integration boundary is a versioned REST API or equivalent stable service contract:

- DeployFlow submits repository identity, immutable commit SHAs, and an idempotency key.
- RiskVerifier returns a run identifier promptly and processes verification asynchronously.
- DeployFlow polls or receives a future authenticated callback/event for terminal status.
- DeployFlow consumes the canonical verdict and reason codes, not internal module types or database tables.
- A verdict is valid only for its recorded repository and target commit. DeployFlow must bind the candidate deployment artifact to that exact verified target through trusted build provenance or an artifact digest/attestation; a mismatch, unproven rebuild, or different target requires a new verification decision.
- RiskVerifier owns verification semantics; DeployFlow owns its deployment decision and may apply additional organizational policy.
- Contract evolution uses explicit versioning and backward-compatibility rules.

No RiskVerifier domain module may import DeployFlow code or concepts. Integration-specific authentication, tenancy, retry, and availability requirements will be validated in Phase 14.

## 12. Product assumptions requiring validation

- A reviewed combination of paths, diff content, manifests/lockfiles, imports, and TypeScript syntax facts may be sufficient for useful initial deterministic classification; filenames alone are not sufficient for sensitive categories.
- Organizations can provide trusted verification configuration independently of repository-controlled content.
- Required npm dependencies can be made available without automatic installation during early execution phases.
- `INCONCLUSIVE` is operationally acceptable when RiskVerifier cannot establish sufficient evidence.
- Trusted build provenance can bind the verified target commit to the artifact that will actually be deployed; this must be validated during DeployFlow integration.
- A modular monolith can meet expected throughput and isolation needs for the initial deployment.
