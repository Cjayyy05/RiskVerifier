import { InvalidInputError } from "../domain/index.js";
import { canonical } from "../evidence/validation.js";
import {
  createArguments,
  type ContainerDefinition,
  type IsolationConfiguration,
} from "./configuration.js";

export interface AppliedProfile {
  readonly imageId: string;
  readonly user: string;
  readonly memoryBytes: number;
  readonly memorySwapBytes: number;
  readonly nanoCpus: number;
  readonly pids: number;
  readonly network: "none";
  readonly readOnlyRootfs: true;
  readonly sourceReadOnly: true;
  readonly verifierReadOnly: true;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InvalidInputError("Missing Docker inspection record");
  return value as Record<string, unknown>;
}
function requireFields(value: unknown, expected: Record<string, unknown>): void {
  const actual = object(value);
  for (const [key, wanted] of Object.entries(expected))
    if (canonical(actual[key]) !== canonical(wanted))
      throw new InvalidInputError("Applied container isolation differs from approved profile");
}

/** Inspect evidence is local daemon evidence, not an attestation against a hostile host. */
export function validateAppliedProfile(
  value: unknown,
  config: IsolationConfiguration,
  definition: ContainerDefinition,
  source: string,
  instance: string,
): AppliedProfile {
  const inspected = object(value);
  const args = createArguments(config, definition, source, instance);
  const command = args.slice(args.indexOf(config.imageId) + 1);
  const user = `${config.uid}:${config.gid}`;
  const memory = config.memoryMiB * 1048576;
  requireFields(inspected, {
    Image: config.imageId,
    Platform: "linux",
    Path: "/usr/bin/env",
    Args: command,
    RestartCount: 0,
  });
  requireFields(inspected.Config, {
    Image: config.imageId,
    User: user,
    WorkingDir: "/workspace",
    Entrypoint: ["/usr/bin/env"],
    Cmd: command,
    Healthcheck: { Test: ["NONE"] },
    Volumes: null,
    Tty: false,
    OpenStdin: false,
  });
  const environment = object(inspected.Config).Env;
  if (
    !Array.isArray(environment) ||
    environment.some(
      (entry) => typeof entry !== "string" || !/^(PATH|NODE_VERSION|YARN_VERSION)=/u.test(entry),
    )
  )
    throw new InvalidInputError("Unexpected container environment");
  const tmpfs = (size: number): string =>
    `rw,noexec,nosuid,nodev,size=${size}m,uid=${config.uid},gid=${config.gid},mode=0700`;
  requireFields(inspected.HostConfig, {
    NetworkMode: "none",
    ReadonlyRootfs: true,
    Privileged: false,
    CapDrop: ["ALL"],
    CapAdd: null,
    SecurityOpt: ["no-new-privileges:true"],
    IpcMode: "none",
    PidMode: "",
    UTSMode: "",
    UsernsMode: "",
    CgroupnsMode: "private",
    Init: true,
    Runtime: "runc",
    RestartPolicy: { Name: "no", MaximumRetryCount: 0 },
    AutoRemove: false,
    Memory: memory,
    MemorySwap: memory,
    NanoCpus: config.cpuMillis * 1000000,
    PidsLimit: config.pids,
    LogConfig: { Type: "none", Config: {} },
    Devices: [],
    DeviceRequests: null,
    DeviceCgroupRules: null,
    GroupAdd: null,
    Binds: null,
    VolumesFrom: null,
    PortBindings: {},
    PublishAllPorts: false,
    Ulimits: [{ Name: "nofile", Hard: 256, Soft: 256 }],
    Tmpfs: { "/scratch": tmpfs(config.scratchMiB), "/tmp": tmpfs(config.tmpMiB) },
    Mounts: [
      {
        Type: "bind",
        Source: source,
        Target: "/workspace",
        ReadOnly: true,
        BindOptions: { NonRecursive: true },
      },
      { Type: "bind", Source: definition.verifier, Target: "/verifier.mjs", ReadOnly: true },
    ],
  });
  // Docker changes this optional field from false to null after starting under cgroup v2.
  if (![false, null].includes(object(inspected.HostConfig).OomKillDisable as false | null))
    throw new InvalidInputError("OOM killing must not be disabled");
  // Mount list order is not stable. Targets must still be unique and exactly the two roles.
  if (!Array.isArray(inspected.Mounts)) throw new InvalidInputError("Missing Docker mounts");
  const mounts = [...(inspected.Mounts as unknown[])].sort((a: unknown, b: unknown) =>
    String(object(a).Destination).localeCompare(String(object(b).Destination)),
  );
  // Desktop inspect reports canonical Windows paths, including after starting.
  requireFields(
    { Mounts: mounts },
    {
      Mounts: [
        {
          Type: "bind",
          Source: definition.verifier,
          Destination: "/verifier.mjs",
          Mode: "",
          RW: false,
          Propagation: "rprivate",
        },
        {
          Type: "bind",
          Source: source,
          Destination: "/workspace",
          Mode: "",
          RW: false,
          Propagation: "rprivate",
        },
      ],
    },
  );
  const networks = object(object(inspected.NetworkSettings).Networks);
  if (canonical(Object.keys(networks)) !== canonical(["none"]))
    throw new InvalidInputError("Unexpected container network attachment");
  return {
    imageId: inspected.Image as string,
    user,
    memoryBytes: memory,
    memorySwapBytes: memory,
    nanoCpus: config.cpuMillis * 1000000,
    pids: config.pids,
    network: "none",
    readOnlyRootfs: true,
    sourceReadOnly: true,
    verifierReadOnly: true,
  };
}
