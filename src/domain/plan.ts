import { InvariantViolationError } from "./errors.js";
import { parseChangeCategory, type ChangeCategory } from "./enums.js";
import { deepFreeze } from "./immutable.js";
import {
  createConfigurationIdentity,
  createPolicyVersion,
  createVerificationPlanId,
  createVerificationRunId,
  type ConfigurationIdentity,
  type PolicyVersion,
  type VerificationPlanId,
  type VerificationRunId,
} from "./identities.js";
import { requireIsoTimestamp } from "./validation.js";
import { createVerificationCheck, type VerificationCheck } from "./check.js";
import { createStrategyRequirement, type StrategyRequirement } from "./policy.js";
import { createRiskAssessment, type RiskAssessment } from "./risk.js";
export * from "./plan-facts.js";

export interface VerificationPlan {
  readonly id: VerificationPlanId;
  readonly runId: VerificationRunId;
  readonly categories: readonly ChangeCategory[];
  readonly risk: RiskAssessment;
  readonly policyVersion: PolicyVersion;
  readonly configuration: ConfigurationIdentity;
  readonly strategyRequirements: readonly StrategyRequirement[];
  readonly checks: readonly VerificationCheck[];
  readonly createdAt: string;
}

export function createVerificationPlan(input: {
  readonly id: unknown;
  readonly runId: unknown;
  readonly categories: readonly unknown[];
  readonly risk: RiskAssessment;
  readonly policyVersion: unknown;
  readonly configuration: ConfigurationIdentity;
  readonly strategyRequirements: readonly StrategyRequirement[];
  readonly checks: readonly VerificationCheck[];
  readonly createdAt: unknown;
}): VerificationPlan {
  const policyVersion = createPolicyVersion(input.policyVersion);
  const categories = [...new Set(input.categories.map(parseChangeCategory))];
  const risk = createRiskAssessment(input.risk);
  const configuration = createConfigurationIdentity(input.configuration);
  const requirements = input.strategyRequirements.map(createStrategyRequirement);
  const checks = input.checks.map(createVerificationCheck);
  const runId = createVerificationRunId(input.runId);

  if (categories.length === 0) {
    throw new InvariantViolationError("A verification plan requires at least one category");
  }

  if (requirements.some((requirement) => requirement.policyVersion !== policyVersion)) {
    throw new InvariantViolationError(
      "Every strategy requirement must use the plan policy version",
    );
  }

  if (new Set(requirements.map((item) => item.strategy)).size !== requirements.length) {
    throw new InvariantViolationError("A plan cannot contain duplicate strategy requirements");
  }

  if (new Set(checks.map((item) => item.id)).size !== checks.length) {
    throw new InvariantViolationError("A plan cannot contain duplicate check IDs");
  }

  for (const check of checks) {
    const requirement = requirements.find((item) => item.strategy === check.strategy);
    if (requirement === undefined || requirement.disposition !== check.disposition) {
      throw new InvariantViolationError(
        "Every check must match a mandatory or optional strategy requirement",
        { checkId: check.id, strategy: check.strategy },
      );
    }
  }

  for (const riskEvidence of risk.evidence) {
    const context = riskEvidence.evidence.context;
    if (
      context.runId !== runId ||
      context.policyVersion !== policyVersion ||
      context.configuration.version !== configuration.version ||
      context.configuration.hash !== configuration.hash
    ) {
      throw new InvariantViolationError(
        "Risk evidence context must match the plan run, policy, and configuration",
        { evidenceId: riskEvidence.evidence.id },
      );
    }
  }

  return deepFreeze({
    id: createVerificationPlanId(input.id),
    runId,
    categories,
    risk,
    policyVersion,
    configuration,
    strategyRequirements: requirements,
    checks,
    createdAt: requireIsoTimestamp(input.createdAt, "createdAt"),
  });
}
