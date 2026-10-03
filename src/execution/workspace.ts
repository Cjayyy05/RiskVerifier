import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createRepositoryIdentity,
  createCommitIdentity,
  InvalidInputError,
  type RepositoryIdentity,
  type CommitIdentity,
} from "../domain/index.js";
import { contained, freeze, list, record, sha256, text } from "./validation.js";

export interface ControlledWorkspace {
  readonly id: string;
  readonly directory: string;
  readonly repository: RepositoryIdentity;
  readonly baseCommit: CommitIdentity;
  readonly targetCommit: CommitIdentity;
  readonly snapshotSha256: string;
}
interface WorkspaceRecord {
  readonly parent: string;
  readonly device: number;
  readonly inode: number;
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
  active: boolean;
  consumed: boolean;
  busy: boolean;
  quarantined: boolean;
}
const workspaces = new WeakMap<ControlledWorkspace, WorkspaceRecord>();

function fixturePath(input: unknown): string {
  const value = text(input, 512);
  const parts = value.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[\\:<>"|?*]/u.test(part) ||
        /[. ]$/u.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
    )
  )
    throw new InvalidInputError("Fixture path is not a portable contained relative path");
  return value;
}

/** Allocates a fresh fixture only; no adoption/copying of arbitrary existing repositories. */
export async function prepareControlledWorkspace(input: unknown): Promise<ControlledWorkspace> {
  const value = record(input, ["kind", "repository", "baseCommit", "targetCommit", "files"]);
  if (value.kind !== "CONTROLLED_FIXTURE")
    throw new InvalidInputError(
      "Local execution requires explicitly trusted controlled fixture data",
    );
  const repository = createRepositoryIdentity(text(value.repository, 1024));
  const baseCommit = createCommitIdentity(value.baseCommit);
  const targetCommit = createCommitIdentity(value.targetCommit);
  let size = 0;
  const files = list(value.files, 256)
    .map((item) => {
      const file = record(item, ["path", "contents"]);
      const name = fixturePath(file.path);
      if (typeof file.contents !== "string" || file.contents.length > 1024 * 1024)
        throw new InvalidInputError("Fixture file exceeds its bound");
      const bytes = Buffer.from(file.contents, "utf8");
      size += bytes.length;
      if (bytes.length > 1024 * 1024 || size > 4 * 1024 * 1024)
        throw new InvalidInputError("Fixture snapshot exceeds its byte bound");
      return { path: name, bytes, sha256: sha256(bytes) };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const names = new Set<string>();
  for (const file of files) {
    const name = file.path.toLowerCase();
    if (
      names.has(name) ||
      [...names].some((other) => other.startsWith(name + "/") || name.startsWith(other + "/"))
    )
      throw new InvalidInputError("Fixture paths collide");
    names.add(name);
  }
  const parent = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(parent, "riskverifier controlled fixture "));
  if (!contained(parent, directory))
    throw new InvalidInputError("Fixture allocation escaped temporary root");
  try {
    for (const file of files) {
      const destination = path.join(directory, ...file.path.split("/"));
      if (!contained(directory, destination))
        throw new InvalidInputError("Fixture path escaped root");
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, file.bytes, { flag: "wx", mode: 0o600 });
    }
    const metadata = await lstat(directory);
    const manifest = files.map((file) => ({ path: file.path, sha256: file.sha256 }));
    const workspace = freeze({
      id: `workspace:${randomUUID()}`,
      directory,
      repository,
      baseCommit,
      targetCommit,
      snapshotSha256: sha256(JSON.stringify(manifest)),
    });
    workspaces.set(workspace, {
      parent,
      device: metadata.dev,
      inode: metadata.ino,
      files: manifest,
      active: true,
      consumed: false,
      busy: false,
      quarantined: false,
    });
    return workspace;
  } catch (error) {
    // Exact mkdtemp result, checked against its canonical temporary parent above.
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export function workspaceMetadata(workspace: ControlledWorkspace): ControlledWorkspace {
  if (!workspaces.has(workspace))
    throw new InvalidInputError("Unregistered controlled workspace handle");
  return workspace;
}

export function acquireWorkspace(workspace: ControlledWorkspace): void {
  const state = workspaces.get(workspace);
  if (!state || !state.active || state.busy || state.quarantined || state.consumed)
    throw new InvalidInputError("Workspace is unknown, disposed, busy, quarantined or consumed");
  state.consumed = true;
  state.busy = true;
}

export function releaseWorkspace(
  workspace: ControlledWorkspace,
  terminationConfirmed: boolean,
): void {
  const state = workspaces.get(workspace)!;
  state.busy = false;
  if (!terminationConfirmed) state.quarantined = true;
}

async function validateRoot(workspace: ControlledWorkspace, state: WorkspaceRecord): Promise<void> {
  const actual = await realpath(workspace.directory);
  const info = await lstat(workspace.directory);
  if (
    actual !== workspace.directory ||
    !contained(state.parent, actual) ||
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.dev !== state.device ||
    info.ino !== state.inode
  )
    throw new InvalidInputError("Controlled workspace root was replaced or escaped containment");
}

export async function validateWorkspaceFiles(workspace: ControlledWorkspace): Promise<void> {
  const state = workspaces.get(workspace)!;
  await validateRoot(workspace, state);
  const seen: string[] = [];
  let entries = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++entries > 4096) throw new InvalidInputError("Fixture tree exceeds its bound");
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || !contained(workspace.directory, await realpath(filename)))
        throw new InvalidInputError("Fixture contains a link or escaped path");
      if (entry.isDirectory()) await visit(filename);
      else {
        const relative = path.relative(workspace.directory, filename).split(path.sep).join("/");
        const expected = state.files.find((file) => file.path === relative);
        const info = await lstat(filename);
        if (
          !entry.isFile() ||
          !expected ||
          info.nlink !== 1 ||
          info.size > 1024 * 1024 ||
          sha256(await readFile(filename)) !== expected.sha256
        )
          throw new InvalidInputError("Fixture contents changed after preparation");
        seen.push(relative);
      }
    }
  };
  await visit(workspace.directory);
  if (seen.length !== state.files.length) throw new InvalidInputError("Fixture files are missing");
}

export async function disposeControlledWorkspace(workspace: ControlledWorkspace): Promise<void> {
  const state = workspaces.get(workspace);
  if (!state) throw new InvalidInputError("Unknown workspace");
  if (!state.active) return;
  if (state.busy || state.quarantined)
    throw new InvalidInputError(
      "Cannot remove a busy workspace or one with unconfirmed termination",
    );
  // Reserve synchronously before filesystem awaits so execution cannot race disposal.
  state.busy = true;
  try {
    await validateRoot(workspace, state);
    await rm(workspace.directory, { recursive: true, force: false });
    state.active = false;
  } finally {
    state.busy = false;
  }
}
