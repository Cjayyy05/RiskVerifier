# Phase 7 adversarial review — executor 7.1.0

## Scope and disposition

Reviewed the 7.0.0 controlled-fixture executor against the supplied security/reliability checklist.
Findings were reported before production edits. Three new regression tests were run against 7.0.0
and failed as expected, then were retained alongside the corrections. No Critical or High issue
was confirmed within the explicitly trusted-host, trusted-verifier, controlled-fixture boundary.
This is not a sandbox or arbitrary-repository security assessment.

## Findings, ordered by severity

### Medium M1 — workspace reuse violates the review's single-attempt freshness requirement

Location: `src/execution/workspace.ts`, `acquireWorkspace` / `releaseWorkspace`.
7.0.0 released its busy flag without recording consumption, so a second execution on a completed
handle succeeded. Reuse was documented in the initial implementation, but the adversarial review
requires a fresh workspace after every outcome. A retry could share process-environment state or
extra empty directories even when original file hashes still match. The correction is a permanent
consumed flag set synchronously on acquisition; restoring files or changing executor cannot reset it.
Invalid requests rejected before acquisition do not consume a handle. Disposal and result replay
remain available; every acquired attempt, including preflight failures, consumes its workspace.

### Medium M2 — fragmented output amplifies retained memory

Location: `src/execution/bounded-execution.ts`, capture storage.
The previous Buffer-array collector retained one Buffer object and array slot per input chunk.
The reproduction emitted 16,384 one-byte chunks and observed 16,384 Buffer allocations. Payload
bytes were capped, but object/allocator overhead grew with fragment count, undermining the bounded
collector claim. The correction uses two fixed-capacity buffers and direct copies, retaining at most
one configured cap of combined payload, with two caps of reserved storage. Base64 output and incoming
chunks add bounded overhead. There is no CPU or whole-process memory quota claim.

### Medium M3 — contradictory observation metadata accepted by result validation

Location: `src/execution/result.ts`, observation validation.
A forged OUTPUT_LIMIT with one observed byte under a 4,096-byte limit validated; unavailable
preflight results could also claim nonzero execution duration. This did not yield live executor
PASS, but weakened the public result contract and could mislead later evidence consumers. The
correction requires exact retained-byte accounting, an actual overflow for OUTPUT_LIMIT, zero
duration for unavailable preflight outcomes, and no execution metadata when definition/policy
availability forbids starting a process. State/protocol mismatches continue to reject.

No Low findings are recorded. Intentionally deferred controls are listed below, not presented as
fixed security guarantees.

## PASS and protocol review

Live PASS requires public plan replay, exact selected check/configuration, registered fresh source-
bound workspace, independent executable/verifier authority, successful pin checks and startup,
normal complete exit 0, no winning stop/error cause and complete bounded output. Exit 42 alone is
the negative verifier protocol outcome; 1, 2, 41, 43, 255, runtime failure codes, negative/no-code and
signal termination cannot become FAIL. Diagnostic words such as PASS/failed have no authority.
Start failures clear libuv error codes rather than treating them as program exit codes.

First observed stop cause wins. A later raw exit 0 after an observed timeout/cancel is legitimate
race metadata, not successful completion: it remains TIMEOUT/CANCELLED. A late abort after the exit
event cannot replace prior completion. Output overflow before close still prevents PASS. An
unconfirmed close produces ERROR and quarantines both executor and workspace. The public validator
checks structural association, not authenticity of a fabricated historical event sequence.

## Authority and filesystem review

No production process owner was added beyond the Git and verification bounded adapters. No shell
or runtime PATH search was introduced. Repository scripts/configuration never select programs.
Definition and configuration identities bind semantic fields; runtime bytes are bound separately
by authority identity. Pinned runtime/verifier bytes are checked at preflight, not atomically held
through execution. Explicitly approved directory aliases are accepted only with matching canonical
basename/content and a location outside the executed workspace. This is not protection against
hostile-host path swaps or changed transitive verifier dependencies.

Fresh allocation, registered handle identity, source labels, canonical containment, root identity,
manifest files, links and special files remain checked. Acquisition and disposal reserve ownership
before asynchronous work. Quarantine prevents cleanup/reuse even from a different executor. The
quarantine fault test uses a simulated child that never closes; it does not leak a real process.
Only its test harness removes that exact temporary fixture after confirming no real child existed.
Real-child tests probe PID absence after confirmed close before disposable fixture cleanup.

## Adversarial coverage

- Regression reproductions for M1/M2/M3, including detached output bytes and contradictory outcomes.
- Full 0/1/2/41/42/43/255 protocol matrix with deliberately misleading stdout/stderr text.
- Real signal termination; simulated negative/null exits and EACCES/ENOEXEC/ENOENT startup errors.
- Actual missing verifier/executable/cwd; changed verifier pin and invalid runtime bytes.
- Invalid plan ID/check/strategy/source/configuration/capability/handling with a spawn-call counter
  proving zero launches; identity-bound definition substitution and wrong-check result reuse.
- Real Windows children checked absent after PASS/FAIL/crash/timeout/cancel/overflow, with disposal
  checks and consumed-workspace rejection. Existing tests cover already-aborted and streaming aborts.
- Thirty deterministic timeout/exit orderings and thirty cancellation/exit orderings per run,
  preserving first-event precedence, exactly one settlement and AbortSignal listener cleanup.
- Quarantine refusal on the original executor, a new executor, a fresh workspace and disposal.
- Fixed-storage capture under 16,385 one-byte chunks; existing combined-stream/multibyte tests.
- Fake AWS/GitHub/database/custom secrets, NODE_OPTIONS and mixed-case Windows PATH canaries,
  plus quoted/backtick/pipe/redirection arguments passed literally.
- Explicit directory alias behavior and malformed absolute paths; existing traversal, junction,
  collision, accessor, sparse/cyclic DTO, immutability and process-boundary architecture tests.

No test uses an arbitrary downloaded/production repository for verification, installs dependencies
or delegates to its package scripts. The BUILD, EXISTING_TESTS and STATIC_ANALYSIS programs remain
limited RiskVerifier-owned fixtures; no production strategy registry is installed.

## Version and validation

Executor changes to **7.1.0** because the workspace lifecycle and result invariants changed.
7.0.0's fingerprint is retained as historical metadata; 7.1.0 has its own semantic fingerprint.
Classifier 3.1.0, risk 4.1.0, policy 5.1.0 and planner 6.0.0 sources/fingerprints are unchanged.
TypeScript 6.0.3 remains the only runtime dependency. No dependencies were added.

Final validation on Windows, Node v26.8.2:

| Check                                              | Result                                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm test`                                         | 243 passed; zero failures, cancellations, skips or TODOs                                             |
| Phase 1–6 and architecture/process-boundary guards | Passed within the full suite; earlier sources unchanged                                              |
| Three additional lifecycle-test runs               | 6/6 each; 18 grouped tests, including 180 deterministic race orderings and real-child/cleanup checks |
| `npm run typecheck`                                | Passed                                                                                               |
| `npm run lint`                                     | Passed                                                                                               |
| `npm run build`                                    | Passed                                                                                               |
| `npm run format:check`                             | Passed; changed execution/review docs also explicitly checked because the default ignores docs       |
| `node dist/cli.js --version`                       | `0.1.0`                                                                                              |
| `npm audit --audit-level=high`                     | Zero vulnerabilities; network-enabled retry after sandbox request failed                             |
| `git diff --check`                                 | Passed; Git emitted only LF/CRLF conversion warnings                                                 |

Post-review executor fingerprint:
`e4ac2f1f3934ed6bfa219b33e60b7af770cd8bc7dd103bf72a00c06c567069d9`.
Phase 7 appears ready as the controlled-fixture baseline for subsequent Phase 8 work. This review
does not begin that work and makes no deployment verdict. No commit or push was performed.

## Intentionally deferred limitations

No OS sandbox, hostile-repository safety, process-tree termination, CPU/memory/PID/disk/network
isolation, dependency attestation/provisioning, result-history authentication, secret redaction,
persistence, HTTP, AI or deployment verdict. Trusted verifiers can access host filesystem/network.
Host TOCTOU is out of scope. A failed OS kill can leave a direct child alive and keep the controller
event loop alive; quarantine is fail-closed handling, not a reaper or termination proof. Preflight
filesystem calls have no hard deadline against a stalled host filesystem. Phase 9 and further
review are required before broadening trust. Phase 8 is not implemented by this review.
