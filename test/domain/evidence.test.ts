import assert from "node:assert/strict";
import test from "node:test";

import { InvalidInputError, createEvidence } from "../../src/domain/index.js";
import { NOW, createTestEvidence } from "../helpers.js";

type EvidenceInput = Parameters<typeof createEvidence>[0];

function createEvidenceWithFact(fact: unknown, overrides: Partial<EvidenceInput> = {}): void {
  const existing = createTestEvidence();
  createEvidence({
    id: "evidence-under-test",
    kind: "TEST_FACT",
    context: existing.context,
    producer: "phase-1-test",
    producerVersion: "1",
    subjectIds: ["subject-1"],
    createdAt: NOW,
    fact: fact as EvidenceInput["fact"],
    completeness: "COMPLETE",
    sensitivity: "INTERNAL",
    ...overrides,
  });
}

void test("accepts finite acyclic JSON facts and recursively freezes their copy", () => {
  const input = {
    values: [null, true, false, "text", 0, 1.5, { nested: ["value"] }],
  };
  const existing = createTestEvidence();
  const evidence = createEvidence({
    ...existing,
    id: "evidence-json",
    fact: input,
  });

  input.values.push("caller mutation");
  const values = evidence.fact.values;
  assert.ok(Array.isArray(values));
  assert.equal(values.length, 7);
  assert.ok(Object.isFrozen(evidence));
  assert.ok(Object.isFrozen(evidence.context));
  assert.ok(Object.isFrozen(evidence.fact));
  assert.ok(Object.isFrozen(values));
  assert.ok(Object.isFrozen(values[6]));
});

void test("rejects every non-JSON fact shape", () => {
  class CustomValue {
    public readonly value = 1;
  }

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const invalidValues: readonly unknown[] = [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    undefined,
    (): boolean => true,
    Symbol("value"),
    1n,
    new Date(NOW),
    new CustomValue(),
    cyclic,
  ];

  for (const invalid of invalidValues) {
    assert.throws(() => createEvidenceWithFact({ invalid }), InvalidInputError);
  }
});

void test("rejects accessor properties and preserves __proto__ as inert JSON data", () => {
  const accessor = Object.defineProperty({}, "value", {
    enumerable: true,
    get: () => 1,
  });
  assert.throws(() => createEvidenceWithFact(accessor), InvalidInputError);

  const protoKey = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
  const existing = createTestEvidence();
  const evidence = createEvidence({ ...existing, id: "evidence-proto", fact: protoKey as never });
  assert.equal(Object.hasOwn(evidence.fact, "__proto__"), true);
  assert.equal(({} as { readonly polluted?: boolean }).polluted, undefined);
});

void test("bounds evidence depth and graph size with domain validation errors", () => {
  const deep: Record<string, unknown> = {};
  let cursor = deep;
  for (let index = 0; index < 70; index += 1) {
    const next: Record<string, unknown> = {};
    cursor.next = next;
    cursor = next;
  }

  assert.throws(() => createEvidenceWithFact(deep), InvalidInputError);
  assert.throws(
    () => createEvidenceWithFact({ values: Array.from({ length: 10_001 }, () => null) }),
    InvalidInputError,
  );
});

void test("enforces execution associations, subjects, and payload digest format", () => {
  assert.throws(() => createEvidenceWithFact({}, { subjectIds: [] }), InvalidInputError);
  assert.throws(() => createEvidenceWithFact({}, { resultState: "PASS" }), InvalidInputError);
  assert.throws(() => createEvidenceWithFact({}, { attemptId: "attempt-1" }), InvalidInputError);
  assert.throws(() => createEvidenceWithFact({}, { checkId: "check-1" }), InvalidInputError);
  assert.throws(
    () => createEvidenceWithFact({}, { payloadDigest: "not-a-digest" }),
    InvalidInputError,
  );

  assert.doesNotThrow(() =>
    createEvidenceWithFact(
      {},
      {
        strategy: "BUILD",
        checkId: "check-1",
        attemptId: "attempt-1",
        resultState: "PASS",
        payloadDigest: `sha256:${"d".repeat(64)}`,
      },
    ),
  );
});
