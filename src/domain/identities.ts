import { InvalidInputError } from "./errors.js";
import { requireExactKeys, requireIdentityString, requirePlainObject } from "./validation.js";

declare const brand: unique symbol;
type Brand<T, Name extends string> = T & { readonly [brand]: Name };

export type RepositoryIdentity = Brand<string, "RepositoryIdentity">;
export type CommitIdentity = Brand<string, "CommitIdentity">;
export type PolicyVersion = Brand<string, "PolicyVersion">;
export type ConfigurationVersion = Brand<string, "ConfigurationVersion">;
export type ConfigurationHash = Brand<string, "ConfigurationHash">;
export type VerificationRunId = Brand<string, "VerificationRunId">;
export type VerificationPlanId = Brand<string, "VerificationPlanId">;
export type VerificationCheckId = Brand<string, "VerificationCheckId">;
export type CheckAttemptId = Brand<string, "CheckAttemptId">;
export type EvidenceId = Brand<string, "EvidenceId">;
export type RuleId = Brand<string, "RuleId">;
export type ComponentVersion = Brand<string, "ComponentVersion">;
export type CheckDefinitionId = Brand<string, "CheckDefinitionId">;
export type ArtifactDigest = Brand<string, "ArtifactDigest">;
export type ProvenanceReference = Brand<string, "ProvenanceReference">;
export type VerdictReasonCode = Brand<string, "VerdictReasonCode">;

function createNamedIdentity<Name extends string>(
  value: unknown,
  field: string,
): Brand<string, Name> {
  return requireIdentityString(value, field) as Brand<string, Name>;
}

export const createRepositoryIdentity = (value: unknown): RepositoryIdentity =>
  createNamedIdentity(value, "repositoryIdentity");

export function createCommitIdentity(value: unknown): CommitIdentity {
  const candidate = requireIdentityString(value, "commitIdentity");
  if (!/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(candidate)) {
    throw new InvalidInputError(
      "commitIdentity must be a complete 40-character SHA-1 or 64-character SHA-256 object ID",
      { field: "commitIdentity" },
    );
  }

  return candidate.toLowerCase() as CommitIdentity;
}

export const createPolicyVersion = (value: unknown): PolicyVersion =>
  createNamedIdentity(value, "policyVersion");

export const createConfigurationVersion = (value: unknown): ConfigurationVersion =>
  createNamedIdentity(value, "configurationVersion");

export function createConfigurationHash(value: unknown): ConfigurationHash {
  const candidate = requireIdentityString(value, "configurationHash");
  if (!/^[a-fA-F0-9]{64}$/.test(candidate)) {
    throw new InvalidInputError("configurationHash must be a 64-character SHA-256 digest", {
      field: "configurationHash",
    });
  }

  return candidate.toLowerCase() as ConfigurationHash;
}

export const createVerificationRunId = (value: unknown): VerificationRunId =>
  createNamedIdentity(value, "verificationRunId");

export const createVerificationPlanId = (value: unknown): VerificationPlanId =>
  createNamedIdentity(value, "verificationPlanId");

export const createVerificationCheckId = (value: unknown): VerificationCheckId =>
  createNamedIdentity(value, "verificationCheckId");

export const createCheckAttemptId = (value: unknown): CheckAttemptId =>
  createNamedIdentity(value, "checkAttemptId");

export const createEvidenceId = (value: unknown): EvidenceId =>
  createNamedIdentity(value, "evidenceId");

export const createRuleId = (value: unknown): RuleId => createNamedIdentity(value, "ruleId");

export const createComponentVersion = (value: unknown): ComponentVersion =>
  createNamedIdentity(value, "componentVersion");

export const createCheckDefinitionId = (value: unknown): CheckDefinitionId =>
  createNamedIdentity(value, "checkDefinitionId");

export function createArtifactDigest(value: unknown): ArtifactDigest {
  const candidate = requireIdentityString(value, "artifactDigest");
  if (!/^sha256:[a-fA-F0-9]{64}$/.test(candidate)) {
    throw new InvalidInputError(
      "artifactDigest must use the form sha256:<64 hexadecimal characters>",
      { field: "artifactDigest" },
    );
  }

  return candidate.toLowerCase() as ArtifactDigest;
}

export const createProvenanceReference = (value: unknown): ProvenanceReference =>
  createNamedIdentity(value, "provenanceReference");

export const createVerdictReasonCode = (value: unknown): VerdictReasonCode =>
  createNamedIdentity(value, "verdictReasonCode");

export interface ConfigurationIdentity {
  readonly version: ConfigurationVersion;
  readonly hash: ConfigurationHash;
}

export function createConfigurationIdentity(input: {
  readonly version: unknown;
  readonly hash: unknown;
}): ConfigurationIdentity {
  const record = requirePlainObject(input, "configurationIdentity");
  requireExactKeys(record, ["version", "hash"], "configurationIdentity");

  return Object.freeze({
    version: createConfigurationVersion(record.version),
    hash: createConfigurationHash(record.hash),
  });
}
