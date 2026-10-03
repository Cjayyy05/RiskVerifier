import {
  createChangeVerificationPolicy,
  type ChangeVerificationPolicy,
  type PolicyRequirement,
  type StrategyAvailability,
} from "./policy-facts.js";
import {
  createComponentVersion,
  createConfigurationIdentity,
  createVerificationPlanId,
  createVerificationCheckId,
  type ComponentVersion,
  type ConfigurationIdentity,
  type VerificationPlanId,
  type VerificationCheckId,
  type RepositoryIdentity,
  type CommitIdentity,
  type PolicyVersion,
  type RuleId,
} from "./identities.js";
import {
  VERIFICATION_STRATEGIES,
  parseVerificationStrategy,
  type VerificationStrategy,
  type StrategyDisposition,
  type UnavailableStrategyBehavior,
} from "./enums.js";
import { validateRiskData, compareRiskKeys } from "./risk-facts.js";
import { requireArray, requireExactKeys, requirePlainObject } from "./validation.js";
import { InvalidInputError, InvariantViolationError } from "./errors.js";
import { deepFreeze } from "./immutable.js";

export const PLANNER_VERSION = createComponentVersion("6.0.0");
export interface PlanContext {
  readonly repository: RepositoryIdentity;
  readonly baseCommit: CommitIdentity;
  readonly targetCommit: CommitIdentity;
  readonly analyzerVersion: ComponentVersion;
  readonly classifierVersion: ComponentVersion;
  readonly riskVersion: ComponentVersion;
  readonly policyVersion: PolicyVersion;
  readonly configuration: ConfigurationIdentity;
}
/** Stable strategy link; the complete immutable requirement remains in plan.policy. */
export interface PlannedRequirement {
  readonly id: string;
  readonly strategy: VerificationStrategy;
}
/** An intended check, not a claim that any trusted executable definition exists. */
export interface PlannedVerificationCheck {
  readonly id: VerificationCheckId;
  readonly requirementId: string;
  readonly strategy: VerificationStrategy;
  readonly strength: "MANDATORY" | "OPTIONAL";
  readonly disposition: StrategyDisposition;
  readonly availability: StrategyAvailability;
  readonly unavailableBehavior: UnavailableStrategyBehavior;
  readonly validFailureBehavior: PolicyRequirement["validFailureBehavior"];
  readonly policyRuleIds: readonly RuleId[];
  readonly explanation: string;
}
export interface VerificationPlanContents {
  readonly plannerVersion: ComponentVersion;
  readonly context: PlanContext;
  readonly policy: ChangeVerificationPolicy;
  readonly requirements: readonly PlannedRequirement[];
  readonly checks: readonly PlannedVerificationCheck[];
}
/** Run-independent Phase 6 plan. Does not fabricate canonical run-bound Evidence. */
export interface ChangeVerificationPlan extends VerificationPlanContents {
  readonly id: VerificationPlanId;
}

/** Mechanical materialization only. Callers must replay policy at an intake boundary. */
export function createVerificationPlanContents(
  input: ChangeVerificationPolicy,
  configurationInput: ConfigurationIdentity,
): VerificationPlanContents {
  validateRiskData(configurationInput);
  const configuration = createConfigurationIdentity(configurationInput);
  const policy = createChangeVerificationPolicy(input);
  const risk = policy.risk;
  const classification = risk.classification;
  const changes = classification.changeSet;
  const selected = policy.requirements.filter(
    (requirement) => requirement.strength !== "UNNECESSARY",
  );
  const requirementId = (strategy: VerificationStrategy): string =>
    `requirement:${strategy.toLowerCase().replaceAll("_", "-")}`;
  const requirements = selected.map((requirement) => ({
    id: requirementId(requirement.strategy),
    strategy: requirement.strategy,
  }));
  const checks = selected.map((requirement): PlannedVerificationCheck => {
    // The filter is mechanical; no risk/category rule is evaluated here.
    if (requirement.strength === "UNNECESSARY")
      throw new InvariantViolationError("Unselected strategy cannot become a check");
    return {
      id: createVerificationCheckId(
        `check:${requirement.strategy.toLowerCase().replaceAll("_", "-")}`,
      ),
      requirementId: requirementId(requirement.strategy),
      strategy: requirement.strategy,
      strength: requirement.strength,
      disposition: requirement.disposition,
      availability: requirement.availability,
      unavailableBehavior: requirement.unavailableBehavior,
      validFailureBehavior: requirement.validFailureBehavior,
      policyRuleIds: requirement.reasons.map((reason) => reason.ruleId),
      explanation: `Materializes ${requirement.strategy} as ${requirement.strength} from validated policy ${policy.policyVersion}.`,
    };
  });
  return deepFreeze({
    plannerVersion: PLANNER_VERSION,
    context: {
      repository: changes.repository,
      baseCommit: changes.baseCommit,
      targetCommit: changes.targetCommit,
      analyzerVersion: changes.analyzerVersion,
      classifierVersion: classification.classifierVersion,
      riskVersion: risk.ruleSetVersion,
      policyVersion: policy.policyVersion,
      configuration,
    },
    policy,
    requirements,
    checks,
  });
}

function record(
  input: unknown,
  keys: readonly string[],
  name: string,
): Readonly<Record<string, unknown>> {
  const value = requirePlainObject(input, name);
  requireExactKeys(value, keys, name);
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new InvalidInputError(`${name} must contain exactly its declared fields`);
  return value;
}

/** Structural factory; identity digest and upstream authority require planning replay. */
export function createChangeVerificationPlan(
  input: ChangeVerificationPlan,
): ChangeVerificationPlan {
  validateRiskData(input);
  const value = record(
    input,
    ["id", "plannerVersion", "context", "policy", "requirements", "checks"],
    "plan",
  );
  const context = record(
    value.context,
    [
      "repository",
      "baseCommit",
      "targetCommit",
      "analyzerVersion",
      "classifierVersion",
      "riskVersion",
      "policyVersion",
      "configuration",
    ],
    "plan context",
  );
  const expected = createVerificationPlanContents(
    input.policy,
    context.configuration as ConfigurationIdentity,
  );
  if (
    value.plannerVersion !== PLANNER_VERSION ||
    Object.keys(expected.context).some(
      (key) =>
        key !== "configuration" && context[key] !== expected.context[key as keyof PlanContext],
    )
  )
    throw new InvariantViolationError("Plan context/version contradicts its policy provenance");
  const requirements = requireArray(value.requirements, "requirements")
    .map((item) => {
      const requirement = record(item, ["id", "strategy"], "planned requirement");
      return { id: requirement.id, strategy: parseVerificationStrategy(requirement.strategy) };
    })
    .sort(
      (a, b) =>
        VERIFICATION_STRATEGIES.indexOf(a.strategy) - VERIFICATION_STRATEGIES.indexOf(b.strategy),
    );
  const checks = requireArray(value.checks, "checks")
    .map((item) => {
      const check = record(
        item,
        [
          "id",
          "requirementId",
          "strategy",
          "strength",
          "disposition",
          "availability",
          "unavailableBehavior",
          "validFailureBehavior",
          "policyRuleIds",
          "explanation",
        ],
        "planned check",
      );
      return {
        id: check.id,
        requirementId: check.requirementId,
        strategy: parseVerificationStrategy(check.strategy),
        strength: check.strength,
        disposition: check.disposition,
        availability: check.availability,
        unavailableBehavior: check.unavailableBehavior,
        validFailureBehavior: check.validFailureBehavior,
        policyRuleIds: requireArray(check.policyRuleIds, "policyRuleIds")
          .map((id) => {
            if (typeof id !== "string")
              throw new InvalidInputError("Policy rule reference must be a string");
            return id;
          })
          .sort(compareRiskKeys),
        explanation: check.explanation,
      };
    })
    .sort(
      (a, b) =>
        VERIFICATION_STRATEGIES.indexOf(a.strategy) - VERIFICATION_STRATEGIES.indexOf(b.strategy),
    );
  // Known policy rule IDs have the same order as their reason codes, under the common prefix.
  if (
    JSON.stringify(requirements) !== JSON.stringify(expected.requirements) ||
    JSON.stringify(checks) !== JSON.stringify(expected.checks)
  )
    throw new InvariantViolationError(
      "Plan must materialize every selected requirement exactly once without changing semantics or provenance",
    );
  const id = createVerificationPlanId(value.id);
  if (!/^plan:sha256:[a-f0-9]{64}$/u.test(id))
    throw new InvalidInputError("Plan identity must be a canonical SHA-256 content identity");
  return deepFreeze({ id, ...expected });
}
