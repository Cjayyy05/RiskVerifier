import { createHash } from "node:crypto";
import {
  createVerificationPlanContents,
  createChangeVerificationPlan,
  createVerificationPlanId,
  createStrategyCapabilities,
  createConfigurationIdentity,
  validateRiskData,
  InvalidInputError,
  type ChangeSet,
  type ChangeClassification,
  type ChangeRiskAssessment,
  type ChangeVerificationPolicy,
  type ConfigurationIdentity,
  type StrategyCapability,
  type ChangeVerificationPlan,
} from "../domain/index.js";
import { validatePolicyResult } from "../policy/index.js";

export interface PlanningInput {
  readonly changeSet: ChangeSet;
  readonly classification: ChangeClassification;
  readonly risk: ChangeRiskAssessment;
  readonly policy: ChangeVerificationPolicy;
  /** Separately acquired trusted snapshot identity, not authority conferred by its hash. */
  readonly configuration: ConfigurationIdentity;
  /** Caller-supplied trusted capability context; never read from the stored policy as authority. */
  readonly capabilities: readonly StrategyCapability[];
}

export function generateVerificationPlan(input: PlanningInput): ChangeVerificationPlan {
  // Validate before reading fields; independently bounded stages perform their own replay checks.
  validateRiskData(input);
  if (input === null || typeof input !== "object" || Array.isArray(input))
    throw new InvalidInputError("Planning input must be an object");
  const keys = ["changeSet", "classification", "risk", "policy", "configuration", "capabilities"];
  if (
    Reflect.ownKeys(input).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(input, key))
  )
    throw new InvalidInputError("Planning input must contain exactly the declared trusted inputs");
  const configuration = createConfigurationIdentity(input.configuration);
  const capabilities = createStrategyCapabilities(input.capabilities);
  const policy = validatePolicyResult(
    input.changeSet,
    input.classification,
    input.risk,
    capabilities,
    input.policy,
  );
  const contents = createVerificationPlanContents(policy, configuration);
  // Factories construct fixed-key objects and canonical collections, not caller insertion order.
  const digest = createHash("sha256")
    .update("riskverifier:verification-plan\n" + JSON.stringify(contents), "utf8")
    .digest("hex");
  return createChangeVerificationPlan({
    id: createVerificationPlanId(`plan:sha256:${digest}`),
    ...contents,
  });
}

export function validateVerificationPlan(
  input: PlanningInput,
  supplied: ChangeVerificationPlan,
): ChangeVerificationPlan {
  const actual = createChangeVerificationPlan(supplied);
  const expected = generateVerificationPlan(input);
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new InvalidInputError(
      "Stored plan does not reproduce its trusted context, policy and content identity",
    );
  return expected;
}
