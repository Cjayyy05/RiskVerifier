export type GitAnalyzerErrorCode =
  | "GIT_REPOSITORY_PATH_INVALID"
  | "GIT_REPOSITORY_NOT_FOUND"
  | "GIT_REPOSITORY_NOT_DIRECTORY"
  | "GIT_NOT_REPOSITORY"
  | "GIT_REPOSITORY_UNSUPPORTED"
  | "GIT_WORKSPACE_FAILED"
  | "GIT_EXECUTABLE_UNAVAILABLE"
  | "GIT_COMMIT_NOT_FOUND"
  | "GIT_OBJECT_NOT_COMMIT"
  | "GIT_COMMAND_FAILED"
  | "GIT_OUTPUT_MALFORMED"
  | "GIT_CHANGE_UNSUPPORTED"
  | "GIT_OUTPUT_LIMIT_EXCEEDED"
  | "GIT_TIMEOUT"
  | "GIT_CANCELLED";

export abstract class GitAnalyzerError extends Error {
  public readonly code: GitAnalyzerErrorCode;
  public readonly details: Readonly<Record<string, unknown>>;

  protected constructor(
    code: GitAnalyzerErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export class GitRepositoryPathError extends GitAnalyzerError {
  public constructor(message: string) {
    super("GIT_REPOSITORY_PATH_INVALID", message);
  }
}

export class GitRepositoryNotFoundError extends GitAnalyzerError {
  public constructor() {
    super("GIT_REPOSITORY_NOT_FOUND", "Repository path does not exist");
  }
}

export class GitRepositoryNotDirectoryError extends GitAnalyzerError {
  public constructor() {
    super("GIT_REPOSITORY_NOT_DIRECTORY", "Repository path is not a directory");
  }
}

export class NotGitRepositoryError extends GitAnalyzerError {
  public constructor() {
    super("GIT_NOT_REPOSITORY", "Repository path is not the root of a usable Git repository");
  }
}

export class GitExecutableUnavailableError extends GitAnalyzerError {
  public constructor() {
    super("GIT_EXECUTABLE_UNAVAILABLE", "Git executable is unavailable");
  }
}

export class UnsupportedGitRepositoryError extends GitAnalyzerError {
  public constructor(reason: string) {
    super("GIT_REPOSITORY_UNSUPPORTED", "Repository storage is unsupported", { reason });
  }
}

export class GitWorkspaceError extends GitAnalyzerError {
  public constructor(operation: "setup" | "cleanup") {
    super("GIT_WORKSPACE_FAILED", "Temporary Git metadata workspace failed", { operation });
  }
}

export class GitCommitNotFoundError extends GitAnalyzerError {
  public constructor(role: "base" | "target", objectId: string) {
    super("GIT_COMMIT_NOT_FOUND", `${role} commit does not exist in the repository`, {
      role,
      objectId,
    });
  }
}

export class GitObjectNotCommitError extends GitAnalyzerError {
  public constructor(role: "base" | "target", objectId: string, objectType: string) {
    super("GIT_OBJECT_NOT_COMMIT", `${role} object is not a commit`, {
      role,
      objectId,
      objectType,
    });
  }
}

export class GitCommandFailedError extends GitAnalyzerError {
  public constructor(operation: string, exitCode: number | null) {
    super("GIT_COMMAND_FAILED", `Git ${operation} failed`, { operation, exitCode });
  }
}

export class MalformedGitOutputError extends GitAnalyzerError {
  public constructor(message: string) {
    super("GIT_OUTPUT_MALFORMED", message);
  }
}

export class UnsupportedGitChangeError extends GitAnalyzerError {
  public constructor(status: string) {
    super("GIT_CHANGE_UNSUPPORTED", "Git reported an unsupported change status", { status });
  }
}

export class GitOutputLimitError extends GitAnalyzerError {
  public constructor(operation: string, maximumBytes: number) {
    super("GIT_OUTPUT_LIMIT_EXCEEDED", `Git ${operation} exceeded its output limit`, {
      operation,
      maximumBytes,
    });
  }
}

export class GitTimeoutError extends GitAnalyzerError {
  public constructor(operation: string, timeoutMs: number) {
    super("GIT_TIMEOUT", `Git ${operation} timed out`, { operation, timeoutMs });
  }
}

export class GitCancelledError extends GitAnalyzerError {
  public constructor(operation: string) {
    super("GIT_CANCELLED", `Git ${operation} was cancelled`, { operation });
  }
}
