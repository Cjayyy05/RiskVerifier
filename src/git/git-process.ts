import os from "node:os";

import { BoundedProcessError, runBoundedProcess } from "./bounded-process.js";
import {
  GitCancelledError,
  GitCommandFailedError,
  GitExecutableUnavailableError,
  GitOutputLimitError,
  GitTimeoutError,
} from "./errors.js";

export const DEFAULT_GIT_TIMEOUT_MS = 30_000;
export const DEFAULT_GIT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

function nullDevicePath(): string {
  return process.platform === "win32" ? "NUL" : os.devNull;
}

export interface GitProcessOptions {
  readonly gitExecutable?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
}

export interface GitCommandResult {
  readonly exitCode: number | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive safe integer`);
  }
  return value;
}

function createGitEnvironment(overrides: Readonly<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    GCM_INTERACTIVE: "Never",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: nullDevicePath(),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
    PAGER: "cat",
    TERM: "dumb",
  };

  const inheritedNames = ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP"];
  for (const name of inheritedNames) {
    const value = process.env[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  return environment;
}

export async function runGitCommand(
  repositoryPath: string,
  arguments_: readonly string[],
  operation: string,
  options: GitProcessOptions = {},
  allowNonZero = false,
  environmentOverrides: Readonly<NodeJS.ProcessEnv> = {},
  input?: string,
): Promise<GitCommandResult> {
  const timeoutMs = positiveSafeInteger(options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS, "timeoutMs");
  if (timeoutMs > 2_147_483_647) {
    throw new RangeError("timeoutMs exceeds the supported timer range");
  }
  const maxOutputBytes = positiveSafeInteger(
    options.maxOutputBytes ?? DEFAULT_GIT_MAX_OUTPUT_BYTES,
    "maxOutputBytes",
  );
  const executable = options.gitExecutable ?? "git";
  if (executable.length === 0 || executable.includes("\0")) {
    throw new GitExecutableUnavailableError();
  }

  const gitArguments = [
    "--no-pager",
    "--no-replace-objects",
    "--no-lazy-fetch",
    ...(environmentOverrides.GIT_ATTR_SOURCE === undefined
      ? []
      : [`--attr-source=${environmentOverrides.GIT_ATTR_SOURCE}`]),
    "-c",
    "color.ui=false",
    "-c",
    "core.fsmonitor=false",
    "-c",
    `core.attributesFile=${nullDevicePath()}`,
    "-c",
    "core.quotepath=false",
    "-c",
    "credential.helper=",
    "-c",
    "protocol.allow=never",
    "-C",
    repositoryPath,
    ...arguments_,
  ];

  try {
    const result = await runBoundedProcess(executable, gitArguments, {
      timeoutMs,
      maxOutputBytes,
      environment: createGitEnvironment(environmentOverrides),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(input === undefined ? {} : { input }),
    });
    if (!allowNonZero && result.exitCode !== 0) {
      throw new GitCommandFailedError(operation, result.exitCode);
    }
    return result;
  } catch (error) {
    if (!(error instanceof BoundedProcessError)) {
      throw error;
    }
    switch (error.kind) {
      case "CANCELLED":
        throw new GitCancelledError(operation);
      case "OUTPUT_LIMIT":
        throw new GitOutputLimitError(operation, maxOutputBytes);
      case "TIMEOUT":
        throw new GitTimeoutError(operation, timeoutMs);
      case "SPAWN":
        throw new GitExecutableUnavailableError();
    }
  }
}
