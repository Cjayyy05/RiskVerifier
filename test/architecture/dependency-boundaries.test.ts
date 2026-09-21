import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = process.cwd();
const domainRoot = path.join(repositoryRoot, "src", "domain");

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
