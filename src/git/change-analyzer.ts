import { realpath, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";

import {
  createChangeSet,
  createChangedFile,
  createCommitIdentity,
  createRepositoryIdentity,
  type ChangeSet,
  type CommitIdentity,
  type RepositoryIdentity,
} from "../domain/index.js";

import { parseGitDiff } from "./diff-parser.js";
import {
  GitCommitNotFoundError,
  GitCommandFailedError,
  GitObjectNotCommitError,
  GitRepositoryNotDirectoryError,
  GitRepositoryNotFoundError,
  GitRepositoryPathError,
  MalformedGitOutputError,
  NotGitRepositoryError,
} from "./errors.js";
import { runGitCommand, type GitProcessOptions } from "./git-process.js";
import { withObjectView } from "./object-view.js";

export const GIT_CHANGE_ANALYZER_VERSION = "2.1.0";

export interface GitChangeAnalysisInput {
  readonly repositoryPath: string;
  readonly repository: RepositoryIdentity;
  readonly baseCommit: CommitIdentity;
  readonly targetCommit: CommitIdentity;
}

export function createGitChangeAnalysisInput(input: {
  readonly repositoryPath: unknown;
  readonly repository: unknown;
  readonly baseCommit: unknown;
  readonly targetCommit: unknown;
}): GitChangeAnalysisInput {
  if (
    typeof input.repositoryPath !== "string" ||
    input.repositoryPath.trim().length === 0 ||
    input.repositoryPath.includes("\0")
  ) {
    throw new GitRepositoryPathError("repositoryPath must be a non-empty filesystem path");
  }

  return Object.freeze({
    repositoryPath: path.resolve(input.repositoryPath),
    repository: createRepositoryIdentity(input.repository),
    baseCommit: createCommitIdentity(input.baseCommit),
    targetCommit: createCommitIdentity(input.targetCommit),
  });
}

function decodeText(output: Buffer, label: string): string {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(output);
  } catch {
    throw new MalformedGitOutputError(`Git ${label} output contains invalid UTF-8`);
  }
  const withoutTerminator = decoded.endsWith("\r\n")
    ? decoded.slice(0, -2)
    : decoded.endsWith("\n")
      ? decoded.slice(0, -1)
      : decoded;
  if (withoutTerminator.length === 0 || /[\r\n]/u.test(withoutTerminator)) {
    throw new MalformedGitOutputError(`Git ${label} output is not a single non-empty line`);
  }
  return withoutTerminator;
}

function systemErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

async function pathsIdentifySameDirectory(first: string, second: string): Promise<boolean> {
  const [firstStat, secondStat] = await Promise.all([
    stat(first, { bigint: true }),
    stat(second, { bigint: true }),
  ]);
  return (
    firstStat.isDirectory() &&
    secondStat.isDirectory() &&
    firstStat.dev === secondStat.dev &&
    firstStat.ino === secondStat.ino
  );
}

async function validateRepositoryPath(repositoryPath: string): Promise<string> {
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(repositoryPath);
  } catch (error) {
    if (systemErrorCode(error) === "ENOENT") {
      throw new GitRepositoryNotFoundError();
    }
    throw new GitRepositoryPathError("Repository path could not be resolved");
  }

  let repositoryStat: Stats;
  try {
    repositoryStat = await stat(canonicalPath);
  } catch {
    throw new GitRepositoryPathError("Repository path could not be inspected");
  }
  if (!repositoryStat.isDirectory()) {
    throw new GitRepositoryNotDirectoryError();
  }
  return canonicalPath;
}

async function validateRepositoryRoot(
  repositoryPath: string,
  options: GitProcessOptions,
): Promise<void> {
  const bareResult = await runGitCommand(
    repositoryPath,
    ["rev-parse", "--is-bare-repository"],
    "repository validation",
    options,
    true,
  );
  if (bareResult.exitCode !== 0) {
    if (bareResult.exitCode !== 128) {
      throw new GitCommandFailedError("repository validation", bareResult.exitCode);
    }
    throw new NotGitRepositoryError();
  }

  const isBareText = decodeText(bareResult.stdout, "repository validation");
  if (isBareText !== "true" && isBareText !== "false") {
    throw new MalformedGitOutputError("Git returned an invalid bare-repository indicator");
  }
  const rootResult = await runGitCommand(
    repositoryPath,
    isBareText === "true" ? ["rev-parse", "--absolute-git-dir"] : ["rev-parse", "--show-toplevel"],
    "repository root validation",
    options,
    true,
  );
  if (rootResult.exitCode !== 0) {
    throw new NotGitRepositoryError();
  }

  const reportedRoot = decodeText(rootResult.stdout, "repository root validation");
  try {
    const canonicalReportedRoot = await realpath(reportedRoot);
    if (!(await pathsIdentifySameDirectory(repositoryPath, canonicalReportedRoot))) {
      throw new NotGitRepositoryError();
    }
  } catch (error) {
    if (error instanceof NotGitRepositoryError) {
      throw error;
    }
    throw new NotGitRepositoryError();
  }
}

async function validateCommit(
  repositoryPath: string,
  objectId: CommitIdentity,
  role: "base" | "target",
  options: GitProcessOptions,
  environment: Readonly<NodeJS.ProcessEnv>,
): Promise<void> {
  const result = await runGitCommand(
    repositoryPath,
    ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
    `${role} commit validation`,
    options,
    false,
    environment,
    `${objectId}\n`,
  );
  const record = decodeText(result.stdout, `${role} object type`);
  // Batch lookup can report "missing" with exit zero after diagnosing a corrupt object.
  // Preserve a non-success category without publishing or parsing arbitrary stderr text.
  if (result.stderr.length > 0) {
    throw new GitCommandFailedError(`${role} commit validation`, result.exitCode);
  }
  if (record === `${objectId} missing`) {
    throw new GitCommitNotFoundError(role, objectId);
  }
  const [reportedId, objectType, extra] = record.split(" ");
  if (
    reportedId !== objectId ||
    extra !== undefined ||
    !["commit", "tree", "blob", "tag"].includes(objectType ?? "")
  ) {
    throw new MalformedGitOutputError("Git object lookup returned an invalid record");
  }
  if (objectType !== "commit") {
    throw new GitObjectNotCommitError(role, objectId, objectType ?? "unknown");
  }
}

export async function analyzeGitChange(
  input: GitChangeAnalysisInput,
  options: GitProcessOptions = {},
): Promise<ChangeSet> {
  const validatedInput = createGitChangeAnalysisInput(input);
  const repositoryPath = await validateRepositoryPath(validatedInput.repositoryPath);
  await validateRepositoryRoot(repositoryPath, options);
  return withObjectView(repositoryPath, options, async (objectView, environment) => {
    await validateCommit(objectView, validatedInput.baseCommit, "base", options, environment);
    await validateCommit(objectView, validatedInput.targetCommit, "target", options, environment);

    const sharedDiffArguments = [
      "--no-ext-diff",
      "--no-textconv",
      "--diff-algorithm=myers",
      "--no-indent-heuristic",
      "--find-renames=50%",
      "--find-copies=50%",
      "-l1000",
      "--ignore-submodules=none",
    ];
    const revisionsAndTerminator = [validatedInput.baseCommit, validatedInput.targetCommit, "--"];
    const nameStatus = await runGitCommand(
      objectView,
      ["diff", ...sharedDiffArguments, "--name-status", "-z", ...revisionsAndTerminator],
      "name-status diff",
      options,
      false,
      { ...environment, GIT_ATTR_SOURCE: validatedInput.targetCommit },
    );
    const numstat = await runGitCommand(
      objectView,
      ["diff", ...sharedDiffArguments, "--numstat", "-z", ...revisionsAndTerminator],
      "numstat diff",
      options,
      false,
      { ...environment, GIT_ATTR_SOURCE: validatedInput.targetCommit },
    );
    const parsedChanges = parseGitDiff(nameStatus.stdout, numstat.stdout);
    const changedFiles = parsedChanges.map((change) => createChangedFile(change));

    return createChangeSet({
      repository: validatedInput.repository,
      baseCommit: validatedInput.baseCommit,
      targetCommit: validatedInput.targetCommit,
      analyzerVersion: GIT_CHANGE_ANALYZER_VERSION,
      changedFiles,
    });
  });
}
