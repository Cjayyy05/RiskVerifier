import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  parseExecutionConfiguration,
  validateExecutionConfiguration,
  parseExecutionDefinition,
  executionDefinitionId,
  executionCapabilities,
  createControlledExecutor,
  prepareControlledWorkspace,
  type ExecutionDefinition,
} from "../../src/execution/index.js";
import { definition, setup } from "./fixture.js";

void test("configuration/definition identity binds every variable execution input and canonicalizes registry order", async () => {
  const build = await definition();
  const tests = await definition("fixture-tests", { strategy: "EXISTING_TESTS" });
  const parse = (
    definitions: readonly ExecutionDefinition[],
    version = "1",
  ): ReturnType<typeof parseExecutionConfiguration> =>
    parseExecutionConfiguration({ schemaVersion: 7, version, definitions });
  const original = parse([build, tests]);
  assert.deepEqual(parse([tests, build]), original);
  assert.deepEqual(validateExecutionConfiguration(JSON.parse(JSON.stringify(original))), original);
  const reversedKeys = Object.fromEntries(Object.entries(build).reverse());
  assert.deepEqual(parseExecutionDefinition(reversedKeys), build);
  for (const change of [
    {
      executable: path.join(
        path.dirname(build.executable),
        "alternative",
        path.basename(build.executable),
      ),
    },
    { args: [...build.args, "changed"] },
    { timeoutMs: build.timeoutMs + 1 },
    { maxOutputBytes: build.maxOutputBytes + 1 },
    { version: "2" },
    { verifierSha256: "1".repeat(64) },
    { strategy: "STATIC_ANALYSIS" as const },
  ]) {
    const altered = { ...build, ...change };
    assert.notEqual(executionDefinitionId(altered), executionDefinitionId(build));
    assert.notEqual(parse([altered, tests]).identity.hash, original.identity.hash);
  }
  assert.notEqual(parse([build, tests], "2").identity.hash, original.identity.hash);
  assert.ok(Object.isFrozen(original.definitions[0]?.args));
  const capabilities = executionCapabilities(original);
  assert.equal(capabilities.filter((item) => item.availability === "SUPPORTED").length, 2);
  assert.ok(
    capabilities
      .filter((item) => item.strategy.endsWith("VERIFICATION"))
      .every((item) => item.availability === "UNSUPPORTED"),
  );
  assert.throws(() =>
    validateExecutionConfiguration({
      ...original,
      identity: { ...original.identity, hash: "0".repeat(64) },
    }),
  );
});

void test("execution schema rejects shell/script aliases, unknowns, ambiguous paths, invalid limits and executable-shaped DTOs", async () => {
  const valid = await definition();
  for (const change of [
    { command: "node verifier.mjs" },
    { shell: false },
    { env: { TOKEN: "secret" } },
    { strategy: "UNKNOWN" },
    { executable: "node" },
    { executable: path.join(path.dirname(valid.executable), "cmd.exe") },
    { args: "verifier.mjs" },
    { args: ["--eval", "process.exit(0)"] },
    { args: ["relative.mjs"] },
    { args: [valid.args[0], "bad\0arg"] },
    { args: [valid.args[0], "\uD800"] },
    { args: [valid.args[0], "x".repeat(4097)] },
    { args: new Array(1) },
    { timeoutMs: 0 },
    { timeoutMs: -1 },
    { timeoutMs: 1.1 },
    { timeoutMs: NaN },
    { timeoutMs: 2147483648 },
    { maxOutputBytes: 0 },
    { maxOutputBytes: 1048577 },
    { protocol: "ANY_NONZERO_FAIL" },
    { workingDirectory: "../elsewhere" },
    { environmentPolicy: "INHERIT_ALL" },
    { verifierSha256: "missing" },
  ])
    assert.throws(() => parseExecutionDefinition({ ...valid, ...change }), JSON.stringify(change));
  let reads = 0;
  const getter = Object.defineProperty({ ...valid }, "args", {
    enumerable: true,
    get: () => {
      reads++;
      return valid.args;
    },
  });
  assert.throws(() => parseExecutionDefinition(getter));
  const poisoned = [...valid.args];
  Object.setPrototypeOf(poisoned, {
    map: () => {
      reads++;
      return valid.args;
    },
  });
  assert.throws(() => parseExecutionDefinition({ ...valid, args: poisoned }));
  assert.equal(reads, 0);
  const cycle: unknown[] = [];
  cycle.push(cycle);
  assert.throws(() => parseExecutionDefinition({ ...valid, args: cycle }));
  for (const definitions of [[valid, valid], new Array(1), [null]])
    assert.throws(() =>
      parseExecutionConfiguration({ schemaVersion: 7, version: "1", definitions }),
    );
  await assert.rejects(
    createControlledExecutor({ kind: "ARBITRARY_REPOSITORY", executables: [], verifiers: [] }),
  );
  await assert.rejects(
    createControlledExecutor({
      kind: "CONTROLLED_FIXTURE_ONLY",
      executables: ["node"],
      verifiers: [],
    }),
  );
});

void test("workspace preparation rejects traversal, reserved names, collisions and malformed fixture graphs", async () => {
  const base = {
    kind: "CONTROLLED_FIXTURE",
    repository: "fixture",
    baseCommit: "a".repeat(40),
    targetCommit: "b".repeat(40),
  };
  for (const name of [
    "../escape",
    "/absolute",
    "a/../../escape",
    "a\\escape",
    "C:/escape",
    "a:stream",
    "NUL",
    "dir/CON.txt",
    "trailing.",
    "dir//file",
  ])
    await assert.rejects(
      prepareControlledWorkspace({ ...base, files: [{ path: name, contents: "x" }] }),
      name,
    );
  for (const files of [
    [
      { path: "a", contents: "x" },
      { path: "A", contents: "x" },
    ],
    [
      { path: "a", contents: "x" },
      { path: "a/file", contents: "x" },
    ],
    [{ path: "file", contents: "x".repeat(1048577) }],
    new Array(1),
  ])
    await assert.rejects(prepareControlledWorkspace({ ...base, files }));
  await assert.rejects(
    prepareControlledWorkspace({ ...base, kind: "EXISTING_REPOSITORY", files: [] }),
  );
  await assert.rejects(
    prepareControlledWorkspace({ ...base, directory: process.cwd(), files: [] }),
  );
});

void test("capability declarations never substitute for actual definitions and caller configuration mutation cannot race execution", async (t) => {
  const { executor, request } = await setup(t);
  const mutable = JSON.parse(JSON.stringify(request.configuration)) as typeof request.configuration;
  const operation = executor.executeCheck({ ...request, configuration: mutable });
  Object.assign(mutable.definitions[0]!, { args: ["--eval", "bad"], timeoutMs: 1 });
  assert.equal((await operation).state, "PASS");
  const fresh = await setup(t);
  const specialized = await fresh.executor.executeCheck({
    ...fresh.request,
    checkId: "check:authorization-verification",
  });
  assert.equal(specialized.binding.check.availability, "SUPPORTED");
  assert.equal(specialized.binding.definition, null);
  assert.equal(specialized.state, "UNSUPPORTED");
  assert.equal(specialized.observation.started, false);
});
