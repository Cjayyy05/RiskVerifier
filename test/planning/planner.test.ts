import assert from "node:assert/strict";
import test from "node:test";
import {
  CHANGE_CATEGORIES,
  createChangeVerificationPlan,
  createVerificationPlanContents,
  createConfigurationIdentity,
  createComponentVersion,
  createRuleId,
  type ChangeVerificationPlan,
  type ChangeVerificationPolicy,
} from "../../src/domain/index.js";
import {
  generateVerificationPlan,
  validateVerificationPlan,
  type PlanningInput,
} from "../../src/planning/index.js";
import { planningFixture } from "./fixture.js";

for (const category of CHANGE_CATEGORIES)
  void test(`${category} policy materializes exactly one conceptual check per selected strategy`, () => {
    const input = planningFixture([category]);
    const plan = generateVerificationPlan(input);
    const selected = input.policy.requirements.filter((item) => item.strength !== "UNNECESSARY");
    assert.deepEqual(
      plan.checks.map((item) => item.strategy),
      selected.map((item) => item.strategy),
    );
    assert.equal(new Set(plan.checks.map((item) => item.id)).size, selected.length);
    for (const check of plan.checks) {
      const requirement = plan.requirements.find((item) => item.id === check.requirementId)!;
      assert.equal(requirement.strategy, check.strategy);
      const policy = selected.find((item) => item.strategy === check.strategy)!;
      assert.equal(check.strength, policy.strength);
      assert.equal(check.disposition, policy.disposition);
      assert.equal(check.availability, policy.availability);
      assert.equal(check.unavailableBehavior, policy.unavailableBehavior);
      assert.equal(check.validFailureBehavior, policy.validFailureBehavior);
      assert.deepEqual(
        check.policyRuleIds,
        policy.reasons.map((item) => item.ruleId),
      );
    }
    assert.deepEqual(plan.policy, input.policy);
    assert.deepEqual(
      validateVerificationPlan(input, JSON.parse(JSON.stringify(plan)) as ChangeVerificationPlan),
      plan,
    );
  });

void test("mechanical BUILD + EXISTING_TESTS materialization yields exactly two checks, not an added policy decision", () => {
  const input = planningFixture(["TEST"]);
  const unused = input.policy.requirements.find((item) => item.strength === "UNNECESSARY")!;
  const twoStrategyPolicy: ChangeVerificationPolicy = {
    ...input.policy,
    requirements: input.policy.requirements.map((item) =>
      item.strategy === "STATIC_ANALYSIS" ? { ...unused, strategy: item.strategy } : item,
    ),
  };
  const contents = createVerificationPlanContents(twoStrategyPolicy, input.configuration);
  assert.deepEqual(
    contents.checks.map((item) => item.strategy),
    ["BUILD", "EXISTING_TESTS"],
  );
  // Current policy always also selects static analysis on nonempty input: never bypass that replay.
  assert.throws(() => generateVerificationPlan({ ...input, policy: twoStrategyPolicy }));
});

for (const categories of [
  ["AUTHORIZATION", "API"],
  ["DATABASE", "API"],
  ["AUTHENTICATION", "AUTHORIZATION"],
  ["DEPENDENCY", "CONFIGURATION"],
] as const)
  void test(`${categories.join("+")} preserves targeted checks and deduplication`, () => {
    const plan = generateVerificationPlan(planningFixture(categories));
    assert.equal(plan.checks.length, 5);
    assert.equal(new Set(plan.checks.map((item) => item.strategy)).size, 5);
    assert.ok(plan.checks.every((item) => item.strength === "MANDATORY"));
  });

void test("optional checks stay optional and unavailable checks remain represented", () => {
  for (const availability of ["SUPPORTED", "UNSUPPORTED", "UNAVAILABLE"] as const) {
    const input = planningFixture(["TEST"], { availability });
    const plan = generateVerificationPlan(input);
    assert.equal(plan.checks.length, 3);
    assert.equal(plan.checks.find((item) => item.strategy === "BUILD")?.strength, "OPTIONAL");
    assert.equal(
      plan.checks.find((item) => item.strategy === "EXISTING_TESTS")?.strength,
      "MANDATORY",
    );
    for (const check of plan.checks) {
      assert.equal(check.availability, availability);
      assert.equal(
        check.disposition,
        availability === "SUPPORTED" ? check.strength : "UNSUPPORTED",
      );
      assert.equal(check.unavailableBehavior, "INCONCLUSIVE");
      assert.equal(check.validFailureBehavior, "BLOCK");
    }
  }
});

void test("empty comparisons have zero checks, preserved ambient coverage, and no result/verdict", () => {
  const plan = generateVerificationPlan(planningFixture(["GENERAL"], { empty: true }));
  assert.deepEqual(plan.checks, []);
  assert.deepEqual(plan.requirements, []);
  assert.equal(plan.context.baseCommit, plan.context.targetCommit);
  assert.equal(plan.policy.coverage.length, 1);
  assert.deepEqual(Object.keys(plan), [
    "id",
    "plannerVersion",
    "context",
    "policy",
    "requirements",
    "checks",
  ]);
  assert.doesNotMatch(
    JSON.stringify(plan),
    /"(?:result|verdict|runId|createdAt|trustedDefinitionId|command|executable|timeout)":/u,
  );
});

void test("GENERAL and classification gaps preserve exact uncertainty and coverage obligations", () => {
  const input = planningFixture(["GENERAL"], { uncertain: true });
  const plan = generateVerificationPlan(input);
  assert.deepEqual(plan.policy.risk.uncertainties, input.risk.uncertainties);
  assert.deepEqual(plan.policy.coverage, input.policy.coverage);
  assert.ok(plan.policy.coverage.some((item) => item.resolution === "REVIEW_REQUIRED"));
  assert.ok(plan.checks.every((item) => item.strength === "MANDATORY"));
});

function changed<T>(input: T, path: string, value: unknown): T {
  const copy = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  const parts = path.split(".");
  let target = copy;
  for (const part of parts.slice(0, -1)) target = target[part] as Record<string, unknown>;
  target[parts.at(-1)!] = value;
  return copy as T;
}

void test("public intake rejects forged upstream context, policy, capabilities and execution fields", () => {
  const input = planningFixture(["AUTHORIZATION", "API"], { uncertain: true });
  for (const [path, value] of [
    ["changeSet.repository", "different"],
    ["changeSet.baseCommit", "c".repeat(40)],
    ["changeSet.targetCommit", "c".repeat(40)],
    ["classification.classifierVersion", "3.0.0"],
    ["classification.facts.0.ruleId", "invented"],
    ["risk.ruleSetVersion", "4.0.0"],
    ["risk.level", "LOW"],
    ["risk.uncertainties", []],
    ["policy.policyVersion", "5.0.0"],
    ["policy.requirements.0.strength", "OPTIONAL"],
    ["policy.coverage", []],
    ["capabilities.0.availability", "UNAVAILABLE"],
    ["capabilities.0.strategy", "BOGUS"],
    ["configuration.hash", "invalid"],
    ["configuration.commands", ["untrusted"]],
  ] as const)
    assert.throws(() => generateVerificationPlan(changed(input, path, value)), path);
  assert.throws(() => generateVerificationPlan({ ...input, commands: [] } as PlanningInput));
});

void test("plan factory rejects contradictory linkage, duplicated identity/strategy, context, handling and provenance", () => {
  const input = planningFixture();
  const plan = generateVerificationPlan(input);
  for (const [path, value] of [
    ["context.repository", "different"],
    ["context.baseCommit", "c".repeat(40)],
    ["context.targetCommit", "c".repeat(40)],
    ["context.analyzerVersion", "2.0.0"],
    ["context.classifierVersion", "3.0.0"],
    ["context.riskVersion", "4.0.0"],
    ["context.policyVersion", "5.0.0"],
    ["plannerVersion", "unknown"],
    ["id", "random"],
    ["checks.0.strategy", "UNKNOWN"],
    ["checks.0.requirementId", "orphan"],
    ["checks.0.id", plan.checks[1]!.id],
    ["checks.0.strength", "OPTIONAL"],
    ["checks.0.unavailableBehavior", "BLOCK"],
    ["checks.0.validFailureBehavior", "NOT_APPLICABLE"],
    ["checks.0.policyRuleIds", ["invented"]],
    ["checks.0.explanation", "Verification passed"],
    ["checks", [...plan.checks, plan.checks[0]]],
    ["checks", plan.checks.slice(1)],
    ["requirements", plan.requirements.slice(1)],
    ["requirements", [...plan.requirements, plan.requirements[0]]],
    ["policy.risk.uncertainties", []],
    ["policy.coverage", []],
    ["checks.0.command", "forbidden"],
  ] as const)
    assert.throws(() => createChangeVerificationPlan(changed(plan, path, value)), path);
});

void test("stored replay rejects well-shaped identity and trusted configuration substitution", () => {
  const input = planningFixture();
  const plan = generateVerificationPlan(input);
  assert.throws(() =>
    validateVerificationPlan(input, changed(plan, "id", `plan:sha256:${"0".repeat(64)}`)),
  );
  for (const field of ["hash", "version"] as const) {
    const configuration = createConfigurationIdentity({
      ...input.configuration,
      [field]: field === "hash" ? "0".repeat(64) : "different-version",
    });
    const substituted = generateVerificationPlan({ ...input, configuration });
    assert.notEqual(substituted.id, plan.id);
    assert.throws(() => validateVerificationPlan(input, substituted));
  }
});

void test("plan identity binds source, capabilities, evidence and configuration, not object insertion order", () => {
  const input = planningFixture();
  const original = generateVerificationPlan(input);
  for (const options of [
    { repository: "another" },
    { base: "c".repeat(40) },
    { target: "d".repeat(40) },
    { availability: "UNAVAILABLE" as const },
    { uncertain: true },
  ])
    assert.notEqual(generateVerificationPlan(planningFixture(undefined, options)).id, original.id);
  assert.notEqual(generateVerificationPlan(planningFixture(["TEST"])).id, original.id);
  assert.deepEqual(
    generateVerificationPlan({
      ...input,
      configuration: { hash: input.configuration.hash, version: input.configuration.version },
    }),
    original,
  );
});

void test("equivalent upstream and stored collection permutations yield identical plans and digests", () => {
  const input = planningFixture(["API", "AUTHORIZATION"], { uncertain: true });
  const expected = generateVerificationPlan(input);
  const classification = {
    ...input.classification,
    changeSet: { ...input.changeSet, changedFiles: [...input.changeSet.changedFiles].reverse() },
    categories: [...input.classification.categories].reverse(),
    facts: [...input.classification.facts]
      .reverse()
      .map((fact) => ({ ...fact, fileIndex: fact.fileIndex === null ? null : 1 - fact.fileIndex })),
    limitations: input.classification.limitations.map((item) => ({
      ...item,
      fileIndex: 1 - item.fileIndex,
    })),
  };
  const risk = {
    ...input.risk,
    evidence: [...input.risk.evidence].reverse(),
    uncertainties: [...input.risk.uncertainties].reverse(),
  };
  const policy = {
    ...input.policy,
    requirements: [...input.policy.requirements]
      .reverse()
      .map((item) => ({ ...item, reasons: [...item.reasons].reverse() })),
    coverage: [...input.policy.coverage].reverse(),
    capabilities: [...input.policy.capabilities].reverse(),
  };
  assert.deepEqual(
    generateVerificationPlan({
      ...input,
      changeSet: classification.changeSet,
      classification,
      risk,
      policy,
      capabilities: [...input.capabilities].reverse(),
    }),
    expected,
  );
  const reordered = {
    ...expected,
    policy,
    checks: [...expected.checks]
      .reverse()
      .map((check) => ({ ...check, policyRuleIds: [...check.policyRuleIds].reverse() })),
    requirements: [...expected.requirements].reverse(),
  };
  assert.deepEqual(validateVerificationPlan(input, reordered), expected);
});

void test("plan is detached, deeply frozen, serializable and rejects executable/non-plain data", () => {
  const source = planningFixture();
  const input = JSON.parse(JSON.stringify(source)) as PlanningInput;
  const plan = generateVerificationPlan(input);
  const walk = (value: unknown): void => {
    if (value !== null && typeof value === "object") {
      assert.ok(Object.isFrozen(value));
      for (const child of Object.values(value)) walk(child);
    }
  };
  walk(plan);
  assert.notEqual(plan.policy, input.policy);
  assert.throws(() => {
    Object.assign(plan.checks[0]!, { strength: "OPTIONAL" });
  });
  let reads = 0;
  const accessor = Object.defineProperty({ ...plan }, "checks", {
    enumerable: true,
    get: (): never => {
      reads++;
      throw new Error("executed");
    },
  });
  assert.throws(() => createChangeVerificationPlan(accessor));
  assert.equal(reads, 0);
  for (const value of [new Date(), Symbol("bad"), (): void => {}, new Array<unknown>(2)])
    assert.throws(() =>
      createChangeVerificationPlan({ ...plan, checks: value } as unknown as ChangeVerificationPlan),
    );
  const cyclic: Record<string, unknown> = { ...plan };
  cyclic.checks = cyclic;
  assert.throws(() => createChangeVerificationPlan(cyclic as unknown as ChangeVerificationPlan));
  assert.deepEqual(
    validateVerificationPlan(source, JSON.parse(JSON.stringify(plan)) as ChangeVerificationPlan),
    plan,
  );
  assert.throws(() =>
    generateVerificationPlan({
      ...source,
      classification: {
        ...source.classification,
        classifierVersion: createComponentVersion("3.0.0"),
        facts: source.classification.facts.map((fact) => ({
          ...fact,
          ruleId: createRuleId("forged"),
        })),
      },
    }),
  );
});
