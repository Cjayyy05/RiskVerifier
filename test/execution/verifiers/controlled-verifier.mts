// Trusted RiskVerifier harness; never sourced from the repository being checked.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import ts from "typescript";

switch (process.argv[2]) {
  case "protocol":
    process.stdout.write("PASS");
    process.stderr.write("failed");
    process.exitCode = Number(process.argv[3]);
    break;
  case "self-signal":
    process.kill(process.pid, "SIGTERM");
    break;
  case "pass":
    process.stdout.write("diagnostic stdout\n");
    process.stderr.write("diagnostic stderr\n");
    break;
  case "fail":
    process.exitCode = 42;
    break;
  case "crash":
    throw new Error("Controlled verifier malfunction");
  case "unknown-exit":
    process.exitCode = 12;
    break;
  case "runtime-exit":
    process.exitCode = 10;
    break;
  case "slow":
    setInterval(() => {}, 1000);
    break;
  case "stream":
    process.stdout.write("ready");
    await writeFile("ready", "ready");
    setInterval(() => process.stdout.write("x"), 5);
    break;
  case "flood":
    process.stdout.write("é".repeat(32768));
    break;
  case "bytes":
    process.stdout.write(Buffer.from([0xff, 0xfe, 0x1b, 0, 0xc3, 0xa9]));
    process.stderr.write("xy");
    break;
  case "context":
    process.stdout.write(
      JSON.stringify({ args: process.argv.slice(3), cwd: process.cwd(), env: process.env }),
    );
    break;
  case "fixture-build": {
    // Fixed options and prepared compiler; no repository tsconfig, plugins or installation.
    const program = ts.createProgram([path.join(process.cwd(), "target.ts")], {
      noEmit: true,
      strict: true,
      types: [],
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
    });
    process.exitCode = ts.getPreEmitDiagnostics(program).length === 0 ? 0 : 42;
    break;
  }
  case "fixture-static-analysis": {
    const source = await readFile("target.ts", "utf8");
    const tree = ts.createSourceFile("target.ts", source, ts.ScriptTarget.ES2022, true);
    let debuggerStatement = false;
    const visit = (node: ts.Node): void => {
      if (ts.isDebuggerStatement(node)) debuggerStatement = true;
      ts.forEachChild(node, visit);
    };
    visit(tree);
    process.exitCode = debuggerStatement ? 42 : 0;
    break;
  }
  case "fixture-tests": {
    const module = (await import(pathToFileURL(path.join(process.cwd(), "math.mjs")).href)) as {
      add(a: number, b: number): number;
    };
    try {
      assert.equal(module.add(2, 3), 5);
      assert.equal(module.add(0, 0), 0);
    } catch (error) {
      if (!(error instanceof assert.AssertionError)) throw error;
      process.exitCode = 42;
    }
    break;
  }
  default:
    process.exitCode = 12;
}
