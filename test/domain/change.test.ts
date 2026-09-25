import assert from "node:assert/strict";
import test from "node:test";

import { InvalidInputError, createChangeSet, createChangedFile } from "../../src/domain/index.js";
import { SHA_A, SHA_B } from "../helpers.js";

void test("creates an immutable changed file and change set without performing Git analysis", () => {
  const changedFile = createChangedFile({
    path: "src/auth.ts",
    status: "MODIFIED",
    additions: 4,
    deletions: 2,
    isBinary: false,
  });
  const changeSet = createChangeSet({
    repository: "repo",
    baseCommit: SHA_A,
    targetCommit: SHA_B,
    analyzerVersion: "not-yet-implemented",
    changedFiles: [changedFile],
  });

  assert.equal(changeSet.changedFiles[0]?.path, "src/auth.ts");
  assert.equal(changeSet.changedFiles[0]?.status, "MODIFIED");
  assert.equal(changeSet.fileCount, 1);
  assert.equal(changeSet.additions, 4);
  assert.equal(changeSet.deletions, 2);
  assert.equal(changeSet.hasUnknownLineCounts, false);
  assert.ok(Object.isFrozen(changedFile));
  assert.ok(Object.isFrozen(changeSet));
  assert.ok(Object.isFrozen(changeSet.changedFiles));
});

void test("represents binary counts honestly and preserves unusual Git paths", () => {
  const binary = createChangedFile({
    path: "assets/line\nwith\ttabs.bin",
    status: "MODIFIED",
    additions: null,
    deletions: null,
    isBinary: true,
  });
  const renamed = createChangedFile({
    path: "renamed/新 name.txt",
    previousPath: "-old name.txt",
    status: "RENAMED",
    additions: 1,
    deletions: 1,
    isBinary: false,
  });
  const changeSet = createChangeSet({
    repository: "repo",
    baseCommit: SHA_A,
    targetCommit: SHA_B,
    analyzerVersion: "phase-2-test",
    changedFiles: [binary, renamed],
  });

  assert.equal(binary.additions, null);
  assert.equal(binary.path, "assets/line\nwith\ttabs.bin");
  assert.equal(changeSet.additions, 1);
  assert.equal(changeSet.deletions, 1);
  assert.equal(changeSet.hasUnknownLineCounts, true);
});

void test("rejects contradictory rename and binary representations", () => {
  assert.throws(
    () =>
      createChangedFile({
        path: "new.txt",
        status: "RENAMED",
        additions: 0,
        deletions: 0,
        isBinary: false,
      }),
    InvalidInputError,
  );
  assert.throws(
    () =>
      createChangedFile({
        path: "file.bin",
        status: "MODIFIED",
        additions: 0,
        deletions: 0,
        isBinary: true,
      }),
    InvalidInputError,
  );
  assert.throws(
    () =>
      createChangedFile({
        path: "../outside.txt",
        status: "ADDED",
        additions: 1,
        deletions: 0,
        isBinary: false,
      }),
    InvalidInputError,
  );
});

void test("rejects negative or fractional line counts", () => {
  assert.throws(
    () =>
      createChangedFile({
        path: "src/auth.ts",
        status: "MODIFIED",
        additions: -1,
        deletions: 0,
        isBinary: false,
      }),
    InvalidInputError,
  );
  assert.throws(
    () =>
      createChangedFile({
        path: "src/auth.ts",
        status: "MODIFIED",
        additions: 1.5,
        deletions: 0,
        isBinary: false,
      }),
    InvalidInputError,
  );

  assert.throws(
    () =>
      createChangeSet({
        repository: "repo",
        baseCommit: SHA_A,
        targetCommit: SHA_B,
        analyzerVersion: "future-analyzer",
        changedFiles: [
          {
            path: "src/auth.ts",
            status: "NOT_A_STATUS",
            additions: 0,
            deletions: 0,
            isBinary: false,
          } as never,
        ],
      }),
    InvalidInputError,
  );
});
