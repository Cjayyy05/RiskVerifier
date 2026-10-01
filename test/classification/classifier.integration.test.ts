import assert from "node:assert/strict";
import { readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { classifyChangeSet } from "../../src/classification/index.js";
import {
  createChangeClassification,
  createChangeSet,
  createChangedFile,
  InvalidInputError,
} from "../../src/domain/index.js";
import {
  analyzeGitChange,
  ClassificationContextMismatchError,
  createGitChangeAnalysisInput,
  GitExecutableUnavailableError,
  createInspectionPolicy,
  GitCancelledError,
  GitOutputLimitError,
} from "../../src/git/index.js";
import { createGitFixture } from "../git/git-fixture.js";

const route =
  'import express from "express"; const app = express(); app.get("/users", (req,res) => { if (req.user.role !== "admin") return res.status(403).end(); return res.json([]); });\n';
const auth =
  'import { jwtVerify as verify } from "jose"; export function login(token) { return verify(token, key); }\n';
function input(
  repositoryPath: string,
  baseCommit: string,
  targetCommit: string,
): ReturnType<typeof createGitChangeAnalysisInput> {
  return createGitChangeAnalysisInput({
    repositoryPath,
    repository: "classification-fixture",
    baseCommit,
    targetCommit,
  });
}
void test("multi-category exact commits, dirty working tree and branch independence, immutable deterministic output", async (t) => {
  const fixture = await createGitFixture(t);
  await fixture.write("README.md", "base\n");
  const base = await fixture.commit("base");
  await fixture.write("src/api/users.ts", route);
  await fixture.write("prisma/schema.prisma", "model User { id Int @id }\n");
  await fixture.write("src/Button.tsx", "export const Button = () => <button/>;\n");
  await fixture.write("src/Button.test.tsx", "export const sample = <button/>;\n");
  await fixture.write("package.json", '{"dependencies":{"express":"5"}}\n');
  const target = await fixture.commit("target");
  const context = input(fixture.directory, base, target);
  const changes = await analyzeGitChange(context);
  const first = await classifyChangeSet(changes, context);
  assert.deepEqual(first.categories, [
    "AUTHORIZATION",
    "DATABASE",
    "API",
    "DEPENDENCY",
    "FRONTEND",
    "TEST",
  ]);
  assert.ok(
    first.facts.every((fact) => fact.ruleId && fact.observation && fact.contentEffect === "ADDED"),
  );
  assert.equal(first.changeSet.baseCommit, base);
  assert.equal(first.changeSet.targetCommit, target);
  assert.ok(Object.isFrozen(first.facts[0]));
  assert.ok(Object.isFrozen(first.changeSet.changedFiles));
  await fixture.git("checkout", "--quiet", base);
  await fixture.write("src/api/users.ts", "totally unrelated dirty data");
  const before = await fixture.git("status", "--porcelain=v1");
  assert.deepEqual(await classifyChangeSet(changes, context), first);
  assert.equal(await fixture.git("status", "--porcelain=v1"), before);
  assert.equal(
    await readFile(path.join(fixture.directory, "src/api/users.ts"), "utf8"),
    "totally unrelated dirty data",
  );
  const reversed = createChangeSet({
    ...changes,
    changedFiles: [...changes.changedFiles].reverse(),
  });
  assert.deepEqual(await classifyChangeSet(reversed, context), first);
  assert.throws(
    () => createChangeClassification({ ...first, facts: [{ ...first.facts[0]!, fileIndex: 999 }] }),
    InvalidInputError,
  );
});
void test("deleted authorization, modified API/schema and rename-only versus rename plus modification", async (t) => {
  const fixture = await createGitFixture(t);
  const padding = Array.from({ length: 30 }, (_, i) => `// padding line ${i}\n`).join("");
  await fixture.write("src/auth.ts", auth + padding);
  await fixture.write("src/token.ts", auth.replace("login", "token") + padding);
  await fixture.write(
    "src/middleware/requireAdmin.ts",
    'export function guard(req,res) { if (req.user.permissions.includes("deny")) return res.status(403).end(); }',
  );
  await fixture.write("src/api/users.ts", route);
  await fixture.write("prisma/schema.prisma", "model User { id Int @id }\n");
  const base = await fixture.commit("base");
  await fixture.git("mv", "src/auth.ts", "src/moved.ts");
  await fixture.git("mv", "src/token.ts", "src/modified.ts");
  await fixture.write(
    "src/modified.ts",
    auth.replace("verify(token, key)", "verify(token, newKey)") + padding,
  );
  await unlink(path.join(fixture.directory, "src/middleware/requireAdmin.ts"));
  await fixture.write("src/api/users.ts", route.replace("/users", "/accounts"));
  await fixture.write("prisma/schema.prisma", "model Account { id Int @id }\n");
  const target = await fixture.commit("target");
  const context = input(fixture.directory, base, target);
  const changes = await analyzeGitChange(context);
  const result = await classifyChangeSet(changes, context);
  assert.deepEqual(result.categories, ["AUTHENTICATION", "AUTHORIZATION", "DATABASE", "API"]);
  const factsFor = (name: string): typeof result.facts =>
    result.facts.filter(
      (fact) =>
        fact.fileIndex !== null && result.changeSet.changedFiles[fact.fileIndex]?.path === name,
    );
  assert.deepEqual(factsFor("src/moved.ts"), []);
  assert.ok(factsFor("src/modified.ts").length > 0);
  assert.ok(factsFor("src/modified.ts").every((fact) => fact.contentEffect === "MODIFIED"));
  assert.ok(
    factsFor("src/middleware/requireAdmin.ts").some(
      (fact) =>
        fact.side === "BASE" &&
        fact.category === "AUTHORIZATION" &&
        fact.contentEffect === "DELETED",
    ),
  );
  assert.equal(
    changes.changedFiles.find((file) => file.path === "src/moved.ts")?.status,
    "RENAMED",
  );
});
void test("limits, invalid UTF8, binary, malformed sources, and secrets degrade explicitly", async (t) => {
  const fixture = await createGitFixture(t);
  await fixture.write("README.md", "base");
  const base = await fixture.commit("base");
  await fixture.write("a.ts", auth.repeat(100));
  await fixture.write("b.ts", Buffer.from([0xff, 0xfe, 0xfd]));
  await fixture.write("c.ts", Buffer.from([0, 1, 2, 3]));
  await fixture.write("d.ts", 'import jwt from "jsonwebtoken"; jwt.verify(');
  await fixture.write(".env.production.ts", "SECRET_DO_NOT_READ_123");
  const target = await fixture.commit("target");
  const context = input(fixture.directory, base, target);
  const changes = await analyzeGitChange(context);
  const result = await classifyChangeSet(changes, context, { inspection: { maxFileBytes: 200 } });
  assert.deepEqual(result.categories, ["CONFIGURATION"]);
  for (const code of ["FILE_LIMIT", "INVALID_UTF8", "BINARY", "MALFORMED_SOURCE"])
    assert.ok(
      result.limitations.some((item) => item.code === code),
      code,
    );
  assert.ok(!JSON.stringify(result).includes("SECRET_DO_NOT_READ"));
  const total = await classifyChangeSet(changes, context, { inspection: { maxTotalBytes: 0 } });
  assert.ok(total.limitations.some((item) => item.code === "TOTAL_LIMIT"));
  const count = await classifyChangeSet(changes, context, { inspection: { maxFiles: 0 } });
  assert.ok(count.limitations.some((item) => item.code === "FILE_COUNT_LIMIT"));
  assert.throws(() => createInspectionPolicy({ maxFileBytes: 999999999 }), InvalidInputError);
});
void test("context, factual mismatch and infrastructure failure do not become GENERAL", async (t) => {
  const fixture = await createGitFixture(t);
  await fixture.write("README.md", "base");
  const base = await fixture.commit("base");
  await fixture.write("src/auth.ts", auth);
  const target = await fixture.commit("target");
  const context = input(fixture.directory, base, target);
  const changes = await analyzeGitChange(context);
  await assert.rejects(
    classifyChangeSet(changes, { ...context, baseCommit: context.targetCommit }),
    ClassificationContextMismatchError,
  );
  const forged = createChangeSet({
    ...changes,
    changedFiles: [
      createChangedFile({
        path: "elsewhere.ts",
        status: "ADDED",
        isBinary: false,
        additions: 1,
        deletions: 0,
      }),
    ],
  });
  await assert.rejects(classifyChangeSet(forged, context), ClassificationContextMismatchError);
  await assert.rejects(
    classifyChangeSet(changes, context, { git: { gitExecutable: "missing-riskverifier-git.exe" } }),
    GitExecutableUnavailableError,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    classifyChangeSet(changes, context, { git: { signal: controller.signal } }),
    GitCancelledError,
  );
  await assert.rejects(
    classifyChangeSet(changes, context, { git: { maxOutputBytes: 1 } }),
    GitOutputLimitError,
  );
});

void test("committed dependency deltas, modified configuration, raw binary and non-regular blobs", async (t) => {
  const fixture = await createGitFixture(t);
  await fixture.write(
    "package.json",
    JSON.stringify({ dependencies: { removed: "1", updated: "1" } }),
  );
  await fixture.write("tsconfig.json", '{"compilerOptions":{"strict":false}}');
  const base = await fixture.commit("base");
  await fixture.write(
    "package.json",
    JSON.stringify({ dependencies: { added: "1", updated: "2" } }),
  );
  await fixture.write("tsconfig.json", '{"compilerOptions":{"strict":true}}');
  await fixture.write(".gitattributes", "*.ts diff\n");
  await fixture.write("binary-text.ts", Buffer.from([0, 106, 119, 116]));
  await fixture.write("link.ts", auth);
  await fixture.git("add", "--all");
  const blob = (await fixture.git("hash-object", "link.ts")).trim();
  await fixture.git("update-index", "--cacheinfo", `120000,${blob},link.ts`);
  await fixture.git("commit", "--quiet", "-m", "target");
  const target = (await fixture.git("rev-parse", "HEAD")).trim();
  const context = input(fixture.directory, base, target);
  const changes = await analyzeGitChange(context);
  assert.equal(
    changes.changedFiles.find((file) => file.path === "binary-text.ts")?.isBinary,
    false,
  );
  const result = await classifyChangeSet(changes, context);
  assert.deepEqual(result.categories, ["DEPENDENCY", "CONFIGURATION"]);
  const dependency = result.facts.find((fact) => fact.ruleId === "json.dependencies");
  assert.ok(dependency?.observation.includes("1 added, 1 removed, 1 versions changed"));
  assert.equal(dependency?.contentEffect, "MODIFIED");
  assert.ok(result.limitations.some((item) => item.code === "BINARY"));
  assert.ok(result.limitations.some((item) => item.code === "UNSUPPORTED_TYPE"));
});
void test("GENERAL is exclusive for empty, README, ordinary source and metadata-only manifests", async (t) => {
  const fixture = await createGitFixture(t, "sha256");
  await fixture.write("package.json", '{"version":"1"}');
  const base = await fixture.commit("base");
  const emptyInput = input(fixture.directory, base, base);
  assert.deepEqual(
    (await classifyChangeSet(await analyzeGitChange(emptyInput), emptyInput)).categories,
    ["GENERAL"],
  );
  await fixture.write("package.json", '{"version":"2"}');
  await fixture.write("README.md", "authentication database API test");
  await fixture.write("src/utils/testValue.ts", "export const testValue = 1;");
  const target = await fixture.commit("target");
  const context = input(fixture.directory, base, target);
  const result = await classifyChangeSet(await analyzeGitChange(context), context);
  assert.deepEqual(result.categories, ["GENERAL"]);
  assert.equal(result.facts.length, 1);
});
void test("path movement retains old test context without inventing source modification", async (t) => {
  const fixture = await createGitFixture(t);
  await fixture.write("a.test.ts", "export const value = 1;\n");
  const base = await fixture.commit("base");
  await rename(
    path.join(fixture.directory, "a.test.ts"),
    path.join(fixture.directory, "production.ts"),
  );
  const target = await fixture.commit("move");
  const context = input(fixture.directory, base, target);
  const result = await classifyChangeSet(await analyzeGitChange(context), context);
  assert.deepEqual(result.categories, ["TEST"]);
  assert.ok(
    result.facts.every((fact) => fact.side === "BASE" && fact.contentEffect === "UNCHANGED"),
  );
});
