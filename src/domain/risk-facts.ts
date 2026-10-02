import { createChangeClassification, type ChangeClassification } from "./classification-facts.js";
import { createChangeSet, type ChangeSet } from "./change.js";
import {
  CHANGE_CATEGORIES,
  RISK_LEVELS,
  parseChangeCategory,
  parseRiskLevel,
  type ChangeCategory,
  type RiskLevel,
} from "./enums.js";
import { InvalidInputError, InvariantViolationError } from "./errors.js";
import {
  createComponentVersion,
  createRuleId,
  type ComponentVersion,
  type RuleId,
} from "./identities.js";
import { deepFreeze } from "./immutable.js";
import { validateRiskClassification } from "./risk-classification.js";
import { RISK_RULE_DEFINITIONS, RISK_RULE_VERSION } from "./risk-contract.js";
import {
  requireArray,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requirePlainObject,
} from "./validation.js";

/** Plain DTO defense; does not claim to sandbox hostile JavaScript Proxy objects. */
export function validateRiskData(value: unknown, maximumDepth = 20): void {
  let nodes = 0;
  const active = new Set<object>();
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 600000 || depth > maximumDepth)
      throw new InvalidInputError("Risk data exceeds structural bounds");
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))
    )
      return;
    if (typeof item !== "object") throw new InvalidInputError("Risk input must be plain data");
    const prototype: unknown = Object.getPrototypeOf(item);
    if (
      active.has(item) ||
      (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null)
    )
      throw new InvalidInputError("Risk input contains cyclic or non-plain data");
    active.add(item);
    if (Array.isArray(item)) {
      if (item.length > 32768 || Object.keys(item).length !== item.length)
        throw new InvalidInputError("Risk arrays must be bounded and dense");
      for (let i = 0; i < item.length; i++)
        if (!Object.hasOwn(item, i)) throw new InvalidInputError("Risk arrays must be dense");
    }
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== "string" || !descriptor || !("value" in descriptor))
        throw new InvalidInputError("Risk accessors/symbol properties are forbidden");
      visit(descriptor.value, depth + 1);
    }
    active.delete(item);
  };
  visit(value, 0);
}

export function compareRiskKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalChanges(input: ChangeSet): ChangeSet {
  requirePlainObject(input, "changeSet");
  for (const file of requireArray(input.changedFiles, "changedFiles"))
    requirePlainObject(file, "changedFile");
  const changes = createChangeSet(input);
  if (
    changes.fileCount > 4096 ||
    new Set(changes.changedFiles.map((file) => file.path)).size !== changes.fileCount
  )
    throw new InvalidInputError("Risk requires at most 4096 uniquely identified changed files");
  for (const field of ["fileCount", "additions", "deletions", "hasUnknownLineCounts"] as const)
    if (input[field] !== changes[field])
      throw new InvalidInputError("Contradictory ChangeSet aggregate");
  return createChangeSet({
    ...changes,
    changedFiles: [...changes.changedFiles].sort((a, b) => compareRiskKeys(a.path, b.path)),
    analysisEvidenceIds: [...new Set(changes.analysisEvidenceIds)].sort(compareRiskKeys),
  });
}

/** Rebuild and bind both inputs, remapping source indices when canonicalizing file order. */
export function createRiskInput(
  changeSet: ChangeSet,
  classification: ChangeClassification,
): ChangeClassification {
  validateRiskData({ changeSet, classification });
  requirePlainObject(changeSet, "changeSet");
  requirePlainObject(classification, "classification");
  const changes = canonicalChanges(changeSet);
  const rebuilt = createChangeClassification(classification);
  validateRiskClassification(rebuilt);
  const nested = canonicalChanges(classification.changeSet);
  if (JSON.stringify(changes) !== JSON.stringify(nested))
    throw new InvariantViolationError(
      "Risk inputs must bind to the same repository, commits, analyzer and changed-file facts",
    );
  const declared = requireArray(classification.categories, "categories").map(parseChangeCategory);
  if (
    declared.length !== new Set(declared).size ||
    CHANGE_CATEGORIES.some(
      (category) => declared.includes(category) !== rebuilt.categories.includes(category),
    )
  )
    throw new InvariantViolationError("Classification categories contradict their facts");
  const fileIndices = new Map(changes.changedFiles.map((file, index) => [file.path, index]));
  const remap = (index: number): number => {
    const file = rebuilt.changeSet.changedFiles[index];
    if (!file) throw new InvalidInputError("Invalid classification file reference");
    const mapped = fileIndices.get(file.path);
    if (mapped === undefined) throw new InvalidInputError("Missing classification file reference");
    return mapped;
  };
  const facts = rebuilt.facts.map((fact) => ({
    ...fact,
    fileIndex: fact.fileIndex === null ? null : remap(fact.fileIndex),
  }));
  const limitations = rebuilt.limitations.map((item) => ({
    ...item,
    fileIndex: remap(item.fileIndex),
  }));
  const unique = <T>(items: readonly T[]): T[] =>
    [...new Map(items.map((item) => [JSON.stringify(item), item])).entries()]
      .sort(([a], [b]) => compareRiskKeys(a, b))
      .map(([, item]) => item);
  return createChangeClassification({
    ...rebuilt,
    changeSet: changes,
    facts: unique(facts),
    limitations: unique(limitations),
  });
}

export interface RiskFact {
  readonly ruleId: RuleId;
  readonly ruleVersion: ComponentVersion;
  readonly reasonCode: string;
  readonly contribution: RiskLevel;
  readonly observation: string;
  readonly categories: readonly ChangeCategory[];
  readonly classificationFactIndices: readonly number[];
  readonly fileIndices: readonly number[];
}
export interface RiskUncertainty {
  readonly code: string;
  readonly classificationLimitationIndices: readonly number[];
  readonly fileIndices: readonly number[];
}
/** Intermediate assessment; canonical RiskAssessment still requires genuine run Evidence. */
export interface ChangeRiskAssessment {
  readonly level: RiskLevel;
  readonly ruleSetVersion: ComponentVersion;
  readonly classification: ChangeClassification;
  readonly evidence: readonly RiskFact[];
  readonly uncertainties: readonly RiskUncertainty[];
}

export function createRiskFact(input: RiskFact, classification: ChangeClassification): RiskFact {
  validateRiskData(classification);
  requirePlainObject(classification, "classification");
  createRiskInput(classification.changeSet, classification);
  return buildRiskFact(input, createChangeClassification(classification));
}

function buildRiskFact(input: unknown, classification: ChangeClassification): RiskFact {
  validateRiskData(input);
  const record = requirePlainObject(input, "riskFact");
  const indices = (value: unknown, size: number): number[] =>
    [
      ...new Set(
        requireArray(value, "indices").map((item) => {
          const index = requireNonNegativeInteger(item, "index");
          if (index >= size)
            throw new InvalidInputError("Risk evidence reference is outside its input");
          return index;
        }),
      ),
    ].sort((a, b) => a - b);
  const factIndices = indices(record.classificationFactIndices, classification.facts.length);
  const fileIndices = indices(record.fileIndices, classification.changeSet.fileCount);
  const declared = requireArray(record.categories, "categories").map(parseChangeCategory);
  const categories = CHANGE_CATEGORIES.filter((category) => declared.includes(category));
  for (const category of categories)
    if (!factIndices.some((index) => classification.facts[index]?.category === category))
      throw new InvariantViolationError(
        "Every risk category requires a referenced classification fact",
      );
  for (const index of factIndices) {
    const fact = classification.facts[index];
    if (
      !fact ||
      !categories.includes(fact.category) ||
      (fact.fileIndex !== null && !fileIndices.includes(fact.fileIndex))
    )
      throw new InvariantViolationError("Risk evidence categories/files contradict source facts");
  }
  const reasonCode = requireNonEmptyString(record.reasonCode, "reasonCode");
  const definition = Object.hasOwn(RISK_RULE_DEFINITIONS, reasonCode)
    ? RISK_RULE_DEFINITIONS[reasonCode]
    : undefined;
  const contribution = parseRiskLevel(record.contribution);
  if (
    !definition ||
    record.ruleVersion !== RISK_RULE_VERSION ||
    record.ruleId !== `risk.${reasonCode.toLowerCase()}` ||
    !definition.contributions.includes(contribution)
  )
    throw new InvariantViolationError("Unknown or contradictory risk rule metadata");
  if (
    categories.some((category) => !definition.categories.includes(category)) ||
    (reasonCode !== "SENSITIVE_CONSTRUCT_BREADTH" &&
      definition.categories.some((category) => !categories.includes(category)))
  )
    throw new InvariantViolationError("Risk categories contradict the rule definition");
  if (definition.categories.length > 0 && factIndices.length === 0)
    throw new InvariantViolationError("Category risk evidence requires classification provenance");
  const empty = classification.changeSet.fileCount === 0;
  if (
    reasonCode === "EMPTY_CHANGE"
      ? !empty || fileIndices.length > 0 || factIndices.length > 0
      : empty || (definition.categories.length === 0 && fileIndices.length === 0)
  )
    throw new InvariantViolationError("Risk evidence has no applicable change provenance");
  const referencedFiles = [
    ...new Set(
      factIndices.flatMap((index) => {
        const file = classification.facts[index]?.fileIndex;
        return file === null || file === undefined ? [] : [file];
      }),
    ),
  ].sort((a, b) => a - b);
  if (factIndices.length > 0 && JSON.stringify(fileIndices) !== JSON.stringify(referencedFiles))
    throw new InvariantViolationError("Risk file references must exactly match source facts");
  return deepFreeze({
    ruleId: createRuleId(record.ruleId),
    ruleVersion: createComponentVersion(record.ruleVersion),
    reasonCode,
    contribution,
    observation: requireNonEmptyString(record.observation, "observation"),
    categories,
    classificationFactIndices: factIndices,
    fileIndices,
  });
}

export function createChangeRiskAssessment(input: ChangeRiskAssessment): ChangeRiskAssessment {
  validateRiskData(input);
  requirePlainObject(input, "riskAssessment");
  const classification = createChangeClassification(input.classification);
  createRiskInput(input.classification.changeSet, input.classification);
  const ruleSetVersion = createComponentVersion(input.ruleSetVersion);
  if (ruleSetVersion !== RISK_RULE_VERSION)
    throw new InvariantViolationError("Unsupported risk rule set");
  const evidence = requireArray(input.evidence, "evidence")
    .map((value) => buildRiskFact(value, classification))
    .sort((a, b) => compareRiskKeys(a.reasonCode, b.reasonCode));
  if (new Set(evidence.map((fact) => fact.reasonCode)).size !== evidence.length)
    throw new InvariantViolationError("Duplicate risk rule evidence");
  if (evidence.length === 0 || evidence.some((fact) => fact.ruleVersion !== ruleSetVersion))
    throw new InvariantViolationError(
      "Risk assessment requires evidence from its recorded rule set",
    );
  const maximum = evidence.reduce<RiskLevel>(
    (level, fact) =>
      RISK_LEVELS.indexOf(fact.contribution) > RISK_LEVELS.indexOf(level)
        ? fact.contribution
        : level,
    "LOW",
  );
  if (parseRiskLevel(input.level) !== maximum)
    throw new InvariantViolationError(
      "Risk level must equal the maximum explicit rule contribution",
    );
  const uncertainties = requireArray(input.uncertainties, "uncertainties")
    .map((value) => {
      const record = requirePlainObject(value, "uncertainty");
      const indices = (items: unknown, size: number): number[] =>
        [
          ...new Set(
            requireArray(items, "uncertainty indices").map((item) => {
              const index = requireNonNegativeInteger(item, "index");
              if (index >= size)
                throw new InvalidInputError("Risk uncertainty reference is outside its input");
              return index;
            }),
          ),
        ].sort((a, b) => a - b);
      const limitationIndices = indices(
        record.classificationLimitationIndices,
        classification.limitations.length,
      );
      const fileIndices = indices(record.fileIndices, classification.changeSet.fileCount);
      for (const index of limitationIndices) {
        const limitation = classification.limitations[index];
        if (!limitation || !fileIndices.includes(limitation.fileIndex))
          throw new InvariantViolationError("Uncertainty must reference the affected file");
      }
      return {
        code: requireNonEmptyString(record.code, "uncertainty code"),
        classificationLimitationIndices: limitationIndices,
        fileIndices,
      };
    })
    .sort((a, b) => compareRiskKeys(a.code, b.code));
  for (const [index] of classification.limitations.entries())
    if (!uncertainties.some((item) => item.classificationLimitationIndices.includes(index)))
      throw new InvariantViolationError(
        "Risk assessment must preserve every classification limitation",
      );
  if (JSON.stringify(uncertainties) !== JSON.stringify(createRiskUncertainties(classification)))
    throw new InvariantViolationError(
      "Risk assessment must preserve the exact required uncertainty records",
    );
  return deepFreeze({ level: maximum, ruleSetVersion, classification, evidence, uncertainties });
}

/** Derive uncertainty references without changing the ordinal risk contribution. */
export function createRiskUncertainties(input: ChangeClassification): readonly RiskUncertainty[] {
  validateRiskData(input);
  requirePlainObject(input, "classification");
  const classification = createChangeClassification(input);
  createRiskInput(input.changeSet, input);
  const changes = classification.changeSet;
  const allFiles = changes.changedFiles.map((_, index) => index);
  const result: RiskUncertainty[] = [
    {
      code: "BOUNDED_CLASSIFIER_COVERAGE",
      classificationLimitationIndices: [],
      fileIndices: allFiles,
    },
  ];
  if (classification.limitations.length > 0)
    result.push({
      code: "CLASSIFICATION_LIMITATIONS",
      classificationLimitationIndices: classification.limitations.map((_, index) => index),
      fileIndices: [...new Set(classification.limitations.map((item) => item.fileIndex))].sort(
        (a, b) => a - b,
      ),
    });
  if (changes.hasUnknownLineCounts)
    result.push({
      code: "UNKNOWN_LINE_COUNTS",
      classificationLimitationIndices: [],
      fileIndices: changes.changedFiles.flatMap((file, index) => (file.isBinary ? [index] : [])),
    });
  if (changes.fileCount > 0 && classification.categories.includes("GENERAL"))
    result.push({
      code: "UNSPECIFIED_CHANGE",
      classificationLimitationIndices: [],
      fileIndices: allFiles,
    });
  return deepFreeze(result.sort((a, b) => compareRiskKeys(a.code, b.code)));
}
