import assert from "node:assert/strict";
import test from "node:test";
import { classifyChangeSet } from "../../src/classification/index.js";
import { analyzeGitChange, createGitChangeAnalysisInput } from "../../src/git/index.js";
import { assessRisk } from "../../src/risk/index.js";
import { createGitFixture } from "../git/git-fixture.js";

void test("real committed cosmetic, unsupported and security/API changes flow into risk without keyword inference", async (t) => {
  const fixture = await createGitFixture(t);
  await fixture.write("src/style.css", "body { color: blue; }\n");
  const first = await fixture.commit("initial");
  await fixture.write("src/style.css", "body { color: red; }\n");
  const cosmetic = await fixture.commit("cosmetic");
  const assessment = async (
    baseCommit: string,
    targetCommit: string,
  ): Promise<ReturnType<typeof assessRisk>> => {
    const context = createGitChangeAnalysisInput({
      repositoryPath: fixture.directory,
      repository: "risk-pipeline",
      baseCommit,
      targetCommit,
    });
    const changes = await analyzeGitChange(context);
    return assessRisk(changes, await classifyChangeSet(changes, context));
  };
  const low = await assessment(first, cosmetic);
  assert.equal(low.level, "LOW");
  assert.deepEqual(low.classification.categories, ["FRONTEND"]);
  await fixture.write(
    "src/authorization.ts",
    "// authorization removed; DROP TABLE; public API\nexport const label = 'auth';\n",
  );
  const unsupported = await fixture.commit("unsupported keywords");
  const general = await assessment(cosmetic, unsupported);
  assert.equal(general.level, "MEDIUM");
  assert.deepEqual(general.classification.categories, ["GENERAL"]);
  assert.ok(general.uncertainties.some((item) => item.code === "CLASSIFICATION_LIMITATIONS"));
  await fixture.write(
    "src/routes.ts",
    'import express from "express"; const app=express(); app.get("/users", (req,res)=>{ if(req.user.role !== "admin") return res.status(403).end(); return res.json([]); });\n',
  );
  const sensitive = await fixture.commit("supported route and guard");
  const high = await assessment(unsupported, sensitive);
  assert.equal(high.level, "HIGH");
  assert.ok(high.evidence.some((item) => item.reasonCode === "COMBINED_AUTHORIZATION_API"));
  await fixture.write("src/routes.ts", "dirty unrelated working tree\n");
  assert.deepEqual(await assessment(unsupported, sensitive), high);
  assert.ok(
    high.evidence.every((item) =>
      item.classificationFactIndices.every(
        (index) => high.classification.facts[index] !== undefined,
      ),
    ),
  );
});

void test("committed auth additions/modifications/deletions and dependency changes retain factual risk semantics", async (t) => {
  const fixture = await createGitFixture(t);
  await fixture.write("README.md", "initial\n");
  let previous = await fixture.commit("initial");
  const assessNext = async (): Promise<ReturnType<typeof assessRisk>> => {
    const target = await fixture.commit("next scenario");
    const context = createGitChangeAnalysisInput({
      repositoryPath: fixture.directory,
      repository: "risk-adversarial",
      baseCommit: previous,
      targetCommit: target,
    });
    const changes = await analyzeGitChange(context);
    const result = assessRisk(changes, await classifyChangeSet(changes, context));
    previous = target;
    return result;
  };
  await fixture.write(
    "src/login.ts",
    'import {jwtVerify} from "jose"; export const verify=(token)=>jwtVerify(token,key);\n',
  );
  assert.equal((await assessNext()).level, "HIGH");
  await fixture.write(
    "src/login.ts",
    'import {jwtVerify} from "jose"; export const verify=(token)=>jwtVerify(token,newKey);\n',
  );
  assert.equal((await assessNext()).level, "HIGH");
  await fixture.git("rm", "--", "src/login.ts");
  const deleted = await assessNext();
  assert.equal(deleted.level, "HIGH");
  assert.match(
    deleted.evidence.find((item) => item.reasonCode === "DELETED_AUTHENTICATION_FILE")!.observation,
    /relocation or replacement elsewhere is not excluded/u,
  );
  for (const contents of [
    '{"dependencies":{"security":"1"}}\n',
    '{"dependencies":{"security":"2"}}\n',
    '{"dependencies":{"security":"2","ordinary":"1"}}\n',
  ]) {
    await fixture.write("package.json", contents);
    const result = await assessNext();
    assert.equal(result.level, "MEDIUM");
    assert.deepEqual(result.classification.categories, ["DEPENDENCY"]);
  }
  await fixture.write("package-lock.json", '{"lockfileVersion":3}\n');
  const lock = await assessNext();
  assert.equal(lock.level, "MEDIUM");
  assert.ok(lock.classification.facts.some((fact) => fact.ruleId === "path.lockfile"));
  await fixture.write(
    "package-lock.json",
    Array.from({ length: 1501 }, (_, i) => String(i)).join("\n"),
  );
  assert.equal((await assessNext()).level, "HIGH");
  await fixture.write("package.json", '{"dependencies":{"security":"3"}}\n');
  await fixture.write("tsconfig.json", "{}\n");
  const combined = await assessNext();
  assert.equal(combined.level, "HIGH");
  assert.ok(
    combined.evidence.some((item) => item.reasonCode === "COMBINED_DEPENDENCY_CONFIGURATION"),
  );
  const context = createGitChangeAnalysisInput({
    repositoryPath: fixture.directory,
    repository: "risk-adversarial",
    baseCommit: previous,
    targetCommit: previous,
  });
  const empty = await analyzeGitChange(context);
  const result = assessRisk(empty, await classifyChangeSet(empty, context));
  assert.equal(result.level, "LOW");
  assert.equal(
    result.classification.changeSet.baseCommit,
    result.classification.changeSet.targetCommit,
  );
  assert.deepEqual(
    result.evidence.map((item) => item.reasonCode),
    ["EMPTY_CHANGE"],
  );
  assert.deepEqual(result.evidence[0]?.classificationFactIndices, []);
  assert.notEqual(result.level, "CRITICAL");
});
