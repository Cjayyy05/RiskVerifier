import { InvariantViolationError } from "./errors.js";
import { parseChangeCategory, type ChangeCategory } from "./enums.js";
import { deepFreeze } from "./immutable.js";
import {
  createComponentVersion,
  createRuleId,
  type ComponentVersion,
  type RuleId,
} from "./identities.js";
import { requireNonEmptyString } from "./validation.js";
import { createEvidence, type Evidence } from "./evidence.js";

export interface ClassificationEvidence {
  readonly evidence: Evidence;
  readonly category: ChangeCategory;
  readonly ruleId: RuleId;
  readonly ruleVersion: ComponentVersion;
  readonly observation: string;
  readonly sourceLocation?: string;
}

export function createClassificationEvidence(input: {
  readonly evidence: Evidence;
  readonly category: unknown;
  readonly ruleId: unknown;
  readonly ruleVersion: unknown;
  readonly observation: unknown;
  readonly sourceLocation?: unknown;
}): ClassificationEvidence {
  const sourceLocation =
    input.sourceLocation === undefined
      ? undefined
      : requireNonEmptyString(input.sourceLocation, "sourceLocation");

  return deepFreeze({
    evidence: createEvidence(input.evidence),
    category: parseChangeCategory(input.category),
    ruleId: createRuleId(input.ruleId),
    ruleVersion: createComponentVersion(input.ruleVersion),
    observation: requireNonEmptyString(input.observation, "observation"),
    ...(sourceLocation === undefined ? {} : { sourceLocation }),
  });
}

export interface ClassificationResult {
  readonly categories: readonly ChangeCategory[];
  readonly evidence: readonly ClassificationEvidence[];
}

export function createClassificationResult(input: {
  readonly categories: readonly unknown[];
  readonly evidence: readonly ClassificationEvidence[];
}): ClassificationResult {
  const categories = [...new Set(input.categories.map(parseChangeCategory))];
  const evidence = input.evidence.map(createClassificationEvidence);
  if (categories.length === 0) {
    throw new InvariantViolationError("A classification result requires at least one category");
  }

  for (const category of categories) {
    if (!evidence.some((item) => item.category === category)) {
      throw new InvariantViolationError("Every category requires classification evidence", {
        category,
      });
    }
  }

  if (evidence.some((item) => !categories.includes(item.category))) {
    throw new InvariantViolationError(
      "Classification evidence cannot declare a category absent from the result",
    );
  }

  return deepFreeze({ categories, evidence });
}
