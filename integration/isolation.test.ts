import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createContainerExecutor,
  parseIsolationConfiguration,
  validateContainerResult,
} from "../src/isolation/index.js";
import { trustedFileHash } from "../src/isolation/executor.js";
import { dockerTransport, type DockerHost } from "../src/isolation/docker-adapter.js";
import { prepareControlledWorkspace, disposeControlledWorkspace } from "../src/execution/index.js";
import { generateVerificationPlan } from "../src/planning/index.js";
import { captureExecutionEvidence } from "../src/evidence/index.js";
import { evaluateVerdict } from "../src/verdict/index.js";
import { planningFixture } from "../test/planning/fixture.js";
import { createArguments } from "../src/isolation/configuration.js";
import { validateWorkspaceFiles } from "../src/execution/workspace.js";

const dockerExecutable =
  "C:\\Users\\Teoh Chung Jay\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker.exe";
const imageId = "sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32";
const endpoint = "npipe:////./pipe/dockerDesktopLinuxEngine";
const verifier = path.join(import.meta.dirname, "verifier.mjs");

async function fixture(
  mode: string,
  options: {
    timeoutMs?: number;
    maxOutputBytes?: number;
    memoryMiB?: number;
    pids?: number;
    args?: readonly string[];
    signal?: AbortSignal;
    missingDefinition?: boolean;
    missingImage?: boolean;
  } = {},
): Promise<{
  result: Awaited<ReturnType<Awaited<ReturnType<typeof createContainerExecutor>>["executeCheck"]>>;
  verdict: string;
  source: string;
}> {
  const definition = {
    strategy: "EXISTING_TESTS",
    version: "phase9-owned-fixture-1",
    verifier,
    verifierSha256: await trustedFileHash(verifier, 1048576),
    args: [mode, ...(options.args ?? [])],
    timeoutMs: options.timeoutMs ?? 15000,
    maxOutputBytes: options.maxOutputBytes ?? 8192,
  };
  const configuration = parseIsolationConfiguration({
    schemaVersion: 9,
    version: "phase9-integration",
    imageId: options.missingImage ? `sha256:${"0".repeat(64)}` : imageId,
    repositoryDigest: `node@${imageId}`,
    uid: 1000,
    gid: 1000,
    memoryMiB: options.memoryMiB ?? 128,
    cpuMillis: 500,
    pids: options.pids ?? 64,
    scratchMiB: 8,
    tmpMiB: 8,
    definitions: options.missingDefinition ? [] : [definition],
  });
  const executor = await createContainerExecutor(configuration, {
    dockerExecutable,
    dockerSha256: await trustedFileHash(dockerExecutable, 128 * 1024 * 1024),
    endpoint,
  });
  const planningInput = { ...planningFixture(["TEST"]), configuration: configuration.identity };
  const plan = generateVerificationPlan(planningInput);
  const workspace = await prepareControlledWorkspace({
    kind: "CONTROLLED_FIXTURE",
    repository: plan.context.repository,
    baseCommit: plan.context.baseCommit,
    targetCommit: plan.context.targetCommit,
    files: [
      { path: "source.txt", contents: "original" },
      { path: "package.json", contents: '{"scripts":{"test":"NEVER_RUN_REPOSITORY_SCRIPT"}}' },
    ],
  });
  const request = {
    planningInput,
    plan,
    checkId: plan.checks.find((check) => check.strategy === "EXISTING_TESTS")!.id,
    workspace,
  };
  try {
    await assert.rejects(executor.executeCheck({ ...request, checkId: "unknown" }));
    await assert.rejects(executor.executeCheck({ ...request, plan: { ...plan, checks: [] } }));
    const result = await executor.executeCheck(request, options.signal);
    assert.equal(result.provenance.imageId, configuration.imageId);
    assert.equal(result.backend, "DOCKER_LINUX");
    assert.ok(Object.isFrozen(result.provenance));
    assert.deepEqual(validateContainerResult(result, JSON.parse(JSON.stringify(result))), result);
    assert.throws(() => validateContainerResult(result, { ...result, backend: "HOST_DIRECT" }));
    // Independent capture must detect every provenance/binding/outcome substitution.
    for (const keys of [
      ["isolationVersion"],
      ["isolationIdentity", "hash"],
      ["provenance", "imageId"],
      ["provenance", "repositoryDigest"],
      ["provenance", "containerId"],
      ["provenance", "instance"],
      ["provenance", "removed"],
      ["provenance", "appliedProfile"],
      ["execution", "binding", "planId"],
      ["execution", "binding", "check", "id"],
      ["execution", "binding", "definition"],
      ["execution", "state"],
    ]) {
      const tampered = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
      let parent = tampered;
      for (const key of keys.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
      parent[keys.at(-1)!] = "tampered";
      assert.throws(() => validateContainerResult(result, tampered), keys.join("."));
    }
    const ref = captureExecutionEvidence(
      planningInput,
      plan,
      result.execution.binding,
      result.execution,
    );
    const verdict = evaluateVerdict({ planningInput, plan, results: [result.execution] }, [
      ref,
    ]).verdict;
    const source = await readFile(path.join(workspace.directory, "source.txt"), "utf8");
    await validateWorkspaceFiles(workspace);
    await assert.rejects(executor.executeCheck(request));
    if (result.provenance.containerId) {
      assert.equal(result.provenance.removed, true, JSON.stringify(result));
      assert.deepEqual(result.provenance.appliedProfile, {
        imageId,
        user: "1000:1000",
        memoryBytes: (options.memoryMiB ?? 128) * 1048576,
        memorySwapBytes: (options.memoryMiB ?? 128) * 1048576,
        nanoCpus: 500000000,
        pids: options.pids ?? 64,
        network: "none",
        readOnlyRootfs: true,
        sourceReadOnly: true,
        verifierReadOnly: true,
      });
      const host: DockerHost = {
        executable: dockerExecutable,
        endpoint,
        directory: workspace.directory,
        environment: {
          SystemRoot: process.env.SystemRoot!,
          PATH: "",
          USERPROFILE: workspace.directory,
          DOCKER_CONFIG: workspace.directory,
        },
      };
      const inspect = await dockerTransport.run(
        host,
        ["container", "inspect", result.provenance.containerId],
        65536,
        5000,
      );
      assert.notEqual(inspect.code, 0, "exact test container must no longer exist");
    }
    return { result, verdict, source };
  } finally {
    await disposeControlledWorkspace(workspace);
  }
}

void test("real Docker: pre-provisioned image and PASS/FAIL/ERROR flow unchanged through Phase 8", async () => {
  for (const [mode, state, verdict] of [
    ["pass", "PASS", "APPROVE"],
    ["fail", "FAIL", "BLOCK"],
    ["error", "ERROR", "INCONCLUSIVE"],
  ]) {
    const result = await fixture(mode!);
    assert.equal(result.result.execution.state, state, JSON.stringify(result.result));
    assert.equal(result.verdict, verdict);
    assert.equal(result.result.provenance.runtimeVersion, "29.7.2");
  }
});
void test("real Docker: non-root, no network/capabilities/secrets/socket, read-only source/root/verifier, writable scratch", async () => {
  process.env.RISKVERIFIER_FAKE_SECRET = "must-not-leak";
  process.env.dOcKeR_hOsT = "tcp://127.0.0.1:1";
  process.env.dOcKeR_cOnTeXt = "must-not-be-used";
  try {
    const { result, source } = await fixture("security");
    assert.equal(result.execution.state, "PASS", JSON.stringify(result));
    assert.equal(source, "original");
    const report = JSON.parse(
      Buffer.from(result.execution.observation.diagnostics.stdout, "base64").toString("utf8"),
    ) as { uid: number };
    assert.equal(report.uid, 1000);
  } finally {
    delete process.env.RISKVERIFIER_FAKE_SECRET;
    delete process.env.dOcKeR_hOsT;
    delete process.env.dOcKeR_cOnTeXt;
  }
});

void test("real Docker: reachable local peer is unreachable from isolation; unrelated running container survives cleanup", async () => {
  const input = planningFixture(["TEST"]),
    plan = generateVerificationPlan(input);
  const workspace = await prepareControlledWorkspace({
    kind: "CONTROLLED_FIXTURE",
    repository: plan.context.repository,
    baseCommit: plan.context.baseCommit,
    targetCommit: plan.context.targetCommit,
    files: [],
  });
  const host: DockerHost = {
    executable: dockerExecutable,
    endpoint,
    directory: workspace.directory,
    environment: {
      SystemRoot: process.env.SystemRoot!,
      PATH: "",
      USERPROFILE: workspace.directory,
    },
  };
  const ids: string[] = [];
  const call = async (args: readonly string[]): Promise<string> => {
    const result = await dockerTransport.run(host, args, 65536, 10000);
    assert.equal(result.code, 0, JSON.stringify(result));
    assert.equal(result.cause, null);
    assert.equal(result.confirmed, true);
    return Buffer.from(result.diagnostics.stdout, "base64").toString();
  };
  type PeerState = {
    Id: string;
    State: { Running: boolean };
    NetworkSettings: { Networks: { bridge: { IPAddress: string } } };
  };
  const inspect = async (id: string): Promise<PeerState> =>
    JSON.parse(await call(["container", "inspect", "--format", "{{json .}}", id])) as PeerState;
  const create = async (mode: string, args: string[] = []): Promise<string> => {
    const config = parseIsolationConfiguration({
      schemaVersion: 9,
      version: "bounded-test-peer",
      imageId,
      repositoryDigest: `node@${imageId}`,
      uid: 1000,
      gid: 1000,
      memoryMiB: 64,
      cpuMillis: 500,
      pids: 32,
      scratchMiB: 8,
      tmpMiB: 8,
      definitions: [
        {
          strategy: "BUILD",
          version: "owned-peer",
          verifier,
          verifierSha256: await trustedFileHash(verifier, 1048576),
          args: [mode, ...args],
          timeoutMs: 15000,
          maxOutputBytes: 8192,
        },
      ],
    });
    // Test-only positive network control. Never used by the production executor.
    const arguments_ = createArguments(
      config,
      config.definitions[0]!,
      workspace.directory,
      `riskverifier-${randomUUID()}`,
    ).map((value) => (value === "--network=none" ? "--network=bridge" : value));
    const id = (await call(arguments_)).trim();
    assert.match(id, /^[a-f0-9]{64}$/u);
    ids.push(id);
    return id;
  };
  try {
    const peer = await create("listener");
    await call(["container", "start", peer]);
    const initial = await inspect(peer);
    assert.equal(initial.State.Running, true);
    const address = initial.NetworkSettings.Networks.bridge.IPAddress;
    assert.match(address, /^\d+\.\d+\.\d+\.\d+$/u);
    const control = await create("network-allowed", [address]);
    assert.deepEqual(JSON.parse(await call(["container", "start", "--attach", control])), {
      connected: true,
    });
    const denied = await fixture("network-denied", { args: [address] });
    assert.equal(denied.result.execution.state, "PASS", JSON.stringify(denied.result));
    const stillThere = await inspect(peer);
    assert.equal(stillThere.Id, peer);
    assert.equal(stillThere.State.Running, true, "unrelated peer must survive executor cleanup");
  } finally {
    // Only IDs created and validated by this test; never enumeration/labels/names.
    for (const id of ids.reverse()) {
      if ((await inspect(id)).State.Running) await call(["container", "kill", "--signal=KILL", id]);
      await call(["container", "rm", id]);
    }
    await disposeControlledWorkspace(workspace);
  }
});
void test("real Docker: shell metacharacters remain literal arguments", async () => {
  const args = [";", "&&", "|", ">", "$()", "`", '"', "spaces here"];
  const { result } = await fixture("args", { args });
  assert.equal(result.execution.state, "PASS", JSON.stringify(result));
  assert.deepEqual(
    JSON.parse(
      Buffer.from(result.execution.observation.diagnostics.stdout, "base64").toString("utf8"),
    ),
    args,
  );
});
void test("real Docker: timeout and output overflow terminate and remove exact containers", async () => {
  const timed = await fixture("timeout", { timeoutMs: 4000 });
  assert.equal(timed.result.execution.state, "TIMEOUT", JSON.stringify(timed.result));
  assert.equal(timed.verdict, "INCONCLUSIVE");
  const overflow = await fixture("overflow", { maxOutputBytes: 512 });
  assert.equal(overflow.result.execution.state, "ERROR");
  assert.equal(overflow.result.execution.observation.outcome, "OUTPUT_LIMIT");
  assert.equal(
    overflow.result.execution.observation.diagnostics.stdoutBytes +
      overflow.result.execution.observation.diagnostics.stderrBytes,
    512,
  );
});
void test("real Docker: cancellation targets the container, including pre-start cancellation", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const cancelled = await fixture("timeout", { signal: controller.signal });
    assert.equal(cancelled.result.execution.state, "CANCELLED", JSON.stringify(cancelled.result));
  } finally {
    clearTimeout(timer);
  }
  const pre = new AbortController();
  pre.abort();
  const cancelled = await fixture("pass", { signal: pre.signal });
  assert.equal(cancelled.result.execution.state, "CANCELLED");
  assert.equal(cancelled.result.provenance.containerId, null);
});
void test("real Docker: bounded memory and PID exhaustion cannot masquerade as valid FAIL", async () => {
  const oom = await fixture("oom", { memoryMiB: 64 });
  assert.equal(oom.result.execution.state, "ERROR", JSON.stringify(oom.result));
  assert.equal(oom.result.provenance.oomKilled, true);
  const pids = await fixture("pids", { pids: 24 });
  assert.notEqual(pids.result.execution.state, "FAIL");
  assert.equal(pids.result.execution.state, "PASS", JSON.stringify(pids.result));
});

void test("real Docker: absent local image fails closed without fetching; missing verifier remains UNSUPPORTED", async () => {
  const absent = await fixture("pass", { missingImage: true });
  assert.equal(absent.result.execution.state, "ERROR");
  assert.equal(absent.result.provenance.containerId, null);
  assert.equal(absent.verdict, "INCONCLUSIVE");
  const unsupported = await fixture("pass", { missingDefinition: true });
  assert.equal(unsupported.result.execution.state, "UNSUPPORTED");
  assert.equal(unsupported.verdict, "INCONCLUSIVE");
  assert.equal(unsupported.result.provenance.containerId, null);
});
