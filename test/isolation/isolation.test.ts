import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { noProcess } from "../../src/execution/result.js";
import {
  parseIsolationConfiguration,
  validateIsolationConfiguration,
  createArguments,
  type IsolationConfiguration,
} from "../../src/isolation/configuration.js";
import {
  runContainer,
  type CliResult,
  type DockerHost,
  type DockerTransport,
} from "../../src/isolation/docker-adapter.js";

const imageId = `sha256:${"a".repeat(64)}`,
  containerId = "b".repeat(64),
  instance = "riskverifier-00000000-0000-4000-8000-000000000001";
function config(overrides: Record<string, unknown> = {}): IsolationConfiguration {
  return parseIsolationConfiguration({
    schemaVersion: 9,
    version: "unit",
    imageId,
    repositoryDigest: `node@${imageId}`,
    uid: 1000,
    gid: 1000,
    memoryMiB: 128,
    cpuMillis: 500,
    pids: 64,
    scratchMiB: 8,
    tmpMiB: 8,
    definitions: [
      {
        strategy: "BUILD",
        version: "fixture-1",
        verifier: path.resolve("trusted fixture.mjs"),
        verifierSha256: "c".repeat(64),
        args: ["pass"],
        timeoutMs: 10000,
        maxOutputBytes: 4096,
      },
    ],
    ...overrides,
  });
}
function response(
  value: unknown,
  code: number | null = 0,
  cause: CliResult["cause"] = null,
): CliResult {
  const bytes = Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
  return {
    code,
    cause,
    confirmed: true,
    diagnostics: {
      ...noProcess("EXITED").diagnostics,
      stdout: bytes.toString("base64"),
      stdoutBytes: bytes.length,
      observedBytes: bytes.length,
    },
  };
}
const host: DockerHost = {
  executable: path.resolve("docker.exe"),
  endpoint: "unit",
  directory: path.resolve("."),
  environment: {},
};
function runtime(mode: string): { transport: DockerTransport; calls: readonly string[][] } {
  const calls: string[][] = [];
  let started = false,
    killed = false;
  return {
    calls,
    transport: {
      async run(_host, args): Promise<CliResult> {
        await Promise.resolve();
        calls.push([...args]);
        if (args[0] === "version")
          return response({ Os: "linux", Arch: "amd64", Version: "29.7.2" });
        if (args[0] === "image")
          return mode === "image-missing"
            ? response("missing", 1)
            : response({
                Id: imageId,
                Os: "linux",
                Architecture: "amd64",
                RepoDigests: [`node@${imageId}`],
                Config: {
                  Volumes: null,
                  Env: ["PATH=/usr/local/bin:/usr/bin:/bin", "NODE_VERSION=22.23.2"],
                },
              });
        if (args[1] === "create")
          return mode === "create-error" ? response("error", 1) : response(`${containerId}\n`);
        if (args[1] === "start") {
          started = true;
          if (mode === "overflow")
            return {
              ...response("x".repeat(4096), null, "OUTPUT_LIMIT"),
              code: null,
              diagnostics: {
                ...response("x".repeat(4096)).diagnostics,
                observedBytes: 5000,
                truncated: true,
              },
            };
          return response(
            "",
            mode === "fail" ? 42 : mode === "start-error" ? 1 : 0,
            mode === "timeout" ? "TIMEOUT" : mode === "cancel" ? "CANCELLED" : null,
          );
        }
        if (args[1] === "kill") {
          killed = true;
          return response(containerId);
        }
        if (args[1] === "rm")
          return response(
            mode === "cleanup-error" ? "error" : containerId,
            mode === "cleanup-error" ? 1 : 0,
          );
        if (args[1] === "inspect") {
          if (mode === "inspect-error" && started) return response("error", 1);
          const running =
            started && !killed && ["timeout", "cancel", "overflow", "unkillable"].includes(mode);
          return response({
            ...inspectionFixture(),
            Id: mode === "identity-mismatch" ? "f".repeat(64) : containerId,
            Config: {
              ...inspectionFixture().Config,
              Image: imageId,
              Labels: { "riskverifier.instance": instance },
            },
            State: {
              Status: running ? "running" : started ? "exited" : "created",
              Running: running || (mode === "unkillable" && started),
              Paused: false,
              Restarting: false,
              Dead: false,
              ExitCode: started && mode === "fail" ? 42 : 0,
              OOMKilled: started && mode === "oom",
              Error: started && mode === "runtime-error" ? "runtime fault" : "",
              StartedAt: started ? "2026-10-04T00:00:00Z" : "0001-01-01T00:00:00Z",
              FinishedAt: started ? "2026-10-04T00:00:01Z" : "0001-01-01T00:00:00Z",
              Pid: running ? 123 : 0,
            },
          });
        }
        throw new Error("Unexpected Docker operation");
      },
    },
  };
}

// Independent observed Docker Desktop schema fixture, not derived from production validation.
function inspectionFixture(): Record<string, unknown> & { Config: Record<string, unknown> } {
  const source = path.resolve("source"),
    verifier = path.resolve("trusted fixture.mjs");
  const command = [
    "-i",
    "PATH=/usr/local/bin:/usr/bin:/bin",
    "HOME=/scratch",
    "TMPDIR=/tmp",
    "LANG=C.UTF-8",
    "/usr/local/bin/node",
    "--",
    "/verifier.mjs",
    "pass",
  ];
  return {
    Image: imageId,
    Platform: "linux",
    Path: "/usr/bin/env",
    Args: command,
    RestartCount: 0,
    Config: {
      Image: imageId,
      User: "1000:1000",
      WorkingDir: "/workspace",
      Entrypoint: ["/usr/bin/env"],
      Cmd: command,
      Healthcheck: { Test: ["NONE"] },
      Volumes: null,
      Tty: false,
      OpenStdin: false,
      Env: ["PATH=/usr/local/bin:/usr/bin:/bin", "NODE_VERSION=22.23.2"],
    },
    HostConfig: {
      NetworkMode: "none",
      ReadonlyRootfs: true,
      Privileged: false,
      CapDrop: ["ALL"],
      CapAdd: null,
      SecurityOpt: ["no-new-privileges:true"],
      IpcMode: "none",
      PidMode: "",
      UTSMode: "",
      UsernsMode: "",
      CgroupnsMode: "private",
      Init: true,
      Runtime: "runc",
      RestartPolicy: { Name: "no", MaximumRetryCount: 0 },
      AutoRemove: false,
      Memory: 134217728,
      MemorySwap: 134217728,
      NanoCpus: 500000000,
      PidsLimit: 64,
      OomKillDisable: false,
      LogConfig: { Type: "none", Config: {} },
      Devices: [],
      DeviceRequests: null,
      DeviceCgroupRules: null,
      GroupAdd: null,
      Binds: null,
      VolumesFrom: null,
      PortBindings: {},
      PublishAllPorts: false,
      Ulimits: [{ Name: "nofile", Hard: 256, Soft: 256 }],
      Tmpfs: {
        "/scratch": "rw,noexec,nosuid,nodev,size=8m,uid=1000,gid=1000,mode=0700",
        "/tmp": "rw,noexec,nosuid,nodev,size=8m,uid=1000,gid=1000,mode=0700",
      },
      Mounts: [
        {
          Type: "bind",
          Source: source,
          Target: "/workspace",
          ReadOnly: true,
          BindOptions: { NonRecursive: true },
        },
        { Type: "bind", Source: verifier, Target: "/verifier.mjs", ReadOnly: true },
      ],
    },
    Mounts: [
      {
        Type: "bind",
        Source: source,
        Destination: "/workspace",
        Mode: "",
        RW: false,
        Propagation: "rprivate",
      },
      {
        Type: "bind",
        Source: verifier,
        Destination: "/verifier.mjs",
        Mode: "",
        RW: false,
        Propagation: "rprivate",
      },
    ],
    NetworkSettings: { Networks: { none: {} } },
  };
}

void test("isolation configuration has immutable identities and rejects unsafe extensions", () => {
  const original = config();
  assert.ok(Object.isFrozen(original.definitions[0]!.args));
  assert.deepEqual(validateIsolationConfiguration(JSON.parse(JSON.stringify(original))), original);
  for (const overrides of [
    { imageId: "node:22-alpine" },
    { uid: 0 },
    { gid: 0 },
    { memoryMiB: 0 },
    { cpuMillis: 0 },
    { pids: 0 },
    { scratchMiB: 0 },
    { network: "host" },
    { privileged: true },
    { mounts: ["/var/run/docker.sock"] },
    { capAdd: ["SYS_ADMIN"] },
    { entrypoint: "sh -c" },
    { noNewPrivileges: false },
    { network: "bridge" },
    { network: "container:other" },
    { tmpMiB: 65 },
    { memoryMiB: 1025 },
    { pids: 129 },
    { uid: "1000:0" },
  ])
    assert.throws(() => config(overrides));
  for (const overrides of [
    { uid: 1001 },
    { memoryMiB: 256 },
    { cpuMillis: 1000 },
    { pids: 32 },
    { scratchMiB: 4 },
    { tmpMiB: 4 },
    { imageId: `sha256:${"d".repeat(64)}` },
  ])
    assert.notEqual(config(overrides).identity.hash, original.identity.hash);
  assert.throws(() => validateIsolationConfiguration({ ...original, uid: 1001 }));
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.throws(() => config({ definitions: [cycle] }));
  const sparse = new Array(2);
  assert.throws(() => config({ definitions: sparse }));
  let invoked = false;
  const accessor = {
    get schemaVersion(): number {
      invoked = true;
      return 9;
    },
  };
  assert.throws(() => parseIsolationConfiguration(accessor));
  assert.equal(invoked, false);
});

void test("ambiguous terminal timestamps or PID cannot authenticate an exit", async () => {
  for (const mutation of [
    { StartedAt: "" },
    { StartedAt: "not-a-date" },
    { FinishedAt: "0001-01-01T00:00:00Z" },
    { FinishedAt: "2026-10-03T00:00:00Z" },
    { Pid: 123 },
  ]) {
    const fake = runtime("pass"),
      configuration = config();
    const transport: DockerTransport = {
      async run(...args) {
        const result = await fake.transport.run(...args);
        if (args[1][0] !== "container" || args[1][1] !== "inspect") return result;
        const inspected = JSON.parse(
          Buffer.from(result.diagnostics.stdout, "base64").toString(),
        ) as { State: { Status: string } };
        if (inspected.State.Status === "exited") Object.assign(inspected.State, mutation);
        return response(inspected);
      },
    };
    const result = await runContainer(
      host,
      configuration,
      configuration.definitions[0]!,
      path.resolve("source"),
      instance,
      undefined,
      transport,
    );
    assert.equal(result.observation.outcome, "PROCESS_ERROR");
  }
});

void test("applied restrictions reject missing, weakened or substituted inspect fields", async () => {
  const mutations: [string, string, unknown][] = [
    ["HostConfig", "Memory", 0],
    ["HostConfig", "MemorySwap", -1],
    ["HostConfig", "OomKillDisable", true],
    ["HostConfig", "NanoCpus", 0],
    ["HostConfig", "PidsLimit", 0],
    ["HostConfig", "NetworkMode", "host"],
    ["HostConfig", "ReadonlyRootfs", false],
    ["HostConfig", "Privileged", true],
    ["HostConfig", "CapAdd", ["SYS_ADMIN"]],
    ["HostConfig", "CapDrop", []],
    ["HostConfig", "SecurityOpt", []],
    ["HostConfig", "PidMode", "host"],
    ["HostConfig", "IpcMode", "host"],
    ["HostConfig", "CgroupnsMode", "host"],
    ["HostConfig", "Tmpfs", {}],
    ["HostConfig", "Mounts", []],
    ["HostConfig", "Binds", ["C:\\Users:/host"]],
    ["HostConfig", "Devices", [{ PathOnHost: "/dev/sda" }]],
    ["Config", "User", "0:0"],
    ["Config", "Entrypoint", ["sh"]],
    ["Config", "Cmd", ["sh", "-c", "true"]],
    ["Config", "Env", ["NODE_OPTIONS=--import=/workspace/evil.mjs"]],
    ["NetworkSettings", "Networks", { bridge: {} }],
    ["", "Mounts", []],
    ["", "RestartCount", 1],
  ];
  for (const [group, key, value] of mutations) {
    const fake = runtime("pass"),
      configuration = config();
    const transport: DockerTransport = {
      async run(...args) {
        const result = await fake.transport.run(...args);
        if (args[1][0] !== "container" || args[1][1] !== "inspect") return result;
        const inspected = JSON.parse(
          Buffer.from(result.diagnostics.stdout, "base64").toString(),
        ) as Record<string, unknown>;
        (group ? (inspected[group] as Record<string, unknown>) : inspected)[key] = value;
        return response(inspected);
      },
    };
    const observed = await runContainer(
      host,
      configuration,
      configuration.definitions[0]!,
      path.resolve("source"),
      instance,
      undefined,
      transport,
    );
    assert.equal(observed.observation.outcome, "TERMINATION_UNCONFIRMED", `${group}.${key}`);
    assert.ok(!fake.calls.some((call) => ["start", "kill", "rm"].includes(call[1]!)));
  }
});

void test("malformed IDs never reach lifecycle commands; mutable tag metadata cannot change authority", async () => {
  for (const id of [
    "--help",
    `${containerId}\n${"f".repeat(64)}`,
    `${containerId}; rm`,
    "abc",
    "F".repeat(64),
  ]) {
    const fake = runtime("pass"),
      configuration = config();
    const transport: DockerTransport = {
      async run(...args) {
        if (args[1][1] === "create") return response(id);
        return fake.transport.run(...args);
      },
    };
    const observed = await runContainer(
      host,
      configuration,
      configuration.definitions[0]!,
      path.resolve("source"),
      instance,
      undefined,
      transport,
    );
    assert.equal(observed.containerId, null);
    assert.equal(observed.observation.terminationConfirmed, false);
    assert.ok(!fake.calls.some((call) => call[0] === "container"));
  }
  const fake = runtime("pass"),
    configuration = config();
  const transport: DockerTransport = {
    async run(...args) {
      const result = await fake.transport.run(...args);
      if (args[1][0] !== "image") return result;
      const value = JSON.parse(
        Buffer.from(result.diagnostics.stdout, "base64").toString(),
      ) as Record<string, unknown>;
      value.RepoTags = ["node:tag-moved-elsewhere"];
      return response(value);
    },
  };
  const observed = await runContainer(
    host,
    configuration,
    configuration.definitions[0]!,
    path.resolve("source"),
    instance,
    undefined,
    transport,
  );
  assert.equal(observed.observation.outcome, "EXITED");
  assert.ok(fake.calls.find((call) => call[1] === "create")!.includes(imageId));
});

void test("repeated abort and exit/timeout/overflow races never preserve PASS after a stop wins", async () => {
  for (let repeat = 0; repeat < 5; repeat++) {
    for (const at of ["version", "create", "before-start", "start", "cleanup", "after"]) {
      const fake = runtime("pass"),
        configuration = config(),
        controller = new AbortController();
      let inspected = 0;
      const transport: DockerTransport = {
        async run(...args) {
          const result = await fake.transport.run(...args);
          const command = args[1];
          if (command[0] === "container" && command[1] === "inspect") inspected++;
          if (
            (at === "version" && command[0] === "version") ||
            (at === "create" && command[1] === "create") ||
            (at === "before-start" && inspected === 1) ||
            (at === "start" && command[1] === "start") ||
            (at === "cleanup" && inspected === 3)
          )
            controller.abort();
          return result;
        },
      };
      const observed = await runContainer(
        host,
        configuration,
        configuration.definitions[0]!,
        path.resolve("source"),
        instance,
        controller.signal,
        transport,
      );
      if (at === "after") controller.abort();
      assert.equal(
        observed.observation.outcome,
        ["cleanup", "after"].includes(at) ? "EXITED" : "CANCELLED",
        at,
      );
      if (observed.containerId) assert.equal(observed.removed, true);
    }
    for (const cause of ["TIMEOUT", "OUTPUT_LIMIT"] as const) {
      const fake = runtime("pass"),
        configuration = config();
      const transport: DockerTransport = {
        async run(...args) {
          const result = await fake.transport.run(...args);
          return args[1][1] === "start" ? { ...result, cause } : result;
        },
      };
      const observed = await runContainer(
        host,
        configuration,
        configuration.definitions[0]!,
        path.resolve("source"),
        instance,
        undefined,
        transport,
      );
      assert.equal(observed.observation.outcome, cause);
      assert.equal(observed.removed, true);
    }
  }
});

void test("Docker arguments enforce fixed security roles and literal command arguments", () => {
  const configuration = config(),
    definition = {
      ...configuration.definitions[0]!,
      args: [";", "&&", "|", ">", "$()", "`", "spaces here"],
    };
  const args = createArguments(
    configuration,
    definition,
    path.resolve("source with spaces"),
    instance,
  );
  for (const flag of [
    "--pull=never",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--entrypoint=/usr/bin/env",
    "--log-driver=none",
  ])
    assert.ok(args.includes(flag));
  assert.equal(args.filter((arg) => arg === "--mount").length, 2);
  assert.equal(args.filter((arg) => arg === "--tmpfs").length, 2);
  assert.ok(args.includes(configuration.imageId));
  assert.deepEqual(args.slice(-definition.args.length), definition.args);
  assert.ok(
    !args.some((arg) => arg.includes("docker.sock") || arg === "--privileged" || arg === "sh"),
  );
  for (const source of [
    path.resolve("source,evil"),
    path.resolve('source"evil'),
    "/workspace/../../host",
  ])
    assert.throws(() => createArguments(configuration, definition, source, instance));
});

void test("lifecycle preserves verifier exit protocol and separates infrastructure errors", async () => {
  for (const [mode, outcome] of [
    ["pass", "EXITED"],
    ["fail", "EXITED"],
    ["oom", "PROCESS_ERROR"],
    ["runtime-error", "PROCESS_ERROR"],
    ["start-error", "PROCESS_ERROR"],
    ["image-missing", "PROCESS_ERROR"],
  ]) {
    const fake = runtime(mode!);
    const configuration = config();
    const observed = await runContainer(
      host,
      configuration,
      configuration.definitions[0]!,
      path.resolve("source"),
      instance,
      undefined,
      fake.transport,
    );
    assert.equal(observed.observation.outcome, outcome, mode!);
    if (mode === "fail") assert.equal(observed.observation.exitCode, 42);
    if (mode === "image-missing") assert.ok(!fake.calls.some((call) => call[1] === "create"));
    else assert.equal(observed.removed, true);
  }
});

void test("timeout/cancel/overflow kill the exact ID before remove; uncertain cleanup quarantines", async () => {
  for (const [mode, outcome] of [
    ["timeout", "TIMEOUT"],
    ["cancel", "CANCELLED"],
    ["overflow", "OUTPUT_LIMIT"],
    ["cleanup-error", "TERMINATION_UNCONFIRMED"],
    ["inspect-error", "TERMINATION_UNCONFIRMED"],
    ["create-error", "TERMINATION_UNCONFIRMED"],
    ["identity-mismatch", "TERMINATION_UNCONFIRMED"],
    ["unkillable", "TERMINATION_UNCONFIRMED"],
  ]) {
    const fake = runtime(mode!);
    const configuration = config();
    const observed = await runContainer(
      host,
      configuration,
      configuration.definitions[0]!,
      path.resolve("source"),
      instance,
      undefined,
      fake.transport,
    );
    assert.equal(observed.observation.outcome, outcome, mode!);
    for (const call of fake.calls.filter((call) => ["kill", "rm"].includes(call[1]!)))
      assert.equal(call.at(-1), containerId);
    assert.ok(
      !fake.calls.some(
        (call) => call.includes("ps") || call.includes("prune") || call.includes("--force"),
      ),
    );
    if (["timeout", "cancel", "overflow"].includes(mode!)) {
      assert.ok(
        fake.calls.findIndex((call) => call[1] === "kill") <
          fake.calls.findIndex((call) => call[1] === "rm"),
      );
      assert.equal(observed.removed, true);
    } else assert.equal(observed.observation.terminationConfirmed, false);
    if (mode === "identity-mismatch")
      assert.ok(!fake.calls.some((call) => ["start", "kill", "rm"].includes(call[1]!)));
    if (mode === "unkillable") assert.ok(!fake.calls.some((call) => call[1] === "rm"));
  }
});

void test("resolved image substitution cannot produce an accepted verifier result", async () => {
  const fake = runtime("pass"),
    configuration = config();
  const transport: DockerTransport = {
    async run(...args) {
      const result = await fake.transport.run(...args);
      if (args[1][1] !== "inspect") return result;
      const value = JSON.parse(
        Buffer.from(result.diagnostics.stdout, "base64").toString(),
      ) as Record<string, unknown>;
      value.Image = `sha256:${"f".repeat(64)}`;
      return response(value);
    },
  };
  const result = await runContainer(
    host,
    configuration,
    configuration.definitions[0]!,
    path.resolve("source"),
    instance,
    undefined,
    transport,
  );
  assert.notEqual(result.observation.outcome, "EXITED");
  assert.ok(!fake.calls.some((call) => call[1] === "start"));
});

void test("contradictory final exit metadata invalidates a prior successful exit", async () => {
  const fake = runtime("pass"),
    configuration = config();
  let inspections = 0;
  const transport: DockerTransport = {
    async run(...args) {
      const result = await fake.transport.run(...args);
      if (args[1][0] !== "container" || args[1][1] !== "inspect" || ++inspections !== 3)
        return result;
      const value = JSON.parse(Buffer.from(result.diagnostics.stdout, "base64").toString()) as {
        State: { ExitCode: number };
      };
      value.State.ExitCode = 42;
      return response(value);
    },
  };
  const result = await runContainer(
    host,
    configuration,
    configuration.definitions[0]!,
    path.resolve("source"),
    instance,
    undefined,
    transport,
  );
  assert.notEqual(result.observation.outcome, "EXITED");
});

void test("Docker mount order and nullable OOM defaults normalize without weakening checks", async () => {
  const fake = runtime("pass"),
    configuration = config();
  const transport: DockerTransport = {
    async run(...args) {
      const result = await fake.transport.run(...args);
      if (args[1][0] !== "container" || args[1][1] !== "inspect") return result;
      const inspected = JSON.parse(Buffer.from(result.diagnostics.stdout, "base64").toString()) as {
        HostConfig: { OomKillDisable: null };
        Mounts: unknown[];
      };
      inspected.HostConfig.OomKillDisable = null;
      inspected.Mounts.reverse();
      return response(inspected);
    },
  };
  const result = await runContainer(
    host,
    configuration,
    configuration.definitions[0]!,
    path.resolve("source"),
    instance,
    undefined,
    transport,
  );
  assert.equal(result.observation.outcome, "EXITED");
  assert.equal(result.removed, true);
});

void test("late lifecycle contradictions and FAIL cleanup failure cannot preserve valid evidence", async () => {
  for (const mutation of [
    { Status: "running", Running: true },
    { Status: "created" },
    { Error: "late runtime failure" },
    { OOMKilled: true },
    { StartedAt: "2026-10-04T01:00:00Z" },
  ]) {
    const fake = runtime("pass"),
      configuration = config();
    let count = 0;
    const transport: DockerTransport = {
      async run(...args) {
        const result = await fake.transport.run(...args);
        if (args[1][0] !== "container" || args[1][1] !== "inspect" || ++count !== 3) return result;
        const inspected = JSON.parse(
          Buffer.from(result.diagnostics.stdout, "base64").toString(),
        ) as { State: Record<string, unknown> };
        Object.assign(inspected.State, mutation);
        return response(inspected);
      },
    };
    const result = await runContainer(
      host,
      configuration,
      configuration.definitions[0]!,
      path.resolve("source"),
      instance,
      undefined,
      transport,
    );
    assert.equal(result.observation.outcome, "PROCESS_ERROR", JSON.stringify(mutation));
    assert.equal(result.removed, true);
  }
  const fake = runtime("fail"),
    configuration = config();
  const transport: DockerTransport = {
    async run(...args) {
      if (args[1][1] === "rm") return response("removal failed", 1);
      return fake.transport.run(...args);
    },
  };
  const result = await runContainer(
    host,
    configuration,
    configuration.definitions[0]!,
    path.resolve("source"),
    instance,
    undefined,
    transport,
  );
  assert.equal(result.observation.exitCode, 42);
  assert.equal(result.observation.outcome, "TERMINATION_UNCONFIRMED");
  assert.equal(result.observation.terminationConfirmed, false);
});
