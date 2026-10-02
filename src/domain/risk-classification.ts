import type { ChangeClassification } from "./classification-facts.js";
import type { ChangeCategory } from "./enums.js";
import { InvalidInputError } from "./errors.js";
import { deepFreeze } from "./immutable.js";
import { RISK_CLASSIFIER_VERSION } from "./risk-contract.js";

/** Compatibility schema for approved Phase 3 evidence; no path or source reclassification. */
export const RISK_CLASSIFICATION_RULES: Readonly<
  Record<
    string,
    {
      readonly category: ChangeCategory;
      readonly shape: "PATH" | "SYNTAX" | "API_JSON" | "DEPENDENCY" | "FALLBACK";
    }
  >
> = deepFreeze({
  "path.fixture": { category: "TEST", shape: "PATH" },
  "path.test": { category: "TEST", shape: "PATH" },
  "path.database": { category: "DATABASE", shape: "PATH" },
  "path.configuration": { category: "CONFIGURATION", shape: "PATH" },
  "path.frontend": { category: "FRONTEND", shape: "PATH" },
  "path.lockfile": { category: "DEPENDENCY", shape: "PATH" },
  "syntax.authentication": { category: "AUTHENTICATION", shape: "SYNTAX" },
  "syntax.authorization": { category: "AUTHORIZATION", shape: "SYNTAX" },
  "syntax.api": { category: "API", shape: "SYNTAX" },
  "syntax.frontend": { category: "FRONTEND", shape: "SYNTAX" },
  "json.api": { category: "API", shape: "API_JSON" },
  "json.dependencies": { category: "DEPENDENCY", shape: "DEPENDENCY" },
  "fallback.general": { category: "GENERAL", shape: "FALLBACK" },
});

export function validateRiskClassification(classification: ChangeClassification): void {
  if (
    classification.classifierVersion !== RISK_CLASSIFIER_VERSION ||
    classification.changeSet.analyzerVersion !== "2.1.0"
  )
    throw new InvalidInputError("Unsupported classification/analyzer context for risk");
  const policy = classification.inspectionPolicy;
  if (policy.maxFiles > 1024 || policy.maxFileBytes > 1048576 || policy.maxTotalBytes > 8388608)
    throw new InvalidInputError("Inspection policy exceeds supported Phase 3 bounds");
  if (
    classification.changeSet.baseCommit === classification.changeSet.targetCommit &&
    classification.changeSet.fileCount !== 0
  )
    throw new InvalidInputError("Equal commits cannot contain changed files");
  for (const fact of classification.facts) {
    const rule = Object.hasOwn(RISK_CLASSIFICATION_RULES, fact.ruleId)
      ? RISK_CLASSIFICATION_RULES[fact.ruleId]
      : undefined;
    if (!rule || rule.category !== fact.category || fact.ruleVersion !== RISK_CLASSIFIER_VERSION)
      throw new InvalidInputError("Unknown or contradictory classification rule provenance");
    const oneSide = fact.side === "BASE" || fact.side === "TARGET";
    const digest = fact.constructDigest !== undefined;
    const valid =
      rule.shape === "SYNTAX"
        ? oneSide && fact.line !== null && digest
        : rule.shape === "API_JSON"
          ? oneSide && fact.line === null && digest
          : rule.shape === "PATH"
            ? oneSide && fact.line === null && !digest
            : rule.shape === "DEPENDENCY"
              ? fact.side === "BOTH" && fact.line === null && !digest
              : fact.side === "CHANGE_SET" && fact.line === null && !digest;
    if (!valid)
      throw new InvalidInputError("Classification evidence shape contradicts its producer rule");
  }
}
