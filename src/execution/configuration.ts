import path from "node:path";
import {
  createConfigurationIdentity,
  createConfigurationVersion,
  createComponentVersion,
  createStrategyCapabilities,
  parseVerificationStrategy,
  VERIFICATION_STRATEGIES,
  InvalidInputError,
  type ConfigurationIdentity,
  type VerificationStrategy,
  type StrategyCapability,
} from "../domain/index.js";
import {
  absolutePath,
  digest,
  freeze,
  integer,
  list,
  record,
  sha256,
  text,
  same,
} from "./validation.js";

export const EXECUTOR_VERSION = createComponentVersion("7.1.0");
export const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface ExecutionDefinition {
  readonly strategy: VerificationStrategy;
  readonly version: string;
  readonly executable: string;
  /** First argument is an absolute separately approved .mjs/.cjs verifier, not inline code. */
  readonly args: readonly string[];
  readonly verifierSha256: string;
  readonly workingDirectory: "WORKSPACE_ROOT";
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly environmentPolicy: "MINIMAL_V1";
  readonly protocol: "EXIT_CODE_V1";
}
export interface ExecutionConfiguration {
  readonly schemaVersion: 7;
  readonly version: string;
  readonly definitions: readonly ExecutionDefinition[];
  readonly identity: ConfigurationIdentity;
}

export function parseExecutionDefinition(input: unknown): ExecutionDefinition {
  const value = record(input, [
    "strategy",
    "version",
    "executable",
    "args",
    "verifierSha256",
    "workingDirectory",
    "timeoutMs",
    "maxOutputBytes",
    "environmentPolicy",
    "protocol",
  ]);
  const executable = absolutePath(value.executable);
  if (
    path.basename(executable).toLowerCase() !== (process.platform === "win32" ? "node.exe" : "node")
  )
    throw new InvalidInputError("Only explicitly approved host Node executables are supported");
  const args = list(value.args, 32).map((arg) => text(arg, 4096, true));
  if (args.length === 0 || args.reduce((size, arg) => size + arg.length, 0) > 16384)
    throw new InvalidInputError("A bounded verifier argument array is required");
  absolutePath(args[0]);
  if (!/\.(?:mjs|cjs)$/u.test(args[0]!))
    throw new InvalidInputError("Verifier entry point must be an explicit mjs/cjs file");
  if (
    value.workingDirectory !== "WORKSPACE_ROOT" ||
    value.environmentPolicy !== "MINIMAL_V1" ||
    value.protocol !== "EXIT_CODE_V1"
  )
    throw new InvalidInputError("Unsupported working directory, environment or exit protocol");
  return freeze({
    strategy: parseVerificationStrategy(value.strategy),
    version: text(value.version, 128),
    executable,
    args,
    verifierSha256: digest(value.verifierSha256),
    workingDirectory: "WORKSPACE_ROOT",
    timeoutMs: integer(value.timeoutMs, 1, 2_147_483_647),
    maxOutputBytes: integer(value.maxOutputBytes, 1, MAX_OUTPUT_BYTES),
    environmentPolicy: "MINIMAL_V1",
    protocol: "EXIT_CODE_V1",
  });
}

/** Trusted acquisition is the caller's responsibility; this parser confers no authority. */
export function parseExecutionConfiguration(input: unknown): ExecutionConfiguration {
  const value = record(input, ["schemaVersion", "version", "definitions"]);
  if (value.schemaVersion !== 7) throw new InvalidInputError("Unsupported execution schema");
  const version = createConfigurationVersion(text(value.version, 128));
  const definitions = list(value.definitions, VERIFICATION_STRATEGIES.length)
    .map(parseExecutionDefinition)
    .sort(
      (a, b) =>
        VERIFICATION_STRATEGIES.indexOf(a.strategy) - VERIFICATION_STRATEGIES.indexOf(b.strategy),
    );
  if (new Set(definitions.map((definition) => definition.strategy)).size !== definitions.length)
    throw new InvalidInputError("Duplicate execution strategy definition");
  const contents = { schemaVersion: 7 as const, version, definitions };
  return freeze({
    ...contents,
    identity: createConfigurationIdentity({
      version,
      hash: sha256("riskverifier:execution-configuration\n" + JSON.stringify(contents)),
    }),
  });
}

export function validateExecutionConfiguration(input: unknown): ExecutionConfiguration {
  const value = record(input, ["schemaVersion", "version", "definitions", "identity"]);
  const result = parseExecutionConfiguration({
    schemaVersion: value.schemaVersion,
    version: value.version,
    definitions: value.definitions,
  });
  const identity = record(value.identity, ["version", "hash"]);
  if (
    !same(
      createConfigurationIdentity({ version: identity.version, hash: identity.hash }),
      result.identity,
    )
  )
    throw new InvalidInputError("Execution configuration digest does not reproduce its contents");
  return result;
}

export function executionDefinitionId(definition: ExecutionDefinition): string {
  return `definition:sha256:${sha256("riskverifier:execution-definition\n" + JSON.stringify(parseExecutionDefinition(definition)))}`;
}

/** Declared implementation presence, not runtime startup or adequate verification proof. */
export function executionCapabilities(
  configuration: ExecutionConfiguration,
): readonly StrategyCapability[] {
  const checked = validateExecutionConfiguration(configuration);
  return createStrategyCapabilities(
    VERIFICATION_STRATEGIES.map((strategy) => ({
      strategy,
      availability: checked.definitions.some((definition) => definition.strategy === strategy)
        ? "SUPPORTED"
        : "UNSUPPORTED",
    })),
  );
}
