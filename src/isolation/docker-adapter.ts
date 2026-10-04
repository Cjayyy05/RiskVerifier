import { spawn } from "node:child_process";
import { noProcess, type ProcessObservation } from "../execution/result.js";
import { InvalidInputError } from "../domain/index.js";
import type { ContainerDefinition, IsolationConfiguration } from "./configuration.js";
import { createArguments } from "./configuration.js";
import { validateAppliedProfile, type AppliedProfile } from "./inspection.js";

export interface DockerHost {
  readonly executable: string;
  readonly endpoint: string;
  readonly directory: string;
  readonly environment: Readonly<Record<string, string>>;
}
export interface CliResult {
  readonly code: number | null;
  readonly confirmed: boolean;
  readonly cause: "TIMEOUT" | "CANCELLED" | "OUTPUT_LIMIT" | "ERROR" | null;
  readonly diagnostics: ProcessObservation["diagnostics"];
}
export interface DockerTransport {
  run(
    host: DockerHost,
    args: readonly string[],
    limit: number,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<CliResult>;
}
/** Internal port, not exported by the public isolation entry. Sole Docker subprocess owner. */
export const dockerTransport: DockerTransport = Object.freeze({
  run(
    host: DockerHost,
    args: readonly string[],
    limit: number,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<CliResult> {
    return new Promise((resolve) => {
      const out = Buffer.alloc(limit),
        err = Buffer.alloc(limit);
      let outSize = 0,
        errSize = 0,
        observed = 0,
        cause: CliResult["cause"] = null,
        settled = false;
      let grace: ReturnType<typeof setTimeout> | undefined;
      const child = spawn(
        host.executable,
        ["--config", host.directory, "--host", host.endpoint, ...args],
        {
          cwd: host.directory,
          env: host.environment,
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const finish = (code: number | null, confirmed: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(grace);
        signal?.removeEventListener("abort", abort);
        child.stdout.removeAllListeners("data");
        child.stderr.removeAllListeners("data");
        child.stdout.destroy();
        child.stderr.destroy();
        resolve({
          code,
          confirmed,
          cause,
          diagnostics: {
            encoding: "base64",
            stdout: out.subarray(0, outSize).toString("base64"),
            stderr: err.subarray(0, errSize).toString("base64"),
            stdoutBytes: outSize,
            stderrBytes: errSize,
            observedBytes: observed,
            truncated: observed > outSize + errSize,
            sensitivity: "SENSITIVE",
          },
        });
      };
      const stop = (reason: NonNullable<CliResult["cause"]>): void => {
        if (settled || cause) return;
        cause = reason;
        try {
          child.kill("SIGKILL");
        } catch {
          /* Bounded grace fails closed. */
        }
        grace = setTimeout(() => finish(null, false), 2000);
      };
      const capture = (chunk: Buffer, stdout: boolean): void => {
        observed = Math.min(Number.MAX_SAFE_INTEGER, observed + chunk.length);
        const keep = Math.min(chunk.length, limit - outSize - errSize);
        if (stdout) {
          chunk.copy(out, outSize, 0, keep);
          outSize += keep;
        } else {
          chunk.copy(err, errSize, 0, keep);
          errSize += keep;
        }
        if (observed > limit) stop("OUTPUT_LIMIT");
      };
      const abort = (): void => stop("CANCELLED");
      const timer = setTimeout(() => stop("TIMEOUT"), Math.max(1, timeout));
      child.stdout.on("data", (chunk: Buffer) => capture(chunk, true));
      child.stderr.on("data", (chunk: Buffer) => capture(chunk, false));
      child.stdout.on("error", () => stop("ERROR"));
      child.stderr.on("error", () => stop("ERROR"));
      child.on("error", () => stop("ERROR"));
      child.once("close", (code, exitSignal) => {
        if (exitSignal !== null) cause ??= "ERROR";
        finish(exitSignal === null ? code : null, true);
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  },
});
export interface ContainerObservation {
  readonly observation: ProcessObservation;
  readonly containerId: string | null;
  readonly instance: string;
  readonly imageId: string;
  readonly repositoryDigest: string;
  readonly oomKilled: boolean;
  readonly removed: boolean;
  readonly runtimeVersion: string | null;
  readonly appliedProfile: AppliedProfile | null;
}
const idPattern = /^[a-f0-9]{64}$/u;
function json(result: CliResult): unknown {
  if (result.code !== 0 || result.cause || !result.confirmed)
    throw new InvalidInputError("Docker operation failed");
  return JSON.parse(Buffer.from(result.diagnostics.stdout, "base64").toString("utf8")) as unknown;
}
interface State {
  Status: string;
  Running: boolean;
  Paused: boolean;
  Restarting: boolean;
  Dead: boolean;
  ExitCode: number;
  OOMKilled: boolean;
  Error: string;
  StartedAt: string;
  FinishedAt: string;
  Pid: number;
}
function state(value: unknown): State {
  if (!value || typeof value !== "object") throw new InvalidInputError("Invalid Docker state");
  const s = value as State;
  if (
    !["created", "running", "paused", "restarting", "removing", "exited", "dead"].includes(
      s.Status,
    ) ||
    [s.Running, s.Paused, s.Restarting, s.Dead, s.OOMKilled].some((v) => typeof v !== "boolean") ||
    !Number.isSafeInteger(s.ExitCode) ||
    s.ExitCode < 0 ||
    s.ExitCode > 255 ||
    !Number.isSafeInteger(s.Pid) ||
    s.Pid < 0 ||
    typeof s.Error !== "string" ||
    typeof s.StartedAt !== "string" ||
    typeof s.FinishedAt !== "string"
  )
    throw new InvalidInputError("Invalid Docker state");
  return s;
}
function normalExit(s: State): boolean {
  const timestamp = (value: string): boolean =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value) &&
    !value.startsWith("0001-") &&
    Number.isFinite(Date.parse(value));
  return (
    s.Status === "exited" &&
    !s.Running &&
    !s.Paused &&
    !s.Restarting &&
    !s.Dead &&
    !s.OOMKilled &&
    s.Error === "" &&
    s.Pid === 0 &&
    timestamp(s.StartedAt) &&
    timestamp(s.FinishedAt) &&
    Date.parse(s.FinishedAt) >= Date.parse(s.StartedAt)
  );
}
/** Explicit lifecycle. CLI termination is never treated as proof of container termination. */
export async function runContainer(
  host: DockerHost,
  config: IsolationConfiguration,
  definition: ContainerDefinition,
  source: string,
  instance: string,
  signal?: AbortSignal,
  transport: DockerTransport = dockerTransport,
): Promise<ContainerObservation> {
  const began = performance.now(),
    deadline = began + definition.timeoutMs;
  let containerId: string | null = null,
    started = false,
    removed = false,
    oomKilled = false,
    runtimeVersion: string | null = null;
  let appliedProfile: AppliedProfile | null = null;
  let acceptedExit: State | null = null;
  let uncertain = false,
    createAttempted = false,
    observation = noProcess("PROCESS_ERROR");
  let firstStop: "TIMEOUT" | "CANCELLED" | null = null;
  const stopController = new AbortController();
  const abort = (): void => {
    firstStop ??= "CANCELLED";
    stopController.abort();
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => {
    firstStop ??= "TIMEOUT";
    stopController.abort();
  }, definition.timeoutMs);
  const call = async (
    args: readonly string[],
    cleanup = false,
    output = 65536,
  ): Promise<CliResult> => {
    if (!cleanup && (firstStop || performance.now() >= deadline))
      throw new InvalidInputError("Execution stopped");
    const result = await transport.run(
      host,
      args,
      output,
      cleanup
        ? 5000
        : Math.max(
            1,
            Math.min(
              args[1] === "start" ? definition.timeoutMs : 10000,
              deadline - performance.now(),
            ),
          ),
      cleanup ? undefined : stopController.signal,
    );
    if (!result.confirmed) uncertain = true;
    if (!cleanup && result.cause === "CANCELLED") firstStop ??= "CANCELLED";
    if (!cleanup && result.cause === "TIMEOUT") firstStop ??= "TIMEOUT";
    return result;
  };
  const inspect = async (): Promise<State> => {
    if (!containerId || !idPattern.test(containerId))
      throw new InvalidInputError("No exact container ID");
    const inspected = json(
      await call(["container", "inspect", "--format", "{{json .}}", containerId], true),
    ) as { Id: string; Config: { Image: string; Labels: Record<string, string> }; State: unknown };
    if (
      inspected.Id !== containerId ||
      inspected.Config?.Image !== config.imageId ||
      inspected.Config.Labels?.["riskverifier.instance"] !== instance
    )
      throw new InvalidInputError("Container identity mismatch");
    appliedProfile = validateAppliedProfile(inspected, config, definition, source, instance);
    return state(inspected.State);
  };
  try {
    if (firstStop) {
      observation = noProcess("CANCELLED");
    } else {
      const version = json(await call(["version", "--format", "{{json .Server}} "])) as {
        Os?: string;
        Arch?: string;
        Version?: string;
      };
      if (
        version?.Os !== "linux" ||
        version.Arch !== "amd64" ||
        typeof version.Version !== "string"
      )
        throw new InvalidInputError("Linux amd64 daemon required");
      runtimeVersion = version.Version;
      const image = json(
        await call(["image", "inspect", "--format", "{{json .}}", config.imageId]),
      ) as {
        Id: string;
        Os: string;
        Architecture: string;
        RepoDigests: string[];
        Config: { Volumes: unknown; Env: string[] };
      };
      if (
        image.Id !== config.imageId ||
        image.Os !== "linux" ||
        image.Architecture !== "amd64" ||
        !image.RepoDigests?.includes(config.repositoryDigest) ||
        (image.Config?.Volumes && Object.keys(image.Config.Volumes).length > 0) ||
        !Array.isArray(image.Config?.Env) ||
        image.Config.Env.some((entry) => !/^(PATH|NODE_VERSION|YARN_VERSION)=/u.test(entry))
      )
        throw new InvalidInputError("Image metadata differs from approved authority");
      const args = createArguments(config, definition, source, instance);
      createAttempted = true;
      const created = await call(args);
      if (created.code !== 0 || created.cause || !created.confirmed)
        throw new InvalidInputError("Container create failed or is ambiguous");
      const id = Buffer.from(created.diagnostics.stdout, "base64").toString("utf8").trim();
      if (!idPattern.test(id)) throw new InvalidInputError("Invalid container ID");
      containerId = id;
      const before = await inspect();
      if (
        before.Status !== "created" ||
        before.Running ||
        before.Paused ||
        before.Restarting ||
        before.Dead ||
        before.OOMKilled ||
        before.Error !== "" ||
        before.ExitCode !== 0 ||
        before.Pid !== 0 ||
        !before.StartedAt.startsWith("0001-")
      )
        throw new InvalidInputError("Container must be fresh");
      started = true;
      const attached = await call(
        ["container", "start", "--attach", containerId],
        false,
        definition.maxOutputBytes,
      );
      observation = {
        ...noProcess("PROCESS_ERROR"),
        started: true,
        diagnostics: attached.diagnostics,
      };
      const after = await inspect();
      oomKilled = after.OOMKilled;
      if (attached.cause === "OUTPUT_LIMIT")
        observation = { ...observation, outcome: "OUTPUT_LIMIT" };
      else if (firstStop) observation = { ...observation, outcome: firstStop };
      else if (
        !attached.cause &&
        attached.confirmed &&
        normalExit(after) &&
        attached.code === after.ExitCode
      ) {
        acceptedExit = after;
        observation = { ...observation, outcome: "EXITED", exitCode: after.ExitCode };
      }
    }
  } catch {
    observation = { ...observation, started, outcome: firstStop ?? "PROCESS_ERROR" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (containerId) {
      try {
        let current = await inspect();
        if (
          acceptedExit &&
          (!normalExit(current) ||
            current.ExitCode !== acceptedExit.ExitCode ||
            current.StartedAt !== acceptedExit.StartedAt ||
            current.FinishedAt !== acceptedExit.FinishedAt)
        )
          observation = { ...observation, outcome: "PROCESS_ERROR" };
        if (current.Running || current.Paused || current.Restarting) {
          await call(["container", "kill", "--signal=KILL", containerId], true);
          current = await inspect();
        }
        oomKilled ||= current.OOMKilled;
        if (
          current.Running ||
          current.Paused ||
          current.Restarting ||
          !["exited", "created", "dead"].includes(current.Status)
        )
          uncertain = true;
        if (!uncertain) {
          const cleanup = await call(["container", "rm", containerId], true);
          removed = cleanup.code === 0 && !cleanup.cause && cleanup.confirmed;
          if (!removed) uncertain = true;
        }
      } catch {
        uncertain = true;
      }
    } else if (createAttempted) uncertain = true;
    if (uncertain)
      observation = {
        ...observation,
        outcome: "TERMINATION_UNCONFIRMED",
        terminationConfirmed: false,
      };
    else if (firstStop && observation.outcome !== "OUTPUT_LIMIT")
      observation = { ...observation, outcome: firstStop };
    if (oomKilled && observation.outcome === "EXITED")
      observation = { ...observation, outcome: "PROCESS_ERROR" };
    observation = { ...observation, durationMs: Math.ceil(performance.now() - began) };
  }
  return {
    observation,
    containerId,
    instance,
    imageId: config.imageId,
    repositoryDigest: config.repositoryDigest,
    oomKilled,
    removed,
    runtimeVersion,
    appliedProfile,
  };
}
