import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { EXECUTOR_VERSION } from "../../src/execution/index.js";

function syntax(source: string): string {
  const tree = ts.createSourceFile("execution.ts", source, ts.ScriptTarget.Latest, true);
  const printed = ts
    .createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
    .printFile(tree);
  const normalized = ts.createSourceFile("execution.ts", printed, ts.ScriptTarget.Latest, true);
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
  for (const file of await readdir("src/execution"))
    if (file.endsWith(".ts")) await visit(`src/execution/${file}`);
  return contents;
}
function fingerprint(contents: ReadonlyMap<string, string>): string {
  const hash = createHash("sha256");
  for (const file of [...contents.keys()].sort())
    hash.update(file + "\n" + syntax(contents.get(file)!) + "\n");
  return hash.digest("hex");
}
void test("executor version binds process lifecycle, protocol, authority, workspace, DTO and replay dependencies", async () => {
  const contents = await sources();
  const approved: Readonly<Record<string, string>> = {
    "7.0.0": "87bb1a7c62507ec94442a2dd6df5e25e36256071b9b839f89f2e5ad3a1e581bb",
    "7.1.0": "e4ac2f1f3934ed6bfa219b33e60b7af770cd8bc7dd103bf72a00c06c567069d9",
  };
  assert.equal(ts.version, "6.0.3");
  assert.equal(
    fingerprint(contents),
    approved[EXECUTOR_VERSION],
    "Review executor version/fingerprint for semantic changes",
  );
  for (const [file, before, after] of [
    ["src/execution/result.ts", "exitCode === 42", "exitCode === 1"],
    ["src/execution/bounded-execution.ts", "shell: false", "shell: true"],
    ["src/execution/bounded-execution.ts", 'child.kill("SIGKILL")', 'child.kill("SIGTERM")'],
    ["src/execution/authority.ts", 'PATH: ""', "PATH: process.env.PATH"],
    ["src/execution/executor.ts", "validateVerificationPlan", "skipPlanReplay"],
    ["src/execution/workspace.ts", "state.consumed = true", "state.consumed = false"],
    ["src/execution/result.ts", "retained !== Math.min", "retained > Math.min"],
  ]) {
    const changed = new Map(contents);
    changed.set(file!, contents.get(file!)!.replace(before!, after!));
    assert.notEqual(fingerprint(changed), fingerprint(contents), before!);
  }
  assert.equal(syntax("const x = 1; // note"), syntax("/* note */ const x=1;"));
  assert.notEqual(syntax("function f(){return\n1;}"), syntax("function f(){return 1;}"));
});
