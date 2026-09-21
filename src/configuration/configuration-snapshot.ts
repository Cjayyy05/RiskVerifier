import { createHash } from "node:crypto";

import {
  InvalidConfigurationError,
  createConfigurationIdentity,
  createConfigurationVersion,
  type ConfigurationIdentity,
  type ConfigurationVersion,
} from "../domain/index.js";

export const CONFIGURATION_SCHEMA_VERSION = 1 as const;

export interface ValidatedConfigurationSnapshot {
  readonly schemaVersion: typeof CONFIGURATION_SCHEMA_VERSION;
  readonly version: ConfigurationVersion;
  readonly identity: ConfigurationIdentity;
}

/**
 * Validates and identifies a configuration-shaped data snapshot. Validation and hashing establish
 * shape and content identity only; they do not establish that the snapshot came from an authorized
 * operator. A later acquisition boundary must establish provenance before using a snapshot as
 * trusted configuration. Executable check definitions intentionally do not exist in Phase 1.
 */
export function parseConfigurationSnapshot(input: unknown): ValidatedConfigurationSnapshot {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidConfigurationError("Configuration snapshot must be an object");
  }

  const prototype = Object.getPrototypeOf(input) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidConfigurationError("Configuration snapshot must be a plain data object");
  }

  const record = input as Readonly<Record<string, unknown>>;
  const allowedKeys = ["schemaVersion", "version"];
  const unexpected = Reflect.ownKeys(record)
    .filter((key) => typeof key !== "string" || !allowedKeys.includes(key))
    .map(String);
  if (unexpected.length > 0) {
    throw new InvalidConfigurationError("Configuration snapshot contains unexpected fields", {
      unexpected,
    });
  }

  for (const key of allowedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor !== undefined && !("value" in descriptor)) {
      throw new InvalidConfigurationError("Configuration snapshot must not use accessors", {
        field: key,
      });
    }
  }

  if (record.schemaVersion !== CONFIGURATION_SCHEMA_VERSION) {
    throw new InvalidConfigurationError("Unsupported configuration snapshot schemaVersion", {
      schemaVersion: record.schemaVersion,
    });
  }

  let version: ConfigurationVersion;
  try {
    version = createConfigurationVersion(record.version);
  } catch (error) {
    throw new InvalidConfigurationError("Configuration snapshot version is invalid", {
      cause: error instanceof Error ? error.message : "unknown error",
    });
  }

  // Constructing this fixed-order normalized representation makes insertion order irrelevant.
  const canonical = JSON.stringify({
    schemaVersion: CONFIGURATION_SCHEMA_VERSION,
    version,
  });
  const hash = createHash("sha256").update(canonical, "utf8").digest("hex");

  return Object.freeze({
    schemaVersion: CONFIGURATION_SCHEMA_VERSION,
    version,
    identity: createConfigurationIdentity({ version, hash }),
  });
}
