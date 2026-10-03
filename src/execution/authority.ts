import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { InvalidInputError } from "../domain/index.js";
import type { ExecutionDefinition } from "./configuration.js";
import { absolutePath, contained, digest, freeze, list, record, sha256 } from "./validation.js";

export interface ExecutionAuthority {
  readonly id: string;
  readonly executables: readonly string[];
  readonly verifiers: readonly { readonly path: string; readonly sha256: string }[];
  readonly runtimeSha256: string;
  readonly environment: Readonly<Record<string, string>>;
}

async function fileHash(filename: string, maximum: number): Promise<string> {
  const file = await open(filename, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximum)
      throw new InvalidInputError("Trusted program must be a bounded regular file");
    // Bounded even if a trusted-host file grows between stat and read.
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await file.read(buffer, length, buffer.length - length, null);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length !== stat.size)
      throw new InvalidInputError("Trusted program changed during validation");
    return sha256(buffer.subarray(0, length));
  } finally {
    await file.close();
  }
}

/** Independent operator allow-list. Nothing here is discovered from a fixture/repository. */
export async function createAuthority(input: unknown): Promise<ExecutionAuthority> {
  const value = record(input, ["kind", "executables", "verifiers"]);
  if (value.kind !== "CONTROLLED_FIXTURE_ONLY")
    throw new InvalidInputError("Local executor authority is restricted to controlled fixtures");
  const executables = list(value.executables, 8).map(absolutePath).sort();
  const verifiers = list(value.verifiers, 32)
    .map((item) => {
      const entry = record(item, ["path", "sha256"]);
      return { path: absolutePath(entry.path), sha256: digest(entry.sha256) };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (
    new Set(executables).size !== executables.length ||
    new Set(verifiers.map((verifier) => verifier.path)).size !== verifiers.length
  )
    throw new InvalidInputError("Duplicate host execution authority entry");
  const environment: Record<string, string> = {};
  if (process.platform === "win32") {
    // libuv fills missing required variables from the host even with an explicit env.
    // Supply every one intentionally so PATH/profile/logon values cannot leak implicitly.
    Object.assign(environment, {
      HOMEDRIVE: "",
      HOMEPATH: "",
      LOGONSERVER: "",
      PATH: "",
      SYSTEMDRIVE: "",
      SystemRoot: absolutePath(process.env.SystemRoot),
      TEMP: "",
      USERDOMAIN: "",
      USERNAME: "",
      USERPROFILE: "",
      WINDIR: absolutePath(process.env.SystemRoot),
    });
    environment.SYSTEMDRIVE = path.parse(environment.SystemRoot!).root.replace(/\\$/u, "");
  }
  const runtimeSha256 = await fileHash(process.execPath, 128 * 1024 * 1024);
  const contents = {
    kind: "CONTROLLED_FIXTURE_ONLY",
    executables,
    verifiers,
    runtimeSha256,
    environment,
  };
  return freeze({
    id: `authority:sha256:${sha256(JSON.stringify(contents))}`,
    executables,
    verifiers,
    runtimeSha256,
    environment,
  });
}

export function executionEnvironment(
  authority: ExecutionAuthority,
  workspace: string,
): Readonly<Record<string, string>> {
  if (process.platform !== "win32") return authority.environment;
  const drive = path.parse(workspace).root.replace(/\\$/u, "");
  return Object.freeze({
    ...authority.environment,
    TEMP: workspace,
    USERPROFILE: workspace,
    HOMEDRIVE: drive,
    HOMEPATH: workspace.slice(drive.length),
  });
}

export function assertDefinitionAllowed(
  definition: ExecutionDefinition,
  authority: ExecutionAuthority,
): void {
  if (
    !authority.executables.includes(definition.executable) ||
    !authority.verifiers.some(
      (verifier) =>
        verifier.path === definition.args[0] && verifier.sha256 === definition.verifierSha256,
    )
  )
    throw new InvalidInputError("Execution definition is outside the independent host allow-list");
}

export async function validatePrograms(
  definition: ExecutionDefinition,
  authority: ExecutionAuthority,
  workspace: string,
): Promise<"EXECUTABLE_UNAVAILABLE" | "VERIFIER_UNAVAILABLE" | null> {
  const check = async (filename: string, expected: string, maximum: number): Promise<boolean> => {
    try {
      const canonical = await realpath(filename);
      if (
        contained(workspace, canonical, true) ||
        path.basename(canonical) !== path.basename(filename) ||
        (await fileHash(canonical, maximum)) !== expected
      )
        throw new InvalidInputError("Program identity or trusted location validation failed");
      return true;
    } catch (error) {
      if (error instanceof InvalidInputError) throw error;
      return false;
    }
  };
  if (!(await check(definition.executable, authority.runtimeSha256, 128 * 1024 * 1024)))
    return "EXECUTABLE_UNAVAILABLE";
  if (!(await check(definition.args[0]!, definition.verifierSha256, 1024 * 1024)))
    return "VERIFIER_UNAVAILABLE";
  return null;
}
