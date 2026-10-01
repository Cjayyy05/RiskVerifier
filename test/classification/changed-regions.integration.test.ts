import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { classifyChangeSet } from "../../src/classification/index.js";
import {
  analyzeGitChange,
  createGitChangeAnalysisInput,
  ClassificationContextMismatchError,
  createInspectionPolicy,
} from "../../src/git/index.js";
import { createChangeSet } from "../../src/domain/index.js";
import { createGitFixture } from "../git/git-fixture.js";

const auth =
  'import jwt from "jsonwebtoken"; export function login(token){ return jwt.verify(token,key); }\n';
const guard =
  'export function guard(req,res){ if(req.user.role!=="admin"){console.log("old");return res.status(403).end();} console.log("outside");}\n';
const api = 'import express from "express"; const app=express(); app.get("/users",handler);\n';

void test("changed constructs exclude old security code, comments, formatting and pure renames", async (t) => {
  const f = await createGitFixture(t);
  const originals: Record<string, string> = {
    "auth-log.ts": auth + 'console.log("old");',
    "auth-change.ts": auth,
    "guard-log.ts": guard,
    "guard-change.ts": guard,
    "api-comment.ts": api,
    "api-method.ts": api,
    "pure.ts": auth,
    "duplicate.ts": auth + "jwt.verify(token,key);\n",
  };
  for (const [name, content] of Object.entries(originals)) await f.write(name, content);
  const base = await f.commit("base");
  await f.write("auth-log.ts", auth + 'console.log("new");');
  await f.write("auth-change.ts", auth.replace("token,key", "token,newKey"));
  await f.write(
    "guard-log.ts",
    guard.replace('"old"', '"new"').replace('"outside"', '"different"'),
  );
  await f.write("guard-change.ts", guard.replace('"admin"', '"owner"'));
  await f.write(
    "api-comment.ts",
    "// route example documentation\n" + api.replace("app.get(", "app.get( "),
  );
  await f.write("api-method.ts", api.replace(".get(", ".post("));
  await f.git("mv", "pure.ts", "moved.ts");
  await f.write("duplicate.ts", auth);
  const target = await f.commit("target");
  const context = createGitChangeAnalysisInput({
    repositoryPath: f.directory,
    repository: "review",
    baseCommit: base,
    targetCommit: target,
  });
  const changes = await analyzeGitChange(context);
  const result = await classifyChangeSet(changes, context);
  const facts = (name: string): typeof result.facts =>
    result.facts.filter(
      (fact) =>
        fact.fileIndex !== null && result.changeSet.changedFiles[fact.fileIndex]?.path === name,
    );
  for (const name of ["auth-log.ts", "guard-log.ts", "api-comment.ts", "moved.ts"])
    assert.deepEqual(facts(name), [], name);
  for (const [name, category] of [
    ["auth-change.ts", "AUTHENTICATION"],
    ["guard-change.ts", "AUTHORIZATION"],
    ["api-method.ts", "API"],
  ]) {
    assert.ok(name);
    assert.equal(facts(name).length, 2, name);
    assert.ok(
      facts(name).every(
        (fact) =>
          fact.category === category &&
          fact.line !== null &&
          /^sha256:[a-f0-9]{64}$/u.test(fact.constructDigest ?? ""),
      ),
    );
  }
  assert.equal(facts("duplicate.ts").length, 1);
  assert.equal(facts("duplicate.ts")[0]?.side, "BASE");
  assert.equal(JSON.stringify(result).includes("newKey"), false);
  // Staged, untracked, poisoned configuration and a different branch must not affect exact blobs.
  await f.git("switch", "--quiet", "-c", "unrelated");
  await f.write("auth-change.ts", "staged nonsense");
  await f.git("add", "--", "auth-change.ts");
  await f.write("auth-change.ts", "unstaged nonsense");
  await f.write("untracked.ts", "arbitrary content");
  await f.write("tsconfig.json", '{"compilerOptions":{"plugins":[{"name":"DO_NOT_LOAD"}]}}');
  await f.git("config", "diff.external", "DO_NOT_EXECUTE");
  const before = await readFile(path.join(f.directory, ".git/index"));
  assert.deepEqual(await classifyChangeSet(changes, context), result);
  assert.deepEqual(await readFile(path.join(f.directory, ".git/index")), before);
  for (const mismatch of [
    { repository: "other" },
    { baseCommit: target },
    { targetCommit: base },
  ]) {
    const wrong = createGitChangeAnalysisInput({ ...context, ...mismatch });
    await assert.rejects(classifyChangeSet(changes, wrong), ClassificationContextMismatchError);
  }
  await assert.rejects(
    classifyChangeSet(createChangeSet({ ...changes, analyzerVersion: "wrong" }), context),
    ClassificationContextMismatchError,
  );
});

void test("partial or malformed counterpart cannot fabricate a semantic addition/removal", async (t) => {
  const f = await createGitFixture(t);
  await f.write("auth.ts", auth);
  const base = await f.commit("base");
  await f.write("auth.ts", auth.replace("key", "changedKey") + " ".repeat(100));
  const target = await f.commit("target");
  const input = createGitChangeAnalysisInput({
    repositoryPath: f.directory,
    repository: "review",
    baseCommit: base,
    targetCommit: target,
  });
  const changes = await analyzeGitChange(input);
  const result = await classifyChangeSet(changes, input, {
    inspection: { maxFileBytes: auth.length },
  });
  assert.deepEqual(result.categories, ["GENERAL"]);
  assert.ok(result.limitations.some((item) => item.code === "SEMANTIC_COMPARISON_UNAVAILABLE"));
  const exact = await classifyChangeSet(changes, input, {
    inspection: { maxFileBytes: auth.length + 107, maxTotalBytes: auth.length * 2 + 107 },
  });
  assert.deepEqual(exact.categories, ["AUTHENTICATION"]);
  await f.write("auth.ts", auth + "(");
  const malformed = await f.commit("malformed");
  const malformedInput = createGitChangeAnalysisInput({ ...input, targetCommit: malformed });
  const malformedResult = await classifyChangeSet(
    await analyzeGitChange(malformedInput),
    malformedInput,
  );
  assert.deepEqual(malformedResult.categories, ["GENERAL"]);
  assert.ok(malformedResult.limitations.some((item) => item.code === "MALFORMED_SOURCE"));
  for (const invalid of [-1, NaN, 1.5, 1048577])
    assert.throws(() => createInspectionPolicy({ maxFileBytes: invalid }));
});
