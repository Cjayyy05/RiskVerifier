import {
  createChangeSet,
  InvalidInputError,
  type ChangeSet,
  type ClassificationInspectionPolicy,
} from "../domain/index.js";
import {
  analyzeGitChange,
  createGitChangeAnalysisInput,
  type GitChangeAnalysisInput,
} from "./change-analyzer.js";
import { MalformedGitOutputError } from "./errors.js";
import { runGitCommand, type GitProcessOptions } from "./git-process.js";
import { withObjectView } from "./object-view.js";

export interface CommitFileContent {
  readonly state:
    | "TEXT"
    | "ABSENT"
    | "BINARY"
    | "FILE_LIMIT"
    | "TOTAL_LIMIT"
    | "FILE_COUNT_LIMIT"
    | "INVALID_UTF8"
    | "UNSUPPORTED_TYPE"
    | "NOT_REQUESTED";
  readonly blobId: string | null;
  readonly text?: string;
}
export interface ChangedFileContent {
  readonly base: CommitFileContent;
  readonly target: CommitFileContent;
}
export interface ChangeContentSnapshot {
  readonly changeSet: ChangeSet;
  readonly policy: ClassificationInspectionPolicy;
  readonly files: readonly ChangedFileContent[];
}
export class ClassificationContextMismatchError extends InvalidInputError {
  constructor() {
    super("Classification context or changed-file facts do not match exact Git analysis");
  }
}
export function createInspectionPolicy(
  input: Partial<ClassificationInspectionPolicy> = {},
): ClassificationInspectionPolicy {
  const result = {
    maxFileBytes: input.maxFileBytes ?? 262144,
    maxTotalBytes: input.maxTotalBytes ?? 2097152,
    maxFiles: input.maxFiles ?? 256,
  };
  for (const [key, cap] of [
    ["maxFileBytes", 1048576],
    ["maxTotalBytes", 8388608],
    ["maxFiles", 1024],
  ] as const) {
    if (!Number.isSafeInteger(result[key]) || result[key] < 0 || result[key] > cap)
      throw new InvalidInputError(`Invalid trusted classification limit: ${key}`);
  }
  return Object.freeze(result);
}
function canonical(changeSet: ChangeSet): ChangeSet {
  return createChangeSet({
    ...changeSet,
    changedFiles: [...changeSet.changedFiles].sort((a, b) =>
      Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
    ),
  });
}
function strictText(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new MalformedGitOutputError("Invalid UTF-8 in Git content metadata");
  }
}

/** Revalidates supplied facts, then reads only selected immutable blobs through the Phase 2 boundary. */
export async function readChangeContents(
  input: GitChangeAnalysisInput,
  supplied: ChangeSet,
  select: (path: string) => boolean,
  policyInput: Partial<ClassificationInspectionPolicy> = {},
  options: GitProcessOptions = {},
): Promise<ChangeContentSnapshot> {
  const context = createGitChangeAnalysisInput(input);
  const changeSet = canonical(createChangeSet(supplied));
  if (changeSet.fileCount > 4096)
    throw new InvalidInputError(
      "Classification supports at most 4096 changed files per invocation",
    );
  const policy = createInspectionPolicy(policyInput);
  if (
    context.repository !== changeSet.repository ||
    context.baseCommit !== changeSet.baseCommit ||
    context.targetCommit !== changeSet.targetCommit
  )
    throw new ClassificationContextMismatchError();
  const actual = await analyzeGitChange(context, options);
  if (
    actual.analyzerVersion !== changeSet.analyzerVersion ||
    JSON.stringify(actual.changedFiles) !== JSON.stringify(changeSet.changedFiles)
  )
    throw new ClassificationContextMismatchError();
  return withObjectView(context.repositoryPath, options, async (directory, environment) => {
    let remaining = policy.maxTotalBytes;
    const read = async (
      commit: string,
      filePath: string,
      binary: boolean,
    ): Promise<CommitFileContent> => {
      const entry = await runGitCommand(
        directory,
        ["ls-tree", "-z", "--full-tree", commit, "--", filePath],
        "classification tree lookup",
        options,
        false,
        { ...environment, GIT_LITERAL_PATHSPECS: "1" },
      );
      const record = strictText(entry.stdout);
      const match =
        /^(100644|100755|120000|160000) (blob|commit) ([0-9a-f]{40}|[0-9a-f]{64})\t([^\0]+)\0$/u.exec(
          record,
        );
      if (!match || match[4] !== filePath)
        throw new MalformedGitOutputError(
          "Classification tree lookup did not return the exact file",
        );
      const blobId = match[3] ?? "";
      const result = (state: CommitFileContent["state"]): CommitFileContent =>
        Object.freeze({ state, blobId });
      if (match[1] !== "100644" && match[1] !== "100755") return result("UNSUPPORTED_TYPE");
      if (binary) return result("BINARY");
      if (!select(filePath)) return result("NOT_REQUESTED");
      const sizeOutput = await runGitCommand(
        directory,
        ["cat-file", "-s", blobId],
        "classification blob size",
        options,
        false,
        environment,
      );
      const sizeText = strictText(sizeOutput.stdout);
      if (!/^(0|[1-9][0-9]*)\n$/u.test(sizeText))
        throw new MalformedGitOutputError("Invalid classification blob size");
      const size = Number(sizeText.trim());
      if (!Number.isSafeInteger(size))
        throw new MalformedGitOutputError("Unsafe classification blob size");
      if (size > policy.maxFileBytes) return result("FILE_LIMIT");
      if (size > remaining) return result("TOTAL_LIMIT");
      remaining -= size;
      const content = await runGitCommand(
        directory,
        ["cat-file", "blob", blobId],
        "classification blob read",
        {
          ...options,
          maxOutputBytes: Math.min(options.maxOutputBytes ?? 16777216, policy.maxFileBytes + 1),
        },
        false,
        environment,
      );
      if (content.stdout.length !== size)
        throw new MalformedGitOutputError("Classification blob size changed");
      if (content.stdout.includes(0)) return result("BINARY");
      try {
        return Object.freeze({
          state: "TEXT",
          blobId,
          text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content.stdout),
        });
      } catch {
        return result("INVALID_UTF8");
      }
    };
    const files: ChangedFileContent[] = [];
    for (const [index, file] of changeSet.changedFiles.entries()) {
      const absent: CommitFileContent = Object.freeze({ state: "ABSENT", blobId: null });
      const limited: CommitFileContent = Object.freeze({ state: "FILE_COUNT_LIMIT", blobId: null });
      const base =
        file.status === "ADDED"
          ? absent
          : index >= policy.maxFiles
            ? limited
            : await read(context.baseCommit, file.previousPath ?? file.path, file.isBinary);
      const target =
        file.status === "DELETED"
          ? absent
          : index >= policy.maxFiles
            ? limited
            : await read(context.targetCommit, file.path, file.isBinary);
      files.push(Object.freeze({ base, target }));
    }
    return Object.freeze({ changeSet, policy, files: Object.freeze(files) });
  });
}
