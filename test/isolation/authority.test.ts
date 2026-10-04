import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { symlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  prepareControlledWorkspace,
  disposeControlledWorkspace,
} from "../../src/execution/index.js";
import { contained } from "../../src/execution/validation.js";
import { createContainerExecutor, parseIsolationConfiguration } from "../../src/isolation/index.js";
import { trustedFileHash } from "../../src/isolation/executor.js";
import { mountPath } from "../../src/isolation/configuration.js";
import { generateVerificationPlan } from "../../src/planning/index.js";
import { planningFixture } from "../planning/fixture.js";

void test("workspace-local Docker authority rejects even with an explicitly matching pin", async () => {
  const configuration = parseIsolationConfiguration({
    schemaVersion: 9,
    version: "authority",
    imageId: `sha256:${"a".repeat(64)}`,
    repositoryDigest: `node@sha256:${"a".repeat(64)}`,
    uid: 1000,
    gid: 1000,
    memoryMiB: 128,
    cpuMillis: 500,
    pids: 64,
    scratchMiB: 8,
    tmpMiB: 8,
    definitions: [],
  });
  const planningInput = { ...planningFixture(["TEST"]), configuration: configuration.identity };
  const plan = generateVerificationPlan(planningInput);
  const workspace = await prepareControlledWorkspace({
    kind: "CONTROLLED_FIXTURE",
    repository: plan.context.repository,
    baseCommit: plan.context.baseCommit,
    targetCommit: plan.context.targetCommit,
    files: [{ path: "docker.exe", contents: "not an executable; never run" }],
  });
  try {
    const host = {
      dockerExecutable: path.join(workspace.directory, "docker.exe"),
      dockerSha256: createHash("sha256").update("not an executable; never run").digest("hex"),
      endpoint: "npipe:////./pipe/dockerDesktopLinuxEngine",
    };
    const executor = await createContainerExecutor(configuration, host);
    await assert.rejects(
      executor.executeCheck({ planningInput, plan, checkId: plan.checks[0]!.id, workspace }),
      /Docker authority cannot come from source workspace/u,
    );
    for (const override of [
      { dockerExecutable: "docker.exe" },
      { endpoint: "tcp://example.invalid:2375" },
      { endpoint: "npipe:////./pipe/other" },
      { dockerSha256: "f".repeat(64) },
    ])
      await assert.rejects(createContainerExecutor(configuration, { ...host, ...override }));
    assert.equal(await trustedFileHash(host.dockerExecutable, 1024), host.dockerSha256);
    await symlink(workspace.directory, path.join(workspace.directory, "alias"), "junction");
    await assert.rejects(
      trustedFileHash(path.join(workspace.directory, "alias", "docker.exe"), 1024),
    );
  } finally {
    await disposeControlledWorkspace(workspace);
  }
});

void test("Windows mount paths reject aliases and containment distinguishes sibling prefixes", () => {
  const root = path.resolve("source");
  assert.equal(contained(root, path.join(root, "file.mjs")), true);
  assert.equal(contained(root, `${root}-sibling\\file.mjs`), false);
  assert.equal(contained(root.toLowerCase(), path.join(root, "file.mjs")), true);
  for (const value of [
    "docker.exe",
    "C:\\Users\\..\\Windows",
    "C:/Users/file.mjs",
    "C:\\Users\\file.mjs.",
    "C:\\Users\\file.mjs ",
    "C:\\Users\\file.mjs:stream",
    "\\\\server\\share\\file.mjs",
    "\\\\?\\C:\\file.mjs",
    "C:\\source,evil",
    'C:\\source"evil',
  ])
    assert.throws(() => mountPath(value), value);
  assert.equal(mountPath(path.resolve("source with spaces")), path.resolve("source with spaces"));
});
