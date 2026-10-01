import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { CLASSIFIER_VERSION } from "../../src/classification/index.js";

void test("reviewed classifier version binds rule, parser, evidence and extraction source", async () => {
  const reviewed: Readonly<Record<string, string>> = {
    "3.1.0": "10082df2f5bb98b26f0b452206610b90de2282e61863f288146ce1f0c4296334",
  };
  const hash = createHash("sha256");
  for (const file of [
    "src/classification/classifier.ts",
    "src/classification/rules.ts",
    "src/classification/syntax.ts",
    "src/domain/classification-facts.ts",
    "src/git/change-content.ts",
  ]) {
    hash.update(file + "\n" + (await readFile(file, "utf8")).replace(/\r\n/gu, "\n") + "\n");
  }
  assert.equal(ts.version, "6.0.3");
  assert.equal(
    hash.digest("hex"),
    reviewed[CLASSIFIER_VERSION],
    "Source changed: explicitly review the classifier version and update its fingerprint; do not silently reuse a reviewed rule identity",
  );
});
