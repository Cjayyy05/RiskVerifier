import {
  parseStrategyDisposition,
  parseUnavailableStrategyBehavior,
  parseVerificationStrategy,
  type StrategyDisposition,
  type UnavailableStrategyBehavior,
  type VerificationStrategy,
} from "./enums.js";
import { deepFreeze } from "./immutable.js";
import {
  createEvidenceId,
  createPolicyVersion,
  createRuleId,
  type EvidenceId,
  type PolicyVersion,
  type RuleId,
} from "./identities.js";
import { requireNonEmptyString } from "./validation.js";
export * from "./policy-facts.js";

export interface VerificationPolicy {
  readonly version: PolicyVersion;
  readonly description: string;
  readonly ruleIds: readonly RuleId[];
}

export function createVerificationPolicy(input: {
  readonly version: unknown;
  readonly description: unknown;
  readonly ruleIds?: readonly unknown[];
}): VerificationPolicy {
  return deepFreeze({
    version: createPolicyVersion(input.version),
    description: requireNonEmptyString(input.description, "policyDescription"),
    ruleIds: (input.ruleIds ?? []).map(createRuleId),
  });
}

export interface StrategyRequirement {
  readonly strategy: VerificationStrategy;
  readonly disposition: StrategyDisposition;
  readonly policyVersion: PolicyVersion;
  readonly selectionReason: string;
  readonly originatingEvidenceIds: readonly EvidenceId[];
  readonly matchedRuleIds: readonly RuleId[];
  readonly unavailableBehavior: UnavailableStrategyBehavior;
}

export function createStrategyRequirement(input: {
  readonly strategy: unknown;
  readonly disposition: unknown;
  readonly policyVersion: unknown;
  readonly selectionReason: unknown;
  readonly originatingEvidenceIds?: readonly unknown[];
  readonly matchedRuleIds?: readonly unknown[];
  readonly unavailableBehavior: unknown;
}): StrategyRequirement {
  return deepFreeze({
    strategy: parseVerificationStrategy(input.strategy),
    disposition: parseStrategyDisposition(input.disposition),
    policyVersion: createPolicyVersion(input.policyVersion),
    selectionReason: requireNonEmptyString(input.selectionReason, "selectionReason"),
    originatingEvidenceIds: (input.originatingEvidenceIds ?? []).map(createEvidenceId),
    matchedRuleIds: (input.matchedRuleIds ?? []).map(createRuleId),
    unavailableBehavior: parseUnavailableStrategyBehavior(input.unavailableBehavior),
  });
}
