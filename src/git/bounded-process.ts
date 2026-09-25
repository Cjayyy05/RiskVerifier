import { spawn } from "node:child_process";

export type BoundedProcessFailureKind = "CANCELLED" | "OUTPUT_LIMIT" | "SPAWN" | "TIMEOUT";

export class BoundedProcessError extends Error {
  public readonly kind: BoundedProcessFailureKind;
  public readonly causeCode: string | undefined;

  public constructor(kind: BoundedProcessFailureKind, message: string, causeCode?: string) {
    super(message);
    this.name = new.target.name;
    this.kind = kind;
    this.causeCode = causeCode;
  }
}

export interface BoundedProcessOptions {
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly environment: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly input?: string;
}

export interface BoundedProcessResult {
  readonly exitCode: number | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

export function runBoundedProcess(
  executable: string,
  arguments_: readonly string[],
  options: BoundedProcessOptions,
): Promise<BoundedProcessResult> {
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    options.timeoutMs > 2_147_483_647
  ) {
    return Promise.reject(new RangeError("timeoutMs must be between 1 and 2147483647"));
  }
  if (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes <= 0) {
    return Promise.reject(new RangeError("maxOutputBytes must be a positive safe integer"));
  }
  if (options.signal?.aborted === true) {
    return Promise.reject(new BoundedProcessError("CANCELLED", "Process was cancelled"));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      env: options.environment,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let capturedBytes = 0;
    let failure: BoundedProcessError | undefined;
    let settled = false;

    const stop = (error: BoundedProcessError): void => {
      if (!settled && failure === undefined) {
        failure = error;
        child.kill("SIGKILL");
      }
    };
    const capture = (destination: Buffer[], chunk: Buffer): void => {
      if (settled || failure !== undefined) {
        return;
      }
      capturedBytes += chunk.length;
      if (capturedBytes > options.maxOutputBytes) {
        stop(new BoundedProcessError("OUTPUT_LIMIT", "Process output limit exceeded"));
        return;
      }
      destination.push(chunk);
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
    };
    const finishReject = (error: Error): void => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    };
    const cancel = (): void => {
      stop(new BoundedProcessError("CANCELLED", "Process was cancelled"));
    };
    const timeout = setTimeout(() => {
      stop(new BoundedProcessError("TIMEOUT", "Process timed out"));
    }, options.timeoutMs);

    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted === true) {
      cancel();
    }
    child.stdout.on("data", (chunk: Buffer) => capture(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => capture(stderr, chunk));
    // An early child exit can close stdin before our small lookup request is written.
    child.stdin.on("error", () => {
      stop(new BoundedProcessError("SPAWN", "Process input could not be written"));
    });
    child.stdin.end(options.input);
    child.once("error", (error: NodeJS.ErrnoException) => {
      finishReject(
        failure ?? new BoundedProcessError("SPAWN", "Process could not be started", error.code),
      );
    });
    child.once("close", (exitCode) => {
      if (settled) {
        return;
      }
      if (failure !== undefined) {
        finishReject(failure);
        return;
      }
      settled = true;
      cleanup();
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
  });
}
