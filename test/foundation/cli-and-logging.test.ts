import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { runCli } from "../../src/cli.js";
import { createStructuredLogger } from "../../src/logging/index.js";
import { VERSION } from "../../src/version.js";

function createCaptureIo(): {
  readonly lines: string[];
  readonly io: Parameters<typeof runCli>[1];
} {
  const lines: string[] = [];
  return {
    lines,
    io: {
      stdout: { write: (chunk): boolean => (lines.push(String(chunk)), true) },
      stderr: { write: (chunk): boolean => (lines.push(String(chunk)), true) },
    },
  };
}

void test("minimal CLI reports the project version and exposes no verify command", () => {
  const versionCapture = createCaptureIo();
  assert.equal(runCli(["--version"], versionCapture.io), 0);
  assert.deepEqual(versionCapture.lines, [`${VERSION}\n`]);

  const shortVersionCapture = createCaptureIo();
  assert.equal(runCli(["-v"], shortVersionCapture.io), 0);
  assert.deepEqual(shortVersionCapture.lines, [`${VERSION}\n`]);

  const unsupportedCapture = createCaptureIo();
  assert.equal(runCli(["verify"], unsupportedCapture.io), 1);
  assert.deepEqual(unsupportedCapture.lines, ["Usage: riskverifier --version\n"]);

  const emptyCapture = createCaptureIo();
  assert.equal(runCli([], emptyCapture.io), 1);
  assert.deepEqual(emptyCapture.lines, ["Usage: riskverifier --version\n"]);
});

void test("CLI version stays synchronized with package metadata", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(process.cwd(), "package.json"), "utf8"),
  ) as { readonly version: string };
  assert.equal(VERSION, packageJson.version);
});

void test("structured logger emits JSON but does not claim to redact caller data", () => {
  const lines: string[] = [];
  const logger = createStructuredLogger((line) => lines.push(line));
  logger.log("info", "foundation.ready", { phase: 1 });

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0] ?? "") as {
    readonly event: string;
    readonly context: { readonly phase: number };
  };
  assert.equal(parsed.event, "foundation.ready");
  assert.equal(parsed.context.phase, 1);
});

void test("structured logger remains valid JSON for errors and cyclic runtime values", () => {
  const lines: string[] = [];
  const logger = createStructuredLogger((line) => lines.push(line));
  logger.log("error", "operation.failed", { error: new Error("safe serialization") as never });

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.doesNotThrow(() => logger.log("info", "cyclic.context", cyclic as never));

  assert.equal(lines.length, 2);
  assert.doesNotThrow(() => JSON.parse(lines[0] ?? ""));
  const fallback = JSON.parse(lines[1] ?? "") as {
    readonly level: string;
    readonly event: string;
    readonly context: Readonly<Record<string, unknown>>;
  };
  assert.equal(fallback.level, "error");
  assert.equal(fallback.event, "logging.serialization_failed");
  assert.deepEqual(fallback.context, {});
});
