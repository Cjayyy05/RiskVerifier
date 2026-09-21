import {
  createConfigurationIdentity,
  createEvidence,
  createEvidenceRunContext,
  createPolicyVersion,
  createRepositoryIdentity,
  createCommitIdentity,
} from "../src/domain/index.js";

export const SHA_A = "a".repeat(40);
export const SHA_B = "b".repeat(40);
export const CONFIG_HASH = "c".repeat(64);
export const NOW = "2026-01-02T03:04:05.000Z";

export function createTestConfigurationIdentity(): ReturnType<typeof createConfigurationIdentity> {
  return createConfigurationIdentity({ version: "config-v1", hash: CONFIG_HASH });
}

export function createTestEvidence(): ReturnType<typeof createEvidence> {
  const configuration = createTestConfigurationIdentity();
  const context = createEvidenceRunContext({
    runId: "run-1",
    repository: "repository-1",
    baseCommit: SHA_A,
    targetCommit: SHA_B,
    policyVersion: "policy-v1",
    configuration,
  });

  return createEvidence({
    id: "evidence-1",
    kind: "TEST_FACT",
    context,
    producer: "phase-1-test",
    producerVersion: "1.0.0",
    subjectIds: ["subject-1"],
    createdAt: NOW,
    fact: { observed: true },
    completeness: "COMPLETE",
    sensitivity: "INTERNAL",
  });
}

export const TEST_REPOSITORY = createRepositoryIdentity("repository-1");
export const TEST_BASE_COMMIT = createCommitIdentity(SHA_A);
export const TEST_TARGET_COMMIT = createCommitIdentity(SHA_B);
export const TEST_POLICY_VERSION = createPolicyVersion("policy-v1");
