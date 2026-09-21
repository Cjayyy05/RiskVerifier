import assert from "node:assert/strict";
import test from "node:test";

import { InvalidConfigurationError } from "../../src/domain/index.js";
import { parseConfigurationSnapshot } from "../../src/configuration/index.js";

void test("validates and deterministically identifies trusted configuration", () => {
  const first = parseConfigurationSnapshot({ schemaVersion: 1, version: "config-v1" });
  const second = parseConfigurationSnapshot({ version: "config-v1", schemaVersion: 1 });

  assert.equal(first.identity.hash, second.identity.hash);
  assert.match(first.identity.hash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(first));
  assert.equal("trustBoundary" in first, false);
});

void test("rejects malformed, unsupported, and command-bearing configuration", () => {
  assert.throws(() => parseConfigurationSnapshot(null), InvalidConfigurationError);
  assert.throws(
    () => parseConfigurationSnapshot({ schemaVersion: 2, version: "config-v1" }),
    InvalidConfigurationError,
  );
  assert.throws(
    () => parseConfigurationSnapshot({ schemaVersion: 1, version: "" }),
    InvalidConfigurationError,
  );
  assert.throws(
    () =>
      parseConfigurationSnapshot({
        schemaVersion: 1,
        version: "config-v1",
        commands: ["npm test"],
      }),
    InvalidConfigurationError,
  );
});

void test("does not confuse validation with provenance or accept executable objects", () => {
  class RepositoryConfiguration {
    public readonly schemaVersion = 1;
    public readonly version = "repo-controlled";
  }

  assert.throws(
    () => parseConfigurationSnapshot(new RepositoryConfiguration()),
    InvalidConfigurationError,
  );
  assert.throws(
    () =>
      parseConfigurationSnapshot(
        Object.defineProperty({ schemaVersion: 1 }, "version", {
          enumerable: true,
          get: () => "config-v1",
        }),
      ),
    InvalidConfigurationError,
  );
});
