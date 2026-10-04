import path from "node:path";
import {
  createConfigurationIdentity,
  createComponentVersion,
  InvalidInputError,
  parseVerificationStrategy,
  VERIFICATION_STRATEGIES,
  type ConfigurationIdentity,
  type VerificationStrategy,
} from "../domain/index.js";
import {
  absolutePath,
  digest as sha,
  integer,
  list,
  record,
  text,
} from "../execution/validation.js";
import { canonical, data, digest, freeze } from "../evidence/validation.js";

export const ISOLATION_VERSION = createComponentVersion("9.1.0");
export const SECURITY_PROFILE = Object.freeze({
  backend: "DOCKER_LINUX",
  platform: "linux/amd64",
  network: "none",
  rootfs: "READ_ONLY",
  source: "/workspace:READ_ONLY",
  verifier: "/verifier.mjs:READ_ONLY",
  capabilities: "DROP_ALL",
  noNewPrivileges: true,
  environment: "EMPTY_THEN_FIXED_V1",
  entrypoint: "/usr/bin/env",
  executable: "/usr/local/bin/node",
  protocol: "EXIT_CODE_V1",
  logging: "none",
  pidNamespace: "private",
  ipc: "none",
  cgroupNamespace: "private",
  init: true,
});
export interface ContainerDefinition {
  readonly strategy: VerificationStrategy;
  readonly version: string;
  readonly verifier: string;
  readonly verifierSha256: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}
export interface IsolationConfiguration {
  readonly schemaVersion: 9;
  readonly version: string;
  readonly imageId: string;
  readonly repositoryDigest: string;
  readonly uid: number;
  readonly gid: number;
  readonly memoryMiB: number;
  readonly cpuMillis: number;
  readonly pids: number;
  readonly scratchMiB: number;
  readonly tmpMiB: number;
  readonly definitions: readonly ContainerDefinition[];
  readonly identity: ConfigurationIdentity;
}
const fields = [
  "schemaVersion",
  "version",
  "imageId",
  "repositoryDigest",
  "uid",
  "gid",
  "memoryMiB",
  "cpuMillis",
  "pids",
  "scratchMiB",
  "tmpMiB",
  "definitions",
];
export function parseIsolationConfiguration(input: unknown): IsolationConfiguration {
  const value = record(data(input), fields);
  if (
    value.schemaVersion !== 9 ||
    typeof value.imageId !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.imageId) ||
    typeof value.repositoryDigest !== "string" ||
    !/^node@sha256:[a-f0-9]{64}$/u.test(value.repositoryDigest)
  )
    throw new InvalidInputError(
      "Require schema 9 and pre-approved immutable local Node image identities",
    );
  const definitions = list(value.definitions, 10)
    .map((input): ContainerDefinition => {
      const item = record(input, [
        "strategy",
        "version",
        "verifier",
        "verifierSha256",
        "args",
        "timeoutMs",
        "maxOutputBytes",
      ]);
      const verifier = mountPath(item.verifier);
      if (path.extname(verifier) !== ".mjs")
        throw new InvalidInputError("Trusted verifier must be an mjs file");
      const args = list(item.args, 32).map((arg) => text(arg, 4096, true));
      if (args.reduce((size, arg) => size + arg.length, 0) > 16384)
        throw new InvalidInputError("Argument bound exceeded");
      return {
        strategy: parseVerificationStrategy(item.strategy),
        version: text(item.version, 128),
        verifier,
        verifierSha256: sha(item.verifierSha256),
        args,
        timeoutMs: integer(item.timeoutMs, 100, 120000),
        maxOutputBytes: integer(item.maxOutputBytes, 1, 1048576),
      };
    })
    .sort(
      (a, b) =>
        VERIFICATION_STRATEGIES.indexOf(a.strategy) - VERIFICATION_STRATEGIES.indexOf(b.strategy),
    );
  if (new Set(definitions.map((item) => item.strategy)).size !== definitions.length)
    throw new InvalidInputError("Duplicate strategy");
  const contents = {
    schemaVersion: 9 as const,
    version: text(value.version, 128),
    imageId: value.imageId,
    repositoryDigest: value.repositoryDigest,
    uid: integer(value.uid, 1, 65535),
    gid: integer(value.gid, 1, 65535),
    memoryMiB: integer(value.memoryMiB, 32, 1024),
    cpuMillis: integer(value.cpuMillis, 100, 2000),
    pids: integer(value.pids, 16, 128),
    scratchMiB: integer(value.scratchMiB, 1, 64),
    tmpMiB: integer(value.tmpMiB, 1, 64),
    definitions,
  };
  return freeze({
    ...contents,
    identity: createConfigurationIdentity({
      version: contents.version,
      hash: digest("isolation-configuration", {
        isolationVersion: ISOLATION_VERSION,
        profile: SECURITY_PROFILE,
        ...contents,
      }),
    }),
  });
}
export function validateIsolationConfiguration(input: unknown): IsolationConfiguration {
  const value = record(data(input), [...fields, "identity"]);
  const parsed = parseIsolationConfiguration(
    Object.fromEntries(fields.map((field) => [field, value[field]])),
  );
  if (canonical(parsed.identity) !== canonical(value.identity))
    throw new InvalidInputError("Isolation identity mismatch");
  return parsed;
}
export function mountPath(value: unknown): string {
  const result = absolutePath(value);
  if (/[",\r\n]/u.test(result))
    throw new InvalidInputError("Mount path contains Docker CSV delimiters");
  return result;
}
export function createArguments(
  config: IsolationConfiguration,
  definition: ContainerDefinition,
  source: string,
  instance: string,
): readonly string[] {
  if (!/^riskverifier-[a-f0-9-]{36}$/u.test(instance))
    throw new InvalidInputError("Invalid internal instance");
  return [
    "container",
    "create",
    "--pull=never",
    "--platform=linux/amd64",
    "--name",
    instance,
    "--label",
    "riskverifier.managed=phase9",
    "--label",
    `riskverifier.instance=${instance}`,
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--user",
    `${config.uid}:${config.gid}`,
    "--ipc=none",
    "--cgroupns=private",
    "--init",
    "--no-healthcheck",
    "--restart=no",
    "--log-driver=none",
    "--memory",
    `${config.memoryMiB}m`,
    "--memory-swap",
    `${config.memoryMiB}m`,
    "--cpus",
    String(config.cpuMillis / 1000),
    "--pids-limit",
    String(config.pids),
    "--ulimit",
    "nofile=256:256",
    "--mount",
    `type=bind,src=${mountPath(source)},dst=/workspace,readonly,bind-recursive=disabled`,
    "--mount",
    `type=bind,src=${mountPath(definition.verifier)},dst=/verifier.mjs,readonly`,
    "--tmpfs",
    `/scratch:rw,noexec,nosuid,nodev,size=${config.scratchMiB}m,uid=${config.uid},gid=${config.gid},mode=0700`,
    "--tmpfs",
    `/tmp:rw,noexec,nosuid,nodev,size=${config.tmpMiB}m,uid=${config.uid},gid=${config.gid},mode=0700`,
    "--workdir=/workspace",
    "--entrypoint=/usr/bin/env",
    config.imageId,
    "-i",
    "PATH=/usr/local/bin:/usr/bin:/bin",
    "HOME=/scratch",
    "TMPDIR=/tmp",
    "LANG=C.UTF-8",
    "/usr/local/bin/node",
    "--",
    "/verifier.mjs",
    ...definition.args,
  ];
}
