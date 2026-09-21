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
  assert.ok(Object.isFrozen(changedFile));
  assert.ok(Object.isFrozen(changeSet));
  assert.ok(Object.isFrozen(changeSet.changedFiles));
});

void test("rejects negative or fractional line counts", () => {
  assert.throws(
    () =>
      createChangedFile({
        path: "src/auth.ts",
        status: "MODIFIED",
        additions: -1,
        deletions: 0,
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
          } as never,
        ],
      }),
    InvalidInputError,
  );
});
