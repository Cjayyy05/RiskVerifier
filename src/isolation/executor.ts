import { randomUUID, createHash } from "node:crypto";
import { open, realpath, lstat, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  InvalidInputError,
  createComponentVersion,
  type ChangeVerificationPlan,
} from "../domain/index.js";
import { validateVerificationPlan, type PlanningInput } from "../planning/index.js";
import {
  acquireWorkspace,
  releaseWorkspace,
  validateWorkspaceFiles,
  workspaceMetadata,
  type ControlledWorkspace,
} from "../execution/workspace.js";
import { absolutePath, contained, digest as sha, record } from "../execution/validation.js";
import {
  noProcess,
  resultState,
  validateBoundResult,
  type ExecutionBinding,
  type ExecutionCheckResult,
} from "../execution/result.js";
import { canonical, data, digest, freeze } from "../evidence/validation.js";
import {
  ISOLATION_VERSION,
  SECURITY_PROFILE,
  validateIsolationConfiguration,
  type IsolationConfiguration,
} from "./configuration.js";
import { runContainer, type ContainerObservation, type DockerHost } from "./docker-adapter.js";

export interface ContainerRequest {
  readonly planningInput: PlanningInput;
  readonly plan: ChangeVerificationPlan;
  readonly checkId: string;
  readonly workspace: ControlledWorkspace;
}
export interface ContainerResult {
  readonly backend: "DOCKER_LINUX";
  readonly isolationVersion: typeof ISOLATION_VERSION;
  readonly isolationIdentity: IsolationConfiguration["identity"];
  readonly provenance: ContainerObservation;
  /** Phase 7 protocol compatibility DTO, not a claim of host-direct execution. */
  readonly execution: ExecutionCheckResult;
}
export interface ContainerExecutor {
  readonly version: typeof ISOLATION_VERSION;
  readonly configuration: IsolationConfiguration;
  executeCheck(request: ContainerRequest, signal?: AbortSignal): Promise<ContainerResult>;
}
/** Streams a bounded, non-link regular file; no mutable byte buffers escape. */
export async function trustedFileHash(filename: string, maximum: number): Promise<string> {
  const info = await lstat(filename);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size > maximum ||
    (await realpath(filename)) !== filename
  )
    throw new InvalidInputError("Trusted program must be canonical, bounded and regular");
  const file = await open(filename, "r");
  try {
    const hash = createHash("sha256"),
      buffer = Buffer.alloc(65536);
    let size = 0;
    while (true) {
      const read = await file.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
      if (size > maximum) throw new InvalidInputError("Program exceeds bound");
      hash.update(buffer.subarray(0, read.bytesRead));
    }
    if (size !== info.size) throw new InvalidInputError("Trusted program changed during read");
    return hash.digest("hex");
  } finally {
    await file.close();
  }
}
/** Operator-supplied authority only. No discovery from repository contents or host PATH. */
export async function createContainerExecutor(
  trustedConfiguration: IsolationConfiguration,
  trustedHost: unknown,
): Promise<ContainerExecutor> {
  const configuration = validateIsolationConfiguration(trustedConfiguration);
  const value = record(data(trustedHost), ["dockerExecutable", "dockerSha256", "endpoint"]);
  const executable = absolutePath(value.dockerExecutable),
    pin = sha(value.dockerSha256);
  if (process.platform !== "win32")
    throw new InvalidInputError(
      "Phase 9 currently validates Windows Docker Desktop Linux containers only",
    );
  if (
    path.basename(executable).toLowerCase() !== "docker.exe" ||
    value.endpoint !== "npipe:////./pipe/dockerDesktopLinuxEngine"
  )
    throw new InvalidInputError("Require explicit local Docker Desktop CLI and Linux-engine pipe");
  if ((await trustedFileHash(executable, 128 * 1024 * 1024)) !== pin)
    throw new InvalidInputError("Docker executable pin mismatch");
  const authority = {
    executable,
    pin,
    endpoint: value.endpoint,
    backend: SECURITY_PROFILE.backend,
  };
  let busy = false,
    quarantined = false;
  return Object.freeze({
    version: ISOLATION_VERSION,
    configuration,
    async executeCheck(request: ContainerRequest, signal?: AbortSignal): Promise<ContainerResult> {
      if (busy || quarantined)
        throw new InvalidInputError("Container executor busy or quarantined");
      if (signal !== undefined && !(signal instanceof AbortSignal))
        throw new InvalidInputError("Require native AbortSignal");
      const requestValue = record(request, ["planningInput", "plan", "checkId", "workspace"]);
      const plan = validateVerificationPlan(
        requestValue.planningInput as PlanningInput,
        requestValue.plan as ChangeVerificationPlan,
      );
      if (canonical(plan.context.configuration) !== canonical(configuration.identity))
        throw new InvalidInputError("Plan isolation configuration mismatch");
      const check = plan.checks.find((item) => item.id === requestValue.checkId);
      if (!check) throw new InvalidInputError("Unknown plan check");
      const workspace = workspaceMetadata(requestValue.workspace as ControlledWorkspace);
      if (
        workspace.repository !== plan.context.repository ||
        workspace.baseCommit !== plan.context.baseCommit ||
        workspace.targetCommit !== plan.context.targetCommit
      )
        throw new InvalidInputError("Fixture source context mismatch");
      const definition = configuration.definitions.find((item) => item.strategy === check.strategy);
      if (contained(workspace.directory, executable, true))
        throw new InvalidInputError("Docker authority cannot come from source workspace");
      if (definition && contained(workspace.directory, definition.verifier, true))
        throw new InvalidInputError("Verifier authority cannot come from source workspace");
      acquireWorkspace(workspace);
      busy = true;
      let confirmed = true,
        directory: string | undefined;
      try {
        await validateWorkspaceFiles(workspace);
        if ((await trustedFileHash(executable, 128 * 1024 * 1024)) !== pin)
          throw new InvalidInputError("Docker executable changed");
        if (
          definition &&
          (await trustedFileHash(definition.verifier, 1048576)) !== definition.verifierSha256
        )
          throw new InvalidInputError("Trusted verifier changed");
        const instance = `riskverifier-${randomUUID()}`;
        let provenance: ContainerObservation = {
          observation: noProcess(
            signal?.aborted
              ? "CANCELLED"
              : !definition
                ? "DEFINITION_MISSING"
                : "POLICY_UNAVAILABLE",
          ),
          containerId: null,
          instance,
          imageId: configuration.imageId,
          repositoryDigest: configuration.repositoryDigest,
          oomKilled: false,
          removed: false,
          runtimeVersion: null,
          appliedProfile: null,
        };
        if (!signal?.aborted && definition && check.availability === "SUPPORTED") {
          const parent = await realpath(os.tmpdir());
          directory = await mkdtemp(path.join(parent, "riskverifier docker control "));
          if (!contained(parent, directory))
            throw new InvalidInputError("Control directory escaped temp root");
          const root = absolutePath(process.env.SystemRoot);
          const environment = {
            HOMEDRIVE: "",
            HOMEPATH: "",
            LOGONSERVER: "",
            PATH: "",
            SYSTEMDRIVE: path.parse(root).root.replace(/\\$/u, ""),
            SystemRoot: root,
            WINDIR: root,
            TEMP: directory,
            TMP: directory,
            USERDOMAIN: "",
            USERNAME: "",
            USERPROFILE: directory,
            DOCKER_CONFIG: directory,
          };
          const host: DockerHost = {
            executable,
            endpoint: authority.endpoint,
            directory,
            environment,
          };
          // Unexpected adapter exceptions could follow a side effect: quarantine by default.
          confirmed = false;
          provenance = await runContainer(
            host,
            configuration,
            definition,
            workspace.directory,
            instance,
            signal,
          );
          confirmed = provenance.observation.terminationConfirmed;
        }
        const binding: ExecutionBinding = {
          executorVersion: createComponentVersion("7.1.0"),
          authorityId: `authority:sha256:${digest("container-authority", { authority, configuration: configuration.identity, provenance })}`,
          planId: plan.id,
          context: plan.context,
          check,
          definition: definition
            ? {
                id: `definition:sha256:${digest("container-definition", { version: ISOLATION_VERSION, profile: SECURITY_PROFILE, configuration, definition })}`,
                version: definition.version,
                maxOutputBytes: definition.maxOutputBytes,
                timeoutMs: definition.timeoutMs,
              }
            : null,
          workspace: { id: workspace.id, snapshotSha256: workspace.snapshotSha256 },
        };
        const execution = validateBoundResult(binding, {
          binding,
          attemptId: `attempt:${randomUUID()}`,
          state: resultState(provenance.observation),
          observation: provenance.observation,
        });
        return freeze({
          backend: "DOCKER_LINUX",
          isolationVersion: ISOLATION_VERSION,
          isolationIdentity: configuration.identity,
          provenance,
          execution,
        });
      } finally {
        if (!confirmed) quarantined = true;
        busy = false;
        releaseWorkspace(workspace, confirmed);
        if (directory && confirmed) await rm(directory, { recursive: true, force: false });
      }
    },
  });
}
/** Independently retained trusted envelope required; exact replay is not historical authentication. */
export function validateContainerResult(
  trusted: ContainerResult,
  candidate: unknown,
): ContainerResult {
  const expected = data(trusted) as ContainerResult;
  if (canonical(candidate) !== canonical(expected))
    throw new InvalidInputError("Container provenance/result differs from trusted capture");
  validateBoundResult(expected.execution.binding, expected.execution);
  return freeze(expected);
}
