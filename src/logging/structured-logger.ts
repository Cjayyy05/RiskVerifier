import type { JsonValue } from "../domain/index.js";

export const LOG_LEVELS = Object.freeze(["debug", "info", "warn", "error"] as const);
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogContext = Readonly<Record<string, JsonValue>>;

export interface StructuredLogger {
  log(level: LogLevel, event: string, context?: LogContext): void;
}

export type LogSink = (line: string) => void;

function serializeLogRecord(level: LogLevel, event: string, context: LogContext): string {
  const timestamp = new Date().toISOString();
  try {
    return JSON.stringify({ timestamp, level, event, context });
  } catch {
    // Never retry with the rejected context: accessors, cycles, or unusual runtime values could
    // throw again or disclose data while the logger is handling its own failure.
    return JSON.stringify({
      timestamp,
      level: "error",
      event: "logging.serialization_failed",
      context: {},
    });
  }
}

/**
 * Creates a minimal JSON-lines logger. Context is assumed to have been redacted by the caller.
 * This logger deliberately does not claim that repository content, evidence, or secrets are safe
 * to emit merely because they can be serialized.
 */
export function createStructuredLogger(sink: LogSink): StructuredLogger {
  return Object.freeze({
    log(level: LogLevel, event: string, context: LogContext = {}): void {
      sink(serializeLogRecord(level, event, context));
    },
  });
}
