import { createChangeSet, type ChangeSet } from "./change.js";
import { CHANGE_CATEGORIES, parseChangeCategory, type ChangeCategory } from "./enums.js";
import { InvalidInputError, InvariantViolationError } from "./errors.js";
import {
  createComponentVersion,
  createRuleId,
  type ComponentVersion,
  type RuleId,
} from "./identities.js";
import { deepFreeze } from "./immutable.js";
import {
  requireEnumValue,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requirePlainObject,
  requireArray,
} from "./validation.js";

export const CLASSIFICATION_SIDES = Object.freeze([
  "BASE",
  "TARGET",
  "BOTH",
  "CHANGE_SET",
] as const);
export const CONTENT_EFFECTS = Object.freeze([
  "ADDED",
  "DELETED",
  "UNCHANGED",
  "MODIFIED",
  "UNKNOWN",
] as const);
export interface ClassificationFact {
  readonly category: ChangeCategory;
  readonly ruleId: RuleId;
  readonly ruleVersion: ComponentVersion;
  /** Index into this result's canonical ChangeSet. Null only for whole-change fallback. */
  readonly fileIndex: number | null;
  readonly side: (typeof CLASSIFICATION_SIDES)[number];
  readonly contentEffect: (typeof CONTENT_EFFECTS)[number];
  readonly signal: string;
  readonly observation: string;
  readonly line: number | null;
  readonly constructDigest?: string;
}
export interface ClassificationLimitation {
  readonly fileIndex: number;
  readonly side: "BASE" | "TARGET" | "BOTH";
  readonly code: string;
}
export interface ClassificationInspectionPolicy {
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly maxFiles: number;
}
/** Intermediate facts, not canonical run Evidence. No invented run identity or timestamp. */
export interface ChangeClassification {
  readonly changeSet: ChangeSet;
  readonly classifierVersion: ComponentVersion;
  readonly inspectionPolicy: ClassificationInspectionPolicy;
  readonly categories: readonly ChangeCategory[];
  readonly facts: readonly ClassificationFact[];
  readonly limitations: readonly ClassificationLimitation[];
}

export function createChangeClassification(input: {
  readonly changeSet: ChangeSet;
  readonly classifierVersion: unknown;
  readonly inspectionPolicy: ClassificationInspectionPolicy;
  readonly facts: readonly ClassificationFact[];
  readonly limitations: readonly ClassificationLimitation[];
}): ChangeClassification {
  // Reject executable/accessor-bearing, sparse, cyclic and excessive DTO graphs before reading fields.
  let count = 0;
  const active = new Set<object>();
  const inspect = (value: unknown, depth: number): void => {
    if (++count > 250000 || depth > 16)
      throw new InvalidInputError("Classification input exceeds structural limits");
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      return;
    if (typeof value !== "object")
      throw new InvalidInputError("Classification input must be plain data");
    if (active.has(value)) throw new InvalidInputError("Cyclic classification input");
    const prototype: unknown = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
      throw new InvalidInputError("Classification input must be plain data");
    active.add(value);
    if (Array.isArray(value)) {
      if (value.length > 32768 || Object.keys(value).length !== value.length)
        throw new InvalidInputError("Classification arrays must be bounded and dense");
      for (let i = 0; i < value.length; i++)
        if (!Object.hasOwn(value, i))
          throw new InvalidInputError("Classification arrays must be dense");
    }
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === "length") continue;
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== "string" || !property || !("value" in property))
        throw new InvalidInputError("Classification accessors are not allowed");
      inspect(property.value, depth + 1);
    }
    active.delete(value);
  };
  inspect(input, 0);
  requirePlainObject(input, "classification");
  requirePlainObject(input.changeSet, "changeSet");
  requirePlainObject(input.inspectionPolicy, "inspectionPolicy");
  const rawFacts = requireArray(input.facts, "facts");
  const rawLimitations = requireArray(input.limitations, "limitations");
  const changeSet = createChangeSet(input.changeSet);
  const index = (value: unknown): number => {
    const result = requireNonNegativeInteger(value, "fileIndex");
    if (result >= changeSet.fileCount)
      throw new InvalidInputError("Classification fileIndex is outside ChangeSet");
    return result;
  };
  const facts = rawFacts.map((value): ClassificationFact => {
    const fact = requirePlainObject(value, "fact");
    const side = requireEnumValue(fact.side, CLASSIFICATION_SIDES, "side");
    const category = parseChangeCategory(fact.category);
    if (
      (fact.fileIndex === null) !== (side === "CHANGE_SET") ||
      (side === "CHANGE_SET" && category !== "GENERAL")
    ) {
      throw new InvariantViolationError("Only GENERAL fallback may describe the whole ChangeSet");
    }
    const line = fact.line === null ? null : requireNonNegativeInteger(fact.line, "line");
    if (line === 0) throw new InvalidInputError("Source lines are one-based");
    const fileIndex = fact.fileIndex === null ? null : index(fact.fileIndex);
    const effect = requireEnumValue(fact.contentEffect, CONTENT_EFFECTS, "contentEffect");
    const file = fileIndex === null ? undefined : changeSet.changedFiles[fileIndex];
    if (category === "GENERAL" && (side !== "CHANGE_SET" || line !== null || effect !== "UNKNOWN"))
      throw new InvariantViolationError("GENERAL must be a whole-change fallback");
    if (
      file &&
      ((file.status === "ADDED" && (side === "BASE" || effect !== "ADDED")) ||
        (file.status === "DELETED" && (side === "TARGET" || effect !== "DELETED")) ||
        (file.status !== "ADDED" && effect === "ADDED") ||
        (file.status !== "DELETED" && effect === "DELETED"))
    )
      throw new InvariantViolationError(
        "Classification side/effect contradicts changed-file status",
      );
    if (line !== null && side !== "BASE" && side !== "TARGET")
      throw new InvariantViolationError("Source line requires one commit side");
    const constructDigest = fact.constructDigest;
    if (
      constructDigest !== undefined &&
      (typeof constructDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(constructDigest))
    )
      throw new InvalidInputError("Invalid construct digest");
    return {
      category,
      ruleId: createRuleId(fact.ruleId),
      ruleVersion: createComponentVersion(fact.ruleVersion),
      fileIndex,
      side,
      contentEffect: effect,
      signal: requireNonEmptyString(fact.signal, "signal"),
      observation: requireNonEmptyString(fact.observation, "observation"),
      line,
      ...(constructDigest === undefined ? {} : { constructDigest }),
    };
  });
  const categories = CHANGE_CATEGORIES.filter((category) =>
    facts.some((fact) => fact.category === category),
  );
  if (categories.length === 0 || (categories.includes("GENERAL") && categories.length !== 1)) {
    throw new InvariantViolationError(
      "Classification requires evidence; GENERAL is exclusive fallback",
    );
  }
  const policy = input.inspectionPolicy;
  return deepFreeze({
    changeSet,
    classifierVersion: createComponentVersion(input.classifierVersion),
    inspectionPolicy: {
      maxFileBytes: requireNonNegativeInteger(policy.maxFileBytes, "maxFileBytes"),
      maxTotalBytes: requireNonNegativeInteger(policy.maxTotalBytes, "maxTotalBytes"),
      maxFiles: requireNonNegativeInteger(policy.maxFiles, "maxFiles"),
    },
    categories,
    facts,
    limitations: rawLimitations.map((value) => {
      const item = requirePlainObject(value, "limitation");
      return {
        fileIndex: index(item.fileIndex),
        side: requireEnumValue(item.side, ["BASE", "TARGET", "BOTH"] as const, "side"),
        code: requireNonEmptyString(item.code, "code"),
      };
    }),
  });
}
