import assert from "node:assert/strict";
import { access, readFile, writeFile, symlink, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { getEventListeners } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import {
  createConfigurationIdentity,
  type ChangeVerificationPlan,
} from "../../src/domain/index.js";
import { generateVerificationPlan } from "../../src/planning/index.js";
import {
  parseExecutionConfiguration,
  createControlledExecutor,
  disposeControlledWorkspace,
  type ExecutionRequest,
} from "../../src/execution/index.js";
import { boundedExecution } from "../../src/execution/bounded-execution.js";
import { definition, setup, verifier } from "./fixture.js";

void test("PASS, valid FAIL and malfunction ERROR remain distinct and bound to the exact check", async (t) => {
  for (const [mode, state, code] of [
    ["pass", "PASS", 0],
    ["fail", "FAIL", 42],
    ["crash", "ERROR", 1],
    ["unknown-exit", "ERROR", 12],
    ["runtime-exit", "ERROR", 10],
  ] as const) {
    const { executor, request } = await setup(t, mode);
    const result = await executor.executeCheck(request);
    assert.equal(result.state, state);
    assert.equal(result.observation.exitCode, code);
    assert.equal(result.observation.started, true);
    assert.equal(result.binding.planId, request.plan.id);
    assert.deepEqual(result.binding.context, request.plan.context);
    assert.deepEqual(result.binding.check, request.plan.checks[0]);
    assert.equal(result.binding.executorVersion, "7.1.0");
    assert.ok(result.observation.durationMs >= 0);
    assert.deepEqual(executor.validateResult(request, JSON.parse(JSON.stringify(result))), result);
    assert.equal("verdict" in result, false);
    if (mode === "pass") {
      assert.equal(
        Buffer.from(result.observation.diagnostics.stdout, "base64").toString(),
        "diagnostic stdout\n",
      );
      assert.equal(
        Buffer.from(result.observation.diagnostics.stderr, "base64").toString(),
        "diagnostic stderr\n",
      );
    }
  }
});

void test("prepared fixture build, tests and narrowly scoped static verifier detect their actual invariants", async (t) => {
  for (const [strategy, mode, good, bad, filename] of [
    [
      "BUILD",
      "fixture-build",
      "export const x: number = 1;",
      'export const x: number = "bad";',
      "target.ts",
    ],
    [
      "EXISTING_TESTS",
      "fixture-tests",
      "export const add=(a,b)=>a+b;",
      "export const add=(a,b)=>a-b;",
      "math.mjs",
    ],
    [
      "STATIC_ANALYSIS",
      "fixture-static-analysis",
      "export const x=1;",
      "debugger; export const x=1;",
      "target.ts",
    ],
  ] as const) {
    for (const [contents, expected] of [
      [good, "PASS"],
      [bad, "FAIL"],
    ] as const) {
      const { executor, request } = await setup(t, mode, {
        definition: { strategy },
        files: [{ path: filename, contents }],
      });
      const result = await executor.executeCheck({
        ...request,
        checkId: `check:${strategy.toLowerCase().replaceAll("_", "-")}`,
      });
      assert.equal(result.state, expected, mode);
    }
  }
});

void test("optional failure is retained; mandatory missing and policy unavailable checks never pass", async (t) => {
  const optional = await setup(t, "fail", { optional: true });
  const result = await optional.executor.executeCheck(optional.request);
  assert.equal(result.binding.check.strength, "OPTIONAL");
  assert.equal(result.state, "FAIL");
  const missing = await setup(t, "pass", { definitions: [] });
  const unsupported = await missing.executor.executeCheck(missing.request);
  assert.equal(unsupported.state, "UNSUPPORTED");
  assert.equal(unsupported.binding.check.strength, "MANDATORY");
  assert.equal(unsupported.binding.definition, null);
  assert.equal(unsupported.observation.outcome, "DEFINITION_MISSING");
  for (const availability of ["UNSUPPORTED", "UNAVAILABLE"] as const) {
    const fixture = await setup(t, "pass", { availability });
    const unavailable = await fixture.executor.executeCheck(fixture.request);
    assert.equal(unavailable.state, "UNSUPPORTED");
    assert.equal(unavailable.observation.outcome, "POLICY_UNAVAILABLE");
    assert.notEqual(unavailable.binding.definition, null);
    assert.equal(unavailable.observation.started, false);
  }
});

void test("combined output is byte-bounded, malformed bytes remain diagnostic, overflow cannot PASS", async (t) => {
  for (const maximum of [8, 7]) {
    const fixture = await setup(t, "bytes", { definition: { maxOutputBytes: maximum } });
    const result = await fixture.executor.executeCheck(fixture.request);
    assert.equal(result.state, maximum === 8 ? "PASS" : "ERROR");
    const diagnostic = result.observation.diagnostics;
    assert.equal(diagnostic.stdoutBytes + diagnostic.stderrBytes, maximum);
    assert.equal(diagnostic.observedBytes, 8);
    assert.equal(diagnostic.truncated, maximum === 7);
    if (maximum === 8)
      assert.deepEqual(
        Buffer.from(diagnostic.stdout, "base64"),
        Buffer.from([0xff, 0xfe, 0x1b, 0, 0xc3, 0xa9]),
      );
  }
  const fixture = await setup(t, "flood", { definition: { maxOutputBytes: 100 } });
  const result = await fixture.executor.executeCheck(fixture.request);
  assert.equal(result.state, "ERROR");
  assert.equal(result.observation.outcome, "OUTPUT_LIMIT");
  assert.equal(result.observation.diagnostics.stdoutBytes, 100);
  assert.equal(result.observation.terminationConfirmed, true);
});

void test("Windows/spaced paths, literal shell metacharacters and minimal environment work without ambient cwd changes", async (t) => {
  const args = [
    "spaces in an argument",
    "&& echo nope",
    "| > output",
    "`quoted` \"double\" 'single'",
    "$(whoami)",
    "; rm ignored",
    "%RV_EXECUTION_SECRET%",
    "--eval",
    "",
  ];
  const base = await definition("context");
  const fixture = await setup(t, "context", { definition: { args: [...base.args, ...args] } });
  const cwd = process.cwd();
  const old = process.env.RV_EXECUTION_SECRET;
  const oldOptions = process.env.NODE_OPTIONS;
  const canaries = [
    "AWS_SECRET_ACCESS_KEY",
    "GITHUB_TOKEN",
    "DATABASE_URL",
    "TEST_SECRET",
    "aRbItRaRy_SeCrEt",
    "Path",
    "path",
  ];
  const saved = canaries.map((key) => [key, process.env[key]] as const);
  for (const key of canaries) process.env[key] = "not-inherited-canary";
  process.env.RV_EXECUTION_SECRET = "not-inherited-canary";
  process.env.NODE_OPTIONS = "--definitely-invalid-option";
  try {
    const result = await fixture.executor.executeCheck(fixture.request);
    assert.equal(result.state, "PASS");
    const observed = JSON.parse(
      Buffer.from(result.observation.diagnostics.stdout, "base64").toString(),
    ) as { args: string[]; cwd: string; env: Record<string, string> };
    assert.deepEqual(observed.args, args);
    assert.equal(observed.cwd, fixture.request.workspace.directory);
    assert.equal(process.cwd(), cwd);
    assert.match(observed.cwd, / /u);
    if (process.platform === "win32") assert.match(process.execPath, / /u);
    assert.equal(observed.env.RV_EXECUTION_SECRET, undefined);
    assert.equal(observed.env.NODE_OPTIONS, undefined);
    assert.ok(Object.values(observed.env).every((value) => value !== "not-inherited-canary"));
    assert.deepEqual(
      Object.keys(observed.env).sort(),
      process.platform === "win32"
        ? [
            "HOMEDRIVE",
            "HOMEPATH",
            "LOGONSERVER",
            "PATH",
            "SYSTEMDRIVE",
            "SystemRoot",
            "TEMP",
            "USERDOMAIN",
            "USERNAME",
            "USERPROFILE",
            "WINDIR",
          ]
        : [],
    );
    if (process.platform === "win32") {
      for (const key of ["PATH", "LOGONSERVER", "USERDOMAIN", "USERNAME"])
        assert.equal(observed.env[key], "");
      assert.equal(observed.env.TEMP, fixture.request.workspace.directory);
      assert.equal(observed.env.USERPROFILE, fixture.request.workspace.directory);
    }
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (old === undefined) delete process.env.RV_EXECUTION_SECRET;
    else process.env.RV_EXECUTION_SECRET = old;
    if (oldOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = oldOptions;
  }
});

void test("timeouts terminate the direct child and cancellation is handled before and during output", async (t) => {
  const timeout = await setup(t, "slow", { definition: { timeoutMs: 200 } });
  const timed = await timeout.executor.executeCheck(timeout.request);
  assert.equal(timed.state, "TIMEOUT");
  assert.equal(timed.observation.terminationConfirmed, true);
  const before = new AbortController();
  before.abort();
  const preaborted = await setup(t);
  const cancelled = await preaborted.executor.executeCheck(preaborted.request, before.signal);
  assert.equal(cancelled.state, "CANCELLED");
  assert.equal(cancelled.observation.started, false);
  const running = await setup(t, "stream");
  const controller = new AbortController();
  const operation = running.executor.executeCheck(running.request, controller.signal);
  const ready = path.join(running.request.workspace.directory, "ready");
  for (let tries = 0; tries < 100; tries++) {
    try {
      await access(ready);
      break;
    } catch {
      await delay(50);
    }
  }
  await access(ready);
  controller.abort();
  const result = await operation;
  assert.equal(result.state, "CANCELLED");
  assert.equal(result.observation.started, true);
  assert.ok(result.observation.diagnostics.observedBytes > 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.equal(result.observation.terminationConfirmed, true);
});

void test("missing executable and cwd produce ERROR; no alternate executable or strategy fallback", async (t) => {
  const initial = await setup(t);
  const missingNode = path.join(
    initial.request.workspace.directory,
    "not-present",
    path.basename(process.execPath),
  );
  const missing = await setup(t, "pass", { definition: { executable: missingNode } });
  const result = await missing.executor.executeCheck(missing.request);
  assert.equal(result.state, "ERROR");
  assert.equal(result.observation.outcome, "EXECUTABLE_UNAVAILABLE");
  assert.equal(result.observation.started, false);
  // Internal adapter contract: the OS refuses startup, with no program FAIL manufactured.
  for (const invocation of [
    {
      definition: { ...(await definition()), executable: missingNode },
      directory: initial.request.workspace.directory,
    },
    {
      definition: await definition(),
      directory: path.join(initial.request.workspace.directory, "missing"),
    },
  ]) {
    const output = await boundedExecution.run({ ...invocation, environment: {} });
    assert.equal(output.outcome, "START_ERROR");
    assert.equal(output.started, false);
    assert.equal(output.exitCode, null);
  }
});

void test("wrong plan/check/config, forged handles and changed policy metadata reject before execution", async (t) => {
  const { executor, request } = await setup(t);
  const clone = (): ChangeVerificationPlan => structuredClone(request.plan);
  const targets: ExecutionRequest[] = [
    { ...request, checkId: "check:not-in-plan" },
    { ...request, workspace: { ...request.workspace } },
    { ...request, plan: { ...request.plan, id: `plan:sha256:${"0".repeat(64)}` as never } },
  ];
  for (const [key, value] of [
    ["strategy", "EXISTING_TESTS"],
    ["strength", "OPTIONAL"],
    ["validFailureBehavior", "NOT_APPLICABLE"],
    ["unavailableBehavior", "BLOCK"],
  ]) {
    const plan = clone();
    Object.assign(plan.checks[0]!, { [key!]: value });
    targets.push({ ...request, plan });
  }
  const configuration = parseExecutionConfiguration({
    schemaVersion: 7,
    version: "another",
    definitions: request.configuration.definitions,
  });
  targets.push({ ...request, configuration });
  const planningInput = {
    ...request.planningInput,
    configuration: createConfigurationIdentity({ version: "different", hash: "0".repeat(64) }),
  };
  targets.push({ ...request, planningInput, plan: generateVerificationPlan(planningInput) });
  for (const target of targets) await assert.rejects(executor.executeCheck(target));
  const forgedRequest = { ...request, check: { strategy: "FAKE" } };
  await assert.rejects(executor.executeCheck(forgedRequest));
});

void test("independent allow-list and content pin reject executable/verifier substitutions", async (t) => {
  const fixture = await setup(t);
  const restricted = await createControlledExecutor({
    kind: "CONTROLLED_FIXTURE_ONLY",
    executables: [],
    verifiers: [],
  });
  await assert.rejects(restricted.executeCheck(fixture.request));
  const wrong = await setup(t, "pass", { definition: { verifierSha256: "0".repeat(64) } });
  await assert.rejects(wrong.executor.executeCheck(wrong.request));
  const contents = await readFile(verifier, "utf8");
  const repoProgram = await setup(t, "pass", { files: [{ path: "verifier.mjs", contents }] });
  const candidate = await definition("pass", {
    args: [path.join(repoProgram.request.workspace.directory, "verifier.mjs"), "pass"],
  });
  const configuration = parseExecutionConfiguration({
    schemaVersion: 7,
    version: "repo-program",
    definitions: [candidate],
  });
  const planningInput = {
    ...repoProgram.request.planningInput,
    configuration: configuration.identity,
  };
  const executor = await createControlledExecutor({
    kind: "CONTROLLED_FIXTURE_ONLY",
    executables: [process.execPath],
    verifiers: [{ path: candidate.args[0], sha256: candidate.verifierSha256 }],
  });
  await assert.rejects(
    executor.executeCheck({
      ...repoProgram.request,
      configuration,
      planningInput,
      plan: generateVerificationPlan(planningInput),
    }),
  );
});

void test("workspace mutation/link escape fails closed and concurrent execution/disposal cannot race a check", async (t) => {
  const changed = await setup(t);
  await writeFile(path.join(changed.request.workspace.directory, "target.ts"), "changed");
  await assert.rejects(changed.executor.executeCheck(changed.request));
  const linked = await setup(t);
  const other = await setup(t);
  await symlink(
    other.request.workspace.directory,
    path.join(linked.request.workspace.directory, "outside"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(linked.executor.executeCheck(linked.request));
  await rm(path.join(linked.request.workspace.directory, "outside"));
  const running = await setup(t, "slow");
  const controller = new AbortController();
  const operation = running.executor.executeCheck(running.request, controller.signal);
  await assert.rejects(running.executor.executeCheck(running.request));
  await assert.rejects(disposeControlledWorkspace(running.request.workspace));
  controller.abort();
  assert.equal((await operation).state, "CANCELLED");
  const disposing = await setup(t);
  const disposal = disposeControlledWorkspace(disposing.request.workspace);
  await assert.rejects(disposing.executor.executeCheck(disposing.request));
  await assert.rejects(disposeControlledWorkspace(disposing.request.workspace));
  await disposal;
  await assert.rejects(disposing.executor.executeCheck(disposing.request));
  const extra = await setup(t);
  await mkdir(
    path.join(
      extra.request.workspace.directory,
      "..",
      path.basename(extra.request.workspace.directory) + "-sibling",
    ),
  );
  const sibling = path.join(
    extra.request.workspace.directory,
    "..",
    path.basename(extra.request.workspace.directory) + "-sibling",
  );
  t.after(async () => rm(sibling, { recursive: true }));
  await assert.rejects(
    extra.executor.executeCheck({
      ...extra.request,
      workspace: { ...extra.request.workspace, directory: sibling },
    }),
  );
});

void test("runtime result validation rejects forged states/provenance/diagnostics and returns deeply frozen DTOs", async (t) => {
  const { executor, request } = await setup(t);
  const result = await executor.executeCheck(request);
  const paths: readonly [string, unknown][] = [
    ["binding.planId", `plan:sha256:${"1".repeat(64)}`],
    ["binding.check.id", "check:existing-tests"],
    ["binding.check.strategy", "UNKNOWN"],
    ["binding.context.configuration.hash", "0".repeat(64)],
    ["binding.context.targetCommit", "0".repeat(40)],
    ["binding.executorVersion", "7.0.0"],
    ["binding.definition.id", "forged"],
    ["state", "UNKNOWN"],
    ["state", "FAIL"],
    ["observation.exitCode", 1.5],
    ["observation.exitCode", -4294967296],
    ["observation.durationMs", -1],
    ["observation.diagnostics.stdoutBytes", -1],
    ["observation.diagnostics.observedBytes", 0],
    ["observation.diagnostics.truncated", true],
    ["observation.diagnostics.stdout", "not base64"],
    ["observation.terminationConfirmed", false],
    ["observation.started", false],
  ];
  for (const [location, value] of paths) {
    const copy = structuredClone(result) as unknown as Record<string, unknown>;
    const keys = location.split(".");
    let cursor = copy;
    for (const key of keys.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>;
    cursor[keys.at(-1)!] = value;
    assert.throws(() => executor.validateResult(request, copy), location);
  }
  let getterReads = 0;
  const forged = Object.defineProperty({ ...result }, "observation", {
    enumerable: true,
    get: () => {
      getterReads++;
      return result.observation;
    },
  });
  assert.throws(() => executor.validateResult(request, forged));
  assert.equal(getterReads, 0);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const observation of [
    cyclic,
    new Date(),
    { ...result.observation, diagnostics: new Array(2) },
  ])
    assert.throws(() => executor.validateResult(request, { ...result, observation }));
  const walk = (value: unknown): void => {
    if (value !== null && typeof value === "object") {
      assert.ok(Object.isFrozen(value));
      assert.throws(() => Object.defineProperty(value, "injected", { value: true }));
      Object.values(value).forEach(walk);
    }
  };
  walk(result);
  const mutable = structuredClone(result);
  const restored = executor.validateResult(request, mutable);
  Object.assign(mutable.observation.diagnostics, { stdout: "" });
  assert.deepEqual(restored, result);
  const different = await setup(t, "pass", { optional: true });
  assert.throws(() => different.executor.validateResult(different.request, result));
  assert.equal(result.state, "PASS");
});

void test("immediate-after-spawn and timeout/cancel/completion races settle once and remove abort listeners", async (t) => {
  const { request } = await setup(t);
  for (const kind of ["immediate", "competing", "completed"] as const) {
    const controller = new AbortController();
    const invocation = {
      definition: await definition(kind === "completed" ? "pass" : "slow", {
        timeoutMs: kind === "competing" ? 30 : 5000,
      }),
      directory: request.workspace.directory,
      environment: {},
    };
    let settlements = 0;
    const operation = boundedExecution.run(invocation, controller.signal).then((result) => {
      settlements++;
      return result;
    });
    const timer = kind === "competing" ? setTimeout(() => controller.abort(), 30) : undefined;
    if (kind === "immediate") controller.abort();
    const result = await operation;
    clearTimeout(timer);
    controller.abort();
    assert.equal(settlements, 1);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    assert.equal(result.terminationConfirmed, true);
    assert.ok(
      kind === "completed"
        ? result.outcome === "EXITED"
        : ["TIMEOUT", "CANCELLED"].includes(result.outcome),
    );
  }
});
