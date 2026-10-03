import { spawn } from "node:child_process";
import type { ExecutionDefinition } from "./configuration.js";
import { noProcess, type ProcessObservation, type ProcessOutcome } from "./result.js";

/** Internal port payload, reachable in production only after executor intake validation. */
export interface ApprovedInvocation {
  readonly definition: ExecutionDefinition;
  readonly directory: string;
  readonly environment: Readonly<Record<string, string>>;
}
export interface ProcessRunner {
  run(invocation: ApprovedInvocation, signal?: AbortSignal): Promise<ProcessObservation>;
}
const TERMINATION_GRACE_MS = 2000;

/** Owns verification subprocesses only. Not a Git adapter or an operating-system sandbox. */
export const boundedExecution: ProcessRunner = Object.freeze({
  run(invocation: ApprovedInvocation, signal?: AbortSignal): Promise<ProcessObservation> {
    if (signal?.aborted) return Promise.resolve(noProcess("CANCELLED"));
    return new Promise((resolve) => {
      const began = performance.now();
      const { definition } = invocation;
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(definition.executable, ["--", ...definition.args], {
          cwd: invocation.directory,
          env: invocation.environment,
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        resolve(noProcess("START_ERROR"));
        return;
      }
      let started = false;
      let exited = false;
      let settled = false;
      let failure: ProcessOutcome | null = null;
      let exitCode: number | null = null;
      let terminationSignal: string | null = null;
      let observedBytes = 0;
      let retained = 0;
      // Fixed capacity: fragmented output cannot accumulate unbounded per-chunk objects.
      const stdout = Buffer.alloc(definition.maxOutputBytes);
      const stderr = Buffer.alloc(definition.maxOutputBytes);
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let grace: ReturnType<typeof setTimeout> | undefined;
      const cleanup = (): void => {
        clearTimeout(timeout);
        clearTimeout(grace);
        signal?.removeEventListener("abort", cancel);
        child.stdout?.removeListener("data", captureOut);
        child.stderr?.removeListener("data", captureErr);
      };
      const finish = (outcome: ProcessOutcome): void => {
        if (settled) return;
        settled = true;
        cleanup();
        const out = stdout.subarray(0, stdoutBytes);
        const err = stderr.subarray(0, stderrBytes);
        resolve({
          outcome,
          started,
          exitCode,
          terminationSignal,
          durationMs: Math.ceil(performance.now() - began),
          terminationConfirmed: outcome !== "TERMINATION_UNCONFIRMED",
          diagnostics: {
            encoding: "base64",
            stdout: out.toString("base64"),
            stderr: err.toString("base64"),
            stdoutBytes: out.length,
            stderrBytes: err.length,
            observedBytes,
            truncated: observedBytes > retained,
            sensitivity: "SENSITIVE",
          },
        });
      };
      const boundCloseWait = (): void => {
        grace ??= setTimeout(() => {
          // A descendant holding pipes or host termination failure cannot become success.
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish("TERMINATION_UNCONFIRMED");
        }, TERMINATION_GRACE_MS);
      };
      const stop = (outcome: ProcessOutcome): void => {
        if (settled || failure !== null) return;
        failure = outcome;
        boundCloseWait();
        try {
          child.kill("SIGKILL");
        } catch {
          /* Grace records unconfirmed termination. */
        }
      };
      const capture = (destination: Buffer, offset: number, chunk: Buffer): number => {
        if (settled) return offset;
        observedBytes = Math.min(Number.MAX_SAFE_INTEGER, observedBytes + chunk.length);
        const keep = Math.min(chunk.length, definition.maxOutputBytes - retained);
        if (keep > 0) {
          chunk.copy(destination, offset, 0, keep);
          retained += keep;
        }
        if (observedBytes > definition.maxOutputBytes) stop("OUTPUT_LIMIT");
        return offset + keep;
      };
      const captureOut = (chunk: Buffer): void => {
        stdoutBytes = capture(stdout, stdoutBytes, chunk);
      };
      const captureErr = (chunk: Buffer): void => {
        stderrBytes = capture(stderr, stderrBytes, chunk);
      };
      const cancel = (): void => {
        if (!exited) stop("CANCELLED");
      };
      const timeout = setTimeout(() => stop("TIMEOUT"), definition.timeoutMs);
      child.stdout!.on("data", captureOut);
      child.stderr!.on("data", captureErr);
      child.stdout!.on("error", () => stop("PROCESS_ERROR"));
      child.stderr!.on("error", () => stop("PROCESS_ERROR"));
      child.once("spawn", () => {
        started = true;
      });
      child.on("error", () => stop(started ? "PROCESS_ERROR" : "START_ERROR"));
      child.once("exit", (code, processSignal) => {
        exited = true;
        exitCode = code;
        terminationSignal = processSignal;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", cancel);
        boundCloseWait();
      });
      child.once("close", (code, processSignal) => {
        if (settled) return;
        exitCode = code;
        terminationSignal = processSignal;
        // Failed starts can report a negative libuv code; it is not a program exit.
        if (!started) {
          exitCode = null;
          terminationSignal = null;
        }
        finish(failure ?? (code !== null && processSignal === null ? "EXITED" : "PROCESS_ERROR"));
      });
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
    });
  },
});
