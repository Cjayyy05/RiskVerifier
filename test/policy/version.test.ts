import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { POLICY_RULE_SET_VERSION } from "../../src/policy/index.js";

const sources = [
  "src/policy/rules.ts",
  "src/policy/evaluator.ts",
  "src/policy/index.ts",
  "src/domain/policy-facts.ts",
  "src/domain/policy.ts",
  "src/domain/index.ts",
  "src/domain/enums.ts",
  "src/domain/identities.ts",
  "src/domain/validation.ts",
  "src/domain/immutable.ts",
  "src/domain/errors.ts",
  "src/domain/risk-facts.ts",
  "src/domain/risk-contract.ts",
  "src/domain/risk-classification.ts",
  "src/domain/classification-facts.ts",
  "src/domain/change.ts",
  "src/risk/assessor.ts",
  "src/risk/index.ts",
];
function syntax(source: string): string {
  const tree = ts.createSourceFile("policy.ts", source, ts.ScriptTarget.Latest, true);
  const printed = ts
    .createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
    .printFile(tree);
  const normalized = ts.createSourceFile("policy.ts", printed, ts.ScriptTarget.Latest, true);
  const tokens: unknown[] = [];
  const visit = (node: ts.Node): void => {
    const children = node.getChildren(normalized);
    if (children.length === 0) tokens.push([node.kind, node.getText(normalized)]);
    else children.forEach(visit);
  };
  visit(normalized);
  return JSON.stringify(tokens);
}
void test("policy 5.1.0 binds selection, applicability, conflict and unavailable semantics", async () => {
  const hash = createHash("sha256");
  for (const file of sources)
    hash.update(file + "\n" + syntax(await readFile(file, "utf8")) + "\n");
  const versions: Readonly<Record<string, string>> = {
    "5.0.0": "aefc759a7a2588d52105e2e883fe980c245a8bde12e2acbdc995138905fe741e",
    "5.1.0": "6a1238bdda85b87a15ce2fc7a29e67ffdf26889f455fa3061419da47d4c8e839",
  };
  assert.equal(ts.version, "6.0.3");
  assert.equal(
    hash.digest("hex"),
    versions[POLICY_RULE_SET_VERSION],
    "Review policy version and fingerprint for semantic changes",
  );
});
void test("policy fingerprint ignores comments and spacing but retains semantic changes", () => {
  assert.equal(syntax("const x = 1; // explanation"), syntax("/* note */ const x=1;"));
  for (const [before, after] of [
    ["x > 0", "x >= 0"],
    ['"MANDATORY"', '"OPTIONAL"'],
    ['"BUILD"', '"EXISTING_TESTS"'],
    ['"INCONCLUSIVE"', '"BLOCK"'],
    ["`a b`", "`a  b`"],
    ["function f(){return\n1;}", "function f(){return 1;}"],
  ])
    assert.notEqual(syntax(before!), syntax(after!));
});
