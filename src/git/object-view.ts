import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  GitWorkspaceError,
  MalformedGitOutputError,
  UnsupportedGitRepositoryError,
} from "./errors.js";
import { runGitCommand, type GitProcessOptions } from "./git-process.js";

async function removeWorkspace(directory: string): Promise<void> {
  try {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    throw new GitWorkspaceError("cleanup");
  }
}

/** A private bare metadata directory: no source config, refs, index or info/attributes. */
export async function withObjectView<T>(
  repositoryPath: string,
  options: GitProcessOptions,
  action: (directory: string, environment: Readonly<NodeJS.ProcessEnv>) => Promise<T>,
): Promise<T> {
  const formatResult = await runGitCommand(
    repositoryPath,
    ["rev-parse", "--show-object-format"],
    "object format",
    options,
  );
  const format = formatResult.stdout.toString("ascii").trim();
  if (format !== "sha1" && format !== "sha256") {
    throw new MalformedGitOutputError("Git returned an unsupported object format");
  }
  const location = await runGitCommand(
    repositoryPath,
    ["rev-parse", "--path-format=absolute", "--git-path", "objects"],
    "object directory",
    options,
  );
  let objectDirectory: string;
  try {
    const reported = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      location.stdout,
    );
    if (!reported.endsWith("\n") || reported.includes("\0")) {
      throw new Error("Invalid terminator");
    }
    objectDirectory = await realpath(reported.replace(/\r?\n$/u, ""));
  } catch {
    throw new MalformedGitOutputError("Git object directory could not be resolved");
  }
  // Alternates can traverse arbitrary object stores. Acquisition must provide a self-contained DB.
  for (const name of ["alternates", "http-alternates"]) {
    try {
      await lstat(path.join(objectDirectory, "info", name));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw new UnsupportedGitRepositoryError("OBJECT_STORAGE_UNREADABLE");
    }
    throw new UnsupportedGitRepositoryError("ALTERNATE_OBJECT_STORE");
  }

  let directory: string;
  try {
    directory = await mkdtemp(path.join(os.tmpdir(), "riskverifier-analysis-"));
  } catch {
    throw new GitWorkspaceError("setup");
  }
  try {
    try {
      await mkdir(path.join(directory, "refs"));
      await mkdir(path.join(directory, "objects"));
      await writeFile(path.join(directory, "HEAD"), "ref: refs/heads/unused\n");
      await writeFile(
        path.join(directory, "config"),
        `[core]\n\tbare = true\n\trepositoryformatversion = ${format === "sha256" ? 1 : 0}\n` +
          (format === "sha256" ? "[extensions]\n\tobjectformat = sha256\n" : ""),
      );
    } catch {
      throw new GitWorkspaceError("setup");
    }
    return await action(directory, { GIT_OBJECT_DIRECTORY: objectDirectory });
  } finally {
    // This exact path was allocated by mkdtemp and never comes from repository content.
    await removeWorkspace(directory);
  }
}
