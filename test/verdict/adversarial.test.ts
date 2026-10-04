import assert from "node:assert/strict";
import test from "node:test";
import { InvalidInputError } from "../../src/domain/index.js";
import { evaluateVerdict, validateVerdictAssessment } from "../../src/verdict/index.js";
import { captureExecutionEvidence } from "../../src/evidence/index.js";
import { data } from "../../src/evidence/validation.js";
import { planningFixture } from "../planning/fixture.js";
import { altered, evidenceFixture } from "./fixture.js";

void test("policy 5.1 permits optional omission but never suppression of captured optional outcomes", () => {
  const fixture = evidenceFixture();
  const results = fixture.input.results.filter(
    (result) => result.binding.check.strength === "MANDATORY",
  );
  const references = fixture.references.filter(
    (reference) => reference.binding.check.strength === "MANDATORY",
  );
  const input = { ...fixture.input, results };
  const assessment = evaluateVerdict(input, references);
  assert.equal(assessment.verdict, "APPROVE");
  assert.equal(
    assessment.checks.filter((check) => check.reason.code === "OPTIONAL_OMITTED").length,
    2,
  );
  assert.deepEqual(
    validateVerdictAssessment(input, references, JSON.parse(JSON.stringify(assessment))),
    assessment,
  );
  for (const state of ["PASS", "FAIL", "ERROR", "TIMEOUT", "CANCELLED", "UNSUPPORTED"] as const) {
    const produced = evidenceFixture([state]);
    const retained = [produced.references[0]!, ...references];
    const missing = evaluateVerdict(input, retained);
    assert.equal(missing.verdict, "INCONCLUSIVE", `cannot erase captured optional ${state}`);
    assert.equal(missing.checks[0]!.expectedEvidence!.resultDigest, retained[0]!.resultDigest);
    assert.notEqual(missing.id, assessment.id);
    assert.throws(() => validateVerdictAssessment(input, retained, assessment), InvalidInputError);
    const present = evaluateVerdict(
      { ...input, results: [produced.input.results[0]!, ...results] },
      retained,
    );
    assert.equal(
      present.verdict,
      state === "PASS" ? "APPROVE" : state === "FAIL" ? "BLOCK" : "INCONCLUSIVE",
    );
  }
});

void test("optional omission is not a waiver of known unsupported or unavailable capability", () => {
  for (const availability of ["UNSUPPORTED", "UNAVAILABLE"] as const) {
    const fixture = evidenceFixture(
      ["UNSUPPORTED", "UNSUPPORTED", "UNSUPPORTED"],
      planningFixture(["TEST"], { availability }),
    );
    const result = evaluateVerdict({ ...fixture.input, results: [] }, []);
    for (const check of result.checks.filter((check) => check.check.strength === "OPTIONAL")) {
      assert.equal(check.contribution, "INDETERMINATE");
      assert.equal(check.reason.code, "RESULT_MISSING");
    }
  }
});

void test("three-state precedence retains every reason across all six permutations", () => {
  for (const states of [
    ["PASS", "FAIL", "TIMEOUT"],
    ["PASS", "ERROR", "UNSUPPORTED"],
    ["FAIL", "CANCELLED", "ERROR"],
    ["FAIL", "FAIL", "PASS"],
  ] as const) {
    const { input, references } = evidenceFixture(states);
    const expected = evaluateVerdict(input, references);
    assert.equal(
      expected.verdict,
      states.some((state) => state === "FAIL") ? "BLOCK" : "INCONCLUSIVE",
    );
    assert.deepEqual(
      expected.checks.map((check) => check.state),
      states,
    );
    for (const order of [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ])
      assert.deepEqual(
        evaluateVerdict(
          { ...input, results: order.map((index) => input.results[index]!) },
          order.map((index) => references[index]!),
        ),
        expected,
      );
  }
});

void test("conflicting duplicates and cross-plan/check substitutions reject, not merge", () => {
  const { input, references } = evidenceFixture();
  const negative = evidenceFixture(["FAIL"]);
  for (const extra of [input.results[0]!, negative.input.results[0]!])
    assert.throws(
      () => evaluateVerdict({ ...input, results: [...input.results, extra] }, references),
      InvalidInputError,
    );
  const other = evidenceFixture([], planningFixture(["TEST"], { repository: "other" }));
  assert.throws(
    () => evaluateVerdict({ ...input, results: other.input.results }, references),
    InvalidInputError,
  );
  const substituted = altered(input.results[0]!, ["binding", "check"], input.plan.checks[1]);
  assert.throws(
    () =>
      evaluateVerdict({ ...input, results: [substituted, ...input.results.slice(1)] }, references),
    InvalidInputError,
  );
});

void test("unreachable empty-plan material coverage and nonblocking selected FAIL cannot bypass replay", () => {
  const empty = evidenceFixture([], planningFixture(["GENERAL"], { empty: true }));
  assert.ok(
    empty.input.plan.policy.coverage.every((entry) => entry.resolution === "INFORMATIONAL"),
  );
  assert.throws(() =>
    evaluateVerdict(
      altered(empty.input, ["plan", "policy", "coverage", 0, "resolution"], "REVIEW_REQUIRED"),
      [],
    ),
  );
  const fixture = evidenceFixture(["FAIL"]);
  assert.throws(() =>
    evaluateVerdict(
      altered(fixture.input, ["plan", "checks", 0, "validFailureBehavior"], "NOT_APPLICABLE"),
      fixture.references,
    ),
  );
});

void test("bounded DTO validation rejects depth, breadth, aggregate text and numeric attacks", () => {
  let deep: unknown = null;
  for (let index = 0; index < 34; index++) deep = { nested: deep };
  for (const input of [
    deep,
    Array(32769).fill(null),
    NaN,
    Infinity,
    -Infinity,
    0.5,
    Array(22).fill("x".repeat(1500000)),
    Array(20).fill(Array(32000).fill(null)),
  ])
    assert.throws(() => data(input), InvalidInputError);
  const { input } = evidenceFixture();
  let called = false;
  const hostile = {
    get observation(): never {
      called = true;
      throw new Error("getter invoked");
    },
  };
  assert.throws(
    () =>
      captureExecutionEvidence(input.planningInput, input.plan, input.results[0]!.binding, hostile),
    InvalidInputError,
  );
  assert.equal(called, false);
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.throws(
    () =>
      captureExecutionEvidence(input.planningInput, input.plan, input.results[0]!.binding, cycle),
    InvalidInputError,
  );
});
