import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const repositoryRoot = process.cwd();
const domainRoot = path.join(repositoryRoot, "src", "domain");
const gitRoot = path.join(repositoryRoot, "src", "git");

void test("risk is pure domain consumption without classification, infrastructure or later policy", async () => {
  const root = path.join(repositoryRoot, "src", "risk");
  for (const file of await listTypeScriptFiles(root)) {
    const source = await readFile(file, "utf8");
    for (const specifier of moduleSpecifiers(source))
      assert.ok(
        specifier === "../domain/index.js" || /^\.\/[a-z-]+\.js$/u.test(specifier),
        `${file}: ${specifier}`,
      );
    assert.doesNotMatch(
      source,
      /\b(?:eval|Function|require|fetch|createVerdict|createVerificationPlan|selectStrategy|createProgram|createSourceFile|getBuiltinModule)\s*\(/u,
    );
    assert.doesNotMatch(
      source,
      /\b(?:APPROVE|BLOCK|INCONCLUSIVE|VerificationStrategy|VerificationPlan|VerificationVerdict)\b/u,
    );
    assert.doesNotMatch(source, /\b(?:Date|process|Math\.random)\b/u);
  }
  for (const module of ["execution", "verdict", "api", "persistence", "jobs"])
    assert.deepEqual(
      await listTypeScriptFiles(path.join(repositoryRoot, "src", module)),
      [],
      `Later-phase module ${module} must remain unimplemented`,
    );
});

void test("planning only materializes validated policy with deterministic identity", async () => {
  for (const file of await listTypeScriptFiles(path.join(repositoryRoot, "src", "planning"))) {
    const source = await readFile(file, "utf8");
    for (const specifier of moduleSpecifiers(source))
      assert.ok(
        specifier === "../domain/index.js" ||
          (path.basename(file) === "planner.ts" &&
            ["../policy/index.js", "node:crypto"].includes(specifier)) ||
          /^\.\/[a-z-]+\.js$/u.test(specifier),
        `${file}: ${specifier}`,
      );
    assert.doesNotMatch(
      source,
      /\b(?:process|Date|fetch|eval|Function|createVerdict|assessRisk|evaluatePolicy|policyIntensity|Math\.random|randomUUID)\b/u,
    );
    assert.doesNotMatch(source, /\b(?:npm|shell|executable|stdout|stderr|timeout|APPROVE)\b/u);
  }
});

void test("policy consumes domain and public risk replay without execution or planning", async () => {
  for (const file of await listTypeScriptFiles(path.join(repositoryRoot, "src", "policy"))) {
    const source = await readFile(file, "utf8");
    for (const specifier of moduleSpecifiers(source))
      assert.ok(
        specifier === "../domain/index.js" ||
          (path.basename(file) === "evaluator.ts" && specifier === "../risk/index.js") ||
          /^\.\/[a-z-]+\.js$/u.test(specifier),
        `${file}: ${specifier}`,
      );
    assert.doesNotMatch(
      source,
      /\b(?:process|Date|fetch|eval|Function|createVerificationPlan|createVerdict|Math\.random)\b/u,
    );
  }
});

function unsafeProcessUsage(source: string, isAdapter: boolean): readonly string[] {
  const violations: string[] = [];
  const tree = ts.createSourceFile("review.ts", source, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (
        specifier &&
        ts.isStringLiteral(specifier) &&
        ["node:child_process", "child_process"].includes(specifier.text)
      ) {
        const bindings = ts.isImportDeclaration(node)
          ? node.importClause?.namedBindings
          : undefined;
        const allowed =
          isAdapter &&
          ts.isImportDeclaration(node) &&
          node.importClause?.name === undefined &&
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length === 1 &&
          bindings.elements[0]?.name.text === "spawn" &&
          bindings.elements[0]?.propertyName === undefined;
        if (!allowed) violations.push("process import");
      }
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const loader =
        expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(expression) && expression.text === "require") ||
        (ts.isPropertyAccessExpression(expression) && expression.name.text === "getBuiltinModule");
      if (loader) {
        const argument = node.arguments[0];
        if (
          !argument ||
          !ts.isStringLiteral(argument) ||
          ["node:child_process", "child_process"].includes(argument.text)
        ) {
          violations.push("process loader");
        }
      }
    }
    if (ts.isImportEqualsDeclaration(node)) violations.push("CommonJS import");
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === "shell" &&
      node.initializer.kind !== ts.SyntaxKind.FalseKeyword
    ) {
      violations.push("shell execution");
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return violations;
}

async function listTypeScriptFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return listTypeScriptFiles(fullPath);
      }
      return entry.isFile() && /\.(?:cts|mts|ts)$/u.test(entry.name) ? [fullPath] : [];
    }),
  );
  return nested.flat();
}

function moduleSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = [];
  const staticPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/gu;
  for (const match of source.matchAll(staticPattern)) {
    const specifier = match[1];
    if (specifier !== undefined) {
      specifiers.push(specifier);
    }
  }

  const callPattern = /\b(?:import|require)\s*\(\s*(?:["']([^"']+)["']|[^)]*)\s*\)/gu;
  for (const match of source.matchAll(callPattern)) {
    specifiers.push(match[1] ?? "<dynamic module specifier>");
  }
  return specifiers;
}

function forbiddenDomainImports(source: string, sourceFile: string): readonly string[] {
  return moduleSpecifiers(source).filter((specifier) => {
    if (!specifier.startsWith(".")) {
      return true;
    }

    const resolved = path.resolve(path.dirname(sourceFile), specifier);
    const relative = path.relative(domainRoot, resolved);
    return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  });
}

void test("domain source imports only other domain modules", async () => {
  const sourceFiles = await listTypeScriptFiles(domainRoot);

  assert.ok(sourceFiles.length > 0);
  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, "utf8");
    assert.deepEqual(
      forbiddenDomainImports(source, sourceFile),
      [],
      path.relative(repositoryRoot, sourceFile),
    );
  }
});

void test("dependency detector rejects static, dynamic, CommonJS, and external imports", () => {
  const sourceFile = path.join(domainRoot, "nested", "example.ts");
  const forbidden = forbiddenDomainImports(
    [
      'import fs from "node:fs";',
      'export { logger } from "../../logging/index.js";',
      'const api = import("../../api/index.js");',
      'const database = require("database-client");',
      "const dynamic = import(moduleName);",
      'import { value } from "../identities.js";',
    ].join("\n"),
    sourceFile,
  );

  assert.deepEqual(forbidden, [
    "node:fs",
    "../../logging/index.js",
    "../../api/index.js",
    "database-client",
    "<dynamic module specifier>",
  ]);
});

void test("Git infrastructure uses the domain public contract and contains the only process adapter", async () => {
  const gitSourceFiles = await listTypeScriptFiles(gitRoot);
  assert.ok(gitSourceFiles.length > 0);

  for (const sourceFile of gitSourceFiles) {
    const source = await readFile(sourceFile, "utf8");
    const forbidden = moduleSpecifiers(source).filter((specifier) => {
      if (specifier.startsWith("node:")) {
        return false;
      }
      if (!specifier.startsWith(".")) {
        return true;
      }
      const resolved = path.resolve(path.dirname(sourceFile), specifier);
      const relativeToGit = path.relative(gitRoot, resolved);
      const staysInGit =
        relativeToGit !== ".." &&
        !relativeToGit.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativeToGit);
      return !staysInGit && resolved !== path.join(domainRoot, "index.js");
    });
    assert.deepEqual(forbidden, [], path.relative(repositoryRoot, sourceFile));
    assert.doesNotMatch(source, /shell\s*:\s*true/u, sourceFile);
  }

  const allSourceFiles = await listTypeScriptFiles(path.join(repositoryRoot, "src"));
  for (const sourceFile of allSourceFiles) {
    const source = await readFile(sourceFile, "utf8");
    assert.deepEqual(
      unsafeProcessUsage(source, sourceFile === path.join(gitRoot, "bounded-process.ts")),
      [],
      sourceFile,
    );
  }
});

void test("process boundary rejects alternate import forms and unsafe adapter APIs", () => {
  for (const source of [
    "import { spawn } from 'child_process';",
    "import { spawn } from 'node:child_process';",
    "const cp = import('node:child_process');",
    "const cp = require('child_process');",
    "const cp = process.getBuiltinModule('child_process');",
    "import cp = require('node:child_process');",
    "const cp = import(variable);",
  ])
    assert.ok(unsafeProcessUsage(source, false).length > 0, source);
  for (const source of [
    "import { exec } from 'node:child_process';",
    "import { execSync } from 'child_process';",
    "import * as cp from 'node:child_process';",
    "spawn(tool, args, { 'shell': true });",
    "spawn(tool, args, { shell: configuredShell });",
  ])
    assert.ok(unsafeProcessUsage(source, true).length > 0, source);
  assert.deepEqual(unsafeProcessUsage("import { spawn } from 'node:child_process';", true), []);
});

void test("classification stays within pure rules, domain factories, and the public Git adapter", async () => {
  const root = path.join(repositoryRoot, "src", "classification");
  for (const file of await listTypeScriptFiles(root)) {
    const source = await readFile(file, "utf8");
    for (const specifier of moduleSpecifiers(source)) {
      const allowed =
        specifier === "../domain/index.js" ||
        (path.basename(file) === "classifier.ts" && specifier === "../git/index.js") ||
        (["classifier.ts", "syntax.ts"].includes(path.basename(file)) &&
          specifier === "node:crypto") ||
        (path.basename(file) === "syntax.ts" && specifier === "typescript") ||
        /^\.\/[a-z-]+\.js$/u.test(specifier);
      assert.ok(allowed, `${file}: ${specifier}`);
    }
    assert.doesNotMatch(source, /\b(?:eval|Function)\s*\(/u);
    assert.doesNotMatch(source, /\b(?:riskScore|assessRisk|selectStrategy|createVerdict)\b/u);
    assert.doesNotMatch(
      source,
      /\b(?:createProgram|createCompilerHost|transpileModule|transpile|resolveModuleName|readConfigFile|emit)\s*\(/u,
    );
  }
});
