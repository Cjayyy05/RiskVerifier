import {
  CHANGE_CATEGORIES,
  RISK_LEVELS,
  InvalidInputError,
  createChangeRiskAssessment,
  createRiskInput,
  createRiskUncertainties,
  createRuleId,
  RISK_RULE_VERSION,
  RISK_CLASSIFIER_VERSION,
  RISK_CATEGORY_MINIMUMS,
  RISK_COMBINATIONS,
  RISK_DELETION_CATEGORIES,
  RISK_SENSITIVE_CATEGORIES,
  compareRiskKeys,
  type ChangeCategory,
  type ChangeClassification,
  type ChangeRiskAssessment,
  type ChangeSet,
  type RiskFact,
  type RiskLevel,
} from "../domain/index.js";

export const RISK_RULE_SET_VERSION = RISK_RULE_VERSION;
export const SUPPORTED_CLASSIFIER_VERSION = RISK_CLASSIFIER_VERSION;

/** Pure assessment of validated Phase 3 facts; no repository access or policy selection. */
export function assessRisk(
  changeSet: ChangeSet,
  input: ChangeClassification,
): ChangeRiskAssessment {
  const classification = createRiskInput(changeSet, input);
  const changes = classification.changeSet;
  const evidence: RiskFact[] = [];
  const allFiles = changes.changedFiles.map((_, index) => index);
  const factIndices = (categories: readonly ChangeCategory[]): number[] =>
    classification.facts.flatMap((fact, index) =>
      categories.includes(fact.category) ? [index] : [],
    );
  const sourceFiles = (indices: readonly number[]): number[] =>
    [
      ...new Set(
        indices.flatMap((index) => {
          const file = classification.facts[index]?.fileIndex;
          return file === null || file === undefined ? [] : [file];
        }),
      ),
    ].sort((a, b) => a - b);
  const add = (
    code: string,
    contribution: RiskLevel,
    observation: string,
    categories: readonly ChangeCategory[] = [],
    indices: readonly number[] = factIndices(categories),
    files: readonly number[] = sourceFiles(indices),
  ): void => {
    evidence.push({
      ruleId: createRuleId(`risk.${code.toLowerCase()}`),
      ruleVersion: RISK_RULE_SET_VERSION,
      reasonCode: code,
      contribution,
      observation,
      categories,
      classificationFactIndices: indices,
      fileIndices: files,
    });
  };
  if (changes.fileCount === 0)
    add("EMPTY_CHANGE", "LOW", "No changed files in the supplied comparison.");
  else
    for (const category of CHANGE_CATEGORIES)
      if (classification.categories.includes(category))
        add(
          `CATEGORY_${category}`,
          RISK_CATEGORY_MINIMUMS[category],
          `Minimum verification importance for classified ${category} changes.`,
          [category],
        );

  for (const pair of RISK_COMBINATIONS) {
    if (pair.every((category) => classification.categories.includes(category)))
      add(
        `COMBINED_${pair.join("_")}`,
        "HIGH",
        `Co-occurring ${pair.join(" and ")} changes require cross-category scrutiny; this does not establish runtime exposure.`,
        pair,
      );
  }

  if (changes.fileCount >= 5)
    add(
      "FILE_BREADTH",
      changes.fileCount >= 20 ? "HIGH" : "MEDIUM",
      `${changes.fileCount} changed files meet the breadth threshold (5 MEDIUM; 20 HIGH).`,
      [],
      [],
      allFiles,
    );
  // Avoid unsafe integer addition: counts are independently safe, thresholds are small.
  const knownLines = Math.min(changes.additions, 1500) + Math.min(changes.deletions, 1500);
  if (knownLines >= 300)
    add(
      "LINE_BREADTH",
      knownLines >= 1500 ? "HIGH" : "MEDIUM",
      "Known added/deleted line volume meets the breadth threshold (300 MEDIUM; 1500 HIGH).",
      [],
      [],
      allFiles,
    );
  const databaseFacts = factIndices(["DATABASE"]);
  const databaseFiles = sourceFiles(databaseFacts);
  const databaseLines = databaseFiles.reduce((total, index) => {
    const file = changes.changedFiles[index];
    return Math.min(
      200,
      total + Math.min(200, file?.additions ?? 0) + Math.min(200, file?.deletions ?? 0),
    );
  }, 0);
  if (databaseLines >= 200)
    add(
      "DATABASE_BREADTH",
      "HIGH",
      "At least 200 known changed lines in database-classified files; destructiveness is not established.",
      ["DATABASE"],
      databaseFacts,
      databaseFiles,
    );

  for (const category of RISK_DELETION_CATEGORIES) {
    const deleted = factIndices([category]).filter((index) => {
      const fact = classification.facts[index];
      return (
        fact?.fileIndex !== null &&
        fact?.fileIndex !== undefined &&
        fact.side === "BASE" &&
        changes.changedFiles[fact.fileIndex]?.status === "DELETED"
      );
    });
    if (deleted.length > 0)
      add(
        `DELETED_${category}_FILE`,
        category === "TEST" ? "MEDIUM" : "HIGH",
        `Deleted file carried ${category} classification; relocation or replacement elsewhere is not excluded.`,
        [category],
        deleted,
      );
  }

  // Count changed semantic locations, not names or repeated category/path hints.
  // BASE/TARGET representations may describe one edit: take max per file/category.
  const sensitive = RISK_SENSITIVE_CATEGORIES;
  const semantic = factIndices(sensitive).filter((index) => {
    const fact = classification.facts[index];
    return (
      fact?.constructDigest !== undefined &&
      fact.line !== null &&
      (fact.side === "BASE" || fact.side === "TARGET") &&
      (fact.contentEffect === "ADDED" ||
        fact.contentEffect === "DELETED" ||
        fact.contentEffect === "MODIFIED")
    );
  });
  const groups = new Map<string, { base: Set<string>; target: Set<string> }>();
  for (const index of semantic) {
    const fact = classification.facts[index];
    if (!fact) continue;
    const key = `${String(fact.fileIndex)}:${fact.category}`;
    const group = groups.get(key) ?? { base: new Set<string>(), target: new Set<string>() };
    const locations = fact.side === "BASE" ? group.base : group.target;
    locations.add(`${String(fact.line)}:${fact.constructDigest ?? ""}`);
    groups.set(key, group);
  }
  const constructCount = [...groups.values()].reduce(
    (total, group) => total + Math.max(group.base.size, group.target.size),
    0,
  );
  if (constructCount >= 5)
    add(
      "SENSITIVE_CONSTRUCT_BREADTH",
      "HIGH",
      `${constructCount} sensitive semantic location observations (maximum side count per file/category); not a count of distinct runtime controls.`,
      sensitive.filter((category) =>
        semantic.some((index) => classification.facts[index]?.category === category),
      ),
      semantic,
    );

  // Uncertainty is recorded independently. It does not imply a vulnerability or a verdict.
  evidence.sort((a, b) => compareRiskKeys(a.reasonCode, b.reasonCode));
  const level = evidence.reduce<RiskLevel>(
    (current, item) =>
      RISK_LEVELS.indexOf(item.contribution) > RISK_LEVELS.indexOf(current)
        ? item.contribution
        : current,
    "LOW",
  );
  return createChangeRiskAssessment({
    level,
    ruleSetVersion: RISK_RULE_SET_VERSION,
    classification,
    evidence,
    uncertainties: createRiskUncertainties(classification),
  });
}

/** Replay a claimed assessment against separately supplied, trusted analysis inputs. */
export function validateRiskAssessment(
  changeSet: ChangeSet,
  classification: ChangeClassification,
  supplied: ChangeRiskAssessment,
): ChangeRiskAssessment {
  const rebuilt = createChangeRiskAssessment(supplied);
  const expected = assessRisk(changeSet, classification);
  if (JSON.stringify(rebuilt) !== JSON.stringify(expected))
    throw new InvalidInputError(
      "Risk assessment does not match deterministic replay of its trusted inputs",
    );
  return expected;
}
