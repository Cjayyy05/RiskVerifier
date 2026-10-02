import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { RISK_RULE_SET_VERSION } from "../../src/risk/index.js";

const SOURCES = [
  "src/risk/assessor.ts",
  "src/risk/index.ts",
  "src/domain/index.ts",
  "src/domain/risk-facts.ts",
  "src/domain/risk-contract.ts",
  "src/domain/risk-classification.ts",
  "src/domain/risk.ts",
  "src/domain/classification-facts.ts",
  "src/domain/change.ts",
  "src/domain/enums.ts",
  "src/domain/identities.ts",
  "src/domain/validation.ts",
  "src/domain/immutable.ts",
  "src/domain/errors.ts",
] as const;

/** Parse/print first to retain ASI semantics, then collect actual syntax tokens (including template text). */
function normalizedSyntax(source: string): string {
  const tree = ts.createSourceFile(
    "risk.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const printed = ts
    .createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
    .printFile(tree);
  const normalized = ts.createSourceFile(
    "risk.ts",
    printed,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const tokens: unknown[] = [];
  const visit = (node: ts.Node): void => {
    const children = node.getChildren(normalized);
    if (children.length === 0) tokens.push([node.kind, node.getText(normalized)]);
    else children.forEach(visit);
  };
  visit(normalized);
  return JSON.stringify(tokens);
}
function fingerprint(sources: ReadonlyMap<string, string>): string {
  const hash = createHash("sha256");
  for (const file of SOURCES)
    hash.update(file + "\n" + normalizedSyntax(sources.get(file) ?? "") + "\n");
  return hash.digest("hex");
}
void test("risk rule identity binds evaluation, schema, ordinal definitions and validation source", async () => {
  const fingerprints: Readonly<Record<string, string>> = {
    "4.1.0": "41f37158983bf796e503cbc317426de91f8fa8b371be62937a47a81ed1d8d60e",
  };
  const sources = new Map(
    await Promise.all(
      SOURCES.map(async (file): Promise<[string, string]> => [file, await readFile(file, "utf8")]),
    ),
  );
  assert.equal(ts.version, "6.0.3");
  assert.equal(
    fingerprint(sources),
    fingerprints[RISK_RULE_SET_VERSION],
    "Risk semantics changed: explicitly review the rule version and source fingerprint.",
  );
  const changed = new Map(sources);
  changed.set(
    "src/domain/enums.ts",
    sources
      .get("src/domain/enums.ts")!
      .replace('["LOW", "MEDIUM", "HIGH", "CRITICAL"]', '["HIGH", "MEDIUM", "LOW", "CRITICAL"]'),
  );
  assert.notEqual(fingerprint(changed), fingerprint(sources));
  changed.set("src/domain/enums.ts", sources.get("src/domain/enums.ts")!);
  changed.set(
    "src/risk/assessor.ts",
    sources.get("src/risk/assessor.ts")!.replace("constructCount >= 5", "constructCount >= 6"),
  );
  assert.notEqual(fingerprint(changed), fingerprint(sources));
});
void test("risk fingerprint ignores comments/spacing but retains literals, operators, templates and ASI", () => {
  assert.equal(
    normalizedSyntax("const x = 5; // note\nconst y = x >= 4;"),
    normalizedSyntax("/* another note */ const x=5; const y=x>=4;"),
  );
  assert.notEqual(normalizedSyntax("const x=5;"), normalizedSyntax("const x=6;"));
  assert.notEqual(normalizedSyntax("const x=a>=5;"), normalizedSyntax("const x=a>5;"));
  assert.notEqual(
    normalizedSyntax("const x=`${a} one two`;"),
    normalizedSyntax("const x=`${a} one  two`;"),
  );
  assert.notEqual(
    normalizedSyntax("function f(){return\n5;}"),
    normalizedSyntax("function f(){return 5;}"),
  );
});
