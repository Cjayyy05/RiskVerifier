import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";

import { BoundedProcessError, runBoundedProcess } from "../../src/git/bounded-process.js";

void test("enforces timeout, output, and cancellation boundaries", async () => {
  await assert.rejects(
    runBoundedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      timeoutMs: 50,
      maxOutputBytes: 1024,
      environment: process.env,
    }),
    (error: unknown) => error instanceof BoundedProcessError && error.kind === "TIMEOUT",
  );

  await assert.rejects(
    runBoundedProcess(process.execPath, ["-e", 'process.stdout.write("x".repeat(2048))'], {
      timeoutMs: 5_000,
      maxOutputBytes: 128,
      environment: process.env,
    }),
    (error: unknown) => error instanceof BoundedProcessError && error.kind === "OUTPUT_LIMIT",
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runBoundedProcess(process.execPath, ["--version"], {
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
      environment: process.env,
      signal: controller.signal,
    }),
    (error: unknown) => error instanceof BoundedProcessError && error.kind === "CANCELLED",
  );
});

void test("combined byte cap accepts its exact boundary and rejects the next byte", async () => {
  for (const maximum of [16, 15]) {
    const operation = runBoundedProcess(
      process.execPath,
      ["-e", 'process.stdout.write("é".repeat(4)); process.stderr.write("z".repeat(8));'],
      { timeoutMs: 5_000, maxOutputBytes: maximum, environment: process.env },
    );
    if (maximum === 16) {
      const result = await operation;
      assert.equal(result.stdout.length + result.stderr.length, 16);
      assert.equal(result.exitCode, 0);
    } else {
      await assert.rejects(
        operation,
        (error: unknown) => error instanceof BoundedProcessError && error.kind === "OUTPUT_LIMIT",
      );
    }
  }
  await assert.rejects(
    runBoundedProcess(process.execPath, ["--version"], {
      timeoutMs: 2_147_483_648,
      maxOutputBytes: 100,
      environment: process.env,
    }),
    RangeError,
  );
});

void test("repeated immediate and in-output aborts settle once and release listeners", async () => {
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const controller = new AbortController();
    let outcomes = 0;
    const operation = runBoundedProcess(
      process.execPath,
      ["-e", 'setInterval(() => process.stdout.write("x"), 5);'],
      {
        timeoutMs: 5_000,
        maxOutputBytes: 1024 * 1024,
        environment: process.env,
        signal: controller.signal,
      },
    );
    const observed = operation.finally(() => {
      outcomes += 1;
    });
    const timer = iteration % 2 === 0 ? undefined : setTimeout(() => controller.abort(), 250);
    if (timer === undefined) controller.abort();
    try {
      await assert.rejects(
        observed,
        (error: unknown) => error instanceof BoundedProcessError && error.kind === "CANCELLED",
      );
    } finally {
      clearTimeout(timer);
    }
    controller.abort();
    assert.equal(outcomes, 1);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
});

void test("completion and competing timeout/output/cancellation retain one terminal outcome", async () => {
  const completed = new AbortController();
  const success = await runBoundedProcess(process.execPath, ["--version"], {
    timeoutMs: 5_000,
    maxOutputBytes: 1024,
    environment: process.env,
    signal: completed.signal,
  });
  completed.abort();
  assert.equal(success.exitCode, 0);
  assert.equal(getEventListeners(completed.signal, "abort").length, 0);
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 75);
    try {
      await assert.rejects(
        runBoundedProcess(
          process.execPath,
          ["-e", 'setInterval(() => process.stdout.write("x".repeat(2048)), 1);'],
          {
            timeoutMs: 75,
            maxOutputBytes: 128,
            environment: process.env,
            signal: controller.signal,
          },
        ),
        (error: unknown) =>
          error instanceof BoundedProcessError &&
          ["TIMEOUT", "CANCELLED", "OUTPUT_LIMIT"].includes(error.kind),
      );
    } finally {
      clearTimeout(timer);
    }
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
});
