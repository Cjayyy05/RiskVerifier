import { createComponentVersion, type CheckResultState } from "../../src/domain/index.js";
import { generateVerificationPlan, type PlanningInput } from "../../src/planning/index.js";
import {
  noProcess,
  type ExecutionBinding,
  type ExecutionCheckResult,
  type ProcessObservation,
} from "../../src/execution/result.js";
import {
  captureExecutionEvidence,
  type EvidenceInput,
  type ExecutionEvidenceReference,
} from "../../src/evidence/index.js";
import { planningFixture } from "../planning/fixture.js";

/** Synthetic protocol fixtures, not claims that any verifier was executed. */
export function evidenceFixture(
  states: readonly CheckResultState[] = [],
  planningInput: PlanningInput = planningFixture(["TEST"]),
): { input: EvidenceInput; references: readonly ExecutionEvidenceReference[] } {
  const plan = generateVerificationPlan(planningInput);
  const results: ExecutionCheckResult[] = plan.checks.map((check, index) => {
    const state = states[index] ?? "PASS";
    const uuid = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const binding: ExecutionBinding = {
      executorVersion: createComponentVersion("7.1.0"),
      authorityId: `authority:sha256:${"a".repeat(64)}`,
      planId: plan.id,
      context: plan.context,
      check,
      definition:
        state === "UNSUPPORTED"
          ? null
          : {
              id: `definition:sha256:${"b".repeat(64)}`,
              version: "fixture-v1",
              maxOutputBytes: 4096,
              timeoutMs: 1000,
            },
      workspace: { id: `workspace:${uuid}`, snapshotSha256: "c".repeat(64) },
    };
    const observation: ProcessObservation =
      state === "UNSUPPORTED"
        ? noProcess("DEFINITION_MISSING")
        : state === "CANCELLED"
          ? noProcess("CANCELLED")
          : state === "TIMEOUT"
            ? {
                ...noProcess("TIMEOUT"),
                started: true,
                durationMs: 1000,
                terminationSignal: "SIGKILL",
              }
            : {
                ...noProcess("EXITED"),
                started: true,
                durationMs: 10,
                exitCode: state === "PASS" ? 0 : state === "FAIL" ? 42 : 1,
              };
    return { binding, attemptId: `attempt:${uuid}`, state, observation };
  });
  const references = results.map((result) =>
    captureExecutionEvidence(planningInput, plan, result.binding, result),
  );
  return { input: { planningInput, plan, results }, references };
}

export function altered<T>(input: T, path: readonly (string | number)[], value: unknown): T {
  const copy = structuredClone(input);
  let target = copy as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string | number, unknown>;
  target[path.at(-1)!] = value;
  return copy;
}
