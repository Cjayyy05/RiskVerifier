import assert from "node:assert/strict";
import test from "node:test";
import {
  createChangeClassification,
  createChangeSet,
  createChangedFile,
  createRuleId,
  createComponentVersion,
  createChangeVerificationPolicy,
  createStrategyCapabilities,
  VERIFICATION_STRATEGIES,
  POLICY_CATEGORY_STRATEGIES,
  mergeRequirementStrength,
  mergeUnavailableBehavior,
  type ChangeCategory,
  type ChangeClassification,
  type ChangeVerificationPolicy,
  type ClassificationFact,
  type ChangeRiskAssessment,
  type StrategyCapability,
} from "../../src/domain/index.js";
import { assessRisk } from "../../src/risk/index.js";
import { evaluatePolicy, validatePolicyResult, policyIntensity } from "../../src/policy/index.js";
import { evaluateRules } from "../../src/policy/evaluator.js";
import { POLICY_RULES } from "../../src/policy/rules.js";
import { SHA_A, SHA_B } from "../helpers.js";

function fixture(
  categories: readonly ChangeCategory[],
  options: {
    empty?: boolean;
    uncertain?: boolean;
    binary?: boolean;
    lines?: number;
    jsx?: boolean;
  } = {},
): ChangeClassification {
  const changeSet = createChangeSet({
    repository: "policy-tests",
    baseCommit: SHA_A,
    targetCommit: options.empty ? SHA_A : SHA_B,
    analyzerVersion: "2.1.0",
    changedFiles: options.empty
      ? []
      : ["a.ts", "b.ts"].map((path) =>
          createChangedFile({
            path,
            status: "MODIFIED",
            additions: options.binary ? null : (options.lines ?? 1),
            deletions: options.binary ? null : 0,
            isBinary: options.binary ?? false,
          }),
        ),
  });
  const facts = categories.map((category): ClassificationFact => {
    const syntax =
      category === "AUTHENTICATION" ||
      category === "AUTHORIZATION" ||
      (category === "FRONTEND" && options.jsx);
    return {
      category,
      ruleId: createRuleId(
        syntax
          ? `syntax.${category.toLowerCase()}`
          : {
              GENERAL: "fallback.general",
              API: "json.api",
              DATABASE: "path.database",
              DEPENDENCY: "path.lockfile",
              CONFIGURATION: "path.configuration",
              TEST: "path.test",
              FRONTEND: "path.frontend",
              AUTHENTICATION: "syntax.authentication",
              AUTHORIZATION: "syntax.authorization",
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
  return createChangeClassification({
    changeSet,
    classifierVersion: "3.1.0",
    inspectionPolicy: { maxFiles: 1024, maxFileBytes: 100000, maxTotalBytes: 1000000 },
    facts,
    limitations: options.uncertain
      ? [{ fileIndex: 0, side: "BOTH", code: "NO_SUPPORTED_RULE" }]
      : [],
  });
}
const capabilities = createStrategyCapabilities(
  VERIFICATION_STRATEGIES.map((strategy) => ({ strategy, availability: "SUPPORTED" })),
);
function policy(classification: ChangeClassification): ChangeVerificationPolicy {
  return evaluatePolicy(
    classification.changeSet,
    classification,
    assessRisk(classification.changeSet, classification),
    capabilities,
  );
}
for (const [category, strategy] of Object.entries(POLICY_CATEGORY_STRATEGIES))
  void test(`${category} selects its targeted strategy without unrelated checks`, () => {
    const result = policy(fixture([category as ChangeCategory]));
    assert.equal(
      result.requirements.find((item) => item.strategy === strategy)?.strength,
      category === "FRONTEND" ? "OPTIONAL" : "MANDATORY",
    );
    assert.equal(result.requirements.filter((item) => item.strength !== "UNNECESSARY").length, 4);
    assert.ok(Object.isFrozen(result.requirements[0]?.reasons));
  });
for (const categories of [
  ["AUTHORIZATION", "API"],
  ["API", "DATABASE"],
  ["DEPENDENCY", "CONFIGURATION"],
  ["AUTHENTICATION", "AUTHORIZATION"],
] as const)
  void test(`${categories.join("+")} deduplicates baseline and combines targets`, () => {
    const result = policy(fixture(categories));
    assert.equal(new Set(result.requirements.map((item) => item.strategy)).size, 10);
    assert.equal(result.requirements.filter((item) => item.strength === "MANDATORY").length, 5);
    assert.ok(
      result.requirements
        .find((item) => item.strategy === "STATIC_ANALYSIS")!
        .reasons.some((item) => item.strength === "OPTIONAL"),
    );
  });
void test("test and style baselines are lighter; JSX and elevated risk strengthen requirements", () => {
  assert.equal(
    policy(fixture(["TEST"])).requirements.find((item) => item.strategy === "BUILD")?.strength,
    "OPTIONAL",
  );
  assert.equal(
    policy(fixture(["TEST"])).requirements.find((item) => item.strategy === "EXISTING_TESTS")
      ?.strength,
    "MANDATORY",
  );
  assert.equal(
    policy(fixture(["FRONTEND"])).requirements.find((item) => item.strategy === "EXISTING_TESTS")
      ?.strength,
    "OPTIONAL",
  );
  for (const options of [{ jsx: true }, { lines: 800 }])
    assert.equal(
      policy(fixture(["FRONTEND"], options)).requirements.find(
        (item) => item.strategy === "FRONTEND_BEHAVIOR_VERIFICATION",
      )?.strength,
      "MANDATORY",
    );
});

void test("stored risk permutations preserve referenced records, not numeric positions", () => {
  const input = fixture(["AUTHORIZATION", "API"], { uncertain: true, binary: true });
  const result = policy(input);
  const risk = result.risk;
  const reorderedRisk = {
    ...risk,
    evidence: [...risk.evidence].reverse(),
    uncertainties: [...risk.uncertainties].reverse(),
  };
  const reordered = {
    ...result,
    risk: reorderedRisk,
    requirements: [...result.requirements].reverse().map((requirement) => ({
      ...requirement,
      reasons: [...requirement.reasons].reverse().map((reason) => ({
        ...reason,
        riskFactIndices: reason.riskFactIndices.map((index) => risk.evidence.length - 1 - index),
        uncertaintyIndices: reason.uncertaintyIndices.map(
          (index) => risk.uncertainties.length - 1 - index,
        ),
      })),
    })),
    coverage: [...result.coverage].reverse().map((coverage) => ({
      ...coverage,
      uncertaintyIndex: risk.uncertainties.length - 1 - coverage.uncertaintyIndex,
    })),
    capabilities: [...result.capabilities].reverse(),
  };
  assert.deepEqual(
    validatePolicyResult(input.changeSet, input, risk, capabilities, reordered),
    result,
  );
  // Same positions in the new arrays now refer to different facts and must not be silently repaired.
  assert.throws(() =>
    validatePolicyResult(input.changeSet, input, risk, capabilities, {
      ...result,
      risk: reorderedRisk,
    }),
  );
});

void test("optional omission differs from valid failure; future failure treatment is explicit and immutable", () => {
  for (const category of ["TEST", "FRONTEND"] as const) {
    const input = fixture([category]);
    const result = policy(input);
    assert.ok(result.requirements.some((item) => item.strength === "OPTIONAL"));
    for (const item of result.requirements) {
      assert.equal(
        item.validFailureBehavior,
        item.strength === "UNNECESSARY" ? "NOT_APPLICABLE" : "BLOCK",
      );
      assert.equal(item.unavailableBehavior, "INCONCLUSIVE");
      assert.ok(Object.isFrozen(item));
    }
    const forged = {
      ...result,
      requirements: result.requirements.map((item) => ({
        ...item,
        validFailureBehavior: "NOT_APPLICABLE" as const,
      })),
    };
    assert.throws(() =>
      validatePolicyResult(input.changeSet, input, result.risk, capabilities, forged),
    );
  }
});

void test("policy cannot elevate caller capability assertions from a stored result into authority", () => {
  const input = fixture(["AUTHORIZATION"]);
  const risk = assessRisk(input.changeSet, input);
  const unavailable = evaluatePolicy(input.changeSet, input, risk);
  const claimedSupported = policy(input);
  assert.throws(() =>
    validatePolicyResult(input.changeSet, input, risk, unavailable.capabilities, claimedSupported),
  );
  for (const forged of [
    capabilities.slice(1),
    [...capabilities, capabilities[0]],
    capabilities.map((item, index) => (index === 0 ? { ...item, strategy: "FAKE" } : item)),
    capabilities.map((item, index) => (index === 0 ? { ...item, availability: "PASS" } : item)),
  ])
    assert.throws(() =>
      evaluatePolicy(input.changeSet, input, risk, forged as readonly StrategyCapability[]),
    );
  let getterReads = 0;
  const accessor = {
    get strategy(): string {
      getterReads++;
      return "BUILD";
    },
    availability: "SUPPORTED",
  };
  assert.throws(() => createStrategyCapabilities([accessor, ...capabilities.slice(1)]));
  assert.equal(getterReads, 0);
  assert.deepEqual(unavailable.risk, claimedSupported.risk);
  assert.deepEqual(
    unavailable.requirements.map((item) => item.strength),
    claimedSupported.requirements.map((item) => item.strength),
  );
});

void test("policy risk replay rejects level, evidence, uncertainty and producer/context forgery", () => {
  const input = fixture(["AUTHORIZATION", "API"], { uncertain: true });
  const risk = assessRisk(input.changeSet, input);
  const mutations: readonly ChangeRiskAssessment[] = [
    { ...risk, level: "LOW" },
    { ...risk, evidence: risk.evidence.slice(1) },
    {
      ...risk,
      evidence: risk.evidence.map((fact, index) =>
        index === 0 ? { ...fact, observation: "Fabricated evidence" } : fact,
      ),
    },
    { ...risk, uncertainties: [] },
    { ...risk, uncertainties: risk.uncertainties.slice(1) },
    {
      ...risk,
      uncertainties: risk.uncertainties.map((fact, index) =>
        index === 0 ? { ...fact, code: "FABRICATED" } : fact,
      ),
    },
    { ...risk, ruleSetVersion: createComponentVersion("4.0.0") },
  ];
  for (const forged of mutations)
    assert.throws(() => evaluatePolicy(input.changeSet, input, forged));
  const low = fixture(["TEST"]);
  assert.throws(() =>
    evaluatePolicy(low.changeSet, low, { ...assessRisk(low.changeSet, low), level: "HIGH" }),
  );
  for (const classification of [
    { ...input, classifierVersion: createComponentVersion("3.0.0") },
    {
      ...input,
      facts: input.facts.map((fact) => ({ ...fact, ruleId: createRuleId("invented.rule") })),
    },
    { ...input, changeSet: createChangeSet({ ...input.changeSet, repository: "substituted" }) },
    {
      ...input,
      changeSet: createChangeSet({ ...input.changeSet, baseCommit: SHA_B, targetCommit: SHA_A }),
    },
  ])
    assert.throws(() => evaluatePolicy(input.changeSet, classification, risk));
});

void test("forged absence BLOCK, changed reasons and stripped stored uncertainty fail closed", () => {
  const input = fixture(["GENERAL"], { uncertain: true, binary: true });
  const result = policy(input);
  const attacks = [
    { ...result, requirements: result.requirements.slice(1) },
    {
      ...result,
      requirements: result.requirements.map((item) => ({
        ...item,
        unavailableBehavior: "BLOCK" as const,
        reasons: item.reasons.map((reason) => ({
          ...reason,
          unavailableBehavior: "BLOCK" as const,
        })),
      })),
    },
    {
      ...result,
      requirements: result.requirements.map((item) => ({
        ...item,
        reasons: item.reasons.map((reason) => ({ ...reason, explanation: "Verification passed" })),
      })),
    },
    { ...result, risk: { ...result.risk, uncertainties: result.risk.uncertainties.slice(0, -1) } },
  ];
  for (const attack of attacks)
    assert.throws(() =>
      validatePolicyResult(input.changeSet, input, result.risk, capabilities, attack),
    );
});

void test("mixed categories and partial frontend evidence cannot weaken baseline requirements", () => {
  for (const categories of [
    ["TEST", "DEPENDENCY"],
    ["TEST", "CONFIGURATION"],
    ["TEST", "API"],
    ["FRONTEND", "API"],
    ["FRONTEND", "AUTHORIZATION"],
    ["AUTHENTICATION", "API"],
  ] as const) {
    const input = fixture(categories);
    const result = policy(input);
    const risk = result.risk;
    for (const strategy of ["BUILD", "EXISTING_TESTS", "STATIC_ANALYSIS"] as const)
      assert.equal(
        result.requirements.find((item) => item.strategy === strategy)?.strength,
        "MANDATORY",
      );
    for (let index = 0; index < POLICY_RULES.length; index++)
      assert.deepEqual(
        evaluateRules(risk, capabilities, [
          ...POLICY_RULES.slice(index),
          ...POLICY_RULES.slice(0, index),
        ]),
        result,
      );
    assert.deepEqual(
      policy({
        ...input,
        facts: [...input.facts].reverse(),
        categories: [...input.categories].reverse(),
      }),
      result,
    );
  }
  const partial = policy(fixture(["FRONTEND"], { uncertain: true }));
  assert.equal(
    partial.requirements.find((item) => item.strategy === "EXISTING_TESTS")?.strength,
    "MANDATORY",
  );
  assert.ok(partial.coverage.some((item) => item.resolution === "REVIEW_REQUIRED"));
});
void test("GENERAL never proves docs-only or understood semantics; explicit gaps survive", () => {
  for (const options of [{}, { uncertain: true }, { binary: true }]) {
    const result = policy(fixture(["GENERAL"], options));
    assert.equal(result.requirements.filter((item) => item.strength === "MANDATORY").length, 3);
    assert.ok(result.coverage.some((item) => item.resolution === "REVIEW_REQUIRED"));
    assert.equal(result.coverage.length, result.risk.uncertainties.length);
  }
  const result = policy(fixture(["TEST"], { uncertain: true }));
  assert.equal(
    result.requirements.find((item) => item.strategy === "BUILD")?.strength,
    "MANDATORY",
  );
});
void test("empty comparison selects nothing and emits no verdict or plan", () => {
  const result = policy(fixture(["GENERAL"], { empty: true }));
  assert.ok(result.requirements.every((item) => item.strength === "UNNECESSARY"));
  assert.deepEqual(Object.keys(result), [
    "policyVersion",
    "risk",
    "capabilities",
    "requirements",
    "coverage",
  ]);
});
void test("capability absence never downgrades mandatory or optional strength", () => {
  const input = fixture(["AUTHORIZATION"]);
  const risk = assessRisk(input.changeSet, input);
  for (const availability of ["SUPPORTED", "UNSUPPORTED", "UNAVAILABLE"] as const) {
    const result = evaluatePolicy(
      input.changeSet,
      input,
      risk,
      createStrategyCapabilities(
        VERIFICATION_STRATEGIES.map((strategy) => ({ strategy, availability })),
      ),
    );
    const target = result.requirements.find(
      (item) => item.strategy === "AUTHORIZATION_VERIFICATION",
    )!;
    assert.equal(target.strength, "MANDATORY");
    assert.equal(target.disposition, availability === "SUPPORTED" ? "MANDATORY" : "UNSUPPORTED");
    assert.equal(target.unavailableBehavior, "INCONCLUSIVE");
  }
  assert.ok(
    evaluatePolicy(input.changeSet, input, risk).capabilities.every(
      (item) => item.availability === "UNAVAILABLE",
    ),
  );
});
void test("conflict precedence is order independent; future CRITICAL cannot bypass risk replay", () => {
  assert.equal(mergeRequirementStrength(["OPTIONAL", "MANDATORY"]), "MANDATORY");
  assert.equal(mergeRequirementStrength(["MANDATORY", "OPTIONAL"]), "MANDATORY");
  assert.equal(mergeUnavailableBehavior(["BLOCK", "INCONCLUSIVE"]), "BLOCK");
  assert.equal(mergeUnavailableBehavior(["INCONCLUSIVE", "BLOCK"]), "BLOCK");
  assert.equal(policyIntensity("CRITICAL"), "ELEVATED");
  const input = fixture(["API"]);
  const risk = assessRisk(input.changeSet, input);
  assert.throws(() => evaluatePolicy(input.changeSet, input, { ...risk, level: "CRITICAL" }));
});
void test("equivalent files, facts, capabilities and built-in rule order produce identical output", () => {
  const input = fixture(["AUTHORIZATION", "API"]);
  const risk = assessRisk(input.changeSet, input);
  const expected = policy(input);
  const reordered = {
    ...input,
    changeSet: { ...input.changeSet, changedFiles: [...input.changeSet.changedFiles].reverse() },
    facts: [...input.facts]
      .reverse()
      .map((fact) => ({ ...fact, fileIndex: fact.fileIndex === null ? null : 1 - fact.fileIndex })),
  };
  assert.deepEqual(
    evaluatePolicy(
      reordered.changeSet,
      reordered,
      {
        ...risk,
        evidence: [...risk.evidence].reverse(),
        uncertainties: [...risk.uncertainties].reverse(),
      },
      [...capabilities].reverse(),
    ),
    expected,
  );
  assert.deepEqual(evaluateRules(risk, capabilities, [...POLICY_RULES].reverse()), expected);
  assert.deepEqual(evaluateRules(risk, capabilities, [...POLICY_RULES, ...POLICY_RULES]), expected);
});
void test("policy intake rejects forged metadata, references, duplicate strategies and contradictory states", () => {
  const input = fixture(["API"]);
  const risk = assessRisk(input.changeSet, input);
  const result = policy(input);
  const mutations: readonly [string, unknown][] = [
    ["policyVersion", "0"],
    ["requirements.0.strategy", "FAKE"],
    ["requirements.0.strength", "FAKE"],
    ["requirements.0.disposition", "OPTIONAL"],
    ["requirements", [...result.requirements, result.requirements[0]]],
    ["requirements.0.reasons.0.ruleId", "fake"],
    ["requirements.0.reasons.0.classificationFactIndices", [999]],
    ["requirements.0.reasons.0.riskFactIndices", [999]],
    ["coverage", []],
    ["risk.ruleSetVersion", "4.0.0"],
    ["risk.classification.classifierVersion", "3.0.0"],
    ["risk.classification.changeSet.repository", "other"],
    ["risk.classification.changeSet.targetCommit", SHA_A],
    ["requirements.0.reasons", result.requirements[0]!.reasons.slice(1)],
    ["capabilities.0.availability", "UNAVAILABLE"],
  ];
  for (const [path, value] of mutations) {
    const forged = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    const parts = path.split(".");
    let target = forged;
    for (const part of parts.slice(0, -1)) target = target[part] as Record<string, unknown>;
    target[parts.at(-1)!] = value;
    assert.throws(() =>
      validatePolicyResult(
        input.changeSet,
        input,
        risk,
        capabilities,
        forged as unknown as ChangeVerificationPolicy,
      ),
    );
  }
  assert.deepEqual(
    validatePolicyResult(input.changeSet, input, risk, capabilities, result),
    result,
  );
  assert.throws(() => createStrategyCapabilities([]));
  assert.throws(() => createChangeVerificationPolicy({ ...result, requirements: [] }));
});
