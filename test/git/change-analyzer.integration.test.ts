import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rename, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { InvalidInputError } from "../../src/domain/index.js";
import {
  GitCommitNotFoundError,
  GitExecutableUnavailableError,
  GitObjectNotCommitError,
  GitOutputLimitError,
  GitRepositoryNotDirectoryError,
  GitRepositoryNotFoundError,
  GitRepositoryPathError,
  NotGitRepositoryError,
  analyzeGitChange,
  createGitChangeAnalysisInput,
} from "../../src/git/index.js";
import { createGitFixture } from "./git-fixture.js";

function createInput(
  repositoryPath: string,
  baseCommit: string,
  targetCommit: string,
): ReturnType<typeof createGitChangeAnalysisInput> {
  return createGitChangeAnalysisInput({
    repositoryPath,
    repository: "fixture-repository",
    baseCommit,
    targetCommit,
  });
}

void test("analyzes committed changes deterministically without touching repository state", async (t) => {
  const fixture = await createGitFixture(t);
  await fixture.write("modified.txt", "old\n");
  await fixture.write("deleted.txt", "one\ntwo\n");
  await fixture.write(
    "old name.txt",
    Array.from({ length: 20 }, (_, index) => `line-${index}\n`).join(""),
  );
  await fixture.write("binary.bin", Buffer.from([0, 1, 2, 3]));
  const baseCommit = await fixture.commit("base");

  await fixture.write("modified.txt", "old\nnew\n");
  await unlink(path.join(fixture.directory, "deleted.txt"));
  await fixture.write("file with spaces.txt", "space\n");
  await fixture.write("ユニコード.txt", "unicode\n");
  await fixture.write("-leading.txt", "leading\n");
  await rename(
    path.join(fixture.directory, "old name.txt"),
    path.join(fixture.directory, "renamed ü name.txt"),
  );
  await fixture.write(
    "renamed ü name.txt",
    `${Array.from({ length: 19 }, (_, index) => `line-${index}\n`).join("")}changed\n`,
  );
  await fixture.write("binary.bin", Buffer.from([0, 1, 9, 3]));
  const targetCommit = await fixture.commit("target");

  const input = createInput(fixture.directory, baseCommit, targetCommit);
  const first = await analyzeGitChange(input);
  const byPath = new Map(first.changedFiles.map((file) => [file.path, file]));

  assert.equal(first.repository, "fixture-repository");
  assert.equal(first.baseCommit, baseCommit);
  assert.equal(first.targetCommit, targetCommit);
  assert.equal(first.fileCount, 7);
  assert.deepEqual(byPath.get("modified.txt"), {
    path: "modified.txt",
    status: "MODIFIED",
    additions: 1,
    deletions: 0,
    isBinary: false,
  });
  assert.deepEqual(byPath.get("deleted.txt"), {
    path: "deleted.txt",
    status: "DELETED",
    additions: 0,
    deletions: 2,
    isBinary: false,
  });
  assert.deepEqual(byPath.get("renamed ü name.txt"), {
    path: "renamed ü name.txt",
    previousPath: "old name.txt",
    status: "RENAMED",
    additions: 1,
    deletions: 1,
    isBinary: false,
  });
  assert.deepEqual(byPath.get("binary.bin"), {
    path: "binary.bin",
    status: "MODIFIED",
    additions: null,
    deletions: null,
    isBinary: true,
  });
  assert.equal(byPath.get("file with spaces.txt")?.status, "ADDED");
  assert.equal(byPath.get("ユニコード.txt")?.status, "ADDED");
  assert.equal(byPath.get("-leading.txt")?.status, "ADDED");
  assert.equal(first.additions, 5);
  assert.equal(first.deletions, 3);
  assert.equal(first.hasUnknownLineCounts, true);

  await fixture.git("switch", "--quiet", "-c", "unrelated-branch");
  await fixture.write("branch-only.txt", "branch\n");
  await fixture.commit("unrelated branch commit");
  await fixture.write("uncommitted.txt", "uncommitted\n");
  await fixture.write("modified.txt", "working tree only\n");

  const sentinel = path.join(fixture.directory, "external-diff-ran");
  await fixture.write(
    "external-diff.cjs",
    `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "ran");\n`,
  );
  await fixture.write(".gitattributes", "*.txt diff=evil\n");
  await fixture.git("config", "diff.external", "node external-diff.cjs");
  await fixture.git("config", "diff.evil.command", "node external-diff.cjs");
  await fixture.git("config", "diff.evil.textconv", "node external-diff.cjs");

  const stateBefore = {
    head: await fixture.git("rev-parse", "HEAD"),
    branch: await fixture.git("symbolic-ref", "--short", "HEAD"),
    status: await fixture.git("status", "--porcelain=v1", "-z"),
    refs: await fixture.git("show-ref", "--head"),
    index: await fixture.git("diff", "--cached", "--binary"),
    config: await readFile(path.join(fixture.directory, ".git", "config"), "utf8"),
  };
  const second = await analyzeGitChange(input);
  const stateAfter = {
    head: await fixture.git("rev-parse", "HEAD"),
    branch: await fixture.git("symbolic-ref", "--short", "HEAD"),
    status: await fixture.git("status", "--porcelain=v1", "-z"),
    refs: await fixture.git("show-ref", "--head"),
    index: await fixture.git("diff", "--cached", "--binary"),
    config: await readFile(path.join(fixture.directory, ".git", "config"), "utf8"),
  };

  assert.deepEqual(second, first);
  assert.deepEqual(stateAfter, stateBefore);
  await assert.rejects(access(sentinel));

  const empty = await analyzeGitChange(createInput(fixture.directory, targetCommit, targetCommit));
  assert.deepEqual(empty.changedFiles, []);
  assert.equal(empty.fileCount, 0);
});

void test("validates commit syntax, existence, and object type", async (t) => {
  const fixture = await createGitFixture(t);
  await fixture.write("file.txt", "content\n");
  const commit = await fixture.commit("commit");

  assert.throws(() => createInput(fixture.directory, "short", commit), InvalidInputError);
  assert.throws(() => createInput(fixture.directory, commit, "HEAD"), InvalidInputError);
  await assert.rejects(
    analyzeGitChange(createInput(fixture.directory, "f".repeat(40), commit)),
    GitCommitNotFoundError,
  );

  await fixture.write("blob-source.txt", "blob\n");
  const blob = (await fixture.git("hash-object", "-w", "--", "blob-source.txt")).trim();
  await assert.rejects(
    analyzeGitChange(createInput(fixture.directory, blob, commit)),
    GitObjectNotCommitError,
  );
});

void test("validates repository paths and roots", async (t) => {
  assert.throws(
    () =>
      createGitChangeAnalysisInput({
        repositoryPath: " ",
        repository: "repo",
        baseCommit: "a".repeat(40),
        targetCommit: "b".repeat(40),
      }),
    GitRepositoryPathError,
  );

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "riskverifier invalid repos "));
  t.after(async () => rm(temporaryRoot, { force: true, recursive: true }));
  const commits = ["a".repeat(40), "b".repeat(40)] as const;
  await assert.rejects(
    analyzeGitChange(createInput(path.join(temporaryRoot, "missing"), ...commits)),
    GitRepositoryNotFoundError,
  );

  const fixture = await createGitFixture(t);
  await fixture.write("file.txt", "content\n");
  const commit = await fixture.commit("commit");
  await assert.rejects(
    analyzeGitChange(createInput(path.join(fixture.directory, "file.txt"), commit, commit)),
    GitRepositoryNotDirectoryError,
  );
  await assert.rejects(
    analyzeGitChange(createInput(temporaryRoot, commit, commit)),
    NotGitRepositoryError,
  );

  await fixture.write("nested/file.txt", "nested\n");
  await assert.rejects(
    analyzeGitChange(createInput(path.join(fixture.directory, "nested"), commit, commit)),
    NotGitRepositoryError,
  );
});

void test("reports unavailable Git and output-limit failures distinctly", async (t) => {
  const fixture = await createGitFixture(t);
  await fixture.write("file.txt", "content\n");
  const commit = await fixture.commit("commit");
  const input = createInput(fixture.directory, commit, commit);

  await assert.rejects(
    analyzeGitChange(input, { gitExecutable: "riskverifier-git-does-not-exist" }),
    GitExecutableUnavailableError,
  );
  await assert.rejects(analyzeGitChange(input, { maxOutputBytes: 1 }), GitOutputLimitError);
});
