import type { ChangeCategory, RiskLevel } from "./enums.js";
import { createComponentVersion } from "./identities.js";
import { deepFreeze } from "./immutable.js";

/** Versioned evidence vocabulary, not verification-policy or verdict behavior. */
export const RISK_RULE_VERSION = createComponentVersion("4.1.0");
export const RISK_CLASSIFIER_VERSION = createComponentVersion("3.1.0");
export const RISK_CATEGORY_MINIMUMS: Readonly<Record<ChangeCategory, RiskLevel>> = deepFreeze({
  AUTHENTICATION: "HIGH",
  AUTHORIZATION: "HIGH",
  DATABASE: "MEDIUM",
  API: "MEDIUM",
  DEPENDENCY: "MEDIUM",
  CONFIGURATION: "MEDIUM",
  FRONTEND: "LOW",
  TEST: "LOW",
  GENERAL: "MEDIUM",
});
export const RISK_COMBINATIONS = deepFreeze([
  ["AUTHORIZATION", "API"],
  ["AUTHENTICATION", "API"],
  ["DATABASE", "API"],
  ["DEPENDENCY", "CONFIGURATION"],
  ["AUTHENTICATION", "AUTHORIZATION"],
] as const);
export const RISK_DELETION_CATEGORIES = deepFreeze([
  "AUTHENTICATION",
  "AUTHORIZATION",
  "DATABASE",
  "API",
  "CONFIGURATION",
  "TEST",
] as const);
export const RISK_SENSITIVE_CATEGORIES = deepFreeze([
  "AUTHENTICATION",
  "AUTHORIZATION",
  "DATABASE",
  "API",
] as const);

export interface RiskRuleDefinition {
  readonly categories: readonly ChangeCategory[];
  readonly contributions: readonly RiskLevel[];
}
const definitions: Record<string, RiskRuleDefinition> = {
  EMPTY_CHANGE: { categories: [], contributions: ["LOW"] },
  FILE_BREADTH: { categories: [], contributions: ["MEDIUM", "HIGH"] },
  LINE_BREADTH: { categories: [], contributions: ["MEDIUM", "HIGH"] },
  DATABASE_BREADTH: { categories: ["DATABASE"], contributions: ["HIGH"] },
  SENSITIVE_CONSTRUCT_BREADTH: { categories: RISK_SENSITIVE_CATEGORIES, contributions: ["HIGH"] },
};
for (const category of Object.keys(RISK_CATEGORY_MINIMUMS) as ChangeCategory[])
  definitions[`CATEGORY_${category}`] = {
    categories: [category],
    contributions: [RISK_CATEGORY_MINIMUMS[category]],
  };
for (const pair of RISK_COMBINATIONS)
  definitions[`COMBINED_${pair.join("_")}`] = { categories: pair, contributions: ["HIGH"] };
for (const category of RISK_DELETION_CATEGORIES)
  definitions[`DELETED_${category}_FILE`] = {
    categories: [category],
    contributions: [category === "TEST" ? "MEDIUM" : "HIGH"],
  };
export const RISK_RULE_DEFINITIONS: Readonly<Record<string, RiskRuleDefinition>> =
  deepFreeze(definitions);
