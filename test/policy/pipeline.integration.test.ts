import assert from "node:assert/strict";
import test from "node:test";
import { classifyChangeSet } from "../../src/classification/index.js";
import { analyzeGitChange, createGitChangeAnalysisInput } from "../../src/git/index.js";
import { assessRisk } from "../../src/risk/index.js";
import { evaluatePolicy } from "../../src/policy/index.js";
import { createGitFixture } from "../git/git-fixture.js";

void test("real committed Git inputs flow through classification/risk/policy without executing repository scripts", async (t) => {
  const fixture = await createGitFixture(t);
  await fixture.write("README.md", "initial\n");
  const base = await fixture.commit("initial");
  await fixture.write(
    "src/login.ts",
    'import {jwtVerify} from "jose"; export const verify=(token)=>jwtVerify(token,key);\n',
  );
  await fixture.write("package.json", '{"scripts":{"build":"UNTRUSTED_DO_NOT_EXECUTE"}}\n');
  const target = await fixture.commit("authentication");
  const evaluate = async (
    baseCommit: string,
    targetCommit: string,
  ): Promise<ReturnType<typeof evaluatePolicy>> => {
    const context = createGitChangeAnalysisInput({
      repositoryPath: fixture.directory,
      repository: "policy-pipeline",
      baseCommit,
      targetCommit,
    });
    const changes = await analyzeGitChange(context);
    const classification = await classifyChangeSet(changes, context);
    return evaluatePolicy(changes, classification, assessRisk(changes, classification));
  };
  const result = await evaluate(base, target);
  assert.equal(
    result.requirements.find((item) => item.strategy === "AUTHENTICATION_VERIFICATION")?.strength,
    "MANDATORY",
  );
  assert.doesNotMatch(JSON.stringify(result), /UNTRUSTED_DO_NOT_EXECUTE/u);
  await fixture.write("src/login.ts", "dirty unrelated contents\n");
  assert.deepEqual(await evaluate(base, target), result);
  assert.ok(
    (await evaluate(target, target)).requirements.every((item) => item.strength === "UNNECESSARY"),
  );
});
