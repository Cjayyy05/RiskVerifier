import {
  POLICY_CATEGORY_STRATEGIES,
  POLICY_REASON_DEFINITIONS,
  POLICY_RULE_SET_VERSION,
  createRuleId,
  parseRiskLevel,
  type ChangeRiskAssessment,
  type PolicyReason,
  type RequirementStrength,
  type RiskLevel,
  type VerificationStrategy,
} from "../domain/index.js";

export interface Contribution {
  readonly strategy: VerificationStrategy;
  readonly reason: PolicyReason;
}
export interface PolicyRule {
  readonly code: string;
  readonly applies: (risk: ChangeRiskAssessment) => boolean;
  readonly evaluate: (risk: ChangeRiskAssessment) => readonly Contribution[];
}
/** Future CRITICAL uses elevated baseline intensity, never unrelated subsystem checks. */
export function policyIntensity(level: RiskLevel): "STANDARD" | "ELEVATED" {
  return parseRiskLevel(level) === "LOW" ? "STANDARD" : "ELEVATED";
}
export function contribution(
  risk: ChangeRiskAssessment,
  code: string,
  strategy: VerificationStrategy,
  strength: RequirementStrength,
): Contribution {
  const definition = POLICY_REASON_DEFINITIONS[code]!;
  const category = definition.category;
  return {
    strategy,
    reason: {
      ruleId: createRuleId(`policy.${code.toLowerCase()}`),
      policyVersion: POLICY_RULE_SET_VERSION,
      reasonCode: code,
      explanation: definition.explanation,
      strength,
      unavailableBehavior: "INCONCLUSIVE",
      classificationFactIndices: risk.classification.facts.flatMap((fact, index) =>
        !category || fact.category === category ? [index] : [],
      ),
      riskFactIndices: risk.evidence.flatMap((fact, index) =>
        !category || fact.categories.includes(category) ? [index] : [],
      ),
      uncertaintyIndices: risk.uncertainties.flatMap((fact, index) =>
        code === "MATERIAL_UNCERTAINTY"
          ? fact.code !== "BOUNDED_CLASSIFIER_COVERAGE"
            ? [index]
            : []
          : code === "BOUNDED_COVERAGE" && fact.code === "BOUNDED_CLASSIFIER_COVERAGE"
            ? [index]
            : [],
      ),
    },
  };
}
const baseline = ["BUILD", "EXISTING_TESTS", "STATIC_ANALYSIS"] as const;
const nonempty = (risk: ChangeRiskAssessment): boolean =>
  risk.classification.changeSet.fileCount > 0;
const testOnly = (risk: ChangeRiskAssessment): boolean =>
  risk.classification.categories.length === 1 && risk.classification.categories[0] === "TEST";
const styleOnly = (risk: ChangeRiskAssessment): boolean =>
  risk.classification.categories.length === 1 &&
  risk.classification.categories[0] === "FRONTEND" &&
  risk.classification.facts.every((fact) => fact.ruleId === "path.frontend");
export const POLICY_RULES: readonly PolicyRule[] = Object.freeze(
  [
    {
      code: "BASELINE",
      applies: nonempty,
      evaluate: (risk: ChangeRiskAssessment): readonly Contribution[] => {
        const code = testOnly(risk)
          ? "TEST_BASELINE"
          : styleOnly(risk)
            ? "STYLE_BASELINE"
            : "BASELINE";
        return baseline.map((strategy) =>
          contribution(
            risk,
            code,
            strategy,
            strategy === "STATIC_ANALYSIS" ||
              (code === "TEST_BASELINE" && strategy === "BUILD") ||
              (code === "STYLE_BASELINE" && strategy === "EXISTING_TESTS")
              ? "OPTIONAL"
              : "MANDATORY",
          ),
        );
      },
    },
    {
      code: "RISK_INTENSITY",
      applies: (risk: ChangeRiskAssessment) =>
        nonempty(risk) && policyIntensity(risk.level) === "ELEVATED",
      evaluate: (risk: ChangeRiskAssessment) =>
        baseline.map((strategy) => contribution(risk, "RISK_INTENSITY", strategy, "MANDATORY")),
    },
    {
      code: "MATERIAL_UNCERTAINTY",
      applies: (risk: ChangeRiskAssessment) =>
        nonempty(risk) &&
        risk.uncertainties.some((fact) => fact.code !== "BOUNDED_CLASSIFIER_COVERAGE"),
      evaluate: (risk: ChangeRiskAssessment) =>
        baseline.map((strategy) =>
          contribution(risk, "MATERIAL_UNCERTAINTY", strategy, "MANDATORY"),
        ),
    },
    {
      code: "BOUNDED_COVERAGE",
      applies: nonempty,
      evaluate: (risk: ChangeRiskAssessment) => [
        contribution(risk, "BOUNDED_COVERAGE", "STATIC_ANALYSIS", "OPTIONAL"),
      ],
    },
    ...Object.entries(POLICY_CATEGORY_STRATEGIES).map(([category, strategy]): PolicyRule => ({
      code: `CATEGORY_${category}`,
      applies: (risk) =>
        nonempty(risk) && risk.classification.categories.some((item) => item === category),
      evaluate: (risk) => [
        contribution(
          risk,
          `CATEGORY_${category}`,
          strategy,
          category === "FRONTEND" && styleOnly(risk) && policyIntensity(risk.level) === "STANDARD"
            ? "OPTIONAL"
            : "MANDATORY",
        ),
      ],
    })),
  ].map((rule) => Object.freeze(rule)),
);
