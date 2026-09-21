import { parseChangedFileStatus, type ChangedFileStatus } from "./enums.js";
import { deepFreeze } from "./immutable.js";
import {
  createCommitIdentity,
  createComponentVersion,
  createEvidenceId,
  createRepositoryIdentity,
  type CommitIdentity,
  type ComponentVersion,
  type EvidenceId,
  type RepositoryIdentity,
} from "./identities.js";
import { requireArray, requireNonEmptyString, requireNonNegativeInteger } from "./validation.js";

export interface ChangedFile {
  readonly path: string;
  readonly previousPath?: string;
  readonly status: ChangedFileStatus;
  readonly additions: number;
  readonly deletions: number;
}

export function createChangedFile(input: {
  readonly path: unknown;
  readonly previousPath?: unknown;
  readonly status: unknown;
  readonly additions: unknown;
  readonly deletions: unknown;
}): ChangedFile {
  const previousPath =
    input.previousPath === undefined
      ? undefined
      : requireNonEmptyString(input.previousPath, "previousPath");

  return deepFreeze({
    path: requireNonEmptyString(input.path, "path"),
    ...(previousPath === undefined ? {} : { previousPath }),
    status: parseChangedFileStatus(input.status),
    additions: requireNonNegativeInteger(input.additions, "additions"),
    deletions: requireNonNegativeInteger(input.deletions, "deletions"),
  });
}

export interface ChangeSet {
  readonly repository: RepositoryIdentity;
  readonly baseCommit: CommitIdentity;
  readonly targetCommit: CommitIdentity;
  readonly analyzerVersion: ComponentVersion;
  readonly changedFiles: readonly ChangedFile[];
  readonly analysisEvidenceIds: readonly EvidenceId[];
}

export function createChangeSet(input: {
  readonly repository: unknown;
  readonly baseCommit: unknown;
  readonly targetCommit: unknown;
  readonly analyzerVersion: unknown;
  readonly changedFiles: readonly ChangedFile[];
  readonly analysisEvidenceIds?: readonly unknown[];
}): ChangeSet {
  const changedFiles = requireArray(input.changedFiles, "changedFiles").map((file) =>
    createChangedFile(file as Parameters<typeof createChangedFile>[0]),
  );

  return deepFreeze({
    repository: createRepositoryIdentity(input.repository),
    baseCommit: createCommitIdentity(input.baseCommit),
    targetCommit: createCommitIdentity(input.targetCommit),
    analyzerVersion: createComponentVersion(input.analyzerVersion),
    changedFiles,
    analysisEvidenceIds: (input.analysisEvidenceIds ?? []).map(createEvidenceId),
  });
}
