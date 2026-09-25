import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitFixture {
  readonly directory: string;
  git(...arguments_: readonly string[]): Promise<string>;
  write(relativePath: string, content: string | Buffer): Promise<void>;
  commit(message: string): Promise<string>;
}

export async function createGitFixture(
  context: TestContext,
  objectFormat = "sha1",
): Promise<GitFixture> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riskverifier git fixture "));
  context.after(async () => rm(directory, { force: true, recursive: true }));

  const git = async (...arguments_: readonly string[]): Promise<string> => {
    const result = await execFileAsync("git", ["-C", directory, ...arguments_], {
      encoding: "utf8",
      windowsHide: true,
    });
    return result.stdout;
  };
  const write = async (relativePath: string, content: string | Buffer): Promise<void> => {
    const destination = path.join(directory, ...relativePath.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  };
  const commit = async (message: string): Promise<string> => {
    await git("add", "--all");
    await git("commit", "--quiet", "-m", message);
    return (await git("rev-parse", "HEAD")).trim();
  };

  await git("init", "--quiet", `--object-format=${objectFormat}`);
  await git("config", "user.email", "fixture@example.invalid");
  await git("config", "user.name", "RiskVerifier Fixture");
  await git("config", "core.autocrlf", "false");
  await git("config", "core.safecrlf", "false");

  return Object.freeze({ directory, git, write, commit });
}
