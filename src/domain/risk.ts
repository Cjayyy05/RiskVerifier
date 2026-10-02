import { InvariantViolationError } from "./errors.js";
import { parseRiskLevel, type RiskLevel } from "./enums.js";
import { deepFreeze } from "./immutable.js";
import {
  createComponentVersion,
  createEvidenceId,
  createRuleId,
  type ComponentVersion,
  type EvidenceId,
  type RuleId,
} from "./identities.js";
import { requireNonEmptyString, requirePlainObject, requireArray } from "./validation.js";
import { validateRiskData } from "./risk-facts.js";
import { createEvidence, type Evidence } from "./evidence.js";

export interface RiskEvidence {
  readonly evidence: Evidence;
  readonly ruleId: RuleId;
  readonly ruleVersion: ComponentVersion;
  readonly contribution: RiskLevel;
  readonly observation: string;
  readonly sourceEvidenceIds: readonly EvidenceId[];
}

export function createRiskEvidence(input: {
  readonly evidence: Evidence;
  readonly ruleId: unknown;
  readonly ruleVersion: unknown;
  readonly contribution: unknown;
  readonly observation: unknown;
  readonly sourceEvidenceIds?: readonly unknown[];
}): RiskEvidence {
  // Canonical Evidence permits JSON facts up to 64 levels deep, plus these wrappers.
  validateRiskData(input, 80);
  requirePlainObject(input, "riskEvidence");
  return deepFreeze({
    evidence: createEvidence(input.evidence),
    ruleId: createRuleId(input.ruleId),
    ruleVersion: createComponentVersion(input.ruleVersion),
    contribution: parseRiskLevel(input.contribution),
    observation: requireNonEmptyString(input.observation, "observation"),
    sourceEvidenceIds: (input.sourceEvidenceIds === undefined
      ? []
      : requireArray(input.sourceEvidenceIds, "sourceEvidenceIds")
    ).map(createEvidenceId),
  });
}

export interface RiskAssessment {
  readonly level: RiskLevel;
  readonly ruleSetVersion: ComponentVersion;
  readonly evidence: readonly RiskEvidence[];
}

export function createRiskAssessment(input: {
  readonly level: unknown;
  readonly ruleSetVersion: unknown;
  readonly evidence: readonly RiskEvidence[];
}): RiskAssessment {
  validateRiskData(input, 80);
  requirePlainObject(input, "riskAssessment");
  requireArray(input.evidence, "riskEvidence");
  const evidence = input.evidence.map(createRiskEvidence);
  if (evidence.length === 0) {
    throw new InvariantViolationError("A risk assessment requires risk evidence");
  }

  return deepFreeze({
    level: parseRiskLevel(input.level),
    ruleSetVersion: createComponentVersion(input.ruleSetVersion),
    evidence,
  });
}
