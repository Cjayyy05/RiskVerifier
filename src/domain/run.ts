import { InvariantViolationError } from "./errors.js";
import {
  parseRunLifecycleState,
  parseVerificationVerdict,
  type RunLifecycleState,
  type VerificationVerdict,
} from "./enums.js";
import { deepFreeze } from "./immutable.js";
import {
  createCommitIdentity,
  createConfigurationIdentity,
  createPolicyVersion,
  createRepositoryIdentity,
  createVerificationRunId,
  type CommitIdentity,
  type ConfigurationIdentity,
  type PolicyVersion,
  type RepositoryIdentity,
  type VerificationRunId,
} from "./identities.js";
import { requireIsoTimestamp } from "./validation.js";
import { createVerdictReason, type VerdictReason } from "./verdict.js";

export interface VerificationRun {
  readonly id: VerificationRunId;
  readonly repository: RepositoryIdentity;
  readonly baseCommit: CommitIdentity;
  readonly targetCommit: CommitIdentity;
  readonly policyVersion: PolicyVersion;
  readonly configuration: ConfigurationIdentity;
  readonly lifecycleState: RunLifecycleState;
  readonly finalVerdict?: VerificationVerdict;
  readonly verdictReasons: readonly VerdictReason[];
  readonly createdAt: string;
}

export function createVerificationRun(input: {
  readonly id: unknown;
  readonly repository: unknown;
  readonly baseCommit: unknown;
  readonly targetCommit: unknown;
  readonly policyVersion: unknown;
  readonly configuration: ConfigurationIdentity;
  readonly lifecycleState: unknown;
  readonly finalVerdict?: unknown;
  readonly verdictReasons?: readonly VerdictReason[];
  readonly createdAt: unknown;
}): VerificationRun {
  const lifecycleState = parseRunLifecycleState(input.lifecycleState);
  const finalVerdict =
    input.finalVerdict === undefined ? undefined : parseVerificationVerdict(input.finalVerdict);
  const verdictReasons = (input.verdictReasons ?? []).map(createVerdictReason);

  if (lifecycleState === "COMPLETED" && finalVerdict === undefined) {
    throw new InvariantViolationError("A completed run must have a final verdict");
  }

  if (lifecycleState !== "COMPLETED" && finalVerdict !== undefined) {
    throw new InvariantViolationError("Only a completed run may have a final verdict");
  }

  if (finalVerdict !== undefined && verdictReasons.length === 0) {
    throw new InvariantViolationError("A final verdict must have at least one verdict reason");
  }

  if (finalVerdict === undefined && verdictReasons.length > 0) {
    throw new InvariantViolationError("Verdict reasons require a final verdict");
  }

  return deepFreeze({
    id: createVerificationRunId(input.id),
    repository: createRepositoryIdentity(input.repository),
    baseCommit: createCommitIdentity(input.baseCommit),
    targetCommit: createCommitIdentity(input.targetCommit),
    policyVersion: createPolicyVersion(input.policyVersion),
    configuration: createConfigurationIdentity(input.configuration),
    lifecycleState,
    ...(finalVerdict === undefined ? {} : { finalVerdict }),
    verdictReasons,
    createdAt: requireIsoTimestamp(input.createdAt, "createdAt"),
  });
}
