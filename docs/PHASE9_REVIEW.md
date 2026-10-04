# Phase 9 adversarial review — 2026-10-04

Scope: local Windows Docker Desktop, RiskVerifier-owned controlled fixtures and the explicitly
pre-provisioned Node image. Phases 0–8 remain approved, unchanged baselines. Findings were reported
before production changes. No Phase 10 implementation, commit or push is included.

## 1. Findings

Critical: none confirmed. High: none confirmed. Medium: three confirmed. Low: none separately filed.

### M1 — Insufficient post-create image/profile verification

Location: `src/isolation/docker-adapter.ts`, `inspect()`.

The original code matched `Config.Image` but ignored resolved `Image`, and did not verify applied
HostConfig, commands or mounts. Unexpected runtime configuration could escape detection and a normal
zero exit could become PASS. A fault-injection regression demonstrated acceptance of a substituted
resolved image. This is an integrity-check gap under runtime inconsistency or accidental regression,
not an assertion that an untrusted repository can change a trusted daemon's image resolution.

Expected/correction: match both identities and the applied fixed profile before start and during
later observations. Reject missing, weakened or conflicting settings. Implemented in `inspection.ts`.

### M2 — Exit proof could survive conflicting or ambiguous metadata

Location: `src/isolation/docker-adapter.ts`, post-attach acceptance and final cleanup.

After accepting exit zero, final inspection could report a different exit, state or start time and
still preserve PASS if removal succeeded. An explicit changed-exit regression reproduced this before
the fix. The original start proof also accepted empty/non-timestamp strings. A runtime observation
inconsistency must not be interpreted as trustworthy verifier evidence, even with successful cleanup.

Expected/correction: require normal exited flags, zero PID, parseable ordered start/finish timestamps,
no OOM/error, and agreement with the attach exit. Final metadata must remain consistent with the
accepted exit and timestamps. Contradictions become ERROR; safe exact-ID cleanup may still proceed.

### M3 — Workspace-local Docker executable not explicitly rejected

Location: `src/isolation/executor.ts`, source/authority separation in `executeCheck()`.

The verifier was excluded from the fixture workspace but the Docker executable was not. An operator
mistakenly approving a workspace-local binary and its matching hash could turn source into host
execution authority. This requires mistaken trusted configuration, not a hash-preimage attack.

Expected/correction: reject Docker authority inside the source root before acquisition/execution,
including case-insensitive Windows containment. A pinned non-executable fixture demonstrates the
rejection without executing it. Trusted configuration remains necessary outside this containment check.

## 2. Fixes made

- Added strict inspect validation and compact validated applied-profile provenance.
- Invalidated accepted exits after contradictory metadata; strengthened initial exit proof.
- Rejected workspace-local Docker executables before consuming the workspace.
- Bumped isolation version to **9.1.0**. Reviewed semantic dependency fingerprint:
  `db3d370de56ac02264a37692de4b370cac3a17038c9e7433d1c19482798699bf`.
- Added focused regressions and stronger real-container assertions without changing earlier phases.

## 3. PASS/isolation integrity

PASS requires a replay-valid plan, exact check/configuration/definition, validated fixture and program
pins, inspected immutable image and applied profile, normal matching zero exits, no winning stop,
no OOM/error, stable final state and confirmed removal. Inspect failure, missing container, unknown
CLI closure, unkillable state or removal failure becomes ERROR/quarantine, never PASS or valid FAIL.

## 4. Image authority

Execution uses exactly:

`sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32`

Repository provenance is `node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32`.
It is checked metadata, not signed authentication. Mutable-tag-only configuration rejects. Simulated
tag movement leaves immutable-ID execution unchanged; the user's actual tag was not modified.
Image inspect, create and resolved container image agree. `--pull=never` prevents implicit fetching.

## 5. Container restrictions

Every successful real attempt validates actual inspect settings: explicit non-root user, network none,
read-only root, dropped ALL capabilities, no-new-privileges, private namespaces, no privileged/devices,
fixed entrypoint and literal arguments, no healthcheck/restart, init, no persistent Docker logs,
memory/swap bytes, NanoCpus, PIDs, nofile cap, bounded tmpfs options and exact read-only mounts.

Inside-container tests independently confirm UID 1000, zero effective capabilities, no-new-privileges,
no external interface, socket/secret absence, denied writes and successful scratch/temp writes. A
reachable controlled bridge peer provides a positive network control; network-none cannot reach it.
Only the test-owned positive controls use bridge, never the production executor. No ports are published.

## 6. Lifecycle integrity

Fresh UUID instance per attempt; all start/inspect/kill/remove operations use the validated full
returned ID. Labels/names are diagnostics, not kill authority. Malformed IDs never reach lifecycle
commands. Stopping the CLI is followed by independent container inspection/termination.

Pre-cleanup abort or timeout disallows success; overflow also disallows success. Repeated deterministic
tests cover abort around create/start/observation, late zero exits, and overflow/timeout. Cleanup is
mandatory and independently bounded; abort during cleanup or after completion does not rewrite the
already observed execution outcome. Cleanup uncertainty overrides both PASS and FAIL. Quarantine
prevents normal reuse/disposal but is not a reaper. Instance/ID remain available for operator recovery.

## 7. Host filesystem safety

Only an opaque registered single-attempt fixture and separately pinned verifier are mounted. Existing
canonical-root, regular-file, manifest, hardlink and symlink/junction checks remain unchanged. Added
tests cover workspace-local Docker, junction aliases, drive casing, alternate separators, traversal,
UNC/device/ADS paths, trailing dots/spaces and sibling-prefix containment. Fixed mount destinations
cannot overlap or accept caller mount extensions. All four source mutations fail in Docker, then the
entire host manifest is revalidated. Windows device/FIFO creation is not claimed as a real OS test.

## 8. Runtime/exit semantics

Normal verifier exits 0/42 map to PASS/FAIL; other exits map to ERROR. CLI error alone is never proof
of verifier exit. OOM overrides valid-exit interpretation. Memory tests use a 64 MiB container; PID
tests request only 32 child processes under a 24-PID cap. The PID fixture deliberately exits zero
after confirming spawn failures: it tests enforcement, not a generic resource-fault classification.
Trusted verifiers must reserve 42 for actual failed verification, never infrastructure exceptions.
There is no complete cgroup resource-event collector or CPU-exhaustion detector.

## 9. Provenance

Backend/version/config, image/digest, instance/container, applied-profile evidence, runtime version,
OOM/removal and execution observation are bound through the authority identity and trusted envelope.
Definition, workspace, plan, check and outcome remain Phase 7 bound data. Mutation tests cover those
fields and backend substitution. Exact comparison requires an independently retained trusted capture;
hashes are not historical authentication and a forged capture plus forged candidate is not secured.

## 10. Phase 8 compatibility

Real container PASS/FAIL/ERROR produce APPROVE/BLOCK/INCONCLUSIVE under the unchanged plan. Timeout,
cancel, overflow, missing image and missing definition remain inconclusive as applicable. Phase 8
sources/tests and fingerprints are unchanged; baseline tests retain optional omission, known evidence,
material review coverage, mixed-state precedence and malformed/unbound result rejection.

## 11. Tests

Ordinary suite: **290 tests**, including 274 earlier-phase regressions and 16 Phase 9 tests.
Real Docker suite: **8 tests**, multiple container scenarios within each. No failures, skips or
cancellations in completed validation runs. Two further repetitions of the timeout/overflow and
cancellation tests supplement five repeated deterministic lifecycle-race loops.

Mutation guards cover pull/network/rootfs, capability/no-new-privileges, entrypoint/source mount,
memory/CPU/PID validation, shell, exit acceptance, cleanup, plan replay and workspace consumption.

## 12. Validation

All requested checks passed: npm test (290/290), typecheck, lint, build, format:check, CLI version
0.1.0, npm audit (zero vulnerabilities), git diff --check and explicit Docker integration (8/8).
Both additional lifecycle repetitions passed (2/2 each), with zero skips. Final read-only Docker
inventory found no Phase 9 containers remaining, and no private CLI-control directories remain.
Docker Desktop **4.90.0 (238679)**, Engine **29.7.2**, Linux/amd64;
Node image metadata **22.23.2**. Local engine pipe and absolute pinned CLI are explicit; ambient
mixed-case DOCKER_HOST/DOCKER_CONTEXT values cannot redirect production execution.

During development, the first strict-inspection suite quarantined six test containers because Docker
normalizes mount order and changes optional OomKillDisable from false to null after start. Inspection
confirmed these representations; validation now permits only those harmless differences. The six
exact test containers were independently inspected, two running timeout fixtures killed, and all six
removed without force. Their six fixture and six empty CLI-control directories were subsequently
validated and deleted. These were disposable generated test artifacts, not user data. No unrelated
container was modified. The final successful suites confirm exact-ID absence after each attempt.

No pull/build, dependency install, analyzed-repository npm script, arbitrary repository command,
DeployFlow, HTTP, persistence/job implementation or AI was introduced/executed. Requested development
npm validation commands belong to RiskVerifier itself, not the analyzed fixtures.

## 13. Documentation changes

Updated `ISOLATION.md` with 9.1.0 profile evidence, exit/cleanup boundary, network positive control,
new tests and counts. Added this review. Existing Phase 9 architecture/security/execution/module and
implementation-plan documentation remains scoped to the separate container backend.

## 14. Remaining limitations

Trusted host/daemon/kernel/image/verifier; no hostile-host TOCTOU, container-escape or authenticated
history guarantee. Windows Docker Desktop Linux/amd64 and observed inspect representations only.
Controlled fixture manifests are not exact Git checkout proofs. No arbitrary repository execution,
dependency provisioning, remote daemon support, automatic quarantine reaper or generic resource-event
classification. Unexpected Docker representations intentionally fail closed.

## 15. Phase readiness

Ready to serve as the Phase 10 baseline with all requested validation green, within the
documented controlled-fixture scope. This review does not start Phase 10 and does not claim a universal
hostile-code sandbox. No commit or push.
