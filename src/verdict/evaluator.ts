import {
  InvalidInputError,
  createComponentVersion,
  type CheckResultState,
  type PlannedVerificationCheck,
  type PlanContext,
  type RiskUncertainty,
  type VerificationVerdict,
  type VerificationPlanId,
} from "../domain/index.js";
import {
  validateExecutionEvidence,
  type EvidenceInput,
  type ExecutionEvidenceReference,
} from "../evidence/index.js";
import { canonical, digest, freeze } from "../evidence/validation.js";

export const VERDICT_VERSION = createComponentVersion("8.1.0");
export type VerdictContribution = "SATISFIED" | "BLOCKING_FAILURE" | "INDETERMINATE";
export interface AssessmentReason {
  readonly code: string;
  readonly explanation: string;
}
export interface CheckAssessment {
  readonly check: PlannedVerificationCheck;
  readonly state: CheckResultState | "MISSING";
  readonly contribution: VerdictContribution;
  readonly reason: AssessmentReason;
  readonly evidence: {
    readonly attemptId: string;
    readonly resultDigest: string;
    readonly binding: ExecutionEvidenceReference["binding"];
  } | null;
  readonly expectedEvidence: ExecutionEvidenceReference | null;
}
export interface CoverageAssessment {
  readonly uncertaintyIndex: number;
  readonly uncertainty: RiskUncertainty;
  readonly resolution: "INFORMATIONAL" | "REVIEW_REQUIRED";
  readonly ifUnresolved: "INCONCLUSIVE";
  readonly contribution: VerdictContribution;
  readonly reason: AssessmentReason;
}
/** Intermediate assessment, not a persisted run Verdict or a deployment action. */
export interface VerdictAssessment {
  readonly id: string;
  readonly verdictVersion: typeof VERDICT_VERSION;
  readonly planId: VerificationPlanId;
  readonly context: PlanContext;
  readonly verdict: VerificationVerdict;
  readonly checks: readonly CheckAssessment[];
  readonly coverage: readonly CoverageAssessment[];
  readonly reason: AssessmentReason;
}

function interpret(
  check: PlannedVerificationCheck,
  state: CheckAssessment["state"],
  hasCapturedEvidence: boolean,
): Pick<CheckAssessment, "contribution" | "reason"> {
  if (
    state === "MISSING" &&
    check.strength === "OPTIONAL" &&
    check.availability === "SUPPORTED" &&
    !hasCapturedEvidence
  )
    return {
      contribution: "SATISFIED",
      reason: {
        code: "OPTIONAL_OMITTED",
        explanation: `${check.strategy} is optional and has no captured result; omission alone is permitted by the approved policy. This is not a PASS.`,
      },
    };
  if (state === "PASS")
    return {
      contribution: "SATISFIED",
      reason: {
        code: "CHECK_PASSED",
        explanation: `${check.strategy} supplied a validated PASS for this selected obligation.`,
      },
    };
  if (state === "FAIL") {
    if (check.validFailureBehavior !== "BLOCK")
      throw new InvalidInputError("Selected check has unsupported valid-failure handling");
    return {
      contribution: "BLOCKING_FAILURE",
      reason: {
        code: "VALID_FAILURE_BLOCKS",
        explanation: `${check.strategy} returned a valid FAIL and its approved valid-failure handling requires BLOCK.`,
      },
    };
  }
  if (!["ERROR", "TIMEOUT", "CANCELLED", "UNSUPPORTED", "MISSING"].includes(state))
    throw new InvalidInputError("Unsupported execution state");
  return {
    contribution: check.unavailableBehavior === "BLOCK" ? "BLOCKING_FAILURE" : "INDETERMINATE",
    reason: {
      code: state === "MISSING" ? "RESULT_MISSING" : `CHECK_${state}`,
      explanation: `${check.strategy}: ${state}; verification was not established. Approved unavailable handling is ${check.unavailableBehavior}.`,
    },
  };
}

export function evaluateVerdict(
  input: EvidenceInput,
  trustedReferences: readonly ExecutionEvidenceReference[],
): VerdictAssessment {
  const { plan, results, references } = validateExecutionEvidence(input, trustedReferences);
  const captured = new Map(references.map((reference) => [reference.binding.check.id, reference]));
  const byCheck = new Map(results.map((entry) => [entry.result.binding.check.id, entry]));
  const checks: CheckAssessment[] = plan.checks.map((check) => {
    const entry = byCheck.get(check.id);
    const state = entry?.result.state ?? "MISSING";
    return {
      check,
      state,
      ...interpret(check, state, captured.has(check.id)),
      expectedEvidence: captured.get(check.id) ?? null,
      evidence: entry
        ? {
            attemptId: entry.result.attemptId,
            resultDigest: entry.resultDigest,
            binding: entry.result.binding,
          }
        : null,
    };
  });
  const coverage: CoverageAssessment[] = plan.policy.coverage.map((obligation) => ({
    ...obligation,
    uncertainty: plan.policy.risk.uncertainties[obligation.uncertaintyIndex]!,
    contribution: obligation.resolution === "REVIEW_REQUIRED" ? "INDETERMINATE" : "SATISFIED",
    reason:
      obligation.resolution === "REVIEW_REQUIRED"
        ? {
            code: "COVERAGE_REVIEW_REQUIRED",
            explanation:
              "Required coverage review remains unresolved; check completion is not resolution evidence.",
          }
        : {
            code: "COVERAGE_INFORMATIONAL",
            explanation:
              "Approved policy records this uncertainty as informational, not a blocking coverage obligation.",
          },
  }));
  const contributions = [...checks, ...coverage].map((entry) => entry.contribution);
  const verdict: VerificationVerdict = contributions.includes("BLOCKING_FAILURE")
    ? "BLOCK"
    : contributions.includes("INDETERMINATE")
      ? "INCONCLUSIVE"
      : "APPROVE";
  const reason: AssessmentReason =
    verdict === "BLOCK"
      ? {
          code: "POLICY_BLOCK_REQUIRED",
          explanation:
            "Validated evidence violates an approved blocking condition; all other reasons remain recorded.",
        }
      : verdict === "INCONCLUSIVE"
        ? {
            code: "VERIFICATION_INCOMPLETE",
            explanation:
              "Required verification remains unresolved and no established blocking condition takes precedence.",
          }
        : {
            code: checks.length === 0 ? "NO_CHECKS_REQUIRED" : "ALL_OBLIGATIONS_SATISFIED",
            explanation:
              checks.length === 0
                ? "The replayed policy required no checks for this exact change and no required coverage obligation remains."
                : "All approval-required obligations are satisfied; optional omissions are permitted and no supplied evidence or coverage condition prevents approval.",
          };
  const assessment = {
    verdictVersion: VERDICT_VERSION,
    planId: plan.id,
    context: plan.context,
    verdict,
    checks,
    coverage,
    reason,
  };
  return freeze({
    id: `verdict:sha256:${digest("verdict-assessment", assessment)}`,
    ...assessment,
  });
}

/** Recompute, never trust a stored verdict, contributions, reasons, or its digest alone. */
export function validateVerdictAssessment(
  input: EvidenceInput,
  trustedReferences: readonly ExecutionEvidenceReference[],
  supplied: unknown,
): VerdictAssessment {
  const expected = evaluateVerdict(input, trustedReferences);
  if (canonical(supplied) !== canonical(expected))
    throw new InvalidInputError("Verdict assessment differs from deterministic replay");
  return expected;
}
