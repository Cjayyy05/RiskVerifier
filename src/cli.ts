#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { VERSION } from "./version.js";

export interface CliIo {
  readonly stdout: { write(chunk: string): unknown };
  readonly stderr: { write(chunk: string): unknown };
}

export function runCli(args: readonly string[], io: CliIo): number {
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }

  io.stderr.write("Usage: riskverifier --version\n");
  return 1;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  process.exitCode = runCli(process.argv.slice(2), {
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
