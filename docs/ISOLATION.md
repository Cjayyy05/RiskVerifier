# Phase 9 — isolated controlled-fixture execution

## Purpose and threat model

Version `9.1.0` provides the reviewed Docker Linux-container backend. It changes where a trusted verifier
runs, not verification selection, the plan, exit protocol or verdict semantics. It remains restricted
to RiskVerifier-owned, operator-approved verifier programs and disposable controlled fixture inputs.
It does not check out or run arbitrary analyzed repositories, package scripts, Dockerfiles, README
instructions, dependency installers or generated shell commands.

```text
Containerized != perfectly safe
Docker isolation != hostile-host protection
Docker isolation != proof against container escape
PASS != APPROVE
```

The host, Docker CLI/daemon, Docker Desktop VM/kernel, image/runtime and approved verifier are trusted.
The controls reduce ordinary filesystem, network, secret and resource exposure. They are not a
malicious-code security proof and do not protect against Docker/kernel/hypervisor/verifier exploits,
container escapes or a compromised host. Hostile-host TOCTOU remains outside the claim.

## Public API and authority

`riskverifier/isolation` exports `parseIsolationConfiguration`, `validateIsolationConfiguration`,
`createContainerExecutor`, `validateContainerResult`, types and `ISOLATION_VERSION`.

The operator supplies a schema-9 configuration with immutable image ID and `node@sha256:...`
repository digest, non-root UID/GID, bounded resources and per-strategy definitions. Definitions
contain an absolute trusted `.mjs` verifier path, its SHA-256 pin, a bounded literal argument array,
producer version, timeout and output cap. No executable/shell/mount/network override is accepted.
The constructor requires a separately supplied absolute Docker CLI path, expected CLI SHA-256 and
the explicit local Docker Desktop Linux-engine named pipe. Neither PATH nor repository metadata
selects executables. Snapshot validation/digests do not establish operator authorization.

```ts
const executor = await createContainerExecutor(trustedConfiguration, {
  dockerExecutable: approvedAbsoluteDockerPath,
  dockerSha256: independentlyApprovedDockerPin,
  endpoint: "npipe:////./pipe/dockerDesktopLinuxEngine",
});
const result = await executor.executeCheck(
  { planningInput, plan, checkId, workspace },
  abortSignal,
);
```

The plan must be replay-valid against independent planning inputs and bind the schema-9
configuration identity. Existing Phase 1–8 source/contracts and fingerprints are unchanged. The
isolation module reuses the existing package-internal controlled-workspace and pure validation
functions without adding new authority to the public host executor.

The executable and verifier are canonical, bounded regular files, not symlinks/hardlinks or aliases.
Pins are checked before each attempt. Neither Docker CLI nor verifier location may be inside the source workspace.
Canonical Windows paths containing spaces are supported; ambiguous paths, dot segments, CSV mount
delimiters, traversal and unsupported path forms reject. Caller DTOs are copied/validated; returned
configuration, provenance and result records are recursively frozen and contain no mutable Buffers.

## Pre-provisioned image

This environment was explicitly approved to use the existing local `node:22-alpine` image:

```text
Image ID:
sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

Repository digest:
node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

Docker CLI:
C:\Users\Teoh Chung Jay\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe
```

Locally inspected metadata reports Node `22.23.2`, Linux/amd64. No Node 24 image was present.
The production path inspects the exact image ID and matches its repository digest, OS and architecture
before create. It rejects anonymous-volume declarations and unexpected image environment keys;
only the approved Node image's PATH/NODE_VERSION/YARN_VERSION metadata is allowed. Image ID, digest,
command, resources and security profile participate in configuration identity. A digest is content
identity, not proof of signed provenance. Tags are not executable authority.

There is no pull/build operation in this backend or integration suite. Create explicitly uses
`--pull=never`. A missing image is ERROR, never a fallback, implicit download or valid verifier FAIL.
Preparing a different image is a separate operator task, not part of execution.

## Fixed security profile

| Area            | Enforced configuration                                                                        |
| --------------- | --------------------------------------------------------------------------------------------- |
| User            | Explicit positive numeric UID:GID; integration uses 1000:1000                                 |
| Network         | `none`; no published ports, host network or added hosts                                       |
| Privilege       | Drop ALL capabilities, no-new-privileges; no added capabilities/devices/privileged mode       |
| Namespaces      | Private/default PID, private cgroup namespace, IPC disabled; no host namespace flags          |
| Root filesystem | Read-only, image healthcheck disabled, no restart policy                                      |
| Source          | Registered controlled fixture only, read-only `/workspace`, recursive bind inclusion disabled |
| Verifier        | One separately trusted pinned file, read-only `/verifier.mjs`                                 |
| Scratch/temp    | `/scratch` and `/tmp` tmpfs; bounded, noexec/nosuid/nodev, configured non-root ownership      |
| Process         | Docker init for reaping; explicit entrypoint `/usr/bin/env`, then absolute Node executable    |
| Environment     | `env -i`, then fixed PATH, HOME=/scratch, TMPDIR=/tmp and LANG; no host credentials           |
| Logging         | Docker log driver disabled; attached streams are byte-bounded in the controller               |
| Resource limits | Memory and memory+swap set equal, CPU quota, PID cap, bounded file descriptors                |

`/usr/bin/env -i` is a structured executable invocation, not a shell. It replaces the image's default
`docker-entrypoint.sh`, removes image environment from the verifier, and invokes
`/usr/local/bin/node -- /verifier.mjs ...literalArgs`. Repository content never supplies these tokens.
Images with loader-affecting environment variables are rejected before starting this entrypoint.

No Docker socket/control pipe, home directory, SSH directory, cloud configuration, environment file,
Docker credentials or arbitrary host directory is mounted. The two host mount roles and two tmpfs
roles are fixed, distinct and non-overlapping. Image content is trusted; source symlinks and special
files are rejected by the existing fixture manifest validator rather than followed into new mounts.

Memory is 32–1024 MiB, CPU is 100–2000 millicores, PIDs are 16–128, each tmpfs is 1–64 MiB, and
execution timeout is 100–120000 ms. Combined retained verifier output is 1–1048576 bytes. There is
no unbounded/zero resource setting. tmpfs limits do not claim a quota on every daemon disk operation;
Docker resource enforcement and Docker Desktop's VM remain trusted/runtime-dependent. Equal memory
and swap limits request no additional container swap; no claim is made about host/VM swap behavior.

## Lifecycle and cleanup

The dedicated `docker-adapter.ts` owns all Docker subprocess creation and lifecycle operations.
Invocations use the trusted executable plus individual args, `shell:false`, `windowsHide:true`, and
a private temporary Docker CLI configuration directory. Host environment is minimal; ambient Docker
contexts, credentials, PATH, endpoint variables and profile files are not inherited.

1. Replay plan; bind configuration/check/workspace; consume the single-attempt workspace.
2. Validate workspace manifest and program pins. Check Linux/amd64 daemon and local immutable image.
3. Generate a private UUID instance/name and diagnostic labels. Create a restricted fresh container.
4. Record the exact 64-hex container ID. Inspect ID, image binding, instance label and fresh state.
5. Start/attach with bounded streams and deadline/cancellation handling.
6. Inspect actual container state; never infer container termination from Docker CLI exit alone.
7. Kill a still-running exact ID, confirm non-running state, then remove that exact ID without force.

Before starting and on each subsequent inspect, verify both configured and resolved image identity,
entrypoint/arguments/user, network, privilege/security options, namespace settings, init/restart/logging,
memory/swap, CPU `NanoCpus` (from `--cpus`), PIDs, file-descriptor cap, tmpfs options and the two exact
read-only bind mounts. Inspect mount order is normalized; duplicate destinations, altered paths or
unexpected mounts still reject. Docker's optional `OomKillDisable` may be false or null, never true.
Unknown inspect representations fail closed rather than relaxing restrictions. Applied resource and
mount assertions are retained in compact `appliedProfile` provenance only after successful validation.

PASS/FAIL requires a confirmed normal container exit, no daemon state error, no OOM, an actual start,
and agreement between attached CLI exit and container exit. Exit 0 is PASS, reserved 42 is FAIL,
other normal exits are ERROR through the existing Phase 7 protocol. Docker start/create/mount/image/
runtime faults and OOM are infrastructure errors, not valid negative verification evidence.
Normal-exit proof also requires a zero PID and valid ordered nonzero start/finish timestamps. Final
inspection must agree with the accepted exit, including its timestamps; a contradiction invalidates
both PASS and FAIL even when the exact container can subsequently be terminated and removed.

Timeout/cancellation/output overflow immediately disallow success. Local CLI termination is followed
by exact-container kill/inspection; stopping only the CLI is insufficient. Command/control output
is capped at 64 KiB; verifier attached output uses its configured combined raw-byte cap. Two fixed
buffers retain bounded stdout/stderr; fragmented chunks cannot create an unbounded chunk list.
Diagnostics remain base64, byte-counted and SENSITIVE, not future API-safe text.

The execution deadline covers the Docker lifecycle before cleanup; each control operation is also
capped at 10 seconds, while attachment uses the remaining execution deadline. Cleanup operations
have independent five-second bounds plus two-second CLI termination grace. Cleanup may therefore
extend wall time beyond the verifier deadline, but is a finite sequence, not an unbounded retry loop.
Cancellation/timeout observed before entering cleanup disallows success, including a simultaneous
zero exit. Confirmed output overflow also disallows success and takes the OUTPUT_LIMIT classification.
Entering cleanup ends cancellation/deadline observation: later aborts cannot interrupt mandatory
cleanup or rewrite an already observed execution outcome. Removal uncertainty still overrides it.

If termination, CLI closure or removal is uncertain, return ERROR with the existing conservative
`TERMINATION_UNCONFIRMED` representation, quarantine executor/workspace, and retain resources for
operator inspection. This also covers a normal PASS followed by removal failure: it is **not PASS**.
The representation conservatively includes cleanup uncertainty even when the container is known
stopped. A create failure with no usable ID is treated as ambiguous and quarantined; no name-based
delete is attempted. Generated instance names help operators investigate; automatic management
requires the exact validated ID. There is no broad enumeration/delete, force-remove or reaper.

Operators should preserve the returned container ID/instance and controlled workspace path, inspect
only that instance, and confirm termination before manual disposal. Quarantined workspaces cannot
be removed through the normal disposal API. No attempt reuses a container or a consumed workspace.
Ordinary confirmed runs remove the container and private CLI directory; callers then dispose the
controlled fixture using Phase 7's existing API.

## Result compatibility and provenance

`ContainerResult` explicitly identifies backend `DOCKER_LINUX`, isolation version/configuration,
container ID and internal instance, immutable image and repository digest, observed Docker version,
OOM/cleanup metadata and execution observation. It wraps an unchanged `ExecutionCheckResult`.
Its `executorVersion:7.1.0` identifies the reused Phase 7 result protocol; `isolationVersion:9.1.0`
identifies the actual producing backend. It must not be described as host-direct execution.

Definition identity binds the isolation configuration, fixed profile, version and trusted verifier.
Authority identity additionally binds the Docker pin/endpoint and full container provenance. Therefore
the execution result's independently captured Phase 8 digest also binds backend/provenance indirectly.
Consumers must retain the envelope to resolve those hashes to readable container provenance.
`validateContainerResult(trustedEnvelope, candidate)` performs exact comparison and Phase 7 validation
against an independently retained trusted envelope, not a self-authenticating historical record.

The trusted capture boundary can pass `result.execution` to Phase 8's existing
`captureExecutionEvidence`, then evaluate it using the unchanged plan and independently retained
references. No verdict logic exists in isolation. Optional omission, review-required coverage,
BLOCK precedence and incomplete-evidence treatment remain version 8.1.0 semantics.

SHA-256 and replay do not prove that historical execution happened. Authenticated persistence,
durable run lifecycle and provenance acquisition remain later-phase responsibilities.

## Platform and source limits

Currently supported/tested: Windows host, local Docker Desktop Linux/amd64 engine and the explicitly
approved Node Alpine image. Windows containers, ARM, remote Docker endpoints and Linux host controllers
are not claimed; the public constructor rejects non-Windows hosts and other endpoints. Pure unit
tests remain Docker-independent. Host paths with spaces and literal metacharacters are tested.

There is no exact repository checkout/materialization implementation. Source is a bounded registered
fixture manifest labeled with the plan's exact source context, not proof that fixture contents came
from that commit. No current developer working tree is automatically mounted. General-repository
dependency provisioning remains unresolved; the verifier must use dependencies already approved
in its image or its own mounted trusted file.

## Version and tests

Isolation version: `9.1.0`. Configuration identity uses canonical DTOs plus the fixed profile and
isolation version. The source fingerprint covers isolation and its relative dependencies, including
plan replay, fixture safety, pure DTO validation and Phase 7 protocol. The reviewed fingerprint is
recorded in `test/isolation/version.test.ts`; version 9.0.0 identities are intentionally superseded.
Changing semantic rules trips the guard; comments/formatting do not. Execution itself is not
deterministic; only selection/configuration and interpretation are deterministic.

Normal `npm test` runs all existing regression tests plus isolated configuration/lifecycle tests
using an internal fake transport, without requiring Docker. The explicit integration command is:

```text
npm run test:isolation
```

This compiles and runs `integration/isolation.test.ts` separately; no silent Docker skips exist.
It requires the documented CLI, running daemon and approved local immutable image. Missing
prerequisites fail the command; no downloads/builds/installers are attempted. Its test runner is
RiskVerifier-owned development infrastructure, not execution of analyzed repository npm scripts.
`integration/verifier.mts` is the only verifier fixture used; compiled bytes are pinned before use.

The tests cover protocol/Phase 8 compatibility, local missing images and definitions, non-root,
read-only source/root/verifier, writable scratch/temp, denied network/no external interface,
capability/no-new-privileges status, fake secret exclusion, absent Docker socket, literal arguments,
timeout/cancel/output overflow, bounded OOM/PID exhaustion and exact container removal. Fault-injected
unit tests cover ambiguous create, start/inspect/removal faults and conservative quarantine without
deliberately orphaning real containers or destabilizing Docker. Existing Phase 7 tests remain intact.
The local network regression first proves an owned, bounded bridge-network peer is reachable from a
separate positive-control container, then proves it is unreachable from the production network-none
executor. The peer remains running after executor cleanup; the test then terminates/removes its own
exact control IDs. No public network or DNS availability is used as evidence of isolation.
Source create/overwrite/rename/delete all fail, scratch writes succeed, and the complete host source
manifest is revalidated. Provenance mutations and mixed-case Docker endpoint/context canaries reject
or remain excluded. Deterministic lifecycle/abort race loops repeat five times.

CLI flags were checked against Docker's [create reference](https://docs.docker.com/reference/cli/docker/container/create/)
and [runtime documentation](https://docs.docker.com/engine/containers/run/). Actual enforcement claims
above are scoped to the exercised Docker Desktop/Linux environment, not all versions/platforms.

## Recorded validation — 2026-10-04

- Ordinary suite: `npm test`, 290 passing tests (274 earlier-phase regressions plus 16 Phase 9 tests),
  no failures/skips/cancellations. Multi-scenario lifecycle tests include wrong-ID protection,
  unkillable-container quarantine, ambiguous create and failed removal.
- Explicit Docker suite: `npm run test:isolation`, eight passing tests, no failures/skips/cancellations.
  Real containers executed the approved local Node image; absence/error/quarantine fault cases also
  have separate deterministic unit coverage. Integration results are not inferred from mocks.
- Docker daemon was available: Docker Desktop 4.90.0, Engine 29.7.2, Linux/amd64,
  kernel 6.18.33.2-microsoft-standard-WSL2; containerd 2.3.3 and runc 1.4.3.
- Typecheck, lint, build, ordinary formatting, explicit ISOLATION.md formatting, CLI version (`0.1.0`)
  and `git diff --check` passed. npm audit reported zero vulnerabilities.
- Final read-only query found no remaining containers with `riskverifier.managed=phase9`.
  No unrelated containers were stopped or removed.
- Phase 1–8 production sources, Phase 7 execution tests and Phase 8 verdict tests remain unchanged;
  their semantic source fingerprints and regression tests pass. The global process-owner allow-list
  adds exactly `isolation/docker-adapter.ts`, retaining both existing owners and shell restrictions.
- No runtime/development dependencies were added or installed. No image was pulled or built.
  No analyzed-repository npm script, arbitrary repository command or dependency installer ran.

See `PHASE9_REVIEW.md` for findings, corrections and reviewed baseline status. This is not a claim of
unconditional sandbox security. Phase 10,
HTTP, DeployFlow and AI remain unimplemented. No commit or push was made.
