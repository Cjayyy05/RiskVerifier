import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { VERDICT_VERSION } from "../../src/verdict/index.js";

function syntax(source: string): string {
  const tree = ts.createSourceFile("verdict.ts", source, ts.ScriptTarget.Latest, true);
  const printed = ts
    .createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
    .printFile(tree);
  const normalized = ts.createSourceFile("verdict.ts", printed, ts.ScriptTarget.Latest, true);
  const tokens: unknown[] = [];
  const visit = (node: ts.Node): void => {
    const children = node.getChildren(normalized);
    if (children.length === 0) tokens.push([node.kind, node.getText(normalized)]);
    else children.forEach(visit);
  };
  visit(normalized);
  return JSON.stringify(tokens);
}
async function sources(): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  const visit = async (file: string): Promise<void> => {
    if (contents.has(file)) return;
    const source = await readFile(file, "utf8");
    contents.set(file, source);
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const node of tree.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      const specifier = node.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith("."))
        await visit(
          path.posix.normalize(
            path.posix.join(path.posix.dirname(file), specifier.text.replace(/\.js$/u, ".ts")),
          ),
        );
    }
  };
  for (const module of ["evidence", "verdict"])
    for (const file of await readdir(`src/${module}`))
      if (file.endsWith(".ts")) await visit(`src/${module}/${file}`);
  return contents;
}
function fingerprint(contents: ReadonlyMap<string, string>): string {
  const hash = createHash("sha256");
  for (const file of [...contents.keys()].sort())
    hash.update(file + "\n" + syntax(contents.get(file)!) + "\n");
  return hash.digest("hex");
}
void test("verdict version fingerprint covers evidence, interpretation, replay and protocol semantics", async () => {
  const contents = await sources();
  const approved: Readonly<Record<string, string>> = {
    "8.0.0": "5ad4e64fb886af20d5334fbb6e5728c3ff28f95a1f4d091cc9caffc7ec670523",
    "8.1.0": "c1d0b314e271f18e39c4ef639c83dc9f21d0c4a329719c930fd614dcdf4d3b67",
  };
  assert.equal(ts.version, "6.0.3");
  assert.equal(
    fingerprint(contents),
    approved[VERDICT_VERSION],
    "Review verdict version/fingerprint for semantic changes",
  );
  for (const [file, before, after] of [
    ["src/verdict/evaluator.ts", 'check.strength === "OPTIONAL"', 'check.strength === "MANDATORY"'],
    ["src/verdict/evaluator.ts", "!hasCapturedEvidence", "true"],
    [
      "src/verdict/evaluator.ts",
      'entry?.result.state ?? "MISSING"',
      'entry?.result.state ?? "PASS"',
    ],
    [
      "src/verdict/evaluator.ts",
      'contributions.includes("BLOCKING_FAILURE")',
      'contributions.includes("INDETERMINATE")',
    ],
    [
      "src/verdict/evaluator.ts",
      'obligation.resolution === "REVIEW_REQUIRED"',
      'obligation.resolution === "INFORMATIONAL"',
    ],
    [
      "src/verdict/evaluator.ts",
      'check.validFailureBehavior !== "BLOCK"',
      'check.validFailureBehavior === "BLOCK"',
    ],
    ["src/evidence/execution-evidence.ts", "resultDigest !== reference.resultDigest", "false"],
    ["src/evidence/execution-evidence.ts", "validateVerificationPlan", "skipPlanReplay"],
    ["src/evidence/validation.ts", '!("value" in descriptor)', "false"],
    ["src/execution/result.ts", "exitCode === 42", "exitCode === 1"],
    ["src/planning/planner.ts", "validatePolicyResult", "skipPolicyReplay"],
  ]) {
    const changed = new Map(contents);
    const original = contents.get(file!)!;
    assert.ok(original.includes(before!), `${file}: mutation target exists`);
    changed.set(file!, original.replace(before!, after!));
    assert.notEqual(fingerprint(changed), fingerprint(contents), before!);
  }
  assert.equal(syntax("const x = 1; // note"), syntax("/* note */ const x=1;"));
  assert.notEqual(syntax("function f(){return\n1;}"), syntax("function f(){return 1;}"));
});

void test("verdict dependency closure has no filesystem, execution adapter, network or later-phase authority", async () => {
  const contents = await sources();
  for (const [file, source] of contents) {
    assert.doesNotMatch(file, /src\/(?:git|classification|api|jobs|persistence)\//u);
    assert.doesNotMatch(
      file,
      /src\/execution\/(?:executor|authority|workspace|bounded-execution|index)\.ts/u,
    );
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const node of tree.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      const specifier = node.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier) && !specifier.text.startsWith("."))
        assert.ok(
          ["node:crypto", "node:path"].includes(specifier.text),
          `${file}: ${specifier.text}`,
        );
    }
  }
  for (const module of ["evidence", "verdict"])
    for (const file of await readdir(`src/${module}`)) {
      if (!file.endsWith(".ts")) continue;
      const source = contents.get(`src/${module}/${file}`)!;
      assert.doesNotMatch(
        source,
        /\b(?:Date|process|fetch|eval|Function|require|randomUUID|setTimeout|setInterval|getBuiltinModule)\b|Math\.random|\bimport\s*\(/u,
      );
      const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      for (const node of tree.statements) {
        if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
        const specifier = node.moduleSpecifier;
        if (specifier && ts.isStringLiteral(specifier))
          assert.ok(
            /^\.\/[a-z-]+\.js$/u.test(specifier.text) ||
              [
                "../domain/index.js",
                "../planning/index.js",
                "../evidence/index.js",
                "../evidence/validation.js",
                "node:crypto",
              ].includes(specifier.text) ||
              (module === "evidence" &&
                file === "execution-evidence.ts" &&
                specifier.text === "../execution/result.js"),
            `${file}: ${specifier.text}`,
          );
      }
    }
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    exports: Record<string, string>;
  };
  assert.equal(packageJson.exports["./execution/results"], "./dist/execution/result.js");
  assert.equal(packageJson.exports["./evidence"], "./dist/evidence/index.js");
  assert.equal(packageJson.exports["./verdict"], "./dist/verdict/index.js");
});
