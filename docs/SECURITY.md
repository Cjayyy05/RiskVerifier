# RiskVerifier Security and Threat Model

## 1. Security objective

RiskVerifier processes repositories that may be buggy, malformed, unsafe, or untrusted. Its security objective is to minimize the authority exposed to analysis and verification, prevent repository content from authorizing commands, preserve evidence integrity, and fail closed when a result cannot be established.

Security controls reduce risk; they do not make executing hostile code safe.

### Implemented Phase 7 boundary

Phase 7 permits local execution **only on disposable, operator-controlled fixture data** through
the APIs in [EXECUTION.md](EXECUTION.md). It cannot adopt an arbitrary repository directory.
Trusted structured definitions, an independent absolute-path Node/verifier allow-list, content pins,
exact plan replay, fixture manifest checks, minimal environment, timeout and bounded raw output are
implemented. Repository package scripts and configuration never supply execution authority.

This is not a sandbox: a trusted verifier still runs with the controller user's filesystem and
network privileges. Only the direct child is killed; CPU, memory, PID, disk and network isolation,
process-tree containment, redaction, authenticated persisted evidence and remote acquisition are
not implemented. Unconfirmed termination returns ERROR and quarantines the executor/workspace;
there is no automatic reaper. Phase 9 is required before broadening this boundary, with independent
review; intentionally malicious repositories remain outside the current claim. Host mutation between
validation and execution is not prevented. The broader controls below remain target requirements
unless an implemented phase is explicitly identified.

## 2. Threat-model boundary

### Implemented Phase 9 boundary

The separate Docker backend applies fixed network-disabled, non-root, dropped-capability,
no-new-privileges, read-only-root/source and bounded scratch/resource controls to controlled fixtures.
It executes only separately approved pinned verifier files using a pre-provisioned immutable image.
It neither pulls/builds images nor runs repository scripts. Unconfirmed termination or removal
quarantines state. Host-direct Phase 7 remains unchanged and is not silently upgraded to isolation.
Docker/kernel/host trust and malicious-container-escape exclusions still apply. See
[ISOLATION.md](ISOLATION.md) for implementation scope and Docker-backed validation.

### 2.1 In scope

The MVP considers accidental and opportunistic threats including:

- command/argument injection;
- unsafe repository instructions and package metadata;
- path traversal and symlink abuse;
- unsafe Git arguments and ambiguous revisions;
- accidental access to host files, credentials, or environment variables;
- unbounded CPU, memory, process, disk, time, or output consumption;
- malicious or malformed stdout/stderr and terminal escape sequences;
- dependency lifecycle scripts and supply-chain behavior;
- unexpected outbound network access;
- corrupted, oversized, or adversarial Git diffs; and
- evidence tampering, truncation ambiguity, or secret leakage.

### 2.2 Explicitly out of scope

The MVP does not claim to securely execute repositories intentionally designed to:

- escape a container;
- exploit the host kernel, Docker daemon/runtime, verifier runtime, hypervisor, hardware, or firmware;
- use undisclosed zero-day vulnerabilities against the isolation stack; or
- resist a fully compromised execution host.

Accordingly, a container is a defense-in-depth boundary, not a security proof. Repositories from actively hostile sources require stronger isolation—such as disposable virtual machines or dedicated hosts—and an operational threat model beyond the MVP.

### 2.3 Trust zones

Trusted inputs/components:

- validated RiskVerifier application code and deployment artifacts;
- operator-controlled, access-controlled policy and configuration snapshots;
- the allow-list of executable definitions and resource profiles; and
- infrastructure identities used to persist and retrieve results.

Untrusted inputs/components:

- repository files, names, symlinks, Git metadata, diffs, objects, hooks, and submodules;
- README content, documentation, comments, and package scripts;
- source code executed by compilers, test runners, linters, or application code;
- dependency contents and install/lifecycle scripts;
- stdout, stderr, coverage/test reports, and other produced artifacts;
- user-controlled API fields before validation; and
- any future AI-generated suggestion.

Trust is based on source and authorization, not file name. A configuration file committed to the repository is untrusted unless an explicit, separately secured approval mechanism promotes a specific immutable version.

## 3. Primary security invariants

- Only trusted RiskVerifier configuration can authorize an executable check.
- Commands are represented as an executable plus argument array and are launched without a shell.
- Repository-derived values never select arbitrary executables, add flags outside an allowed schema, or become host paths without validation.
- The working directory is isolated and containment-checked.
- The execution environment begins empty/minimal; host secrets are not inherited.
- Every execution terminates with an explicit state. Error, timeout, cancellation, missing tooling, skipped work, and unsupported behavior are never `PASS`.
- Every mandatory policy requirement remains visible through planning and verdict evaluation.
- Evidence records provenance, integrity metadata, truncation, and sensitivity.

## 4. Threats and controls

### 4.1 Command injection

**Threat.** File names, commit messages, request fields, configuration values, or discovered repository commands could introduce shell syntax or alter execution.

**Controls.**

- Never build a shell command string and never use shell interpolation.
- Spawn an exact executable with a separate argument array.
- Prohibit `child_process.exec`, `execSync`, `{ shell: true }`, and equivalent shell-launch modes for verification commands. Shell chaining, pipelines, substitutions, and redirections supplied through untrusted strings are never interpreted.
- Resolve the executable from a trusted check definition and allow-list; do not search the repository or honor aliases.
- Validate each argument by type and purpose. Repository-derived paths must be normalized repository-relative paths and passed only in argument positions designed for paths.
- Use `--` before path operands when the invoked tool supports it.
- Reject NUL characters, invalid encodings, unsafe control characters, and values outside configured size limits.
- Log structured, escaped representations rather than reconstructing a copy-pasteable shell command.

Residual risk remains in tools whose argument parsers have unsafe behavior. Each allowed tool/version requires review.

### 4.2 Arbitrary code execution

**Threat.** Builds, tests, static analysis, TypeScript transformers/plugins, and application imports can execute repository code even without a shell.

**Controls.**

- Treat every executable verification strategy as arbitrary code execution.
- Run with a dedicated low-privilege identity in an isolated working directory.
- Deny privilege escalation and access to Docker/container control sockets.
- Apply resource, environment, filesystem, process, output, and network controls.
- Separate analysis-only phases from execution and keep Git inspection non-executing.
- Do not source repository shell files or invoke hooks.
- Progress toward a container/stronger isolation executor before processing higher-trust-boundary repositories.

Residual risk is material because containers share a kernel. This is covered by the explicit threat-model limitation.

### 4.3 Repository instructions and trust confusion

**Threat.** A repository asks RiskVerifier through a README, comment, package script, config file, or generated output to run an unsafe command or weaken verification.

**Controls.**

- Repository content can contribute facts but cannot grant authority.
- Ignore instructions embedded in prose or code comments.
- Do not automatically execute npm scripts. Allow-listing `npm test` or `npm run <name>` alone is insufficient because the repository controls the underlying script body. A trusted configuration must define the exact check independently. Any future promotion of a package script requires separate review/authorization of its exact content and immutable digest; a changed script loses that trust.
- Keep policy/configuration acquisition separate from repository acquisition and record their immutable identities.
- Do not allow verification output to modify the frozen plan or policy.

### 4.4 Dependency installation

**Threat.** `npm install`/`npm ci` can fetch mutable or malicious packages, execute lifecycle scripts, consume resources, and access credentials/network.

**Controls.**

- Do not automatically run dependency installation in early phases.
- Treat installation as a separate, explicitly authorized operation and evidence-producing stage if later introduced.
- Require a lockfile and an approved registry/proxy policy where applicable.
- Prefer prebuilt, immutable dependency environments or caches keyed by lockfile digest.
- Disable lifecycle scripts where feasible, while documenting strategies that require them.
- Use no package-registry credentials unless narrowly scoped and brokered for that operation.
- Apply the same or stronger isolation, network, output, and resource controls as check execution.

Unresolved: some npm projects cannot build without lifecycle scripts. The product must report that limitation rather than silently relax controls.

### 4.5 Filesystem access

**Threat.** Checks read or modify host files, other runs, verifier binaries, or persistence credentials.

**Controls.**

- Allocate a unique working root per attempt with restrictive permissions and a non-secret random identifier.
- Mount or copy only the required repository snapshot; use read-only mounts for inputs where the strategy permits and a bounded scratch/output area where writes are needed.
- Do not mount host home directories, SSH agents, cloud credentials, Docker sockets, or persistence storage.
- Run the verifier/controller outside the writable repository tree.
- Enforce disk quotas and clean up through a trusted controller after process termination.
- Ensure evidence collection reads only approved output paths beneath the execution root.

### 4.6 Path traversal, symlinks, hard links, and special files

**Threat.** Paths such as `../`, absolute paths, alternate data streams, case collisions, symlinks, hard links, device names, or archive entries escape the working root or confuse analysis.

**Controls.**

- Treat Git paths as opaque repository-relative byte sequences where possible; validate before converting to platform paths.
- Reject absolute paths, parent traversal, NULs, platform-reserved names, and paths that cannot be represented safely.
- Resolve the parent/root and verify containment before every host filesystem operation; string-prefix tests alone are insufficient.
- Define an explicit symlink policy. Do not follow a symlink when collecting artifacts or traversing a checkout unless the operation is specifically designed and containment-safe.
- Do not materialize untrusted archives with a generic extractor.
- Detect case-insensitive collisions on Windows/macOS-like filesystems and fail analysis rather than overwrite.
- Prefer an isolated Linux execution filesystem for consistent semantics in later phases.

### 4.7 Secret leakage and environment exposure

**Threat.** Repository code reads CI tokens, Git credentials, cloud metadata, proxy credentials, host environment variables, or secrets present in logs.

**Controls.**

- Construct an explicit minimal environment; never inherit the controller process environment wholesale.
- Exclude tokens, SSH/GPG agents, credential-helper sockets/config, npm credentials, cloud variables, and host `HOME`.
- Use a fresh non-secret home directory inside the sandbox when a tool requires one.
- Disable access to cloud instance metadata through network policy.
- Apply secret scanning/redaction as defense in depth before logs/evidence are displayed, recognizing that redaction is not complete protection.
- Mark evidence sensitivity and authorize evidence access separately from run-status access.
- Avoid placing secrets in command arguments, which may be visible in process listings and logs.

### 4.8 Network access

**Threat.** Executed code exfiltrates data, downloads changing inputs, attacks internal services, or behaves nondeterministically.

**Controls.**

- Default to no network for verification checks.
- If a future strategy requires network access, grant it through a strategy-specific egress policy to explicit endpoints, methods, and credentials.
- Block loopback-to-host bridges, link-local/metadata ranges, private networks, and control-plane endpoints unless explicitly required.
- Record the network policy and any permitted external identities in execution evidence.
- Do not rely solely on environment proxy settings as an enforcement boundary.

### 4.9 Resource exhaustion and denial of service

**Threat.** A repository produces infinite loops, fork bombs, huge output, large Git objects, excessive files, disk exhaustion, or slow parsing.

**Controls.**

- Bound repository size, file count, per-file size, diff size, rename-detection effort, and evidence/artifact count before deep processing.
- Apply wall-clock and, where supported, CPU, memory, process-count, open-file, and disk limits.
- Terminate the complete process tree on timeout/cancellation and wait for confirmed termination before collecting mutable outputs.
- Limit concurrency globally and per caller/repository.
- Stream stdout/stderr into bounded collectors; stop retaining content after limits while continuing to drain or terminate safely.
- Use queue admission control, job leases, and maximum attempts.

### 4.10 Malicious output and evidence artifacts

**Threat.** Output contains terminal escapes, forged log prefixes, binary data, huge lines, invalid Unicode, HTML/script payloads, secrets, or filenames designed to mislead viewers.

**Controls.**

- Store stdout and stderr as untrusted bytes with encoding metadata.
- Bound bytes and line lengths; record truncation and a digest of the observed stream.
- Escape control characters for text views and render through a non-executing viewer with contextual output encoding and a restrictive content security policy.
- Never interpret output as Markdown/HTML, commands, policy, or a successful check signal without a trusted result parser.
- Version and fuzz-test result parsers; parser failure is `ERROR`/insufficient evidence, not `PASS`.
- Use safe generated storage keys rather than artifact-provided names.

### 4.11 Git argument and revision safety

**Threat.** Revisions or paths beginning with `-`, ambiguous ref names, replace objects, hooks, external diff/text-conversion drivers, submodules, or malicious repository configuration change Git behavior.

**Controls.**

- Prefer full validated object IDs. If refs are accepted, resolve them once with an end-of-options marker and verify the resulting object is a commit.
- Keep revisions in positions parsed as revisions and use `--` before path operands.
- Invoke Git without a shell and set explicit safe configuration: disable hooks by never invoking hook-triggering operations, disable external diff and text conversion, ignore repository credential helpers, and avoid user/global config where practical.
- Do not initialize/update submodules or Git LFS automatically; record unsupported content when required objects are unavailable.
- Treat `.git` content as untrusted and never expose a working repository's Git directory to an execution check when a detached materialized source tree is sufficient.
- Disable or account for replacement/graft mechanisms and record the exact resolved object IDs.
- Bound Git output and operation time.

The Phase 2 invocation set is covered by adversarial fixture tests. This does not establish
OS-level filesystem, network, or process-tree isolation.

The Phase 2 adapter uses NUL-delimited `name-status` and `numstat` output, exact validated object
IDs, `--no-ext-diff`, and `--no-textconv`. Repository discovery uses read-only `rev-parse` calls.
Commit lookup and diffs then run against a temporary, verifier-owned bare metadata directory,
with the selected repository's physical object directory supplied explicitly. Source-local config,
refs, index, worktree attributes, and `info/attributes` are not used by those analysis operations.
The source repository is never edited; temporary metadata is removed in `finally`, including on
failure. Temporary workspace errors are typed and do not expose host paths.

Attribute lookup uses `--attr-source=<exact-target>`; external and system attribute files are
disabled. Target-committed attributes can intentionally select text/binary treatment. Custom
driver commands/configuration are not loaded; external diff and textconv remain disabled.
Diff behavior fixes the Myers algorithm, disables
the indent heuristic, uses 50% rename/copy similarity, and caps exhaustive rename/copy candidates
at 1,000. Each Git subprocess has a 30-second default timeout and a 16 MiB combined stdout/stderr
capture limit; these limits are operator-side options and cannot be supplied by repository content.
Interactive prompting, pagers, replacement objects, optional locks, lazy fetching, and system/global
Git configuration are disabled for analyzer subprocesses. Metadata-declared alternate object stores
(`objects/info/alternates` and `http-alternates`) are explicitly unsupported, including empty files;
acquisition must supply a self-contained object database. Inherited Git variables, HOME and
XDG_CONFIG_HOME are excluded. Only host executable-search/Windows runtime/temp variables are
allow-listed, plus explicit adapter controls.

Git is an operator-trusted host prerequisite, not an npm dependency. The default executable name
uses the trusted host PATH; operators can supply an absolute trusted executable path through
`GitProcessOptions.gitExecutable`. RiskVerifier does not authenticate or attest the binary.
The reviewed host uses Git 2.47.1 for Windows; supported Git must understand `--no-lazy-fetch`,
`--attr-source`, and `rev-parse --path-format=absolute`. Unsupported command options fail explicitly
instead of silently relying on ignored environment variables.

Timeouts accept 1 through 2,147,483,647 milliseconds (Node's timer range). Output is counted as raw
combined stdout/stderr bytes before decoding; retention stops at the limit, with bounded transient
chunk/concatenation overhead. Cancellation/timeout/output overflow kills the direct process and
waits for its close event. First observed failure wins. This is not process-tree termination or
a CPU/memory quota; the trusted Git binary must not leave descendants holding its pipes open.
External repository helpers are disabled. Source metadata/object storage must remain stable during
analysis: concurrent hostile filesystem mutation, Git binary vulnerabilities, OS failures to kill
a process, and malicious object-store symlink swaps require stronger future acquisition/isolation.

### 4.12 Temporary working directories

**Threat.** Predictable/shared directories enable races, symlink swaps, cross-run reads, or incomplete cleanup.

**Controls.**

- Create directories atomically using the platform's secure temporary-directory primitive beneath a dedicated verifier-owned root.
- Use one root per run attempt, restrictive permissions, and no user-supplied directory name.
- Verify ownership and containment before use and cleanup.
- Never reuse a dirty directory for a different run.
- Clean up after terminating processes, with a quarantined cleanup/reaper path for failures.
- Do not treat deletion as secure erasure; avoid writing secrets in the first place and use encrypted storage where required.

### 4.13 Docker and container assumptions

**Threat.** A container is misconfigured with excessive privilege or treated as a complete sandbox.

**Controls for the Phase 9 design.**

- Run as a non-root user with no privileged mode, no added capabilities, no host PID/IPC namespace, and no control socket mounts.
- Use a read-only root filesystem, bounded writable scratch space, seccomp/AppArmor/SELinux or platform equivalent, resource limits, and `no-new-privileges` where available.
- Pin executor images by digest and maintain their provenance/vulnerability posture.
- Deny network by default and mount only the specific source/output paths required.
- Keep the controller and secrets outside the container.

Assumption: the host kernel and container runtime are trusted. Container escape defense against an intentionally malicious repository is outside the MVP claim.

### 4.14 Deployment artifact substitution

**Threat.** RiskVerifier approves target commit A, but DeployFlow deploys an artifact produced from commit B, an unverified working tree, or a rebuild whose inputs cannot be tied to A.

**Controls.**

- Scope every verdict to the exact repository identity and resolved base/target commit pair.
- Require trusted build provenance or an artifact attestation that binds the candidate artifact digest to the approved target commit and relevant build inputs.
- Treat branch names, tags, filenames, caller assertions, and mutable registry tags as insufficient binding.
- Refuse to treat an existing verdict as valid when provenance is absent, mismatched, or points to another commit/configuration.
- Require a new verification decision when the deployed source changes; define during Phase 14 whether a reproducible rebuild of the same verified source can reuse a verdict and under which attested build constraints.

## 5. Integrity, policy, and evidence security

- Policy and configuration snapshots are immutable during a run and accessible only to authorized operators/services.
- Every decision cites rule IDs and input evidence; every evidence item records its producer/version, immutable run context (repository, commits, policy, and configuration), strategy/check/outcome where applicable, and a cryptographic digest.
- Evidence references must be content-addressed or otherwise protected from substitution and authorized by run ownership/tenancy.
- Completed results are append-oriented; modifications create audited superseding records.
- System clocks support operations but do not establish content identity; hashes and immutable IDs do.
- The verdict engine evaluates the frozen plan and cannot accept an executor's self-declared verdict.
- A check process cannot write directly to canonical persistence.

## 6. Failure behavior

- Invalid input or unsafe path: reject/fail the run; never approve.
- Analyzer/parser error or exceeded analysis bound: explicit failure or `INCONCLUSIVE` projection.
- Mandatory valid test failure: `BLOCK`.
- Execution error, timeout, cancellation, missing tool, malformed result, or skipped mandatory check: `INCONCLUSIVE` by default, or `BLOCK` only where frozen policy explicitly defines absence as blocking. Any applicable verification marked `UNSUPPORTED` likewise prevents approval and is `INCONCLUSIVE` or `BLOCK` according to policy.
- Internal service/persistence failure: job `FAILED`; never synthesize `APPROVE`.
- Output truncation: retain truncation evidence. If the trusted parser cannot still establish the result, the result is inconclusive/error rather than pass.

## 7. Security validation plan

Security tests should include:

- adversarial filenames, revisions, symlinks, case collisions, and path traversal;
- command-argument metacharacters proving no shell interpretation;
- repository attempts to influence commands through README/package scripts/config;
- environment and filesystem canaries proving secrets/host paths are unavailable;
- network denial and metadata-service probes;
- time, memory, process, disk, and output exhaustion fixtures;
- malicious ANSI/HTML/Unicode/binary output;
- missing tools, parser failures, timeouts, and killed process trees;
- submodule, LFS, external-diff, Git-config, and replace-object cases; and
- policy/configuration substitution and evidence-tampering attempts.

Independent threat review is required before processing repositories beyond controlled evaluation fixtures.

## 8. Unresolved security risks

- The strength and portability of network/filesystem/process isolation on supported hosts.
- Safe dependency provisioning for real npm projects, especially lifecycle scripts and native modules.
- Toolchain attacks from compilers, linters, test runners, plugins, and preinstalled dependencies.
- Secure remote repository acquisition and credentials.
- Evidence secret-detection accuracy, redaction, retention, and tenant authorization.
- Container image supply chain, patching, and runtime hardening.
- Whether threat requirements ultimately demand disposable VMs rather than containers.
- Denial-of-service limits that preserve usefulness for legitimate large repositories.
- Windows path/materialization edge cases if execution is supported directly on Windows.
