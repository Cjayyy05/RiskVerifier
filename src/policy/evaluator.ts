import {
  VERIFICATION_STRATEGIES,
  POLICY_RULE_SET_VERSION,
  createChangeVerificationPolicy,
  createStrategyCapabilities,
  defaultStrategyCapabilities,
  createPolicyCoverage,
  mergeRequirementStrength,
  mergeUnavailableBehavior,
  InvariantViolationError,
  type ChangeSet,
  type ChangeClassification,
  type ChangeRiskAssessment,
  type ChangeVerificationPolicy,
  type StrategyCapability,
} from "../domain/index.js";
import { validateRiskAssessment } from "../risk/index.js";
import { POLICY_RULES, contribution, type PolicyRule } from "./rules.js";

/** Internal built-in rule ordering seam; not exported by the public policy entry point. */
export function evaluateRules(
  risk: ChangeRiskAssessment,
  capabilities: readonly StrategyCapability[],
  rules: readonly PolicyRule[],
): ChangeVerificationPolicy {
  const contributions = rules
    .filter((rule) => rule.applies(risk))
    .flatMap((rule) => rule.evaluate(risk));
  const requirements = VERIFICATION_STRATEGIES.map((strategy) => {
    let reasons = contributions
      .filter((item) => item.strategy === strategy)
      .map((item) => item.reason);
    reasons = [...new Map(reasons.map((reason) => [JSON.stringify(reason), reason])).values()];
    if (reasons.length === 0)
      reasons = [
        contribution(
          risk,
          risk.classification.changeSet.fileCount === 0 ? "EMPTY_CHANGE" : "NOT_APPLICABLE",
          strategy,
          "UNNECESSARY",
        ).reason,
      ];
    const strength = mergeRequirementStrength(reasons.map((reason) => reason.strength));
    const availability = capabilities.find((item) => item.strategy === strategy)!.availability;
    return {
      strategy,
      strength,
      availability,
      disposition:
        strength === "UNNECESSARY"
          ? ("UNNECESSARY" as const)
          : availability === "SUPPORTED"
            ? strength
            : ("UNSUPPORTED" as const),
      unavailableBehavior: mergeUnavailableBehavior(
        reasons.map((reason) => reason.unavailableBehavior),
      ),
      validFailureBehavior:
        strength === "UNNECESSARY" ? ("NOT_APPLICABLE" as const) : ("BLOCK" as const),
      reasons,
    };
  });
  return createChangeVerificationPolicy({
    policyVersion: POLICY_RULE_SET_VERSION,
    risk,
    capabilities,
    requirements,
    coverage: createPolicyCoverage(risk),
  });
}
/** Pure policy selection, with approved risk replay at the trust boundary. */
export function evaluatePolicy(
  changes: ChangeSet,
  classification: ChangeClassification,
  risk: ChangeRiskAssessment,
  capabilities: readonly StrategyCapability[] = defaultStrategyCapabilities(),
): ChangeVerificationPolicy {
  return evaluateRules(
    validateRiskAssessment(changes, classification, risk),
    createStrategyCapabilities(capabilities),
    POLICY_RULES,
  );
}
/** Capability assertions must come from the caller's trusted context, not the stored result. */
export function validatePolicyResult(
  changes: ChangeSet,
  classification: ChangeClassification,
  risk: ChangeRiskAssessment,
  capabilities: readonly StrategyCapability[],
  supplied: ChangeVerificationPolicy,
): ChangeVerificationPolicy {
  const actual = createChangeVerificationPolicy(supplied);
  const expected = evaluatePolicy(changes, classification, risk, capabilities);
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new InvariantViolationError(
      "Policy result does not reproduce the supplied context and approved rules",
    );
  return expected;
}
