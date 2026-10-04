import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { createConnection, createServer } from "node:net";
import { spawn } from "node:child_process";

// RiskVerifier-owned fixture only. No source imports, package scripts or dependency installation.
const mode = process.argv[2];
async function connects(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port: 38191 });
    const done = (value: boolean): void => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}
if (mode === "pass") process.exitCode = 0;
else if (mode === "fail") process.exitCode = 42;
else if (mode === "error") process.exitCode = 7;
else if (mode === "timeout") setInterval(() => {}, 1000);
else if (mode === "listener") {
  const server = createServer((socket) => socket.end());
  server.listen(38191, "0.0.0.0");
  setTimeout(() => server.close(), 60000);
} else if (mode === "network-allowed" || mode === "network-denied") {
  const connected = await connects(process.argv[3]!);
  process.stdout.write(JSON.stringify({ connected }));
  process.exitCode = connected === (mode === "network-allowed") ? 0 : 7;
} else if (mode === "overflow") {
  const bytes = Buffer.alloc(65536, 120);
  setInterval(() => process.stdout.write(bytes), 1);
} else if (mode === "args") process.stdout.write(JSON.stringify(process.argv.slice(3)));
else if (mode === "oom") {
  const held: Buffer[] = [];
  setInterval(() => {
    for (let i = 0; i < 8; i++) held.push(Buffer.alloc(8 * 1024 * 1024, 1));
  }, 1);
} else if (mode === "pids") {
  let failures = 0,
    created = 0;
  for (let i = 0; i < 32; i++) {
    const child = spawn("/usr/local/bin/node", ["--", "/verifier.mjs", "timeout"], {
      stdio: "ignore",
      env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
    });
    child.once("spawn", () => {
      created++;
    });
    child.once("error", () => {
      failures++;
    });
  }
  setTimeout(() => {
    process.stdout.write(JSON.stringify({ created, failures }));
    process.exit(failures > 0 ? 0 : 7);
  }, 1000);
} else if (mode === "security") {
  let sourceReadOnly = false,
    rootReadOnly = false,
    verifierReadOnly = false;
  const sourceMutations = [
    () => writeFileSync("/workspace/new.txt", "created"),
    () => renameSync("/workspace/source.txt", "/workspace/renamed.txt"),
    () => unlinkSync("/workspace/source.txt"),
  ].map((operation) => {
    try {
      operation();
      return false;
    } catch {
      return true;
    }
  });
  try {
    writeFileSync("/workspace/source.txt", "modified");
  } catch {
    sourceReadOnly = true;
  }
  try {
    writeFileSync("/root-write-probe", "modified");
  } catch {
    rootReadOnly = true;
  }
  try {
    writeFileSync("/verifier.mjs", "modified");
  } catch {
    verifierReadOnly = true;
  }
  writeFileSync("/scratch/output.txt", "scratch-ok");
  writeFileSync("/tmp/output.txt", "tmp-ok");
  const status = readFileSync("/proc/self/status", "utf8");
  const capability = status.match(/^CapEff:\s*(\w+)/mu)?.[1];
  const noNewPrivileges = status.match(/^NoNewPrivs:\s*(\d+)/mu)?.[1];
  const externalInterface = Object.values(networkInterfaces())
    .flat()
    .some((item) => item && !item.internal);
  const network = await new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: "192.0.2.1", port: 9 });
    const done = (connected: boolean): void => {
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(300, () => done(false));
    socket.once("error", () => done(false));
    socket.once("connect", () => done(true));
  });
  const report = {
    uid: process.getuid?.(),
    sourceReadOnly,
    sourceMutations,
    rootReadOnly,
    verifierReadOnly,
    scratch: readFileSync("/scratch/output.txt", "utf8"),
    tmp: readFileSync("/tmp/output.txt", "utf8"),
    capability,
    noNewPrivileges,
    externalInterface,
    network,
    secret: process.env.RISKVERIFIER_FAKE_SECRET ?? null,
    socket: existsSync("/var/run/docker.sock"),
    source: readFileSync("/workspace/source.txt", "utf8"),
  };
  process.stdout.write(JSON.stringify(report));
  process.exitCode =
    report.uid !== 0 &&
    sourceReadOnly &&
    sourceMutations.every(Boolean) &&
    rootReadOnly &&
    verifierReadOnly &&
    report.scratch === "scratch-ok" &&
    !externalInterface &&
    !network &&
    !report.secret &&
    !report.socket &&
    /^0+$/u.test(capability ?? "") &&
    noNewPrivileges === "1"
      ? 0
      : 7;
} else process.exitCode = 7;
