import assert from "node:assert/strict";
import test from "node:test";
import { classifyChangeSet } from "../../src/classification/index.js";
import { analyzeGitChange, createGitChangeAnalysisInput } from "../../src/git/index.js";
import { assessRisk } from "../../src/risk/index.js";
import { evaluatePolicy } from "../../src/policy/index.js";
import { defaultStrategyCapabilities } from "../../src/domain/index.js";
import { parseConfigurationSnapshot } from "../../src/configuration/index.js";
import { generateVerificationPlan, validateVerificationPlan } from "../../src/planning/index.js";
import { createGitFixture } from "../git/git-fixture.js";

void test("exact committed Git/classification/risk/policy inputs produce a non-executing plan", async (t) => {
  const fixture = await createGitFixture(t);
  await fixture.write("README.md", "initial\n");
  const base = await fixture.commit("initial");
  await fixture.write(
    "src/routes.ts",
    'import express from "express"; const app=express(); app.get("/users", (req,res)=>{ if(req.user.role !== "admin") return res.status(403).end(); return res.json([]); });\n',
  );
  const target = await fixture.commit("API and authorization");
  const context = createGitChangeAnalysisInput({
    repositoryPath: fixture.directory,
    repository: "planning-pipeline",
    baseCommit: base,
    targetCommit: target,
  });
  const changeSet = await analyzeGitChange(context);
  const classification = await classifyChangeSet(changeSet, context);
  const risk = assessRisk(changeSet, classification);
  const capabilities = defaultStrategyCapabilities();
  const policy = evaluatePolicy(changeSet, classification, risk, capabilities);
  const configuration = parseConfigurationSnapshot({
    schemaVersion: 1,
    version: "pipeline-config",
  }).identity;
  const input = { changeSet, classification, risk, policy, capabilities, configuration };
  const plan = generateVerificationPlan(input);
  assert.equal(
    plan.checks.find((check) => check.strategy === "AUTHORIZATION_VERIFICATION")?.strength,
    "MANDATORY",
  );
  assert.equal(
    plan.checks.find((check) => check.strategy === "API_CONTRACT_VERIFICATION")?.strength,
    "MANDATORY",
  );
  assert.ok(plan.checks.every((check) => check.disposition === "UNSUPPORTED"));
  assert.equal(plan.context.targetCommit, target);
  await fixture.write("src/routes.ts", "dirty unrelated source\n");
  assert.deepEqual(generateVerificationPlan(input), plan);
  assert.deepEqual(validateVerificationPlan(input, plan), plan);
});
