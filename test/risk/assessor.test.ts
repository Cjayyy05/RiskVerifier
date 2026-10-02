import assert from "node:assert/strict";
import test from "node:test";
import {
  createChangeClassification,
  createChangedFile,
  createChangeSet,
  createComponentVersion,
  createRuleId,
  createChangeRiskAssessment,
  createRiskFact,
  createRiskAssessment,
  createRiskEvidence,
  type ChangeCategory,
  type ChangeClassification,
  type ChangedFile,
  type ClassificationFact,
  type RiskLevel,
} from "../../src/domain/index.js";
import { assessRisk, validateRiskAssessment } from "../../src/risk/index.js";
import { SHA_A, SHA_B, createTestEvidence } from "../helpers.js";

function fixture(
  categories: readonly ChangeCategory[],
  options: {
    files?: number;
    lines?: number;
    status?: ChangedFile["status"];
    binary?: boolean;
    limitations?: boolean;
    path?: string;
  } = {},
): ChangeClassification {
  const count = options.files ?? 1;
  const changes = createChangeSet({
    repository: "risk-tests",
    baseCommit: SHA_A,
    targetCommit: SHA_B,
    analyzerVersion: "2.1.0",
    changedFiles: Array.from({ length: count }, (_, index) =>
      createChangedFile({
        path: `${String(index)}-${options.path ?? "opaque.ts"}`,
        status: options.status ?? "MODIFIED",
        additions: options.binary ? null : (options.lines ?? 1),
        deletions: options.binary ? null : 0,
        isBinary: options.binary ?? false,
      }),
    ),
  });
  const facts = categories.map((category): ClassificationFact => ({
    category,
    ruleId: createRuleId(
      {
        AUTHENTICATION: "syntax.authentication",
        AUTHORIZATION: "syntax.authorization",
        API: "json.api",
        DATABASE: "path.database",
        CONFIGURATION: "path.configuration",
        DEPENDENCY: "path.lockfile",
        TEST: "path.test",
        FRONTEND: "path.frontend",
        GENERAL: "fallback.general",
      }[category],
    ),
    ruleVersion: createComponentVersion("3.1.0"),
    fileIndex: category === "GENERAL" ? null : 0,
    side: category === "GENERAL" ? "CHANGE_SET" : options.status === "DELETED" ? "BASE" : "TARGET",
    contentEffect:
      category === "GENERAL"
        ? "UNKNOWN"
        : options.status === "DELETED"
          ? "DELETED"
          : options.status === "ADDED"
            ? "ADDED"
            : "MODIFIED",
    signal: "supported-fixture",
    observation: "Structured classifier fact",
    line: category === "AUTHENTICATION" || category === "AUTHORIZATION" ? 1 : null,
    ...(["AUTHENTICATION", "AUTHORIZATION", "API"].includes(category)
      ? { constructDigest: `sha256:${"0".repeat(64)}` }
      : {}),
  }));
  return createChangeClassification({
    changeSet: changes,
    classifierVersion: "3.1.0",
    inspectionPolicy: { maxFiles: 1024, maxFileBytes: 100000, maxTotalBytes: 1000000 },
    facts,
    limitations: options.limitations
      ? [{ fileIndex: 0, side: "BOTH", code: "NO_SUPPORTED_RULE" }]
      : [],
  });
}
function assess(classification: ChangeClassification): ReturnType<typeof assessRisk> {
  return assessRisk(classification.changeSet, classification);
}
const cases: readonly [ChangeCategory, RiskLevel][] = [
  ["FRONTEND", "LOW"],
  ["TEST", "LOW"],
  ["API", "MEDIUM"],
  ["CONFIGURATION", "MEDIUM"],
  ["DEPENDENCY", "MEDIUM"],
  ["DATABASE", "MEDIUM"],
  ["GENERAL", "MEDIUM"],
  ["AUTHENTICATION", "HIGH"],
  ["AUTHORIZATION", "HIGH"],
];
for (const [category, level] of cases)
  void test(`${category} explicit minimum is ${level}, not a verdict`, () => {
    const result = assess(fixture([category]));
    assert.equal(result.level, level);
    assert.ok(
      result.evidence.some(
        (fact) =>
          fact.reasonCode === `CATEGORY_${category}` && fact.classificationFactIndices.length > 0,
      ),
    );
    assert.deepEqual(Object.keys(result), [
      "level",
      "ruleSetVersion",
      "classification",
      "evidence",
      "uncertainties",
    ]);
    assert.doesNotMatch(JSON.stringify(result), /APPROVE|BLOCK|INCONCLUSIVE/u);
    assert.notEqual(result.level, "CRITICAL");
  });
for (const categories of [
  ["AUTHORIZATION", "API"],
  ["AUTHENTICATION", "API"],
  ["DATABASE", "API"],
  ["DEPENDENCY", "CONFIGURATION"],
] as const)
  void test(`${categories.join(" + ")} has explicit combined evidence`, () => {
    const result = assess(fixture(categories));
    assert.equal(result.level, "HIGH");
    assert.ok(
      result.evidence.some(
        (fact) => fact.reasonCode.startsWith("COMBINED_") && fact.categories.length === 2,
      ),
    );
  });
void test("test changes do not suppress production dependency/configuration evidence", () => {
  assert.equal(assess(fixture(["TEST", "DEPENDENCY"])).level, "MEDIUM");
  assert.equal(assess(fixture(["TEST", "CONFIGURATION"])).level, "MEDIUM");
  assert.equal(assess(fixture(["TEST", "DEPENDENCY", "CONFIGURATION"])).level, "HIGH");
});
void test("file and line breadth thresholds are inclusive and monotonic", () => {
  for (const [files, level] of [
    [4, "LOW"],
    [5, "MEDIUM"],
    [19, "MEDIUM"],
    [20, "HIGH"],
  ] as const)
    assert.equal(assess(fixture(["TEST"], { files })).level, level);
  for (const [lines, level] of [
    [299, "LOW"],
    [300, "MEDIUM"],
    [1499, "MEDIUM"],
    [1500, "HIGH"],
  ] as const)
    assert.equal(assess(fixture(["FRONTEND"], { lines })).level, level);
});
void test("database breadth establishes high importance, not destructive behavior", () => {
  assert.equal(assess(fixture(["DATABASE"], { lines: 199 })).level, "MEDIUM");
  const result = assess(fixture(["DATABASE"], { lines: 200 }));
  assert.equal(result.level, "HIGH");
  assert.ok(result.evidence.some((fact) => fact.reasonCode === "DATABASE_BREADTH"));
});
void test("deletion evidence is file-status bound, not a claim of security-control removal", () => {
  for (const category of [
    "AUTHORIZATION",
    "AUTHENTICATION",
    "DATABASE",
    "API",
    "CONFIGURATION",
    "TEST",
  ] as const) {
    const result = assess(fixture([category], { status: "DELETED" }));
    assert.equal(result.level, category === "TEST" ? "MEDIUM" : "HIGH");
    assert.ok(result.evidence.some((fact) => fact.reasonCode === `DELETED_${category}_FILE`));
  }
  const original = fixture(["AUTHORIZATION"]);
  const baseOnly = createChangeClassification({
    ...original,
    facts: original.facts.map((fact) => ({ ...fact, side: "BASE" as const })),
  });
  assert.ok(!assess(baseOnly).evidence.some((fact) => fact.reasonCode.startsWith("DELETED_")));
});
void test("changed semantic breadth deduplicates and pairs sides without counting path hints", () => {
  const original = fixture(["API"]);
  const seed = original.facts[0]!;
  const make = (count: number): ChangeClassification =>
    createChangeClassification({
      ...original,
      facts: Array.from({ length: count }, (_, i) =>
        ["BASE", "TARGET"].map((side): ClassificationFact => ({
          ...seed,
          ruleId: createRuleId("syntax.api"),
          side: side as "BASE" | "TARGET",
          line: i + 1,
          constructDigest: `sha256:${String(i).padStart(64, "0")}`,
        })),
      ).flat(),
    });
  assert.equal(assess(make(4)).level, "MEDIUM");
  assert.equal(assess(make(5)).level, "HIGH");
  assert.deepEqual(
    assess(createChangeClassification({ ...make(4), facts: [...make(4).facts, ...make(4).facts] })),
    assess(make(4)),
  );
  assert.equal(
    assess(
      createChangeClassification({
        ...original,
        facts: Array.from({ length: 8 }, (_, i) => ({
          ...seed,
          observation: `Path hint ${String(i)}`,
        })),
      }),
    ).level,
    "MEDIUM",
  );
});
void test("uncertainty is preserved independently, including binary and unsupported GENERAL", () => {
  const result = assess(fixture(["GENERAL"], { binary: true, limitations: true }));
  assert.equal(result.level, "MEDIUM");
  assert.deepEqual(
    result.uncertainties.map((item) => item.code),
    [
      "BOUNDED_CLASSIFIER_COVERAGE",
      "CLASSIFICATION_LIMITATIONS",
      "UNKNOWN_LINE_COUNTS",
      "UNSPECIFIED_CHANGE",
    ],
  );
  assert.equal(assess(fixture(["TEST"], { limitations: true })).level, "LOW");
  assert.equal(assess(fixture(["GENERAL"], { files: 0 })).level, "LOW");
});
void test("risk does not rediscover semantics from filenames, signals or observation keywords", () => {
  for (const path of [
    "authorization.ts",
    "DROP_TABLE_public_api.ts",
    "login-security-control-removed.ts",
    "cosmetic.css",
  ]) {
    const input = fixture(["GENERAL"], { path });
    const result = assess(
      createChangeClassification({
        ...input,
        facts: input.facts.map((fact) => ({
          ...fact,
          signal: "AUTHORIZATION",
          observation: "DROP TABLE; security controls removed; public endpoint",
        })),
      }),
    );
    assert.equal(result.level, "MEDIUM");
    assert.deepEqual(
      result.evidence.map((fact) => fact.reasonCode),
      ["CATEGORY_GENERAL"],
    );
  }
});
void test("equivalent reordered files, facts, categories and limitations yield identical immutable output", () => {
  const first = fixture(["API", "TEST"], { files: 3, limitations: true });
  const second = {
    ...first,
    changeSet: createChangeSet({
      ...first.changeSet,
      changedFiles: [...first.changeSet.changedFiles].reverse(),
    }),
    categories: [...first.categories].reverse(),
    facts: [...first.facts]
      .reverse()
      .map((fact) => ({ ...fact, fileIndex: fact.fileIndex === null ? null : 2 - fact.fileIndex })),
    limitations: [...first.limitations]
      .reverse()
      .map((item) => ({ ...item, fileIndex: 2 - item.fileIndex })),
  };
  const result = assess(first);
  assert.deepEqual(assess(second), result);
  assert.deepEqual(assess(first), result);
  assert.equal(JSON.stringify(assess(second)), JSON.stringify(result));
  assert.ok(Object.isFrozen(result.evidence[0]?.classificationFactIndices));
  assert.ok(Object.isFrozen(result.classification.changeSet.changedFiles));
  assert.throws(() => Object.assign(result.evidence[0]!, { contribution: "LOW" }));
});
void test("risk input rejects mismatched identity, file facts, aggregates, summaries and versions", () => {
  const input = fixture(["API"]);
  for (const changes of [
    createChangeSet({ ...input.changeSet, repository: "other" }),
    createChangeSet({ ...input.changeSet, targetCommit: SHA_A }),
    createChangeSet({ ...input.changeSet, analysisEvidenceIds: ["other"] }),
    createChangeSet({ ...input.changeSet, analyzerVersion: "future" }),
    createChangeSet({
      ...input.changeSet,
      changedFiles: [createChangedFile({ ...input.changeSet.changedFiles[0]!, additions: 9 })],
    }),
  ])
    assert.throws(() => assessRisk(changes, input));
  assert.throws(() => assessRisk({ ...input.changeSet, fileCount: 20 }, input));
  assert.throws(() => assess({ ...input, categories: ["TEST"] }));
  assert.throws(() => assess({ ...input, classifierVersion: createComponentVersion("3.2.0") }));
  assert.throws(() =>
    assess({
      ...input,
      facts: input.facts.map((fact) => ({ ...fact, ruleVersion: createComponentVersion("3.0.0") })),
    }),
  );
  assert.throws(() => assess({ ...input, changeSet: { ...input.changeSet, additions: 999 } }));
});
void test("intermediate factories reject forged levels, references, versions and lost uncertainty", () => {
  const input = fixture(["API"], { limitations: true });
  const result = assess(input);
  const fact = result.evidence[0]!;
  for (const forged of [
    { ...result, level: "LOW" },
    { ...result, evidence: [] },
    { ...result, evidence: [{ ...fact, contribution: "APPROVE" }] },
    { ...result, evidence: [{ ...fact, ruleVersion: "other" }] },
    { ...result, evidence: [{ ...fact, classificationFactIndices: [999] }] },
    { ...result, uncertainties: [] },
    {
      ...result,
      uncertainties: [{ code: "X", classificationLimitationIndices: [0], fileIndices: [] }],
    },
  ])
    assert.throws(() => createChangeRiskAssessment(forged as typeof result));
  for (const forged of [
    { ...fact, categories: ["AUTHORIZATION"] },
    { ...fact, fileIndices: [] },
    { ...fact, classificationFactIndices: [-1] },
    { ...fact, reasonCode: "" },
    { ...fact, contribution: "SEVERE" },
  ])
    assert.throws(() => createRiskFact(forged as typeof fact, input));
  assert.throws(() => createRiskFact(fact, { ...input, categories: ["TEST"] }));
});
void test("DTO attacks reject getters without executing them, cycles, sparse arrays and nonplain objects", () => {
  const input = fixture(["API"]);
  const result = assess(input);
  let calls = 0;
  const getter = { ...result };
  Object.defineProperty(getter, "level", {
    get: () => {
      calls++;
      return "LOW";
    },
  });
  const cycle: Record<string, unknown> = { ...result };
  cycle.extra = cycle;
  for (const value of [
    getter,
    cycle,
    { ...result, evidence: new Array(1) },
    { ...result, extra: new Date() },
    { ...result, evidence: null },
    null,
  ])
    assert.throws(() => createChangeRiskAssessment(value as typeof result));
  assert.equal(calls, 0);
  const snapshot = structuredClone(result);
  const rebuilt = createChangeRiskAssessment(snapshot);
  Object.assign(snapshot.evidence[0]!, { observation: "mutated" });
  assert.notEqual(rebuilt.evidence[0]?.observation, "mutated");
});
void test("canonical run Evidence factories reject malformed TypeScript-shaped risk values", () => {
  const evidence = createRiskEvidence({
    evidence: createTestEvidence(),
    ruleId: "risk.test",
    ruleVersion: "4.0.0",
    contribution: "HIGH",
    observation: "Test provenance",
  });
  for (const value of [
    { ...evidence, contribution: "BLOCK" },
    { ...evidence, sourceEvidenceIds: {} },
    { ...evidence, evidence: { ...evidence.evidence, context: {} } },
    { ...evidence, ruleId: "" },
    null,
  ])
    assert.throws(() => createRiskEvidence(value as typeof evidence));
  const risk = createRiskAssessment({
    level: "HIGH",
    ruleSetVersion: "4.0.0",
    evidence: [evidence],
  });
  for (const value of [
    { ...risk, level: "APPROVE" },
    { ...risk, evidence: [] },
    { ...risk, evidence: [{ ...evidence, contribution: "impossible" }] },
    { ...risk, evidence: new Array(1) },
    null,
  ])
    assert.throws(() => createRiskAssessment(value as typeof risk));
  let calls = 0;
  const malicious = { ...evidence };
  Object.defineProperty(malicious, "contribution", {
    get: () => {
      calls++;
      return "LOW";
    },
  });
  assert.throws(() => createRiskEvidence(malicious));
  assert.equal(calls, 0);
});

void test("approved classification rule schema rejects unknown IDs, relabeling, missing constructs and impossible context", () => {
  const input = fixture(["AUTHORIZATION"]);
  const seed = input.facts[0]!;
  for (const fact of [
    { ...seed, ruleId: "invented.rule" },
    { ...seed, ruleId: "path.test" },
    { ...seed, line: null },
    { ...seed, constructDigest: undefined },
  ])
    assert.throws(() => assess({ ...input, facts: [fact as ClassificationFact] }));
  assert.throws(() =>
    assess({ ...input, inspectionPolicy: { ...input.inspectionPolicy, maxFiles: 1025 } }),
  );
  assert.throws(() =>
    assess({
      ...input,
      changeSet: createChangeSet({ ...input.changeSet, targetCommit: input.changeSet.baseCommit }),
    }),
  );
  assert.throws(() =>
    assess({
      ...input,
      changeSet: createChangeSet({ ...input.changeSet, analyzerVersion: "future" }),
    }),
  );
  // A structurally valid path fact cannot masquerade as a changed semantic location.
  const database = fixture(["DATABASE"]);
  assert.throws(() =>
    assess({
      ...database,
      facts: [{ ...database.facts[0]!, line: 1, constructDigest: `sha256:${"a".repeat(64)}` }],
    }),
  );
});

void test("risk factories reject unreferenced/unknown/relabelled evidence and normalize result ordering", () => {
  const result = assess(fixture(["AUTHORIZATION", "API"]));
  const seed = result.evidence[0]!;
  for (const fact of [
    { ...seed, ruleId: "risk.unknown" },
    { ...seed, reasonCode: "UNKNOWN" },
    { ...seed, contribution: "CRITICAL" },
    { ...seed, ruleVersion: "4.0.0" },
    { ...seed, categories: [], classificationFactIndices: [], fileIndices: [] },
  ])
    assert.throws(() => createRiskFact(fact as typeof seed, result.classification));
  const unreferenced = {
    ...seed,
    ruleId: createRuleId("risk.empty_change"),
    reasonCode: "EMPTY_CHANGE",
    contribution: "LOW" as const,
    categories: [],
    classificationFactIndices: [],
    fileIndices: [],
  };
  assert.throws(() =>
    createChangeRiskAssessment({ ...result, level: "LOW", evidence: [unreferenced] }),
  );
  assert.throws(() =>
    createChangeRiskAssessment({ ...result, evidence: [...result.evidence, seed] }),
  );
  assert.deepEqual(
    createChangeRiskAssessment({
      ...result,
      evidence: [...result.evidence].reverse(),
      uncertainties: [...result.uncertainties].reverse(),
    }),
    result,
  );
});

void test("uncertainty records cannot be removed, renamed, duplicated or rebound even without explicit limitations", () => {
  for (const input of [
    fixture(["TEST"]),
    fixture(["GENERAL"]),
    fixture(["GENERAL"], { binary: true, limitations: true }),
    fixture(["GENERAL"], { files: 0 }),
  ]) {
    const result = assess(input);
    for (const index of result.uncertainties.keys())
      assert.throws(() =>
        createChangeRiskAssessment({
          ...result,
          uncertainties: result.uncertainties.filter((_, i) => i !== index),
        }),
      );
    assert.throws(() =>
      createChangeRiskAssessment({
        ...result,
        uncertainties: result.uncertainties.map((item) => ({ ...item, code: "COMPLETE" })),
      }),
    );
    assert.throws(() =>
      createChangeRiskAssessment({
        ...result,
        uncertainties: [...result.uncertainties, result.uncertainties[0]!],
      }),
    );
    if (input.changeSet.fileCount > 0)
      assert.throws(() =>
        createChangeRiskAssessment({
          ...result,
          uncertainties: result.uncertainties.map((item) => ({ ...item, fileIndices: [] })),
        }),
      );
  }
});

void test("replay rejects missing combination/breadth rules, changed reasons and substituted source context", () => {
  const input = fixture(["DATABASE", "API"], { lines: 200 });
  const result = assess(input);
  assert.deepEqual(
    validateRiskAssessment(input.changeSet, input, {
      ...result,
      evidence: [...result.evidence].reverse(),
    }),
    result,
  );
  const categoriesOnly = result.evidence.filter((item) => item.reasonCode.startsWith("CATEGORY_"));
  const partial = createChangeRiskAssessment({
    ...result,
    level: "MEDIUM",
    evidence: categoriesOnly,
  });
  assert.throws(() => validateRiskAssessment(input.changeSet, input, partial));
  assert.throws(() =>
    validateRiskAssessment(input.changeSet, input, {
      ...result,
      evidence: result.evidence.map((item) => ({ ...item, observation: "Fabricated claim" })),
    }),
  );
  const another = {
    ...input,
    changeSet: createChangeSet({ ...input.changeSet, repository: "another" }),
  };
  assert.throws(() => validateRiskAssessment(another.changeSet, another, result));
  const alternate = createChangeSet({ ...input.changeSet, baseCommit: SHA_B, targetCommit: SHA_A });
  assert.throws(() =>
    validateRiskAssessment(alternate, { ...input, changeSet: alternate }, result),
  );
});

void test("explicit aggregation matrix is order independent and does not sum arbitrary category scores", () => {
  const rows: readonly [readonly ChangeCategory[], RiskLevel][] = [
    [["API", "CONFIGURATION"], "MEDIUM"],
    [["API", "DEPENDENCY"], "MEDIUM"],
    [["API", "DATABASE", "CONFIGURATION"], "HIGH"],
    [["API", "DEPENDENCY", "CONFIGURATION"], "HIGH"],
    [["AUTHENTICATION", "FRONTEND"], "HIGH"],
    [["AUTHORIZATION", "CONFIGURATION"], "HIGH"],
    [["FRONTEND", "TEST"], "LOW"],
    [["FRONTEND", "API"], "MEDIUM"],
    [["AUTHENTICATION", "AUTHORIZATION"], "HIGH"],
  ];
  for (const [categories, level] of rows) {
    const input = fixture(categories);
    const result = assess(input);
    assert.equal(result.level, level);
    assert.notEqual(result.level, "CRITICAL");
    assert.deepEqual(
      assess({
        ...input,
        facts: [...input.facts].reverse(),
        categories: [...input.categories].reverse(),
      }),
      result,
    );
  }
});

void test("breadth threshold minus/at/plus one, duplicate files and renames do not add hidden weight", () => {
  for (const [files, level] of [
    [4, "LOW"],
    [5, "MEDIUM"],
    [6, "MEDIUM"],
    [19, "MEDIUM"],
    [20, "HIGH"],
    [21, "HIGH"],
  ] as const)
    assert.equal(assess(fixture(["TEST"], { files })).level, level);
  for (const [lines, level] of [
    [299, "LOW"],
    [300, "MEDIUM"],
    [301, "MEDIUM"],
    [1499, "MEDIUM"],
    [1500, "HIGH"],
    [1501, "HIGH"],
  ] as const)
    assert.equal(assess(fixture(["FRONTEND"], { lines })).level, level);
  for (const lines of [199, 200, 201])
    assert.equal(assess(fixture(["DATABASE"], { lines })).level, lines < 200 ? "MEDIUM" : "HIGH");
  const input = fixture(["TEST"]);
  assert.throws(() =>
    assess({
      ...input,
      changeSet: createChangeSet({
        ...input.changeSet,
        changedFiles: [...input.changeSet.changedFiles, ...input.changeSet.changedFiles],
      }),
    }),
  );
  const renamed = {
    ...input,
    changeSet: createChangeSet({
      ...input.changeSet,
      changedFiles: [
        createChangedFile({
          ...input.changeSet.changedFiles[0]!,
          status: "RENAMED",
          previousPath: "old.test.ts",
          additions: 0,
          deletions: 0,
        }),
      ],
    }),
    facts: input.facts.flatMap((fact) =>
      ["BASE", "TARGET"].map((side): ClassificationFact => ({
        ...fact,
        side: side as "BASE" | "TARGET",
        contentEffect: "UNCHANGED",
      })),
    ),
  };
  const result = assess(renamed);
  assert.equal(result.level, "LOW");
  assert.equal(result.classification.changeSet.fileCount, 1);
  assert.ok(!result.evidence.some((item) => item.reasonCode.startsWith("DELETED_")));
});

void test("duplicate semantic descriptions cannot inflate breadth; five distinct locations can", () => {
  const input = fixture(["API"]);
  const seed = { ...input.facts[0]!, ruleId: createRuleId("syntax.api"), line: 1 };
  const duplicates = {
    ...input,
    facts: Array.from({ length: 10 }, (_, i) => ({
      ...seed,
      observation: `Description ${String(i)}`,
    })),
  };
  assert.equal(assess(duplicates).level, "MEDIUM");
  for (const count of [4, 5, 6]) {
    const distinct = {
      ...input,
      facts: Array.from({ length: count }, (_, i) => ({ ...seed, line: i + 1 })),
    };
    assert.equal(assess(distinct).level, count < 5 ? "MEDIUM" : "HIGH");
  }
});
