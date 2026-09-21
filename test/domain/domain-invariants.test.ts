import assert from "node:assert/strict";
import test from "node:test";

import {
  InvariantViolationError,
  InvalidInputError,
  createClassificationEvidence,
  createClassificationResult,
  createEvidence,
  createEvidenceRunContext,
  createRiskAssessment,
  createRiskEvidence,
  createStrategyRequirement,
  createVerdictReason,
  createVerificationCheck,
  createVerificationPlan,
  createVerificationRun,
  type ConfigurationIdentity,
  type RiskAssessment,
} from "../../src/domain/index.js";
import { NOW, SHA_A, SHA_B, createTestConfigurationIdentity } from "../helpers.js";

function createRisk(
  runId = "run-1",
  policyVersion = "policy-v1",
  configuration: ConfigurationIdentity = createTestConfigurationIdentity(),
): RiskAssessment {
  const evidence = createEvidence({
    id: `evidence-${runId}`,
    kind: "RISK_FACT",
    context: createEvidenceRunContext({
      runId,
      repository: "repository-1",
      baseCommit: SHA_A,
      targetCommit: SHA_B,
      policyVersion,
      configuration,
    }),
    producer: "phase-1-test",
    producerVersion: "1",
    subjectIds: ["change-1"],
    createdAt: NOW,
    fact: { observed: true },
    completeness: "COMPLETE",
    sensitivity: "INTERNAL",
  });
  return createRiskAssessment({
    level: "LOW",
    ruleSetVersion: "1",
    evidence: [
      createRiskEvidence({
        evidence,
        ruleId: "risk.general",
        ruleVersion: "1",
        contribution: "LOW",
        observation: "General change",
      }),
    ],
  });
}

function createRequirement(): ReturnType<typeof createStrategyRequirement> {
  return createStrategyRequirement({
    strategy: "BUILD",
    disposition: "MANDATORY",
    policyVersion: "policy-v1",
    selectionReason: "Build required",
    unavailableBehavior: "INCONCLUSIVE",
  });
}

function createCheck(id = "check-1"): ReturnType<typeof createVerificationCheck> {
  return createVerificationCheck({
    id,
    strategy: "BUILD",
    disposition: "MANDATORY",
    trustedDefinitionId: "build-definition",
  });
}

void test("rejects duplicate requirements, duplicate checks, and forged nested values", () => {
  const configuration = createTestConfigurationIdentity();
  const base = {
    id: "plan-1",
    runId: "run-1",
    categories: ["GENERAL"],
    risk: createRisk(),
    policyVersion: "policy-v1",
    configuration,
    createdAt: NOW,
  } as const;

  const requirement = createRequirement();
  assert.throws(
    () =>
      createVerificationPlan({
        ...base,
        strategyRequirements: [requirement, requirement],
        checks: [],
      }),
    InvariantViolationError,
  );
  assert.throws(
    () =>
      createVerificationPlan({
        ...base,
        strategyRequirements: [requirement],
        checks: [createCheck(), createCheck()],
      }),
    InvariantViolationError,
  );
  assert.throws(
    () =>
      createVerificationPlan({
        ...base,
        risk: { level: "NOT_RISK", ruleSetVersion: "1", evidence: base.risk.evidence } as never,
        strategyRequirements: [requirement],
        checks: [],
      }),
    InvalidInputError,
  );
  assert.throws(
    () =>
      createVerificationPlan({
        ...base,
        configuration: { version: "config-v1", hash: "not-a-hash" } as never,
        strategyRequirements: [requirement],
        checks: [],
      }),
    InvalidInputError,
  );
});

void test("requires risk evidence context to match plan identity", () => {
  assert.throws(
    () =>
      createVerificationPlan({
        id: "plan-1",
        runId: "run-1",
        categories: ["GENERAL"],
        risk: createRisk("another-run"),
        policyVersion: "policy-v1",
        configuration: createTestConfigurationIdentity(),
        strategyRequirements: [createRequirement()],
        checks: [],
        createdAt: NOW,
      }),
    InvariantViolationError,
  );
});

void test("recursively freezes plan requirements, checks, risk evidence, and configuration", () => {
  const plan = createVerificationPlan({
    id: "plan-1",
    runId: "run-1",
    categories: ["GENERAL"],
    risk: createRisk(),
    policyVersion: "policy-v1",
    configuration: createTestConfigurationIdentity(),
    strategyRequirements: [createRequirement()],
    checks: [createCheck()],
    createdAt: NOW,
  });

  assert.ok(Object.isFrozen(plan.strategyRequirements[0]));
  assert.ok(Object.isFrozen(plan.checks[0]));
  assert.ok(Object.isFrozen(plan.risk.evidence[0]));
  assert.ok(Object.isFrozen(plan.risk.evidence[0]?.evidence.context.configuration));
});

void test("rejects classification evidence for categories absent from the result", () => {
  const risk = createRisk();
  const evidence = risk.evidence[0]?.evidence;
  assert.ok(evidence);
  const classificationEvidence = createClassificationEvidence({
    evidence,
    category: "API",
    ruleId: "classification.api",
    ruleVersion: "1",
    observation: "API change",
  });

  assert.throws(
    () =>
      createClassificationResult({
        categories: ["GENERAL"],
        evidence: [classificationEvidence],
      }),
    InvariantViolationError,
  );
});

void test("rejects every contradictory run verdict state and freezes valid run context", () => {
  const reason = createVerdictReason({
    code: "ALL_MANDATORY_CHECKS_PASSED",
    explanation: "Construction invariant test",
  });
  const base = {
    id: "run-1",
    repository: "repository-1",
    baseCommit: SHA_A,
    targetCommit: SHA_B,
    policyVersion: "policy-v1",
    configuration: createTestConfigurationIdentity(),
    createdAt: NOW,
  } as const;

  assert.throws(
    () => createVerificationRun({ ...base, lifecycleState: "COMPLETED" }),
    InvariantViolationError,
  );
  assert.throws(
    () =>
      createVerificationRun({
        ...base,
        lifecycleState: "COMPLETED",
        finalVerdict: "APPROVE",
        verdictReasons: [],
      }),
    InvariantViolationError,
  );
  assert.throws(
    () =>
      createVerificationRun({
        ...base,
        lifecycleState: "QUEUED",
        finalVerdict: "APPROVE",
        verdictReasons: [reason],
      }),
    InvariantViolationError,
  );
  assert.throws(
    () => createVerificationRun({ ...base, lifecycleState: "QUEUED", verdictReasons: [reason] }),
    InvariantViolationError,
  );
  assert.throws(
    () =>
      createVerificationRun({
        ...base,
        configuration: { version: "config-v1", hash: "invalid" } as never,
        lifecycleState: "QUEUED",
      }),
    InvalidInputError,
  );

  const run = createVerificationRun({ ...base, lifecycleState: "QUEUED" });
  assert.ok(Object.isFrozen(run));
  assert.ok(Object.isFrozen(run.configuration));
  assert.throws(() => {
    (run as unknown as { repository: string }).repository = "changed";
  }, TypeError);
  assert.throws(() => {
    (run as unknown as { targetCommit: string }).targetCommit = SHA_A;
  }, TypeError);
});
