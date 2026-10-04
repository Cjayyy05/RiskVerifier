import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { ISOLATION_VERSION } from "../../src/isolation/index.js";

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
  for (const module of ["isolation"])
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

void test("isolation version binds profile, lifecycle, authority, output, replay and protocol", async () => {
  const contents = await sources();
  const approved: Readonly<Record<string, string>> = {
    "9.1.0": "db3d370de56ac02264a37692de4b370cac3a17038c9e7433d1c19482798699bf",
  };
  assert.equal(ts.version, "6.0.3");
  assert.equal(fingerprint(contents), approved[ISOLATION_VERSION]);
  for (const [file, before, after] of [
    ["src/isolation/configuration.ts", '"--pull=never"', '"--pull=always"'],
    ["src/isolation/configuration.ts", '"--network=none"', '"--network=host"'],
    ["src/isolation/configuration.ts", '"--read-only"', '"--privileged"'],
    ["src/isolation/configuration.ts", '"--cap-drop=ALL"', '"--cap-add=ALL"'],
    [
      "src/isolation/configuration.ts",
      '"--security-opt=no-new-privileges:true"',
      '"--security-opt=no-new-privileges:false"',
    ],
    ["src/isolation/configuration.ts", '"--entrypoint=/usr/bin/env"', '"--entrypoint=/bin/sh"'],
    ["src/isolation/configuration.ts", "dst=/workspace,readonly", "dst=/workspace"],
    ["src/isolation/inspection.ts", "Memory: memory", "Memory: 0"],
    ["src/isolation/inspection.ts", "NanoCpus: config.cpuMillis * 1000000", "NanoCpus: 0"],
    ["src/isolation/inspection.ts", "PidsLimit: config.pids", "PidsLimit: 0"],
    ["src/isolation/docker-adapter.ts", "normalExit(after)", "true"],
    ["src/isolation/docker-adapter.ts", "shell: false", "shell: true"],
    ["src/isolation/docker-adapter.ts", "attached.code === after.ExitCode", "true"],
    ["src/isolation/docker-adapter.ts", "if (!uncertain)", "if (true)"],
    ["src/isolation/executor.ts", "validateVerificationPlan", "skipReplay"],
    ["src/execution/workspace.ts", "state.consumed = true", "state.consumed = false"],
    ["src/execution/result.ts", "exitCode === 42", "exitCode === 1"],
  ]) {
    const changed = new Map(contents),
      original = contents.get(file!)!;
    assert.ok(original.includes(before!));
    changed.set(file!, original.replace(before!, after!));
    assert.notEqual(fingerprint(changed), fingerprint(contents));
  }
  assert.equal(syntax("const x = 1; // note"), syntax("/* note */ const x=1;"));
});
void test("isolation has one Docker owner and cannot acquire policy, verdict, HTTP or job authority", async () => {
  const allowed: Readonly<Record<string, readonly string[]>> = {
    "configuration.ts": ["node:path", "../execution/validation.js", "../evidence/validation.js"],
    "executor.ts": [
      "node:crypto",
      "node:fs/promises",
      "node:os",
      "node:path",
      "../planning/index.js",
      "../execution/workspace.js",
      "../execution/validation.js",
      "../execution/result.js",
      "../evidence/validation.js",
    ],
    "docker-adapter.ts": ["node:child_process", "../execution/result.js"],
    "inspection.ts": ["../evidence/validation.js"],
    "index.ts": [],
  };
  for (const file of await readdir("src/isolation")) {
    if (!file.endsWith(".ts")) continue;
    const source = await readFile(`src/isolation/${file}`, "utf8");
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const node of tree.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      const specifier = node.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier))
        assert.ok(
          specifier.text === "../domain/index.js" ||
            /^\.\/[a-z-]+\.js$/u.test(specifier.text) ||
            allowed[file]?.includes(specifier.text),
          `${file}: ${specifier.text}`,
        );
    }
    assert.doesNotMatch(
      source,
      /\b(?:eval|Function|require|fetch|getBuiltinModule)\s*\(|\bimport\s*\(/u,
    );
    assert.doesNotMatch(source, /\b(?:APPROVE|BLOCK|INCONCLUSIVE|assessRisk|evaluatePolicy)\b/u);
  }
  const adapter = await readFile("src/isolation/docker-adapter.ts", "utf8");
  assert.doesNotMatch(adapter, /["'](?:pull|build|prune|ps|run)["']/u);
  assert.match(adapter, /shell:\s*false/u);
  assert.match(adapter, /windowsHide:\s*true/u);
});
