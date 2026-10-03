# RiskVerifier Architecture

## 1. Architectural style

RiskVerifier begins as a TypeScript/Node.js modular monolith. Modules have explicit responsibilities and communicate through typed domain values and narrow ports. Domain decisions do not depend on HTTP, a database library, Docker, or a particular local process runner.

The design favors deterministic, inspectable behavior over framework magic. It creates seams for persistence, execution isolation, and future ecosystem adapters only where the MVP already needs a boundary; it does not create generic plugin systems for unsupported languages.

## 2. System context

```text
Caller / future DeployFlow
          |
     future API
          |
     jobs orchestrator
          |
  analysis decision pipeline
          |
   execution port ---- trusted execution backend
          |
 persistence ports --- persistence adapter
```

The repository is an untrusted input to analysis and execution. Trusted RiskVerifier configuration is a separate input controlled by the verifier operator.

## 3. Modules and responsibilities

| Module | Responsibility | Must not own |
|---|---|---|
| `domain` | Domain values, invariants, state types, identifiers, decision/evidence contracts | HTTP, Git processes, database mapping, container APIs |
| `git` | Resolve validated commits, compute bounded diffs, normalize changed files, produce `ChangeSet` | Classification, risk, or verdict decisions |
| `classification` | Apply versioned deterministic rules and emit categories plus intermediate `ChangeClassification` facts; later orchestration supplies genuine run context for canonical `ClassificationEvidence` (see [Phase 3 clarification](CLASSIFICATION.md)) | Risk scores or command execution |
| `risk` | Apply deterministic risk rules to the change/classification and emit intermediate `ChangeRiskAssessment`; later orchestration supplies genuine run context for canonical `RiskAssessment` / `RiskEvidence` (see [Phase 4 clarification](RISK.md)) | Verification selection or verdicts |
| `policy` | Map change, classification, and risk to strategy dispositions and policy rationale | Concrete command construction or execution |
| `planning` | Convert policy requirements into an immutable `VerificationPlan`, resolving supported checks from trusted configuration | Running checks or hiding unsupported requirements |
| `execution` | Validate executable check specifications, enforce execution controls through an executor port, and return raw structured outcomes | Deciding risk or final verdict |
| `evidence` | Normalize, bound, hash, store/reference, and query evidence with provenance | Changing the meaning of check outcomes |
| `verdict` | Evaluate plan coverage and check evidence to produce one verdict and ordered reasons | Running checks or selecting policy |
| `jobs` | Orchestrate lifecycle transitions, cancellation, retry boundaries, and calls between modules | Domain rule definitions or transport details |
| `persistence` | Implement repositories for runs, plans, results, evidence, and idempotency records | Domain decisions |
| `api` | Future request validation, authentication/authorization integration, serialization, and job submission/status endpoints | Business decisions or synchronous long-running execution |
| `configuration` | Load, validate, canonicalize, hash, and expose trusted RiskVerifier configuration | Reading repository instructions as authority |

## 4. Allowed dependency direction

Dependencies point inward toward stable domain contracts:

```text
api -> jobs -> git / classification / risk / policy / planning / execution / evidence / verdict
jobs -> persistence ports
persistence adapters -> domain + persistence ports
execution backends -> execution port + domain
configuration adapters -> configuration contracts + domain
all decision modules -> domain
domain -> no infrastructure module
```

Additional rules:

- `classification` must not call `risk`; orchestration passes classification output to risk.
- `risk` must not call `policy`; orchestration passes the risk assessment to policy.
- `policy` returns requirements, not executable shell commands.
- Phase 5 implements immutable `ChangeVerificationPolicy` with separate requirement strength and
  capability availability; it replays public risk assessment before selection. See [POLICY.md](POLICY.md).
- `planning` is the only module that binds policy requirements to trusted check definitions.
- Phase 6 currently materializes conceptual checks without executable definitions, as required by
  its implementation scope. Its additive run-independent `ChangeVerificationPlan` preserves the
  original run-bound contracts; command binding is deferred. See [PLANNING.md](PLANNING.md).
- `verdict` consumes the frozen plan and collected results; it may not retroactively weaken a requirement.
- `api` and persistence adapters translate domain types but do not duplicate decision logic.
- Cross-module imports use each module's public contract, not internal implementation files.

If shared orchestration contracts are needed, they belong in `domain` only when they express domain meaning; infrastructure convenience types remain local.

## 5. Core domain objects

### 5.1 Run and source identity

- `VerificationRun`: aggregate identity, immutable inputs, lifecycle, version identities, stage outputs, terminal verdict, and timestamps.
- `RepositoryIdentity`: canonical repository identity independent of a local checkout path.
- `CommitIdentity`: validated immutable Git object ID. The run records resolved base and target commit SHAs.
- `DeploymentArtifactIdentity` (future integration boundary): artifact digest plus trusted provenance binding the artifact to the verified target commit. It is not inferred from a filename, tag, or caller assertion.
- `PolicyVersion`: immutable identity for the exact policy rule set.
- `ConfigurationVersion`: immutable version and/or cryptographic hash of canonical trusted configuration.

### 5.2 Change analysis

- `ChangeSet`: base/target identity, ordered changed files, aggregate statistics, analyzer version, and analysis evidence.
- `ChangedFile`: normalized repository-relative old/new paths, change type, bounded diff metadata, language/type hints, and content evidence references where allowed.
- `ChangeCategory`: one of the supported category values. Classification is a set, not a single label.
- `ClassificationEvidence`: rule ID/version, category, relevant path or diff reference, observed fact, confidence semantics (deterministic match, not probabilistic confidence), and explanation.

### 5.3 Risk and policy

- `RiskLevel`: `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL`.
- `RiskAssessment`: final level, matched rules, contributing categories/factors, and ordered evidence.
- `RiskEvidence`: rule ID/version, observed fact, level contribution or escalation, source evidence references, and explanation.
- Phase 4 uses additive `ChangeRiskAssessment`, `RiskFact`, and `RiskUncertainty` contracts because its inputs contain no genuine run/policy/configuration/time context. They retain normalized classification and exact index references without fabricating canonical Evidence. Existing canonical contracts remain available; risk level is never a deployment verdict. See [the implemented rule set](RISK.md).
- `VerificationStrategy`: stable strategy vocabulary independent of a concrete runner.
- `VerificationPolicy`: immutable rule set that assigns a disposition to every considered strategy.
- `StrategyRequirement`: strategy, disposition (`MANDATORY`, `OPTIONAL`, `UNSUPPORTED`, `UNNECESSARY`), applicable conditions, absence behavior, frozen `PolicyVersion`, originating evidence, and policy evidence.

### 5.4 Planning and execution

- `VerificationPlan`: immutable plan ID, run input digest, policy/configuration identity, ordered checks, unresolved requirements, and planning evidence.
- `VerificationCheck`: check ID, strategy, mandatory/optional status, trusted check-definition ID, structured execution specification reference, resource profile, expected result interpretation, and rationale.
- `CheckResult`: terminal result state, start/end time, exit information, bounded output evidence, executor identity, and error details.
- `Evidence`: typed fact with provenance; immutable run-context reference resolving to repository, base/target commits, policy version, and configuration hash; subject; producer/version; strategy/check/attempt and outcome where applicable; timestamp; integrity hash; sensitivity classification; retention metadata; and optional bounded payload/reference.

### 5.5 Verdict

- `VerificationVerdict`: `APPROVE`, `BLOCK`, or `INCONCLUSIVE`.
- `VerdictReason`: stable machine-readable reason code plus explanation and references to plan/check/evidence IDs.

Domain objects should be immutable after their stage is finalized. Corrections create a new run or explicitly versioned superseding record; audit history is not silently rewritten.

## 6. Control flow

1. **Accept and canonicalize inputs.** Resolve repository identity, validate base/target object IDs, load a frozen policy and trusted configuration snapshot, and derive the future idempotency identity.
2. **Analyze.** The Git module produces a bounded `ChangeSet`. Invalid commits, oversized diffs, or unsupported Git conditions fail closed into a recorded non-success outcome.
3. **Classify.** All deterministic classification rules run. Multiple categories may be emitted. Unmatched behavior is explicitly represented; `GENERAL` is not proof that a change is safe.
4. **Assess risk.** Risk rules consume the change and classification evidence, produce a level, and record all escalations and relevant defaults.
5. **Apply policy.** The selected immutable policy gives every applicable strategy a disposition and defines how absence/unsupported states affect the verdict.
6. **Plan.** Planning binds requirements to check definitions from the frozen trusted configuration. It preserves every unsupported applicable strategy and every unresolved mandatory requirement instead of omitting them; either condition prevents approval.
7. **Execute.** The execution module validates each command specification and uses an executor port. It collects bounded outcomes; error and timeout remain distinct from a valid test failure.
8. **Collect evidence.** Evidence payloads are bounded, classified, hashed, and persisted or referenced with provenance.
9. **Evaluate.** The verdict module accounts for every plan requirement using explicit precedence and emits a verdict plus reasons.
10. **Complete.** Jobs persist the terminal aggregate. A caller receives the canonical result through a future API projection.

Classification, risk, policy, and planning are pure or near-pure deterministic transformations for the same canonical inputs and versions.

## 7. Execution boundary

The core engine depends on an `Executor` port conceptually shaped around structured data:

```text
execute(ApprovedCheck, ExecutionContext) -> CheckResult
```

An approved check contains an executable selected from an allow-list and an argument array. It is never a shell command string. The execution backend may initially be a tightly controlled local process adapter and later a container adapter without changing policy, planning, or verdict semantics.

Verification commands must not use `child_process.exec`, `execSync`, `{ shell: true }`, or an equivalent shell-launch mode. Command chaining and redirection syntax have no execution meaning because untrusted strings are never evaluated by a shell. A lower-level spawn API with an exact executable and argument array is required.

The boundary enforces:

- no shell interpolation;
- executable and argument validation against trusted configuration;
- a dedicated isolated working directory rooted at the checked-out target;
- path containment checks;
- minimal environment variables with no implicit inheritance of secrets;
- time, CPU, memory, process-count, and output limits where supported;
- restricted network access where practical;
- cancellation and process-tree termination;
- stdout/stderr truncation with hashes and truncation evidence; and
- distinct states for pass, fail, execution error, timeout, cancellation, skipped, and unsupported.

Repository content can be data observed by a check, but cannot add or alter approved commands. In particular, allow-listing `npm test` or `npm run <name>` is not sufficient because the invoked script body remains mutable repository-controlled command content. Early checks must use a trusted exact executable/argument definition that does not delegate command construction to a package script. Any future mechanism that promotes a specific script must independently review and authorize its exact content, bind that content by immutable digest, and treat a changed script as untrusted. Dependency installation is a separate future operation with its own authorization and controls.

## 8. Persistence boundary

The domain and decision modules do not depend on a database. The jobs layer uses narrow persistence ports such as:

- create/load a `VerificationRun`;
- atomically advance a lifecycle state using expected-version concurrency;
- append immutable stage outputs and evidence metadata;
- store/retrieve large evidence through a separate blob/reference abstraction;
- claim/release executable jobs with leases;
- record cancellation requests; and
- reserve/find an idempotency identity.

Required persistence properties include durable version identities, append-oriented auditability, transactional state transitions, idempotent result writes, and clear retention/redaction behavior. A relational database plus external bounded artifact storage is a likely implementation, but selection is deferred to Phase 10.

Raw repository contents should not be copied into persistence by default. Evidence stores the minimum data needed for explanation, subject to output limits, sensitivity marking, and retention policy.

## 9. Configuration and policy versioning

Policy and runtime configuration have distinct identities:

- `PolicyVersion` identifies the exact verification-requirement and verdict-treatment rule set. Those rules may consume classification and risk outputs without merging those responsibilities.
- `ConfigurationVersion`/hash identifies canonical trusted operational configuration, including available check definitions, executable allow-lists, resource profiles, and relevant analyzer/rule configuration.

Classification and risk rule-set versions must also be recorded, either as explicit component versions within the configuration snapshot or as first-class fields. The selected snapshots are frozen when a run is created and remain unchanged through completion.

Canonicalization must be deterministic before hashing: stable key ordering, normalized encodings, explicit defaults, and secret values excluded or represented by non-reversible version identifiers. Hashes prove identity, not trust; signatures or access controls establish trust.

The future idempotency identity is derived from a canonical tuple similar to:

```text
repository identity
+ resolved base SHA
+ resolved target SHA
+ policy version
+ configuration hash
```

Conceptual idempotency behavior is fixed now, while storage mechanics remain a Phase 10/11 decision:

- repeating the same canonical request identity (and the same caller-supplied idempotency key when one is present) returns the existing active or terminal run rather than starting duplicate work;
- changing the policy version or configuration hash changes the request identity and therefore requires a new run;
- reusing one caller idempotency key for a different canonical identity is a conflict, not an alias;
- a prior `FAILED` or `CANCELLED` run remains immutable and is returned for its original key; and
- an explicit retry creates a new run/attempt identity linked to the prior run and never converts the prior terminal record into success.

The exact hash algorithm, key scope/retention, collision handling, and retry authorization remain Phase 10/11 decisions.

## 10. Future job lifecycle

Normal progression is:

```text
QUEUED
  -> ANALYZING
  -> CLASSIFYING
  -> ASSESSING_RISK
  -> PLANNING
  -> EXECUTING
  -> EVALUATING
  -> COMPLETED
```

Explicit terminal states are:

- `COMPLETED`: verdict and full terminal record exist;
- `FAILED`: an internal or input-processing failure prevented a valid verdict evaluation;
- `CANCELLED`: cancellation was acknowledged and execution stopped.

`COMPLETED` does not mean approved; it may contain any verdict. `FAILED` is never interpreted as `APPROVE`. A future API projection may map a run failure to an `INCONCLUSIVE` deployment-facing outcome, but it must preserve the distinction between a domain verdict and job infrastructure failure.

Transitions are monotonic and persisted atomically. Retries resume only at explicitly idempotent stage boundaries. A lease/heartbeat mechanism will prevent two workers from executing the same checks concurrently. Cancellation is cooperative first and forceful at the executor boundary after a grace period.

## 11. Future API boundary

The API will be asynchronous and versioned. Expected capabilities are:

- submit a verification request with an idempotency key;
- retrieve run status and terminal results;
- request cancellation;
- retrieve authorized, redacted evidence; and
- expose health/operational status separately from domain results.

API DTOs are explicit mappings and do not expose database records or TypeScript-internal discriminated unions without a versioned wire contract. Authentication, authorization, tenancy, quotas, pagination, evidence redaction, and callback/event delivery are deferred to Phase 11.

## 12. Future DeployFlow boundary

DeployFlow integrates only through the versioned external contract. It does not import RiskVerifier modules, write RiskVerifier persistence, select internal rule classes, or infer a verdict from logs. RiskVerifier returns stable status, verdict, and reason codes; DeployFlow decides how those outcomes affect its deployment workflow.

The boundary must tolerate retries and long-running work. It will use immutable commit identities and idempotency. An approval is scoped to its exact repository and target commit; it is not a transferable approval for a branch name or later build. Before deployment, DeployFlow must verify trusted artifact provenance that binds the candidate artifact digest to the approved target commit. If the artifact is derived from another commit, cannot be bound to the commit, or is rebuilt through an unapproved/non-reproducible path, the existing verdict is not valid for that artifact and deployment must not proceed as verified.

DeployFlow integration is Phase 14 and may impose requirements on authentication, latency, availability, retention, or callbacks that must not be guessed during Phase 0.

## 13. Failure semantics and observability

- Unknown inputs and internal failures are explicit and fail closed.
- Stage logs are operational telemetry, not canonical evidence unless promoted through the evidence model.
- Structured metrics include stage latency, queue latency, rule matches, strategy disposition, executor outcomes, output truncation, verdict counts, and cancellation.
- Logs and traces use opaque identifiers and avoid repository content, environment values, tokens, or raw command output by default.
- Correlation uses run/check IDs; evidence integrity uses hashes and producer/version metadata.

## 14. Deferred decisions

- Concrete web framework, database, job queue, and container runtime.
- The initial set of executable strategies and their trusted command definitions.
- How dependencies are provisioned without trusting repository-controlled installation hooks.
- Whether local execution is allowed outside development fixtures once container execution exists.
- Multi-tenancy, remote repository acquisition, credential brokering, and evidence retention periods.
- Cryptographic signing of policies, configurations, or completed results.
