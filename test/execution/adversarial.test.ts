import assert from "node:assert/strict";
import cp from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter, getEventListeners } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { access, realpath, rm, mkdtemp, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { boundedExecution } from "../../src/execution/bounded-execution.js";
import {
  createControlledExecutor,
  disposeControlledWorkspace,
  parseExecutionConfiguration,
  parseExecutionDefinition,
} from "../../src/execution/index.js";
import { definition, setup, verifier } from "./fixture.js";

// Isolated test-file process: no production injection seam or public arbitrary runner.
function fakeSpawn(
  t: TestContext,
  emitSpawn = true,
): {
  child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => boolean };
  calls: () => number;
} {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => true,
  });
  let count = 0;
  t.mock.method(cp, "spawn", (() => {
    count++;
    if (emitSpawn) queueMicrotask(() => child.emit("spawn"));
    return child;
  }) as unknown as typeof cp.spawn);
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    child.stdout.destroy();
    child.stderr.destroy();
  });
  return { child, calls: () => count };
}

void test("a completed workspace is consumed rather than reusable", async (t) => {
  const fixture = await setup(t);
  await fixture.executor.executeCheck(fixture.request);
  await assert.rejects(fixture.executor.executeCheck(fixture.request));
});

void test("OS permission and format failures never become verifier FAIL", async (t) => {
  const configured = await definition();
  const fake = fakeSpawn(t, false);
  for (const code of ["EACCES", "ENOEXEC", "ENOENT"]) {
    const operation = boundedExecution.run({
      definition: configured,
      directory: process.cwd(),
      environment: {},
    });
    fake.child.emit("error", Object.assign(new Error("simulated OS startup failure"), { code }));
    fake.child.emit("close", -13, null);
    const result = await operation;
    assert.equal(result.outcome, "START_ERROR");
    assert.equal(result.started, false);
    assert.equal(result.exitCode, null);
    assert.equal(result.terminationConfirmed, true);
    fake.child.removeAllListeners();
    fake.child.stdout.removeAllListeners();
    fake.child.stderr.removeAllListeners();
  }
});

void test("result validation rejects impossible limit and preflight observations", async (t) => {
  const fixture = await setup(t);
  const original = await fixture.executor.executeCheck(fixture.request);
  const overflow = structuredClone(original);
  Object.assign(overflow, { state: "ERROR" });
  Object.assign(overflow.observation, {
    outcome: "OUTPUT_LIMIT",
    diagnostics: {
      encoding: "base64",
      stdout: "",
      stderr: "",
      stdoutBytes: 0,
      stderrBytes: 0,
      observedBytes: 1,
      truncated: true,
      sensitivity: "SENSITIVE",
    },
  });
  assert.throws(() => fixture.executor.validateResult(fixture.request, overflow));
  const unavailable = structuredClone(original);
  Object.assign(unavailable, { state: "ERROR" });
  Object.assign(unavailable.observation, {
    outcome: "EXECUTABLE_UNAVAILABLE",
    started: false,
    exitCode: null,
    durationMs: 20,
    diagnostics: {
      encoding: "base64",
      stdout: "",
      stderr: "",
      stdoutBytes: 0,
      stderrBytes: 0,
      observedBytes: 0,
      truncated: false,
      sensitivity: "SENSITIVE",
    },
  });
  assert.throws(() => fixture.executor.validateResult(fixture.request, unavailable));
  for (const state of ["FAIL", "TIMEOUT", "CANCELLED", "UNSUPPORTED"])
    assert.throws(() => fixture.executor.validateResult(fixture.request, { ...original, state }));
  assert.throws(() =>
    fixture.executor.validateResult(
      { ...fixture.request, checkId: "check:authorization-verification" },
      original,
    ),
  );
  const absent = await setup(t, "pass", { definitions: [] });
  const cancelled = new AbortController();
  cancelled.abort();
  const impossible = await absent.executor.executeCheck(absent.request, cancelled.signal);
  assert.throws(() =>
    absent.executor.validateResult(absent.request, {
      ...impossible,
      observation: { ...impossible.observation, started: true },
    }),
  );
});

void test("fragmented output uses fixed storage, copies bytes and cannot PASS after overflow", async (t) => {
  const configured = await definition("pass", { maxOutputBytes: 16384 });
  const fake = fakeSpawn(t);
  const operation = boundedExecution.run({
    definition: configured,
    directory: process.cwd(),
    environment: {},
  });
  await Promise.resolve();
  const from = Buffer.from.bind(Buffer);
  let fragmentCopies = 0;
  t.mock.method(Buffer, "from", ((...args: Parameters<typeof Buffer.from>) => {
    fragmentCopies++;
    return Reflect.apply(from, Buffer, args);
  }) as typeof Buffer.from);
  const byte = Buffer.alloc(1, 0x61);
  for (let i = 0; i < 16385; i++) fake.child.stdout.emit("data", byte);
  byte[0] = 0x62;
  fake.child.emit("exit", 0, null);
  fake.child.emit("close", 0, null);
  const result = await operation;
  assert.equal(result.outcome, "OUTPUT_LIMIT");
  assert.equal(result.diagnostics.stdoutBytes, 16384);
  assert.equal(result.diagnostics.stdout, Buffer.alloc(16384, 0x61).toString("base64"));
  assert.equal(fragmentCopies, 0, "No per-fragment Buffer allocation");
});

void test("unconfirmed close quarantines executor and workspace without deleting files", async (t) => {
  // An OS failure is simulated, never created as a real leaked child.
  const fixture = await setup(t, "pass", { cleanup: false });
  const directory = fixture.request.workspace.directory;
  t.after(async () => {
    assert.equal(await realpath(directory), directory);
    assert.equal(path.dirname(directory), await realpath(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("riskverifier controlled fixture "));
    await rm(directory, { recursive: true });
  });
  const fake = fakeSpawn(t);
  const controller = new AbortController();
  const operation = fixture.executor.executeCheck(fixture.request, controller.signal);
  while (fake.calls() === 0) await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  const result = await operation;
  assert.equal(result.state, "ERROR");
  assert.equal(result.observation.outcome, "TERMINATION_UNCONFIRMED");
  assert.equal(result.observation.terminationConfirmed, false);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  await assert.rejects(fixture.executor.executeCheck(fixture.request));
  const independent = await createControlledExecutor({
    kind: "CONTROLLED_FIXTURE_ONLY",
    executables: [process.execPath],
    verifiers: [
      { path: verifier, sha256: fixture.request.configuration.definitions[0]!.verifierSha256 },
    ],
  });
  await assert.rejects(independent.executeCheck(fixture.request));
  const fresh = await setup(t);
  await assert.rejects(fixture.executor.executeCheck(fresh.request));
  await assert.rejects(disposeControlledWorkspace(fixture.request.workspace));
  await access(directory);
  // Quarantine intentionally prohibits public cleanup; no real process existed here.
  // The test harness alone removes this exact fixture after the simulated failure.
});

void test("timeout versus completion ordering settles once in repeated deterministic races", async (t) => {
  const configured = await definition("pass", { timeoutMs: 5 });
  const fake = fakeSpawn(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (let i = 0; i < 30; i++) {
    let settlements = 0;
    const operation = boundedExecution
      .run({ definition: configured, directory: process.cwd(), environment: {} })
      .then((result) => {
        settlements++;
        return result;
      });
    await Promise.resolve();
    if (i % 2 === 0) t.mock.timers.tick(5);
    fake.child.emit("exit", 0, null);
    if (i % 2 !== 0) t.mock.timers.tick(5);
    fake.child.emit("close", 0, null);
    const result = await operation;
    assert.equal(result.outcome, i % 2 === 0 ? "TIMEOUT" : "EXITED");
    assert.equal(settlements, 1);
    fake.child.removeAllListeners();
    fake.child.stdout.removeAllListeners();
    fake.child.stderr.removeAllListeners();
  }
});

void test("negative, missing and signalled exits cannot become valid protocol results", async (t) => {
  const configured = await definition();
  const fake = fakeSpawn(t);
  for (const [code, signal] of [
    [-1, null],
    [null, null],
    [null, "SIGTERM"],
  ] as const) {
    const operation = boundedExecution.run({
      definition: configured,
      directory: process.cwd(),
      environment: {},
    });
    await Promise.resolve();
    fake.child.emit("exit", code, signal);
    fake.child.emit("close", code, signal);
    const observed = await operation;
    assert.ok(
      observed.outcome !== "EXITED" || (observed.exitCode !== 0 && observed.exitCode !== 42),
    );
    fake.child.removeAllListeners();
    fake.child.stdout.removeAllListeners();
    fake.child.stderr.removeAllListeners();
  }
});

void test("exact exit protocol ignores diagnostic claims and all attempts consume their workspace", async (t) => {
  for (const code of [0, 1, 2, 41, 42, 43, 255]) {
    const base = await definition("protocol");
    const fixture = await setup(t, "protocol", {
      definition: { args: [...base.args, String(code)] },
    });
    const result = await fixture.executor.executeCheck(fixture.request);
    assert.equal(result.state, code === 0 ? "PASS" : code === 42 ? "FAIL" : "ERROR");
    assert.equal(result.observation.exitCode, code);
    assert.equal(Buffer.from(result.observation.diagnostics.stdout, "base64").toString(), "PASS");
    assert.equal(Buffer.from(result.observation.diagnostics.stderr, "base64").toString(), "failed");
    await assert.rejects(fixture.executor.executeCheck(fixture.request));
    await disposeControlledWorkspace(fixture.request.workspace);
    assert.deepEqual(fixture.executor.validateResult(fixture.request, result), result);
  }
  const signalled = await setup(t, "self-signal");
  assert.equal((await signalled.executor.executeCheck(signalled.request)).state, "ERROR");
});

void test("invalid plans and identity-bound definition substitutions never call spawn", async (t) => {
  const fixture = await setup(t);
  const fake = fakeSpawn(t);
  for (const mutate of [
    (plan: typeof fixture.request.plan): typeof fixture.request.plan =>
      Object.assign(plan, { id: `plan:sha256:${"f".repeat(64)}` }),
    (plan: typeof fixture.request.plan): typeof fixture.request.plan.context =>
      Object.assign(plan.context, { targetCommit: "f".repeat(40) }),
    (plan: typeof fixture.request.plan): typeof fixture.request.plan.context.configuration =>
      Object.assign(plan.context.configuration, { hash: "f".repeat(64) }),
    ...[
      "id",
      "strategy",
      "availability",
      "strength",
      "validFailureBehavior",
      "unavailableBehavior",
    ].map(
      (key) =>
        (plan: typeof fixture.request.plan): (typeof fixture.request.plan.checks)[number] =>
          Object.assign(plan.checks[0]!, { [key]: "FORGED" }),
    ),
  ]) {
    const plan = structuredClone(fixture.request.plan);
    mutate(plan);
    await assert.rejects(fixture.executor.executeCheck({ ...fixture.request, plan }));
  }
  const original = fixture.request.configuration.definitions[0]!;
  for (const alteration of [
    {
      executable: path.join(
        path.dirname(process.execPath),
        "other",
        path.basename(process.execPath),
      ),
    },
    { args: [path.join(path.dirname(verifier), "other.mjs")] },
    { args: [...original.args, "changed"] },
    { timeoutMs: 12 },
    { maxOutputBytes: 12 },
    { verifierSha256: "f".repeat(64) },
  ]) {
    const configuration = parseExecutionConfiguration({
      schemaVersion: 7,
      version: "substitution",
      definitions: [{ ...original, ...alteration }],
    });
    await assert.rejects(fixture.executor.executeCheck({ ...fixture.request, configuration }));
  }
  for (const alteration of [
    { workingDirectory: process.cwd() },
    { environmentPolicy: "HOST" },
    { runtimeSha256: "f".repeat(64) },
  ])
    assert.throws(() => parseExecutionDefinition({ ...original, ...alteration }));
  assert.equal(fake.calls(), 0);
});

void test("real direct children are gone before confirmed results and safe disposal", async (t) => {
  const spawn = cp.spawn;
  const children: cp.ChildProcess[] = [];
  let controller: AbortController | undefined;
  t.mock.method(cp, "spawn", ((...args: Parameters<typeof cp.spawn>) => {
    const child = Reflect.apply(spawn, cp, args);
    children.push(child);
    if (controller) child.once("spawn", () => controller?.abort());
    return child;
  }) as typeof cp.spawn);
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  for (const mode of ["pass", "fail", "crash", "slow", "cancel", "flood"] as const) {
    const fixture = await setup(t, mode === "cancel" ? "slow" : mode, {
      definition: {
        timeoutMs: mode === "slow" ? 100 : 10000,
        maxOutputBytes: mode === "flood" ? 20 : 4096,
      },
    });
    controller = mode === "cancel" ? new AbortController() : undefined;
    const result = await fixture.executor.executeCheck(fixture.request, controller?.signal);
    assert.equal(result.observation.terminationConfirmed, true);
    assert.equal(
      result.state,
      {
        pass: "PASS",
        fail: "FAIL",
        crash: "ERROR",
        slow: "TIMEOUT",
        cancel: "CANCELLED",
        flood: "ERROR",
      }[mode],
    );
    const child = children.at(-1)!;
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    assert.throws(() => process.kill(child.pid!, 0), { code: "ESRCH" });
    await assert.rejects(fixture.executor.executeCheck(fixture.request));
    await disposeControlledWorkspace(fixture.request.workspace);
    await assert.rejects(access(fixture.request.workspace.directory));
  }
});

void test("normal-exit and stop races preserve first observed cause including a late zero exit", async (t) => {
  const configured = await definition();
  const fake = fakeSpawn(t);
  for (let i = 0; i < 30; i++) {
    const controller = new AbortController();
    const operation = boundedExecution.run(
      { definition: configured, directory: process.cwd(), environment: {} },
      controller.signal,
    );
    await Promise.resolve();
    if (i % 2 === 0) controller.abort();
    fake.child.emit("exit", 0, null);
    if (i % 2 !== 0) controller.abort();
    fake.child.emit("close", 0, null);
    const result = await operation;
    assert.equal(result.outcome, i % 2 === 0 ? "CANCELLED" : "EXITED");
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    fake.child.removeAllListeners();
    fake.child.stdout.removeAllListeners();
    fake.child.stderr.removeAllListeners();
  }
});

void test("allowed missing verifier is ERROR; changed verifier/runtime pins reject; canonical aliases are explicit", async (t) => {
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, "riskverifier trusted programs "));
  t.after(async () => {
    assert.equal(await realpath(root), root);
    assert.equal(path.dirname(root), parent);
    await rm(root, { recursive: true });
  });
  const script = path.join(root, "check.mjs");
  const contents = "process.exitCode = 42;";
  const pin = createHash("sha256").update(contents).digest("hex");
  const missing = await setup(t, "pass", { definition: { args: [script], verifierSha256: pin } });
  const result = await missing.executor.executeCheck(missing.request);
  assert.equal(result.state, "ERROR");
  assert.equal(result.observation.outcome, "VERIFIER_UNAVAILABLE");
  await writeFile(script, "process.exitCode = 0;");
  const tampered = await setup(t, "pass", { definition: { args: [script], verifierSha256: pin } });
  await assert.rejects(tampered.executor.executeCheck(tampered.request));
  const fakeRuntime = path.join(root, path.basename(process.execPath));
  await writeFile(fakeRuntime, "not a Node runtime");
  const substituted = await setup(t, "pass", { definition: { executable: fakeRuntime } });
  await assert.rejects(substituted.executor.executeCheck(substituted.request));
  const alias = path.join(root, "approved-alias");
  await symlink(path.dirname(verifier), alias, process.platform === "win32" ? "junction" : "dir");
  const aliased = await setup(t, "pass", {
    definition: { args: [path.join(alias, path.basename(verifier)), "pass"] },
  });
  assert.equal((await aliased.executor.executeCheck(aliased.request)).state, "PASS");
  for (const executable of [
    "node",
    "./node",
    `${root}${path.sep}..${path.sep}node`,
    `${process.execPath} `,
  ])
    assert.throws(() =>
      parseExecutionDefinition({ ...aliased.request.configuration.definitions[0]!, executable }),
    );
});
