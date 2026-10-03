import {
  InvalidInputError,
  type CheckResultState,
  type PlanContext,
  type PlannedVerificationCheck,
  type VerificationPlanId,
} from "../domain/index.js";
import { type EXECUTOR_VERSION, MAX_OUTPUT_BYTES } from "./configuration.js";
import { freeze, integer, list, record } from "./validation.js";

export type ProcessOutcome =
  | "EXITED"
  | "START_ERROR"
  | "PROCESS_ERROR"
  | "TIMEOUT"
  | "CANCELLED"
  | "OUTPUT_LIMIT"
  | "TERMINATION_UNCONFIRMED"
  | "EXECUTABLE_UNAVAILABLE"
  | "VERIFIER_UNAVAILABLE"
  | "WORKSPACE_UNAVAILABLE"
  | "DEFINITION_MISSING"
  | "POLICY_UNAVAILABLE";
const outcomes: readonly ProcessOutcome[] = [
  "EXITED",
  "START_ERROR",
  "PROCESS_ERROR",
  "TIMEOUT",
  "CANCELLED",
  "OUTPUT_LIMIT",
  "TERMINATION_UNCONFIRMED",
  "EXECUTABLE_UNAVAILABLE",
  "VERIFIER_UNAVAILABLE",
  "WORKSPACE_UNAVAILABLE",
  "DEFINITION_MISSING",
  "POLICY_UNAVAILABLE",
];
export interface ExecutionDiagnostics {
  readonly encoding: "base64";
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly observedBytes: number;
  readonly truncated: boolean;
  readonly sensitivity: "SENSITIVE";
}
export interface ProcessObservation {
  readonly outcome: ProcessOutcome;
  readonly started: boolean;
  readonly exitCode: number | null;
  readonly terminationSignal: string | null;
  readonly durationMs: number;
  readonly terminationConfirmed: boolean;
  readonly diagnostics: ExecutionDiagnostics;
}
export interface ExecutionBinding {
  readonly executorVersion: typeof EXECUTOR_VERSION;
  readonly authorityId: string;
  readonly planId: VerificationPlanId;
  readonly context: PlanContext;
  readonly check: PlannedVerificationCheck;
  readonly definition: {
    readonly id: string;
    readonly version: string;
    readonly maxOutputBytes: number;
    readonly timeoutMs: number;
  } | null;
  readonly workspace: { readonly id: string; readonly snapshotSha256: string };
}
/** Intermediate execution evidence; not canonical run Evidence or a deployment decision. */
export interface ExecutionCheckResult {
  readonly binding: ExecutionBinding;
  readonly attemptId: string;
  readonly state: CheckResultState;
  readonly observation: ProcessObservation;
}

export function noProcess(outcome: ProcessOutcome): ProcessObservation {
  return {
    outcome,
    started: false,
    exitCode: null,
    terminationSignal: null,
    durationMs: 0,
    terminationConfirmed: true,
    diagnostics: {
      encoding: "base64",
      stdout: "",
      stderr: "",
      stdoutBytes: 0,
      stderrBytes: 0,
      observedBytes: 0,
      truncated: false,
      sensitivity: "SENSITIVE",
    },
  };
}

export function resultState(observation: ProcessObservation): CheckResultState {
  if (observation.outcome === "EXITED") {
    if (observation.exitCode === 0) return "PASS";
    if (observation.exitCode === 42) return "FAIL";
    return "ERROR";
  }
  if (observation.outcome === "TIMEOUT" || observation.outcome === "CANCELLED")
    return observation.outcome;
  if (observation.outcome === "DEFINITION_MISSING" || observation.outcome === "POLICY_UNAVAILABLE")
    return "UNSUPPORTED";
  return "ERROR";
}

/** Exact comparison without getters, insertion-order dependence, or trusting caller prototypes. */
function assertBinding(input: unknown, expected: unknown): void {
  if (expected !== null && typeof expected === "object") {
    if (Array.isArray(expected)) {
      const actual = list(input, expected.length);
      if (actual.length !== expected.length) throw new InvalidInputError("Result binding differs");
      expected.forEach((value, index) => assertBinding(actual[index], value));
    } else {
      const actual = record(input, Object.keys(expected));
      for (const [key, value] of Object.entries(expected)) assertBinding(actual[key], value);
    }
  } else if (input !== expected)
    throw new InvalidInputError("Result does not match its trusted binding");
}

function diagnosticBytes(input: unknown, length: unknown): { encoded: string; length: number } {
  const bytes = integer(length, 0, MAX_OUTPUT_BYTES);
  if (
    typeof input !== "string" ||
    input.length !== Math.ceil(bytes / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(input)
  )
    throw new InvalidInputError("Diagnostic output is not bounded canonical base64");
  const decoded = Buffer.from(input, "base64");
  if (decoded.length !== bytes || decoded.toString("base64") !== input)
    throw new InvalidInputError("Diagnostic byte metadata is inconsistent");
  return { encoded: input, length: bytes };
}

function observation(input: unknown, binding: ExecutionBinding): ProcessObservation {
  const value = record(input, [
    "outcome",
    "started",
    "exitCode",
    "terminationSignal",
    "durationMs",
    "terminationConfirmed",
    "diagnostics",
  ]);
  if (
    !outcomes.includes(value.outcome as ProcessOutcome) ||
    typeof value.started !== "boolean" ||
    typeof value.terminationConfirmed !== "boolean"
  )
    throw new InvalidInputError("Invalid process outcome");
  const outcome = value.outcome as ProcessOutcome;
  const diagnostics = record(value.diagnostics, [
    "encoding",
    "stdout",
    "stderr",
    "stdoutBytes",
    "stderrBytes",
    "observedBytes",
    "truncated",
    "sensitivity",
  ]);
  const stdout = diagnosticBytes(diagnostics.stdout, diagnostics.stdoutBytes);
  const stderr = diagnosticBytes(diagnostics.stderr, diagnostics.stderrBytes);
  const retained = stdout.length + stderr.length;
  const observedBytes = integer(diagnostics.observedBytes, retained, Number.MAX_SAFE_INTEGER);
  if (
    retained !== Math.min(observedBytes, binding.definition?.maxOutputBytes ?? 0) ||
    diagnostics.encoding !== "base64" ||
    diagnostics.sensitivity !== "SENSITIVE" ||
    diagnostics.truncated !== observedBytes > retained
  )
    throw new InvalidInputError("Diagnostic limits or completeness metadata disagree");
  const exitCode =
    value.exitCode === null ? null : integer(value.exitCode, -2147483648, 4294967295);
  const terminationSignal = value.terminationSignal;
  if (
    terminationSignal !== null &&
    (typeof terminationSignal !== "string" || !/^SIG[A-Z0-9]{1,16}$/u.test(terminationSignal))
  )
    throw new InvalidInputError("Invalid process termination signal");
  const durationMs = integer(value.durationMs, 0, Number.MAX_SAFE_INTEGER);
  if (
    (exitCode !== null && terminationSignal !== null) ||
    (!value.started && (exitCode !== null || terminationSignal !== null || observedBytes !== 0)) ||
    (outcome === "EXITED" && (!value.started || exitCode === null || diagnostics.truncated)) ||
    (outcome === "OUTPUT_LIMIT" &&
      (!value.started || observedBytes <= (binding.definition?.maxOutputBytes ?? 0))) ||
    value.terminationConfirmed !== (outcome !== "TERMINATION_UNCONFIRMED")
  )
    throw new InvalidInputError("Process metadata contradicts its terminal outcome");
  const noStart = [
    "START_ERROR",
    "EXECUTABLE_UNAVAILABLE",
    "VERIFIER_UNAVAILABLE",
    "WORKSPACE_UNAVAILABLE",
    "DEFINITION_MISSING",
    "POLICY_UNAVAILABLE",
  ].includes(outcome);
  if (
    (noStart && value.started) ||
    (noStart && outcome !== "START_ERROR" && durationMs !== 0) ||
    ((!binding.definition || binding.check.availability !== "SUPPORTED") &&
      (value.started || durationMs !== 0 || observedBytes !== 0)) ||
    (!binding.definition && outcome !== "DEFINITION_MISSING" && outcome !== "CANCELLED") ||
    (outcome === "DEFINITION_MISSING" && binding.definition !== null) ||
    (outcome === "POLICY_UNAVAILABLE" && binding.check.availability === "SUPPORTED") ||
    (binding.check.availability !== "SUPPORTED" &&
      !["POLICY_UNAVAILABLE", "DEFINITION_MISSING", "CANCELLED"].includes(outcome))
  )
    throw new InvalidInputError(
      "Execution outcome contradicts implementation or capability context",
    );
  return {
    outcome,
    started: value.started,
    exitCode,
    terminationSignal,
    durationMs,
    terminationConfirmed: value.terminationConfirmed,
    diagnostics: {
      encoding: "base64",
      stdout: stdout.encoded,
      stderr: stderr.encoded,
      stdoutBytes: stdout.length,
      stderrBytes: stderr.length,
      observedBytes,
      truncated: observedBytes > retained,
      sensitivity: "SENSITIVE",
    },
  };
}

/** Validates association and structural semantics, not authentication of historical execution. */
export function validateBoundResult(
  binding: ExecutionBinding,
  input: unknown,
): ExecutionCheckResult {
  const value = record(input, ["binding", "attemptId", "state", "observation"]);
  assertBinding(value.binding, binding);
  if (
    typeof value.attemptId !== "string" ||
    !/^attempt:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
      value.attemptId,
    )
  )
    throw new InvalidInputError("Invalid execution attempt identity");
  const validated = observation(value.observation, binding);
  const state = resultState(validated);
  if (value.state !== state)
    throw new InvalidInputError("Result state contradicts the exit protocol");
  return freeze({ binding, attemptId: value.attemptId, state, observation: validated });
}
