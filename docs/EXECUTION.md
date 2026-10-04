# Phase 7 — Controlled verification execution

## Scope and trust boundary

Executor **7.1.0** answers what happened when one approved conceptual check ran. It does
not aggregate checks or decide deployment. The approved classifier 3.1.0, risk 4.1.0,
policy 5.1.0 and planner 6.0.0 contracts/semantics remain unchanged.

Local execution is permitted only for disposable, operator-controlled fixture data.
There is no API to adopt a downloaded, production or arbitrary user repository directory.
The operator must not disguise untrusted repository content as a controlled fixture.
The fixture marker and content hashes establish consistency, not safety or authorization.
This phase does not safely execute intentionally malicious repositories. Phase 9 isolation
and independent security review are required before broadening the execution boundary.

Trusted components are RiskVerifier, the host OS/runtime, the operator supplying configuration
and an independent allow-list, the verifier program and its dependencies, and controlled
fixture contents. Repository prose, package scripts, comments, configuration and generated
output never register commands or modify policy. Configuration provenance is an external
operator responsibility: parsing a configuration does not authorize it.

No dependency installation, npm-script delegation, Docker, scheduler, persistence, HTTP,
AI or DeployFlow integration is implemented. The CLI remains non-executing.

## Architecture and public API

Import the public module from `riskverifier/execution`:

1. `parseExecutionConfiguration(raw)` validates/canonicalizes the separate trusted registry.
   Use its `identity` in the Phase 6 planning input before generating the plan.
2. `prepareControlledWorkspace(rawFixture)` allocates a fresh temporary fixture and returns
   a frozen, registered handle. Existing paths or serialized/cloned handles are not accepted.
3. `createControlledExecutor(rawAuthority)` constructs the independent host authority.
4. `executor.executeCheck({ planningInput, plan, checkId, configuration, workspace }, signal?)`
   validates the request and executes only that plan check.
5. Retain the returned `ExecutionCheckResult` in the caller's controlled context, then call
   `disposeControlledWorkspace(workspace)` after checks finish, normally in `finally`.

`executor.validateResult(request, unknownResult)` validates shape, protocol and association
against the same independently replayed request. It does not authenticate a historical
observation or distinguish a coherent fabrication from a real execution. The live workspace
handle remains usable for association validation after disposal, but not for another execution.

Only one check may run per executor and per workspace at once; competing requests are rejected.
There is no global scheduler, full-plan iteration or implicit retry/fallback. Callers can make
sequential requests, explicitly deciding whether to continue, with a newly allocated workspace
for every attempt. Once acquired, a workspace is consumed even after PASS, failure, timeout,
cancellation, unsupported results or preflight rejection. Invalid requests rejected before
acquisition do not consume it. Consumption cannot be reset by changing executors or restoring
file bytes. Registered handles still support result validation and confirmed-safe disposal.

The module owns validation/configuration, host authority, workspace lifecycle, the process port,
and immutable intermediate results. `execution/bounded-execution.ts` alone creates verification
processes. `git/bounded-process.ts` remains a separate trust domain. Architecture guards restrict
production process imports to exactly those files and prohibit shell APIs.

## Trusted structured configuration

The raw configuration has exactly `schemaVersion: 7`, a nonempty `version`, and `definitions`.
Each definition has exactly these fields (paths and digest are illustrative placeholders):

```json
{
  "strategy": "BUILD",
  "version": "fixture-build-1",
  "executable": "C:\\Program Files\\nodejs\\node.exe",
  "args": ["C:\\trusted-verifiers\\build.mjs"],
  "verifierSha256": "<64 lowercase hexadecimal SHA-256 characters>",
  "workingDirectory": "WORKSPACE_ROOT",
  "timeoutMs": 10000,
  "maxOutputBytes": 4096,
  "environmentPolicy": "MINIMAL_V1",
  "protocol": "EXIT_CODE_V1"
}
```

There is at most one definition per known domain strategy. Unknown/extra fields, command strings,
shell aliases, arbitrary environment overrides, accessors, sparse arrays, unsupported enum values,
invalid bounds and duplicate strategies fail closed. Definitions are canonically strategy-ordered.
Args contain 1–32 strings, each at most 4,096 characters and at most 16,384 combined; the first is
an absolute trusted `.mjs`/`.cjs` entrypoint. Control/format/surrogate characters are rejected.
The executable is an explicit normalized local absolute path ending in `node.exe` on Windows or
`node` elsewhere; there is no PATH lookup. UNC/device/alternate-stream/dot-segment paths are rejected.
Subsequent args are literal verifier data, not a general embedded scripting language. Operators
must review what each verifier does with them; trusting a script that itself evaluates args defeats
this boundary and is outside the supported controlled-verifier contract.

The separate authority input is exactly:

```text
{ kind: "CONTROLLED_FIXTURE_ONLY",
  executables: [absoluteNodePath],
  verifiers: [{ path: absoluteVerifierPath, sha256: pinnedVerifierDigest }] }
```

Both path membership and verifier digest must match independently of the configuration hash.
The executor pins the bytes of its own running Node executable when authority is created and
requires the selected executable to match those bytes before each spawn. This deliberately narrow
MVP does not permit arbitrary native executables, shells, npm, cmd, PowerShell, sh or bash wrappers.

Explicitly allow-listed directory symlink/junction aliases may resolve to a matching pinned program
outside the executed workspace; canonical basename must remain unchanged. Aliases do not create
allow-list membership. Hashing and spawn/open are separate operations: validation establishes the
bytes seen during preflight, not an atomic guarantee about the bytes eventually executed. Host
runtime files, verifier entrypoints and their resolved locations must remain stable through execution.
Each verifier entrypoint is separately digest-checked before spawn and may not reside in the
executed workspace. Pins cover entrypoint/runtime bytes, not imported libraries, native libraries
or the entire toolchain. Operators must separately control all transitive verifier dependencies.

The process call is `spawn(executable, ["--", ...args], { shell: false, cwd, env,
windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })`. The delimiter prevents Node options
such as `--eval` from becoming runtime flags. Metacharacters, quotes and spaces in later args remain
literal. There is no command concatenation, shell interpretation, stdin protocol or automatic install.

## Binding, identity and capabilities

Execution replays `validateVerificationPlan` against separately supplied Phase 6 inputs, including
the Phase 5 replay chain. It selects the check by exact ID from the validated plan, retaining its
strategy, mandatory/optional state, availability, failure/absence handling and rationale. Altered
plans/checks, wrong source context or configuration mismatches reject before process creation.

Execution configuration identity hashes its canonical schema/version/definitions. Definition
identity hashes every semantic field, including executable, args, timeout, output limit, environment
policy and protocol. The plan's configuration identity must equal this execution configuration's
identity. This is a dedicated Phase 7 subschema within the execution module, not a relaxation of
the existing Phase 1 configuration parser. It uses the existing domain ConfigurationIdentity.

Each result binds executor version, authority identity, exact plan ID/full context, full selected
check, definition ID/version/limits (or null), workspace ID/content-manifest digest and a unique
attempt ID. Repository and base/target commits are carried in that context. The fixture's source
labels must match the plan, but are operator assertions: its file manifest is not proof of a Git
checkout or deployment artifact. Real acquisition/attestation remains future work.

`executionCapabilities(configuration)` reports registry presence only. Policy-declared support,
definition presence and successful process startup are distinct. A missing definition yields
UNSUPPORTED even when policy claimed support. A policy UNAVAILABLE/UNSUPPORTED check does not run,
even if a definition exists. Nothing substitutes another strategy or drops mandatory/optional checks.

## Outcomes and protocol

`EXIT_CODE_V1` is an explicit contract with a trusted verifier, not arbitrary tool exit handling:

| Observation                                                           | Result      |
| --------------------------------------------------------------------- | ----------- |
| Normal complete exit 0                                                | PASS        |
| Normal complete exit 42, reserved valid negative verification outcome | FAIL        |
| Any other exit, signal termination, process malfunction/start error   | ERROR       |
| Deadline wins and direct-child close is confirmed                     | TIMEOUT     |
| Cancellation wins and close is confirmed, or already aborted          | CANCELLED   |
| No implementation or policy availability prevents execution           | UNSUPPORTED |
| Output overflow or termination cannot be confirmed                    | ERROR       |

The verifier must use 42 only after producing a valid negative assertion/check result. For example,
an unexpected exception exits 1 and remains ERROR. Node's internal failure code 10 is ERROR,
not FAIL ([Node exit codes](https://nodejs.org/api/process.html#exit-codes)). Stdout/stderr are never
interpreted as success/failure messages. A broken trusted verifier could still report a misleading
0 or 42; this contract is not a correctness proof.

Missing/unreadable allowed executables/verifiers, unavailable cwd and spawn permission failures
produce ERROR. Unsafe paths, changed program pins, changed fixture data, invalid requests or
unapproved authority reject with `InvalidInputError`; they do not fabricate a terminal check result.
Optional FAIL remains FAIL; mandatory absence remains visible with policy handling unchanged.

```text
PASS != APPROVE
FAIL != BLOCK
UNSUPPORTED != INCONCLUSIVE
```

Phase 8 performs interpretation. This module never calculates a verdict or canonical run Evidence.
The additive `ExecutionCheckResult` reuses approved CheckResult states because Phase 7 lacks a
genuine run/evidence context; no fake run IDs, timestamps or evidence IDs are created.

## Bounds, cancellation and lifecycle

Timeout is mandatory, an integer from 1 to 2,147,483,647 ms. It measures the process portion,
not asynchronous filesystem preflight. Duration uses a monotonic clock and is integer milliseconds.
Filesystem operations have byte/count bounds but no hard deadline against a stalled host filesystem.

The combined stdout/stderr retention limit is 1 byte to 1 MiB per check. Raw bytes are counted before
decoding. Two fixed buffers each reserve the configured cap, with a combined retained payload no
larger than one cap; transient incoming chunks and base64 strings add bounded overhead. Fragment
count does not grow a retained Buffer/object list. Overflow terminates the child and produces
ERROR/OUTPUT_LIMIT; truncated exit 0 cannot become PASS. The retained streams are canonical base64
strings with per-stream lengths, total observed bytes, truncation and `SENSITIVE` metadata. Observed
bytes mean bytes received before completion, not all bytes the child attempted to write. Streams
are not merged into a claimed chronological transcript. Malformed UTF-8 is preserved as bytes.

The first observed stop cause wins among timeout, cancellation, stream errors and output overflow.
Already-aborted signals do not spawn. Signals are checked after asynchronous preflight and again
after registering the process listener, covering immediate-after-spawn races. Once process exit
has been observed, late cancellation does not overwrite the result; remaining output is still
bounded while awaiting close. Exactly one terminal result settles. Timers, capture listeners and
AbortSignal listeners are released on completion.

A timeout/cancellation observed before an exit event can legitimately accompany a later raw exit
code 0: the stop cause wins and the state remains TIMEOUT/CANCELLED, never PASS. Changing only a
successful result's state without changing its observation is rejected. Structural validation is
not authentication of the event sequence; coherent fabricated observations remain outside its claim.
Unavailable preflight outcomes require zero duration/output; overflow must exceed the configured
limit, and retained bytes must equal the smaller of observed bytes and the cap.

Stop attempts kill the **direct child only** with `SIGKILL` and wait for close. A 2-second grace
also bounds pipe closure after exit. If closure is not confirmed, ERROR/TERMINATION_UNCONFIRMED
supersedes any otherwise successful/timeout/cancellation observation, and both executor and workspace
are quarantined. Reuse and automatic disposal are refused. Operator recovery must confirm all
related processes have stopped before cleanup; there is no reaper. If the OS cannot kill a child,
that process may remain alive and hold the controller event loop. API completion is not proof of
whole-tree termination. Trusted fixtures/verifiers must not spawn uncontrolled descendants.

## Workspace and environment

Raw fixture input is exactly `{ kind: "CONTROLLED_FIXTURE", repository, baseCommit, targetCommit,
files: [{ path, contents }] }`. Files are UTF-8 strings, at most 256 files, 1 MiB each and 4 MiB total.
Preparation allocates an unpredictable fresh directory beneath the canonical OS temporary parent;
there is no existing-directory option. POSIX directory/file modes are restrictive; Windows relies
on the trusted user's inherited ACLs, not a separate security principal.

Paths must be portable relative file paths. Parent traversal, absolute paths, backslashes, Windows
reserved names, alternate data streams, trailing dots/spaces and case-insensitive file collisions
are rejected. Preflight checks canonical path containment, root identity, regular single-link files,
manifest hashes, missing/extra files and at most 4,096 tree entries; links and special files reject.
The manifest covers file paths/bytes, not extra empty directories. Cwd is passed explicitly without
`process.chdir()`. Cleanup validates the registered root before removing that exact fixture; it
is not secure erasure. Host filesystem races between validation and use remain out of scope.

`MINIMAL_V1` never spreads `process.env`. Non-Windows children receive an empty environment.
Windows intentionally supplies the 11 variables that libuv otherwise auto-inherits:

| Variables                               | Supplied value                   |
| --------------------------------------- | -------------------------------- |
| SystemRoot, WINDIR                      | Validated host Windows directory |
| SYSTEMDRIVE                             | Drive of that Windows directory  |
| TEMP, USERPROFILE                       | Controlled fixture root          |
| HOMEDRIVE, HOMEPATH                     | Controlled fixture drive/path    |
| PATH, LOGONSERVER, USERDOMAIN, USERNAME | Empty                            |

This explicit set prevents libuv's implicit host fallback
([libuv Windows process environment](https://github.com/libuv/libuv/blob/v1.x/src/win/process.c)).
Tokens, NODE_OPTIONS, host profile/search paths and other host environment values are not copied.
Absolute executable paths avoid PATH lookup. Minimal environment does not prevent a child from
reading host files, discovering credentials elsewhere or using the network. Do not put secrets
in trusted arguments. No raw output or full environment is logged by this module. Public display,
redaction, authorized evidence access and persistence are future responsibilities.

## Versioning and verification

Executor version 7.1.0 is independent of app/classifier/risk/policy/planner versions. Its regression
fingerprint is recorded in `test/execution/version.test.ts`. The guard hashes normalized TypeScript
syntax for every execution source and its relative-import/export dependency closure using pinned
TypeScript 6.0.3. Formatting/comments do not affect it; semantic mutations to protocol, shell mode,
termination, environment or replay do. A semantic change requires explicit version/fingerprint
review, not a blind golden-hash update. Configuration/definition/authority identities separately
bind operator-selected behavior and runtime bytes. They are not cryptographic authorization.

Registry selection, arguments, limits and result association are deterministic for the same inputs.
Program outcomes, output, duration, attempts and workspace paths need not be deterministic.

RiskVerifier-owned trusted verifier fixtures cover real small BUILD typechecking, EXISTING_TESTS
assertions and STATIC_ANALYSIS debugger-statement detection, plus pass/fail/crash/slow/flood/binary
output harness modes. They use already prepared TypeScript/runtime dependencies and never load
repository package scripts or tsconfig. These are limited test fixtures, not full production
strategy implementations. No default production registry is installed. Specialized authorization,
database migration, API contract and other strategies without a supplied real trusted definition
remain UNSUPPORTED; a generic always-pass harness is not specialized verification.

Tests exercise all six result states, literal metacharacters and spaced Windows paths, real fixture
success/failure, secret exclusion, timeout/direct-child termination, cancellation races, byte limits,
missing programs/cwd, plan/config/authority substitutions, changed files/link escape, immutable
results and malformed/accessor/cyclic/sparse public input. Architecture tests retain the Phase 1–6
boundaries and add the single verification process owner. This is engineering validation, not a
claim of sandbox security.

The [Phase 7 adversarial review](PHASE7_REVIEW.md) records the 7.0.0 findings, reproduced failures,
7.1.0 corrections, lifecycle fault injection and final validation. Real Windows child termination
tests probe the child PID after confirmed close. Quarantine tests simulate an OS/pipe close failure
without intentionally leaking real children; this does not prove the OS can always terminate them.

## Remaining limitations

There is no CPU, memory, PID, filesystem, disk, network or process-tree isolation. Runtime/verifier
pins do not prevent hostile-host TOCTOU changes, attest dependencies or authenticate result history.
Workspace context does not attest a real Git snapshot or artifact. There is no automatic dependency
provisioning, broad verifier suite, public output rendering/redaction, persistence or final verdict.
Phase 7 stops at controlled execution and adversarial review. Phase 8 now consumes its existing
result validator through the additive pure `execution/results` package subpath, without modifying
executor source or behavior. See [VERDICT.md](VERDICT.md) for independent evidence binding and
interpretation. The separate Phase 9 backend is now documented in [ISOLATION.md](ISOLATION.md);
host-direct execution remains unchanged and is not implicitly isolated.
