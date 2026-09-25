import assert from "node:assert/strict";
import { chmod, readFile, readdir, symlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { InvalidInputError } from "../../src/domain/index.js";
import {
  analyzeGitChange,
  createGitChangeAnalysisInput,
  GitCommitNotFoundError,
  GitCommandFailedError,
  GitCancelledError,
  GitTimeoutError,
  GitOutputLimitError,
  GitObjectNotCommitError,
  UnsupportedGitRepositoryError,
} from "../../src/git/index.js";
import { createGitFixture, type GitFixture } from "./git-fixture.js";

function input(
  directory: string,
  baseCommit: string,
  targetCommit: string,
): ReturnType<typeof createGitChangeAnalysisInput> {
  return createGitChangeAnalysisInput({
    repositoryPath: directory,
    repository: "review-fixture",
    baseCommit,
    targetCommit,
  });
}

async function snapshot(fixture: GitFixture): Promise<unknown> {
  return {
    head: await fixture.git("rev-parse", "HEAD"),
    refs: await fixture.git("show-ref", "--head"),
    index: await readFile(path.join(fixture.directory, ".git/index")),
    config: await readFile(path.join(fixture.directory, ".git/config")),
    status: await fixture.git("--no-optional-locks", "status", "--porcelain=v1", "-z"),
    metadata: await readdir(path.join(fixture.directory, ".git"), { recursive: true }),
  };
}

void test("local attributes, configuration, replace refs and dirty/detached state cannot change facts", async (t) => {
  const f = await createGitFixture(t);
  await f.write(
    ".gitattributes",
    "committed.txt -diff\n*.txt diff=localdriver\ncommitted.txt -diff\n",
  );
  for (const name of ["a.txt", "z.txt", "committed.txt", "\uFEFFfile.txt"])
    await f.write(name, "old\n");
  const base = await f.commit("base");
  for (const name of ["a.txt", "z.txt", "committed.txt", "\uFEFFfile.txt"])
    await f.write(name, "new\n");
  const target = await f.commit("target");
  const request = input(f.directory, base, target);
  const expected = await analyzeGitChange(request);
  assert.deepEqual(
    expected.changedFiles.map((file) => file.path),
    ["a.txt", "committed.txt", "z.txt", "\uFEFFfile.txt"],
  );
  assert.equal(expected.changedFiles.find((file) => file.path === "committed.txt")?.isBinary, true);
  assert.equal(expected.changedFiles.find((file) => file.path === "a.txt")?.isBinary, false);
  await f.write(".git/info/attributes", "*.txt -diff\n");
  await f.write("order", "z.txt\na.txt\n");
  for (const [key, value] of [
    ["diff.orderFile", "order"],
    ["diff.algorithm", "histogram"],
    ["diff.indentHeuristic", "true"],
    ["diff.renames", "false"],
    ["diff.renameLimit", "1"],
    ["diff.localdriver.binary", "true"],
    ["diff.external", "definitely-unavailable-driver"],
    ["diff.localdriver.command", "definitely-unavailable-driver"],
    ["diff.localdriver.textconv", "definitely-unavailable-driver"],
    ["core.fsmonitor", "definitely-unavailable-driver"],
    ["core.pager", "definitely-unavailable-driver"],
    ["pager.diff", "definitely-unavailable-driver"],
    ["interactive.diffFilter", "definitely-unavailable-driver"],
    ["diff.submodule", "diff"],
  ] as const)
    await f.git("config", key, value);
  await f.git("replace", base, target);
  await f.git("switch", "--detach", "--quiet", target);
  await f.write("staged.txt", "staged\n");
  await f.git("add", "--", "staged.txt");
  await f.write("a.txt", "dirty\n");
  await f.write("untracked.txt", "untracked\n");
  await f.write(".gitattributes", "*.txt diff\n");
  // Measuring state must not invoke the fixture's deliberately hostile fsmonitor setting.
  await f.git("config", "core.fsmonitor", "false");
  const before = await snapshot(f);
  assert.deepEqual(await analyzeGitChange(request), expected);
  assert.deepEqual(await snapshot(f), before);
  await f.git("config", "diff.orderFile", "missing-order-file");
  assert.deepEqual(await analyzeGitChange(request), expected);
});

void test("host Git environment, namespaces and alternate object stores are not inherited", async (t) => {
  const f = await createGitFixture(t);
  const other = await createGitFixture(t);
  await f.write("one", "one\n");
  const base = await f.commit("base");
  await f.write("one", "two\n");
  const target = await f.commit("target");
  await other.write("foreign", "foreign\n");
  const foreign = await other.commit("foreign");
  const expected = await analyzeGitChange(input(f.directory, base, target));
  const values: Record<string, string> = {
    GIT_DIR: path.join(other.directory, ".git"),
    GIT_WORK_TREE: other.directory,
    GIT_COMMON_DIR: path.join(other.directory, ".git"),
    GIT_INDEX_FILE: path.join(other.directory, ".git/index"),
    GIT_OBJECT_DIRECTORY: path.join(other.directory, ".git/objects"),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(other.directory, ".git/objects"),
    GIT_NAMESPACE: "malicious",
    GIT_CONFIG_GLOBAL: path.join(other.directory, ".git/config"),
    GIT_CONFIG_SYSTEM: path.join(other.directory, ".git/config"),
    GIT_CONFIG_NOSYSTEM: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "diff.external",
    GIT_CONFIG_VALUE_0: "unavailable-driver",
    GIT_ATTR_NOSYSTEM: "0",
    GIT_ATTR_SOURCE: foreign,
    GIT_CEILING_DIRECTORIES: f.directory,
    GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
    HOME: other.directory,
    XDG_CONFIG_HOME: other.directory,
  };
  const original = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    assert.deepEqual(await analyzeGitChange(input(f.directory, base, target)), expected);
    await assert.rejects(
      analyzeGitChange(input(f.directory, base, foreign)),
      GitCommitNotFoundError,
    );
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  await f.write(".git/objects/info/alternates", `${path.join(other.directory, ".git/objects")}\n`);
  await assert.rejects(
    analyzeGitChange(input(f.directory, base, foreign)),
    UnsupportedGitRepositoryError,
  );
});

void test("bare repositories, linked worktrees and canonical root aliases produce the same facts", async (t) => {
  const f = await createGitFixture(t);
  await f.write("file", "one\n");
  const base = await f.commit("base");
  await f.write("file", "two\n");
  const target = await f.commit("target");
  const expected = await analyzeGitChange(input(f.directory, base, target));
  const bare = path.join(f.directory, "bare.git");
  await f.git("clone", "--bare", "--no-hardlinks", f.directory, bare);
  assert.deepEqual(await analyzeGitChange(input(bare, base, target)), expected);
  const linked = path.join(f.directory, "linked worktree");
  await f.git("worktree", "add", "--detach", linked, target);
  assert.deepEqual(await analyzeGitChange(input(linked, base, target)), expected);
  const alias = path.join(f.directory, "root alias ü");
  await symlink(f.directory, alias, process.platform === "win32" ? "junction" : "dir");
  assert.deepEqual(await analyzeGitChange(input(alias, base, target)), expected);
  assert.deepEqual(
    await analyzeGitChange(input(path.join(f.directory, "unused", ".."), base, target)),
    expected,
  );
  if (process.platform === "win32") {
    assert.deepEqual(
      await analyzeGitChange(input(f.directory.toUpperCase(), base, target)),
      expected,
    );
  }
  assert.deepEqual(
    await analyzeGitChange(
      input(path.relative(process.cwd(), f.directory) + path.sep, base, target),
    ),
    expected,
  );
});

void test("SHA-256 commits retain full identities and reject abbreviated or revision-shaped input", async (t) => {
  let f: GitFixture;
  try {
    f = await createGitFixture(t, "sha256");
  } catch (error) {
    if (
      error instanceof Error &&
      /unknown option|unknown hash algorithm|unsupported.*sha256/iu.test(error.message)
    ) {
      t.skip("Host Git does not support SHA-256");
      return;
    }
    throw error;
  }
  await f.write("file", "old\n");
  const base = await f.commit("base");
  await f.write("file", "new\n");
  const target = await f.commit("target");
  const result = await analyzeGitChange(input(f.directory, base, target));
  assert.equal(result.baseCommit.length, 64);
  assert.equal(result.targetCommit, target);
  for (const bad of [
    base.slice(0, 12),
    "HEAD",
    "main",
    `${base}^`,
    `${base}..${target}`,
    "--help",
  ]) {
    assert.throws(() => input(f.directory, bad, target), InvalidInputError);
    assert.throws(() => input(f.directory, base, bad), InvalidInputError);
  }
  await f.git("tag", "-a", "tag-object", "-m", "tag", target);
  const tag = (await f.git("rev-parse", "refs/tags/tag-object")).trim();
  await assert.rejects(analyzeGitChange(input(f.directory, base, tag)), GitObjectNotCommitError);
});

void test("mode, type and gitlink changes use actual committed tree metadata without checkout", async (t) => {
  const f = await createGitFixture(t);
  await f.write("mode", "content\n");
  await f.write("type", "regular\ncontent\n");
  const initial = await f.commit("initial");
  await f.git("update-index", "--add", "--cacheinfo", "160000", initial, "submodule");
  await f.git("commit", "--quiet", "-m", "base gitlink");
  const base = (await f.git("rev-parse", "HEAD")).trim();
  await f.write("link-target-blob", "destination");
  const typeBlob = (await f.git("hash-object", "-w", "--", "link-target-blob")).trim();
  await f.git("update-index", "--chmod=+x", "mode");
  await f.git("update-index", "--cacheinfo", "120000", typeBlob, "type");
  await f.git("update-index", "--cacheinfo", "160000", base, "submodule");
  await f.git("commit", "--quiet", "-m", "metadata changes");
  const target = (await f.git("rev-parse", "HEAD")).trim();
  const before = await snapshot(f);
  const result = await analyzeGitChange(input(f.directory, base, target));
  assert.deepEqual(
    result.changedFiles.map((file) => [file.path, file.status, file.additions, file.deletions]),
    [
      ["mode", "MODIFIED", 0, 0],
      ["submodule", "MODIFIED", 1, 1],
      ["type", "TYPE_CHANGED", 1, 2],
    ],
  );
  assert.deepEqual(await snapshot(f), before);
});

void test("copy detection considers modified sources but does not claim unchanged-source copies", async (t) => {
  const f = await createGitFixture(t);
  const content = Array.from({ length: 20 }, (_, index) => `line-${index}\n`).join("");
  await f.write("source", content);
  const base = await f.commit("base");
  await f.write("copy", content);
  const added = await f.commit("copy only");
  assert.equal(
    (await analyzeGitChange(input(f.directory, base, added))).changedFiles[0]?.status,
    "ADDED",
  );
  await f.write("source", content + "edited\n");
  const target = await f.commit("modify source");
  const result = await analyzeGitChange(input(f.directory, base, target));
  assert.equal(result.changedFiles.find((file) => file.path === "copy")?.status, "COPIED");
  assert.equal(result.changedFiles.find((file) => file.path === "copy")?.previousPath, "source");
});

void test("failure, timeout, cancellation and output limits leave repository state and locks intact", async (t) => {
  const f = await createGitFixture(t);
  await f.write("file", "content\n");
  const commit = await f.commit("base");
  const request = input(f.directory, commit, commit);
  const before = await snapshot(f);
  await assert.rejects(
    analyzeGitChange(input(f.directory, commit, "f".repeat(40))),
    GitCommitNotFoundError,
  );
  await assert.rejects(analyzeGitChange(request, { timeoutMs: 1 }), GitTimeoutError);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(analyzeGitChange(request, { signal: controller.signal }), GitCancelledError);
  await assert.rejects(analyzeGitChange(request, { maxOutputBytes: 1 }), GitOutputLimitError);
  assert.deepEqual(await snapshot(f), before);
  const empty = await analyzeGitChange(request);
  assert.deepEqual(
    [
      empty.fileCount,
      empty.additions,
      empty.deletions,
      empty.hasUnknownLineCounts,
      empty.analysisEvidenceIds,
    ],
    [0, 0, 0, false, []],
  );
  // Corrupt a fixture object only after all state-preservation checks.
  await chmod(
    path.join(f.directory, `.git/objects/${commit.slice(0, 2)}/${commit.slice(2)}`),
    0o600,
  );
  await f.write(`.git/objects/${commit.slice(0, 2)}/${commit.slice(2)}`, "invalid loose object");
  await assert.rejects(analyzeGitChange(request), GitCommandFailedError);
});
