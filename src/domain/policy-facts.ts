import {
  VERIFICATION_STRATEGIES,
  parseVerificationStrategy,
  parseStrategyDisposition,
  parseUnavailableStrategyBehavior,
  type VerificationStrategy,
  type StrategyDisposition,
  type UnavailableStrategyBehavior,
  type ChangeCategory,
} from "./enums.js";
import {
  createPolicyVersion,
  createRuleId,
  type PolicyVersion,
  type RuleId,
} from "./identities.js";
import {
  createChangeRiskAssessment,
  validateRiskData,
  compareRiskKeys,
  type ChangeRiskAssessment,
} from "./risk-facts.js";
import { deepFreeze } from "./immutable.js";
import { InvalidInputError, InvariantViolationError } from "./errors.js";
import {
  requireArray,
  requireEnumValue,
  requireExactKeys,
  requireNonNegativeInteger,
  requirePlainObject,
} from "./validation.js";

export const POLICY_RULE_SET_VERSION = createPolicyVersion("5.1.0");
export const POLICY_CATEGORY_STRATEGIES: Readonly<
  Partial<Record<ChangeCategory, VerificationStrategy>>
> = deepFreeze({
  AUTHENTICATION: "AUTHENTICATION_VERIFICATION",
  AUTHORIZATION: "AUTHORIZATION_VERIFICATION",
  API: "API_CONTRACT_VERIFICATION",
  DATABASE: "DATABASE_MIGRATION_VERIFICATION",
  DEPENDENCY: "DEPENDENCY_VERIFICATION",
  CONFIGURATION: "CONFIGURATION_VERIFICATION",
  FRONTEND: "FRONTEND_BEHAVIOR_VERIFICATION",
});
export type RequirementStrength = "MANDATORY" | "OPTIONAL" | "UNNECESSARY";
export type StrategyAvailability = "SUPPORTED" | "UNSUPPORTED" | "UNAVAILABLE";
export interface StrategyCapability {
  readonly strategy: VerificationStrategy;
  readonly availability: StrategyAvailability;
}
export interface PolicyReason {
  readonly ruleId: RuleId;
  readonly policyVersion: PolicyVersion;
  readonly reasonCode: string;
  readonly explanation: string;
  readonly strength: RequirementStrength;
  readonly unavailableBehavior: UnavailableStrategyBehavior;
  readonly classificationFactIndices: readonly number[];
  readonly riskFactIndices: readonly number[];
  readonly uncertaintyIndices: readonly number[];
}
export interface PolicyRequirement {
  readonly strategy: VerificationStrategy;
  readonly strength: RequirementStrength;
  readonly disposition: StrategyDisposition;
  readonly availability: StrategyAvailability;
  readonly unavailableBehavior: UnavailableStrategyBehavior;
  /** Future treatment of a valid verification failure, never an execution error or absence. */
  readonly validFailureBehavior: "BLOCK" | "NOT_APPLICABLE";
  readonly reasons: readonly PolicyReason[];
}
export interface PolicyCoverage {
  readonly uncertaintyIndex: number;
  readonly resolution: "INFORMATIONAL" | "REVIEW_REQUIRED";
  readonly ifUnresolved: "INCONCLUSIVE";
}
export interface ChangeVerificationPolicy {
  readonly policyVersion: PolicyVersion;
  readonly risk: ChangeRiskAssessment;
  readonly capabilities: readonly StrategyCapability[];
  readonly requirements: readonly PolicyRequirement[];
  readonly coverage: readonly PolicyCoverage[];
}
interface ReasonDefinition {
  readonly strategies: readonly VerificationStrategy[];
  readonly strengths: readonly RequirementStrength[];
  readonly explanation: string;
  readonly category?: ChangeCategory;
}
const baseline = ["BUILD", "EXISTING_TESTS", "STATIC_ANALYSIS"] as const;
const definitions: Record<string, ReasonDefinition> = {
  BASELINE: {
    strategies: baseline,
    strengths: ["MANDATORY", "OPTIONAL"],
    explanation:
      "Nonempty classified changes require baseline compatibility and regression verification.",
  },
  TEST_BASELINE: {
    strategies: baseline,
    strengths: ["MANDATORY", "OPTIONAL"],
    explanation:
      "Only TEST is established: require the suite to remain valid; build and static analysis start optional.",
  },
  STYLE_BASELINE: {
    strategies: baseline,
    strengths: ["MANDATORY", "OPTIONAL"],
    explanation:
      "Only stylesheet convention evidence is present: require build integration; other baseline strategies start optional. Cosmetic-only behavior is not proven.",
  },
  RISK_INTENSITY: {
    strategies: baseline,
    strengths: ["MANDATORY"],
    explanation:
      "Elevated risk strengthens baseline verification without selecting unrelated subsystem strategies.",
  },
  MATERIAL_UNCERTAINTY: {
    strategies: baseline,
    strengths: ["MANDATORY"],
    explanation:
      "Explicit analysis gaps require stronger baseline verification and separate coverage resolution; checks alone do not erase the gaps.",
  },
  BOUNDED_COVERAGE: {
    strategies: ["STATIC_ANALYSIS"],
    strengths: ["OPTIONAL"],
    explanation:
      "The classifier has bounded coverage; static analysis provides complementary but not comprehensive verification.",
  },
  EMPTY_CHANGE: {
    strategies: VERIFICATION_STRATEGIES,
    strengths: ["UNNECESSARY"],
    explanation:
      "The exact comparison has no changed files; no strategy is selected. This is not successful verification.",
  },
  NOT_APPLICABLE: {
    strategies: VERIFICATION_STRATEGIES,
    strengths: ["UNNECESSARY"],
    explanation:
      "No current policy rule selects this strategy from the supplied evidence; this does not establish absence of relevant behavior.",
  },
};
for (const [category, strategy] of Object.entries(POLICY_CATEGORY_STRATEGIES))
  definitions[`CATEGORY_${category}`] = {
    strategies: [strategy],
    strengths: category === "FRONTEND" ? ["MANDATORY", "OPTIONAL"] : ["MANDATORY"],
    explanation: `${category} classification calls for targeted ${strategy}; runtime impact is not established by classification alone.`,
    category: category as ChangeCategory,
  };
export const POLICY_REASON_DEFINITIONS: Readonly<Record<string, ReasonDefinition>> =
  deepFreeze(definitions);

function record(
  value: unknown,
  keys: readonly string[],
  name: string,
): Readonly<Record<string, unknown>> {
  const result = requirePlainObject(value, name);
  requireExactKeys(result, keys, name);
  return result;
}
export function createStrategyCapabilities(input: unknown): readonly StrategyCapability[] {
  validateRiskData(input);
  const values = requireArray(input, "capabilities").map((item) => {
    const value = record(item, ["strategy", "availability"], "capability");
    return {
      strategy: parseVerificationStrategy(value.strategy),
      availability: requireEnumValue(
        value.availability,
        ["SUPPORTED", "UNSUPPORTED", "UNAVAILABLE"] as const,
        "availability",
      ),
    };
  });
  if (
    values.length !== VERIFICATION_STRATEGIES.length ||
    new Set(values.map((item) => item.strategy)).size !== values.length
  )
    throw new InvalidInputError("Capabilities must describe each strategy exactly once");
  return deepFreeze(
    values.sort(
      (a, b) =>
        VERIFICATION_STRATEGIES.indexOf(a.strategy) - VERIFICATION_STRATEGIES.indexOf(b.strategy),
    ),
  );
}
export function defaultStrategyCapabilities(): readonly StrategyCapability[] {
  return createStrategyCapabilities(
    VERIFICATION_STRATEGIES.map((strategy) => ({ strategy, availability: "UNAVAILABLE" })),
  );
}
function indices(input: unknown, size: number): number[] {
  return [
    ...new Set(
      requireArray(input, "policy references").map((value) => {
        const index = requireNonNegativeInteger(value, "policy reference");
        if (index >= size)
          throw new InvalidInputError("Policy evidence reference is outside its input");
        return index;
      }),
    ),
  ].sort((a, b) => a - b);
}
function reason(
  input: unknown,
  strategy: VerificationStrategy,
  risk: ChangeRiskAssessment,
  riskIndexMap: readonly number[],
  uncertaintyIndexMap: readonly number[],
): PolicyReason {
  const value = record(
    input,
    [
      "ruleId",
      "policyVersion",
      "reasonCode",
      "explanation",
      "strength",
      "unavailableBehavior",
      "classificationFactIndices",
      "riskFactIndices",
      "uncertaintyIndices",
    ],
    "policyReason",
  );
  const code = typeof value.reasonCode === "string" ? value.reasonCode : "";
  const definition = Object.hasOwn(POLICY_REASON_DEFINITIONS, code)
    ? POLICY_REASON_DEFINITIONS[code]
    : undefined;
  const strength = requireEnumValue(
    value.strength,
    ["MANDATORY", "OPTIONAL", "UNNECESSARY"] as const,
    "strength",
  );
  if (
    !definition ||
    !definition.strategies.includes(strategy) ||
    !definition.strengths.includes(strength) ||
    value.ruleId !== `policy.${code.toLowerCase()}` ||
    value.policyVersion !== POLICY_RULE_SET_VERSION ||
    value.explanation !== definition.explanation ||
    value.unavailableBehavior !== "INCONCLUSIVE"
  )
    throw new InvariantViolationError("Unknown or contradictory policy reason metadata");
  const classificationFactIndices = indices(
    value.classificationFactIndices,
    risk.classification.facts.length,
  );
  const riskFactIndices = indices(value.riskFactIndices, riskIndexMap.length)
    .map((index) => riskIndexMap[index]!)
    .sort((a, b) => a - b);
  const uncertaintyIndices = indices(value.uncertaintyIndices, uncertaintyIndexMap.length)
    .map((index) => uncertaintyIndexMap[index]!)
    .sort((a, b) => a - b);
  if (classificationFactIndices.length === 0 || riskFactIndices.length === 0)
    throw new InvariantViolationError("Policy reason requires classification and risk provenance");
  if (
    definition.category &&
    (!classificationFactIndices.every(
      (index) => risk.classification.facts[index]?.category === definition.category,
    ) ||
      !riskFactIndices.every((index) =>
        risk.evidence[index]?.categories.includes(definition.category!),
      ))
  )
    throw new InvariantViolationError("Policy category reason contradicts originating evidence");
  if (
    (code === "MATERIAL_UNCERTAINTY" || code === "BOUNDED_COVERAGE") &&
    (uncertaintyIndices.length === 0 ||
      uncertaintyIndices.some(
        (index) =>
          (risk.uncertainties[index]?.code === "BOUNDED_CLASSIFIER_COVERAGE") !==
          (code === "BOUNDED_COVERAGE"),
      ))
  )
    throw new InvariantViolationError("Policy uncertainty reason contradicts its references");
  return {
    ruleId: createRuleId(value.ruleId),
    policyVersion: POLICY_RULE_SET_VERSION,
    reasonCode: code,
    explanation: definition.explanation,
    strength,
    unavailableBehavior: "INCONCLUSIVE",
    classificationFactIndices,
    riskFactIndices,
    uncertaintyIndices,
  };
}
/** Explicit future handling precedence, not a deployment decision. */
export function mergeUnavailableBehavior(
  values: readonly UnavailableStrategyBehavior[],
): UnavailableStrategyBehavior {
  validateRiskData(values);
  requireArray(values, "handling contributions");
  if (values.length === 0)
    throw new InvalidInputError("Handling resolution needs at least one contribution");
  const validated = values.map(parseUnavailableStrategyBehavior);
  return validated.includes("BLOCK") ? "BLOCK" : "INCONCLUSIVE";
}
export function mergeRequirementStrength(
  values: readonly RequirementStrength[],
): RequirementStrength {
  validateRiskData(values);
  requireArray(values, "strength contributions");
  if (values.length === 0)
    throw new InvalidInputError("Strength resolution needs at least one contribution");
  const validated = values.map((value) =>
    requireEnumValue(value, ["UNNECESSARY", "OPTIONAL", "MANDATORY"] as const, "strength"),
  );
  return validated.includes("MANDATORY")
    ? "MANDATORY"
    : validated.includes("OPTIONAL")
      ? "OPTIONAL"
      : "UNNECESSARY";
}
export function createPolicyCoverage(risk: ChangeRiskAssessment): readonly PolicyCoverage[] {
  const validated = createChangeRiskAssessment(risk);
  return deepFreeze(
    validated.uncertainties.map((item, uncertaintyIndex) => ({
      uncertaintyIndex,
      resolution:
        item.code === "BOUNDED_CLASSIFIER_COVERAGE"
          ? ("INFORMATIONAL" as const)
          : ("REVIEW_REQUIRED" as const),
      ifUnresolved: "INCONCLUSIVE" as const,
    })),
  );
}
/** Structural contract validation. Intake from untrusted storage additionally requires policy replay. */
export function createChangeVerificationPolicy(
  input: ChangeVerificationPolicy,
): ChangeVerificationPolicy {
  validateRiskData(input);
  const value = record(
    input,
    ["policyVersion", "risk", "capabilities", "requirements", "coverage"],
    "policy",
  );
  if (value.policyVersion !== POLICY_RULE_SET_VERSION)
    throw new InvalidInputError("Unsupported policy rule version");
  const risk = createChangeRiskAssessment(input.risk);
  // The risk factory sorts these collections. Resolve old positions by their validated,
  // unique identities before interpreting any referring policy record.
  const riskIndexMap = input.risk.evidence.map((fact) =>
    risk.evidence.findIndex((candidate) => candidate.reasonCode === fact.reasonCode),
  );
  const uncertaintyIndexMap = input.risk.uncertainties.map((fact) =>
    risk.uncertainties.findIndex((candidate) => candidate.code === fact.code),
  );
  const capabilities = createStrategyCapabilities(value.capabilities);
  const requirements = requireArray(value.requirements, "requirements")
    .map((item): PolicyRequirement => {
      const entry = record(
        item,
        [
          "strategy",
          "strength",
          "disposition",
          "availability",
          "unavailableBehavior",
          "validFailureBehavior",
          "reasons",
        ],
        "requirement",
      );
      const strategy = parseVerificationStrategy(entry.strategy);
      const reasons = requireArray(entry.reasons, "reasons")
        .map((item) => reason(item, strategy, risk, riskIndexMap, uncertaintyIndexMap))
        .sort((a, b) => compareRiskKeys(a.reasonCode, b.reasonCode));
      if (new Set(reasons.map((item) => item.reasonCode)).size !== reasons.length)
        throw new InvariantViolationError("Duplicate policy reason");
      const strength = mergeRequirementStrength(reasons.map((item) => item.strength));
      const unavailableBehavior = mergeUnavailableBehavior(
        reasons.map((item) => item.unavailableBehavior),
      );
      const availability = capabilities.find((item) => item.strategy === strategy)!.availability;
      const validFailureBehavior = strength === "UNNECESSARY" ? "NOT_APPLICABLE" : "BLOCK";
      const disposition: StrategyDisposition =
        strength === "UNNECESSARY"
          ? "UNNECESSARY"
          : availability === "SUPPORTED"
            ? strength
            : "UNSUPPORTED";
      if (
        entry.strength !== strength ||
        parseStrategyDisposition(entry.disposition) !== disposition ||
        entry.availability !== availability ||
        entry.unavailableBehavior !== unavailableBehavior ||
        entry.validFailureBehavior !== validFailureBehavior
      )
        throw new InvariantViolationError("Requirement contradicts its reasons or capability");
      return {
        strategy,
        strength,
        disposition,
        availability,
        unavailableBehavior,
        validFailureBehavior,
        reasons,
      };
    })
    .sort(
      (a, b) =>
        VERIFICATION_STRATEGIES.indexOf(a.strategy) - VERIFICATION_STRATEGIES.indexOf(b.strategy),
    );
  if (
    requirements.length !== VERIFICATION_STRATEGIES.length ||
    new Set(requirements.map((item) => item.strategy)).size !== requirements.length
  )
    throw new InvariantViolationError("Every strategy requires exactly one policy disposition");
  const coverage = requireArray(value.coverage, "coverage")
    .map((item) => {
      const value = record(item, ["uncertaintyIndex", "resolution", "ifUnresolved"], "coverage");
      const originalIndex = requireNonNegativeInteger(value.uncertaintyIndex, "uncertaintyIndex");
      const uncertaintyIndex = uncertaintyIndexMap[originalIndex];
      if (uncertaintyIndex === undefined)
        throw new InvalidInputError("Policy coverage reference is outside its input");
      return {
        uncertaintyIndex,
        resolution: requireEnumValue(
          value.resolution,
          ["INFORMATIONAL", "REVIEW_REQUIRED"] as const,
          "coverage resolution",
        ),
        ifUnresolved: requireEnumValue(
          value.ifUnresolved,
          ["INCONCLUSIVE"] as const,
          "coverage handling",
        ),
      };
    })
    .sort((a, b) => a.uncertaintyIndex - b.uncertaintyIndex);
  if (JSON.stringify(coverage) !== JSON.stringify(createPolicyCoverage(risk)))
    throw new InvariantViolationError("Policy must preserve all uncertainty and required handling");
  return deepFreeze({
    policyVersion: POLICY_RULE_SET_VERSION,
    risk,
    capabilities,
    requirements,
    coverage,
  });
}
