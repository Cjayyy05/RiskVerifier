import { parseChangedFileStatus, type ChangedFileStatus } from "./enums.js";
import { InvalidInputError } from "./errors.js";
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
import { requireArray, requireNonNegativeInteger } from "./validation.js";

export type DiffLineCount = number | null;

function requireRepositoryRelativePath(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidInputError(`${field} must be a non-empty repository-relative path`, {
      field,
    });
  }
  if (value.includes("\0")) {
    throw new InvalidInputError(`${field} must not contain NUL characters`, { field });
  }
  if (value.startsWith("/") || value.startsWith("//") || /^[A-Za-z]:\//u.test(value)) {
    throw new InvalidInputError(`${field} must be repository-relative`, { field });
  }

  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new InvalidInputError(`${field} must be a normalized repository-relative path`, {
      field,
    });
  }

  return value;
}

function requireBinaryFlag(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new InvalidInputError("isBinary must be a boolean", { field: "isBinary" });
  }
  return value;
}

function requireLineCounts(
  additions: unknown,
  deletions: unknown,
  isBinary: boolean,
): Readonly<{ additions: DiffLineCount; deletions: DiffLineCount }> {
  if (isBinary) {
    if (additions !== null || deletions !== null) {
      throw new InvalidInputError("Binary changes must use null additions and deletions");
    }
    return { additions: null, deletions: null };
  }

  if (additions === null || deletions === null) {
    throw new InvalidInputError("Text changes require numeric additions and deletions");
  }
  return {
    additions: requireNonNegativeInteger(additions, "additions"),
    deletions: requireNonNegativeInteger(deletions, "deletions"),
  };
}

function sumKnownLineCounts(
  changedFiles: readonly ChangedFile[],
  field: "additions" | "deletions",
): number {
  let total = 0;
  for (const file of changedFiles) {
    total += file[field] ?? 0;
    if (!Number.isSafeInteger(total)) {
      throw new InvalidInputError(`Aggregate ${field} exceeds the safe integer range`, { field });
    }
  }
  return total;
}

export interface ChangedFile {
  readonly path: string;
  readonly previousPath?: string;
  readonly status: ChangedFileStatus;
  readonly additions: DiffLineCount;
  readonly deletions: DiffLineCount;
  readonly isBinary: boolean;
}

export function createChangedFile(input: {
  readonly path: unknown;
  readonly previousPath?: unknown;
  readonly status: unknown;
  readonly additions: unknown;
  readonly deletions: unknown;
  readonly isBinary: unknown;
}): ChangedFile {
  const status = parseChangedFileStatus(input.status);
  const previousPath =
    input.previousPath === undefined
      ? undefined
      : requireRepositoryRelativePath(input.previousPath, "previousPath");
  const requiresPreviousPath = status === "RENAMED" || status === "COPIED";
  if (requiresPreviousPath !== (previousPath !== undefined)) {
    throw new InvalidInputError(
      requiresPreviousPath
        ? `${status} changes require previousPath`
        : `${status} changes must not include previousPath`,
      { status },
    );
  }
  const isBinary = requireBinaryFlag(input.isBinary);
  const lineCounts = requireLineCounts(input.additions, input.deletions, isBinary);

  return deepFreeze({
    path: requireRepositoryRelativePath(input.path, "path"),
    ...(previousPath === undefined ? {} : { previousPath }),
    status,
    additions: lineCounts.additions,
    deletions: lineCounts.deletions,
    isBinary,
  });
}

export interface ChangeSet {
  readonly repository: RepositoryIdentity;
  readonly baseCommit: CommitIdentity;
  readonly targetCommit: CommitIdentity;
  readonly analyzerVersion: ComponentVersion;
  readonly changedFiles: readonly ChangedFile[];
  readonly fileCount: number;
  readonly additions: number;
  readonly deletions: number;
  readonly hasUnknownLineCounts: boolean;
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
  const changedFiles = requireArray(input.changedFiles, "changedFiles").map((file) => {
    if (file === null || typeof file !== "object") {
      throw new InvalidInputError("changedFiles must contain changed-file objects");
    }
    const record = file as Readonly<Record<string, unknown>>;
    return createChangedFile({
      path: record.path,
      previousPath: record.previousPath,
      status: record.status,
      additions: record.additions,
      deletions: record.deletions,
      isBinary: record.isBinary,
    });
  });
  const additions = sumKnownLineCounts(changedFiles, "additions");
  const deletions = sumKnownLineCounts(changedFiles, "deletions");

  return deepFreeze({
    repository: createRepositoryIdentity(input.repository),
    baseCommit: createCommitIdentity(input.baseCommit),
    targetCommit: createCommitIdentity(input.targetCommit),
    analyzerVersion: createComponentVersion(input.analyzerVersion),
    changedFiles,
    fileCount: changedFiles.length,
    additions,
    deletions,
    hasUnknownLineCounts: changedFiles.some(
      (file) => file.additions === null || file.deletions === null,
    ),
    analysisEvidenceIds: (input.analysisEvidenceIds ?? []).map(createEvidenceId),
  });
}
