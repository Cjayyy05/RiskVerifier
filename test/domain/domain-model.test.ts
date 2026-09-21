import assert from "node:assert/strict";
import test from "node:test";

import {
  InvariantViolationError,
  InvalidInputError,
  createCheckResult,
  createClassificationEvidence,
  createClassificationResult,
  createDeploymentArtifactIdentity,
  createEvidence,
  createRiskAssessment,
  createRiskEvidence,
  createStrategyRequirement,
  createVerdictReason,
  createVerificationCheck,
  createVerificationPlan,
  createVerificationPolicy,
  createVerificationRun,
  isDeploymentArtifactBoundToTarget,
  type CheckResultState,
} from "../../src/domain/index.js";
import {
  CHECK_RESULT_STATES,
  createCommitIdentity,
  createRepositoryIdentity,
} from "../../src/domain/index.js";
import {
  CONFIG_HASH,
  NOW,
  SHA_A,
  SHA_B,
  createTestConfigurationIdentity,
  createTestEvidence,
} from "../helpers.js";

void test("creates the major Phase 1 domain objects with explicit evidence and separate risk/verdict", () => {
  const evidence = createTestEvidence();
  const classificationEvidence = createClassificationEvidence({
    evidence,
    category: "AUTHORIZATION",
    ruleId: "classification.authorization-path",
    ruleVersion: "1.0.0",
    observation: "Authorization-related source was identified by a future classifier contract",
    sourceLocation: "src/authz.ts",
  });
  const classification = createClassificationResult({
    categories: ["AUTHORIZATION"],
    evidence: [classificationEvidence],
  });
  const riskEvidence = createRiskEvidence({
    evidence,
    ruleId: "risk.authorization",
    ruleVersion: "1.0.0",
    contribution: "CRITICAL",
    observation: "Authorization changes may affect an access-control boundary",
    sourceEvidenceIds: [evidence.id],
  });
  const risk = createRiskAssessment({
    level: "CRITICAL",
    ruleSetVersion: "1.0.0",
    evidence: [riskEvidence],
  });
  const policy = createVerificationPolicy({
    version: "policy-v1",
    description: "Phase 1 policy identity only",
    ruleIds: ["policy.authorization"],
  });
  const requirement = createStrategyRequirement({
    strategy: "AUTHORIZATION_VERIFICATION",
    disposition: "MANDATORY",
    policyVersion: policy.version,
    selectionReason: "Authorization verification is required by the represented policy",
    originatingEvidenceIds: [evidence.id],
    matchedRuleIds: ["policy.authorization"],
    unavailableBehavior: "INCONCLUSIVE",
  });
  const check = createVerificationCheck({
    id: "check-1",
    strategy: "AUTHORIZATION_VERIFICATION",
    disposition: "MANDATORY",
    trustedDefinitionId: "future-definition-1",
    originatingEvidenceIds: [evidence.id],
  });
  const plan = createVerificationPlan({
    id: "plan-1",
    runId: "run-1",
    categories: classification.categories,
    risk,
    policyVersion: policy.version,
    configuration: createTestConfigurationIdentity(),
    strategyRequirements: [requirement],
    checks: [check],
    createdAt: NOW,
  });
  const reason = createVerdictReason({
    code: "ALL_MANDATORY_CHECKS_PASSED",
    explanation: "Example completed-run construction only; no verdict engine was executed",
    evidenceIds: [evidence.id],
    checkId: check.id,
  });
  const run = createVerificationRun({
    id: "run-1",
    repository: "repository-1",
    baseCommit: SHA_A,
    targetCommit: SHA_B,
    policyVersion: policy.version,
    configuration: createTestConfigurationIdentity(),
    lifecycleState: "COMPLETED",
    finalVerdict: "APPROVE",
    verdictReasons: [reason],
    createdAt: NOW,
  });

  assert.equal(risk.level, "CRITICAL");
  assert.equal(run.finalVerdict, "APPROVE");
  assert.notEqual(risk.level, run.finalVerdict);
  assert.equal(plan.checks[0]?.strategy, "AUTHORIZATION_VERIFICATION");
  assert.ok(Object.isFrozen(classification));
  assert.ok(Object.isFrozen(risk));
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.categories));
  assert.ok(Object.isFrozen(plan.checks));
});

void test("protects plan collections from mutation", () => {
  const evidence = createTestEvidence();
  const riskEvidence = createRiskEvidence({
    evidence,
    ruleId: "risk.general",
    ruleVersion: "1",
    contribution: "LOW",
    observation: "General change",
  });
  const risk = createRiskAssessment({
    level: "LOW",
    ruleSetVersion: "1",
    evidence: [riskEvidence],
  });
  const requirement = createStrategyRequirement({
    strategy: "BUILD",
    disposition: "MANDATORY",
    policyVersion: "policy-v1",
    selectionReason: "Build required",
    unavailableBehavior: "INCONCLUSIVE",
  });
  const plan = createVerificationPlan({
    id: "plan-1",
    runId: "run-1",
    categories: ["GENERAL"],
    risk,
    policyVersion: "policy-v1",
    configuration: createTestConfigurationIdentity(),
    strategyRequirements: [requirement],
    checks: [],
    createdAt: NOW,
  });

  const mutableView = plan.categories as unknown as string[];
  assert.throws(() => mutableView.push("API"), TypeError);
});

void test("requires completed runs to have a verdict and reason", () => {
  assert.throws(
    () =>
      createVerificationRun({
        id: "run-1",
        repository: "repository-1",
        baseCommit: SHA_A,
        targetCommit: SHA_B,
        policyVersion: "policy-v1",
        configuration: createTestConfigurationIdentity(),
        lifecycleState: "COMPLETED",
        createdAt: NOW,
      }),
    InvariantViolationError,
  );
});

void test("models every approved check result state without collapsing non-success states", () => {
  for (const state of CHECK_RESULT_STATES) {
    const result = createCheckResult({
      checkId: "check-1",
      attemptId: `attempt-${state.toLowerCase()}`,
      state,
      startedAt: NOW,
      completedAt: NOW,
    });
    assert.equal(result.state, state satisfies CheckResultState);
  }

  assert.throws(
    () =>
      createCheckResult({
        checkId: "check-1",
        attemptId: "attempt-unknown",
        state: "UNKNOWN",
        startedAt: NOW,
        completedAt: NOW,
      }),
    InvalidInputError,
  );
  assert.throws(
    () =>
      createCheckResult({
        checkId: "check-1",
        attemptId: "attempt-reversed",
        state: "ERROR",
        startedAt: "2026-01-02T03:04:06.000Z",
        completedAt: NOW,
      }),
    InvariantViolationError,
  );
});

void test("binds a deployment artifact to one repository and exact target commit", () => {
  const repository = createRepositoryIdentity("repository-1");
  const targetCommit = createCommitIdentity(SHA_B);
  const artifact = createDeploymentArtifactIdentity({
    digest: `sha256:${CONFIG_HASH}`,
    repository,
    targetCommit,
    provenanceReference: "attestation-1",
  });

  assert.equal(isDeploymentArtifactBoundToTarget(artifact, repository, targetCommit), true);
  assert.equal(
    isDeploymentArtifactBoundToTarget(artifact, repository, createCommitIdentity(SHA_A)),
    false,
  );
  assert.equal(
    isDeploymentArtifactBoundToTarget(
      artifact,
      createRepositoryIdentity("repository-2"),
      targetCommit,
    ),
    false,
  );
});

void test("rejects non-JSON evidence facts at runtime", () => {
  const evidence = createTestEvidence();
  assert.throws(
    () =>
      createEvidence({
        id: "evidence-invalid",
        kind: "TEST_FACT",
        context: evidence.context,
        producer: "phase-1-test",
        producerVersion: "1",
        subjectIds: ["subject-1"],
        createdAt: NOW,
        fact: { invalid: Number.POSITIVE_INFINITY },
        completeness: "COMPLETE",
        sensitivity: "INTERNAL",
      }),
    InvalidInputError,
  );
});
