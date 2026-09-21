import assert from "node:assert/strict";
import test from "node:test";

import {
  CHANGE_CATEGORIES,
  CHECK_RESULT_STATES,
  InvalidInputError,
  RISK_LEVELS,
  VERIFICATION_STRATEGIES,
  VERIFICATION_VERDICTS,
  createCommitIdentity,
  createArtifactDigest,
  createConfigurationIdentity,
  createPolicyVersion,
  createRepositoryIdentity,
  parseChangeCategory,
  parseRiskLevel,
  parseVerificationVerdict,
} from "../../src/domain/index.js";
import { CONFIG_HASH, SHA_A } from "../helpers.js";

void test("creates validated repository, commit, policy, and configuration identities", () => {
  assert.equal(createRepositoryIdentity("repo"), "repo");
  assert.equal(createCommitIdentity(SHA_A.toUpperCase()), SHA_A);
  assert.equal(createPolicyVersion("policy-v1"), "policy-v1");
  assert.deepEqual(createConfigurationIdentity({ version: "config-v1", hash: CONFIG_HASH }), {
    version: "config-v1",
    hash: CONFIG_HASH,
  });
});

void test("rejects empty repository and policy identities", () => {
  assert.throws(() => createRepositoryIdentity("  "), InvalidInputError);
  assert.throws(() => createRepositoryIdentity(" repo"), InvalidInputError);
  assert.throws(() => createRepositoryIdentity("repo\nname"), InvalidInputError);
  assert.throws(() => createRepositoryIdentity("repo\u200Bname"), InvalidInputError);
  assert.throws(() => createPolicyVersion(""), InvalidInputError);
  assert.throws(
    () => createConfigurationIdentity({ version: "config-v1", hash: "not-a-sha256" }),
    InvalidInputError,
  );
});

void test("rejects incomplete or non-hex commit identities", () => {
  assert.throws(() => createCommitIdentity("abc123"), InvalidInputError);
  assert.throws(() => createCommitIdentity("z".repeat(40)), InvalidInputError);
  assert.equal(createCommitIdentity("A".repeat(64)), "a".repeat(64));
  assert.throws(() => createCommitIdentity(` ${SHA_A}`), InvalidInputError);
  assert.equal(createArtifactDigest(`sha256:${"D".repeat(64)}`), `sha256:${"d".repeat(64)}`);
  assert.throws(() => createArtifactDigest(`sha256:${"g".repeat(64)}`), InvalidInputError);
});

void test("publishes exactly the approved category, risk, strategy, result, and verdict values", () => {
  assert.deepEqual(CHANGE_CATEGORIES, [
    "AUTHENTICATION",
    "AUTHORIZATION",
    "DATABASE",
    "API",
    "DEPENDENCY",
    "CONFIGURATION",
    "FRONTEND",
    "TEST",
    "GENERAL",
  ]);
  assert.deepEqual(RISK_LEVELS, ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
  assert.deepEqual(VERIFICATION_VERDICTS, ["APPROVE", "BLOCK", "INCONCLUSIVE"]);
  assert.deepEqual(CHECK_RESULT_STATES, [
    "PASS",
    "FAIL",
    "ERROR",
    "TIMEOUT",
    "CANCELLED",
    "SKIPPED",
    "UNSUPPORTED",
  ]);
  assert.equal(VERIFICATION_STRATEGIES.length, 10);
});

void test("runtime enum parsers reject unsupported values", () => {
  assert.throws(() => parseChangeCategory("SECURITY"), InvalidInputError);
  assert.throws(() => parseRiskLevel("UNKNOWN"), InvalidInputError);
  assert.throws(() => parseRiskLevel("APPROVE"), InvalidInputError);
  assert.throws(() => parseVerificationVerdict("PASS"), InvalidInputError);
  assert.throws(() => parseVerificationVerdict("HIGH"), InvalidInputError);
});
