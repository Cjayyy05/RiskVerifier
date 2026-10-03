import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { PLANNER_VERSION } from "../../src/planning/index.js";

const sources = [
  "src/planning/planner.ts",
  "src/planning/index.ts",
  "src/domain/plan-facts.ts",
  "src/domain/plan.ts",
  "src/domain/index.ts",
  "src/domain/identities.ts",
  "src/domain/enums.ts",
  "src/domain/validation.ts",
  "src/domain/immutable.ts",
  "src/domain/errors.ts",
  "src/policy/evaluator.ts",
  "src/policy/rules.ts",
  "src/policy/index.ts",
  "src/domain/policy-facts.ts",
  "src/domain/policy.ts",
  "src/risk/assessor.ts",
  "src/risk/index.ts",
  "src/domain/risk-facts.ts",
  "src/domain/risk-contract.ts",
  "src/domain/risk-classification.ts",
  "src/domain/classification-facts.ts",
  "src/domain/change.ts",
];
function syntax(source: string): string {
  const tree = ts.createSourceFile("plan.ts", source, ts.ScriptTarget.Latest, true);
  const printed = ts
    .createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
    .printFile(tree);
  const normalized = ts.createSourceFile("plan.ts", printed, ts.ScriptTarget.Latest, true);
  const tokens: unknown[] = [];
  const visit = (node: ts.Node): void => {
    const children = node.getChildren(normalized);
    if (children.length === 0) tokens.push([node.kind, node.getText(normalized)]);
    else children.forEach(visit);
  };
  visit(normalized);
  return JSON.stringify(tokens);
}
function fingerprint(contents: ReadonlyMap<string, string>): string {
  const hash = createHash("sha256");
  for (const file of sources) hash.update(file + "\n" + syntax(contents.get(file)!) + "\n");
  return hash.digest("hex");
}
void test("planner identity binds materialization, schema, IDs, hash and replay behavior", async () => {
  const contents = new Map(
    await Promise.all(
      sources.map(async (file): Promise<[string, string]> => [file, await readFile(file, "utf8")]),
    ),
  );
  const versions: Readonly<Record<string, string>> = {
    "6.0.0": "b968f0c982e172588758d55a320a00083b3e341c4f31283ac26a6f716be68beb",
  };
  assert.equal(ts.version, "6.0.3");
  assert.equal(
    fingerprint(contents),
    versions[PLANNER_VERSION],
    "Review planner version and source fingerprint for semantic changes",
  );
  for (const [file, before, after] of [
    ["src/domain/plan-facts.ts", '!== "UNNECESSARY"', '=== "UNNECESSARY"'],
    ["src/domain/plan-facts.ts", "check:", "check-v2:"],
    ["src/domain/plan-facts.ts", "strength: requirement.strength", 'strength: "MANDATORY"'],
    [
      "src/domain/plan-facts.ts",
      "validFailureBehavior: requirement.validFailureBehavior",
      'validFailureBehavior: "NOT_APPLICABLE"',
    ],
    ["src/planning/planner.ts", "riskverifier:verification-plan", "riskverifier:another-plan"],
  ] as const) {
    const mutated = new Map(contents);
    mutated.set(file, contents.get(file)!.replace(before, after));
    assert.notEqual(fingerprint(mutated), fingerprint(contents), before);
  }
});
void test("planner fingerprint ignores formatting/comments but preserves actual syntax semantics", () => {
  assert.equal(syntax("const x = 1; // comment"), syntax("/* note */ const x=1;"));
  assert.notEqual(syntax('const x="MANDATORY";'), syntax('const x="OPTIONAL";'));
  assert.notEqual(syntax("function f(){return\n1;}"), syntax("function f(){return 1;}"));
});
