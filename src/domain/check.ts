import { InvariantViolationError } from "./errors.js";
import {
  parseCheckResultState,
  parseStrategyDisposition,
  parseVerificationStrategy,
  type CheckResultState,
  type StrategyDisposition,
  type VerificationStrategy,
} from "./enums.js";
import { deepFreeze } from "./immutable.js";
import {
  createCheckAttemptId,
  createCheckDefinitionId,
  createEvidenceId,
  createVerificationCheckId,
  type CheckAttemptId,
  type CheckDefinitionId,
  type EvidenceId,
  type VerificationCheckId,
} from "./identities.js";
import { requireInteger, requireIsoTimestamp, requireNonEmptyString } from "./validation.js";

export type ExecutableCheckDisposition = Extract<StrategyDisposition, "MANDATORY" | "OPTIONAL">;

export interface VerificationCheck {
  readonly id: VerificationCheckId;
  readonly strategy: VerificationStrategy;
  readonly disposition: ExecutableCheckDisposition;
  readonly trustedDefinitionId: CheckDefinitionId;
  readonly originatingEvidenceIds: readonly EvidenceId[];
}

export function createVerificationCheck(input: {
  readonly id: unknown;
  readonly strategy: unknown;
  readonly disposition: unknown;
  readonly trustedDefinitionId: unknown;
  readonly originatingEvidenceIds?: readonly unknown[];
}): VerificationCheck {
  const disposition = parseStrategyDisposition(input.disposition);
  if (disposition !== "MANDATORY" && disposition !== "OPTIONAL") {
    throw new InvariantViolationError(
      "A concrete verification check must be mandatory or optional",
      { disposition },
    );
  }

  return deepFreeze({
    id: createVerificationCheckId(input.id),
    strategy: parseVerificationStrategy(input.strategy),
    disposition,
    trustedDefinitionId: createCheckDefinitionId(input.trustedDefinitionId),
    originatingEvidenceIds: (input.originatingEvidenceIds ?? []).map(createEvidenceId),
  });
}

export interface CheckResult {
  readonly checkId: VerificationCheckId;
  readonly attemptId: CheckAttemptId;
  readonly state: CheckResultState;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly exitCode?: number;
  readonly evidenceIds: readonly EvidenceId[];
  readonly detail?: string;
}

export function createCheckResult(input: {
  readonly checkId: unknown;
  readonly attemptId: unknown;
  readonly state: unknown;
  readonly startedAt: unknown;
  readonly completedAt: unknown;
  readonly exitCode?: unknown;
  readonly evidenceIds?: readonly unknown[];
  readonly detail?: unknown;
}): CheckResult {
  const startedAt = requireIsoTimestamp(input.startedAt, "startedAt");
  const completedAt = requireIsoTimestamp(input.completedAt, "completedAt");
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new InvariantViolationError("completedAt cannot be before startedAt");
  }

  const exitCode =
    input.exitCode === undefined ? undefined : requireInteger(input.exitCode, "exitCode");
  const detail =
    input.detail === undefined ? undefined : requireNonEmptyString(input.detail, "detail");

  return deepFreeze({
    checkId: createVerificationCheckId(input.checkId),
    attemptId: createCheckAttemptId(input.attemptId),
    state: parseCheckResultState(input.state),
    startedAt,
    completedAt,
    ...(exitCode === undefined ? {} : { exitCode }),
    evidenceIds: (input.evidenceIds ?? []).map(createEvidenceId),
    ...(detail === undefined ? {} : { detail }),
  });
}
