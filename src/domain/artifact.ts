import { deepFreeze } from "./immutable.js";
import {
  createArtifactDigest,
  createCommitIdentity,
  createProvenanceReference,
  createRepositoryIdentity,
  type ArtifactDigest,
  type CommitIdentity,
  type ProvenanceReference,
  type RepositoryIdentity,
} from "./identities.js";

export interface DeploymentArtifactIdentity {
  readonly digest: ArtifactDigest;
  readonly repository: RepositoryIdentity;
  readonly targetCommit: CommitIdentity;
  readonly provenanceReference: ProvenanceReference;
}

export function createDeploymentArtifactIdentity(input: {
  readonly digest: unknown;
  readonly repository: unknown;
  readonly targetCommit: unknown;
  readonly provenanceReference: unknown;
}): DeploymentArtifactIdentity {
  return deepFreeze({
    digest: createArtifactDigest(input.digest),
    repository: createRepositoryIdentity(input.repository),
    targetCommit: createCommitIdentity(input.targetCommit),
    provenanceReference: createProvenanceReference(input.provenanceReference),
  });
}

export function isDeploymentArtifactBoundToTarget(
  artifact: DeploymentArtifactIdentity,
  repository: RepositoryIdentity,
  targetCommit: CommitIdentity,
): boolean {
  return artifact.repository === repository && artifact.targetCommit === targetCommit;
}
