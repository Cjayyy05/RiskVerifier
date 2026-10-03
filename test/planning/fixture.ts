import {
  createChangeClassification,
  createChangeSet,
  createChangedFile,
  createRuleId,
  createComponentVersion,
  createStrategyCapabilities,
  VERIFICATION_STRATEGIES,
  type ChangeCategory,
  type ClassificationFact,
  type StrategyAvailability,
} from "../../src/domain/index.js";
import { parseConfigurationSnapshot } from "../../src/configuration/index.js";
import { assessRisk } from "../../src/risk/index.js";
import { evaluatePolicy } from "../../src/policy/index.js";
import type { PlanningInput } from "../../src/planning/index.js";
import { SHA_A, SHA_B } from "../helpers.js";

export function planningFixture(
  categories: readonly ChangeCategory[] = ["AUTHORIZATION", "API"],
  options: {
    empty?: boolean;
    uncertain?: boolean;
    availability?: StrategyAvailability;
    repository?: string;
    base?: string;
    target?: string;
  } = {},
): PlanningInput {
  const changeSet = createChangeSet({
    repository: options.repository ?? "planning-tests",
    baseCommit: options.base ?? SHA_A,
    targetCommit: options.target ?? (options.empty ? SHA_A : SHA_B),
    analyzerVersion: "2.1.0",
    changedFiles: options.empty
      ? []
      : ["a.ts", "b.ts"].map((path) =>
          createChangedFile({
            path,
            status: "MODIFIED",
            additions: 1,
            deletions: 0,
            isBinary: false,
          }),
        ),
  });
  const facts = categories.map((category): ClassificationFact => {
    const syntax = category === "AUTHENTICATION" || category === "AUTHORIZATION";
    return {
      category,
      ruleId: createRuleId(
        {
          AUTHENTICATION: "syntax.authentication",
          AUTHORIZATION: "syntax.authorization",
          API: "json.api",
          DATABASE: "path.database",
          DEPENDENCY: "path.lockfile",
          CONFIGURATION: "path.configuration",
          TEST: "path.test",
          FRONTEND: "path.frontend",
          GENERAL: "fallback.general",
        }[category],
      ),
      ruleVersion: createComponentVersion("3.1.0"),
      fileIndex: category === "GENERAL" ? null : 0,
      side: category === "GENERAL" ? "CHANGE_SET" : "TARGET",
      contentEffect: category === "GENERAL" ? "UNKNOWN" : "MODIFIED",
      signal: "fixture",
      observation: "Structured fixture",
      line: syntax ? 1 : null,
      ...(syntax || category === "API" ? { constructDigest: `sha256:${"0".repeat(64)}` } : {}),
    };
  });
  const classification = createChangeClassification({
    changeSet,
    classifierVersion: "3.1.0",
    inspectionPolicy: { maxFiles: 1024, maxFileBytes: 100000, maxTotalBytes: 1000000 },
    facts,
    limitations: options.uncertain
      ? [{ fileIndex: 0, side: "BOTH", code: "NO_SUPPORTED_RULE" }]
      : [],
  });
  const risk = assessRisk(changeSet, classification);
  const capabilities = createStrategyCapabilities(
    VERIFICATION_STRATEGIES.map((strategy) => ({
      strategy,
      availability: options.availability ?? "SUPPORTED",
    })),
  );
  const policy = evaluatePolicy(changeSet, classification, risk, capabilities);
  return {
    changeSet,
    classification,
    risk,
    policy,
    capabilities,
    configuration: parseConfigurationSnapshot({ schemaVersion: 1, version: "planning-config-v1" })
      .identity,
  };
}
