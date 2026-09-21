import { deepFreeze } from "./immutable.js";
import {
  createEvidenceId,
  createVerdictReasonCode,
  createVerificationCheckId,
  type EvidenceId,
  type VerdictReasonCode,
  type VerificationCheckId,
} from "./identities.js";
import { requireNonEmptyString } from "./validation.js";

export interface VerdictReason {
  readonly code: VerdictReasonCode;
  readonly explanation: string;
  readonly evidenceIds: readonly EvidenceId[];
  readonly checkId?: VerificationCheckId;
}

export function createVerdictReason(input: {
  readonly code: unknown;
  readonly explanation: unknown;
  readonly evidenceIds?: readonly unknown[];
  readonly checkId?: unknown;
}): VerdictReason {
  const checkId =
    input.checkId === undefined ? undefined : createVerificationCheckId(input.checkId);

  return deepFreeze({
    code: createVerdictReasonCode(input.code),
    explanation: requireNonEmptyString(input.explanation, "explanation"),
    evidenceIds: (input.evidenceIds ?? []).map(createEvidenceId),
    ...(checkId === undefined ? {} : { checkId }),
  });
}
