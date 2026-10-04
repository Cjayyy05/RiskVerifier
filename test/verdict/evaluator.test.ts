import assert from "node:assert/strict";
import test from "node:test";
import { InvalidInputError, type CheckResultState } from "../../src/domain/index.js";
import { captureExecutionEvidence, validateExecutionEvidence } from "../../src/evidence/index.js";
import { noProcess } from "../../src/execution/result.js";
import { evaluateVerdict, validateVerdictAssessment } from "../../src/verdict/index.js";
import { planningFixture } from "../planning/fixture.js";
import { altered, evidenceFixture } from "./fixture.js";

const states = ["PASS", "FAIL", "ERROR", "TIMEOUT", "CANCELLED", "UNSUPPORTED"] as const;
for (const state of states) {
  void test(`${state} uses selected mandatory and optional plan handling`, () => {
    for (const index of [0, 1, 2]) {
      const selected: CheckResultState[] = ["PASS", "PASS", "PASS"];
      selected[index] = state;
      const { input, references } = evidenceFixture(selected);
      assert.ok(input.plan.checks.some((check) => check.strength === "OPTIONAL"));
      assert.ok(input.plan.checks.some((check) => check.strength === "MANDATORY"));
      const result = evaluateVerdict(input, references);
      assert.equal(
        result.verdict,
        state === "PASS" ? "APPROVE" : state === "FAIL" ? "BLOCK" : "INCONCLUSIVE",
      );
      assert.equal(result.checks[index]!.state, state);
      assert.equal(result.checks[index]!.check.validFailureBehavior, "BLOCK");
      assert.equal(result.checks[index]!.check.unavailableBehavior, "INCONCLUSIVE");
      assert.ok(
        result.checks[index]!.reason.explanation.includes(input.plan.checks[index]!.strategy),
      );
      assert.deepEqual(
        validateVerdictAssessment(input, references, JSON.parse(JSON.stringify(result))),
        result,
      );
    }
  });
}

void test("all 36 mixed state pairs enforce precedence, retain all reasons and ignore result ordering", () => {
  for (const left of states)
    for (const right of states) {
      const { input, references } = evidenceFixture([left, right]);
      const expected = evaluateVerdict(input, references);
      assert.equal(
        expected.verdict,
        left === "FAIL" || right === "FAIL"
          ? "BLOCK"
          : left !== "PASS" || right !== "PASS"
            ? "INCONCLUSIVE"
            : "APPROVE",
      );
      assert.deepEqual(
        expected,
        evaluateVerdict(
          { ...input, results: [...input.results].reverse() },
          [...references].reverse(),
        ),
      );
      assert.equal(expected.checks.length, input.plan.checks.length);
      assert.equal(expected.checks[0]!.state, left);
      assert.equal(expected.checks[1]!.state, right);
    }
});

void test("missing mandatory or captured evidence prevents approval; genuine optional omission is neutral", () => {
  const { input, references } = evidenceFixture();
  assert.equal(input.plan.checks.length, 3);
  for (let missing = 0; missing < input.results.length; missing++) {
    const results = input.results.filter((_, index) => index !== missing);
    const assessment = evaluateVerdict({ ...input, results }, references);
    assert.equal(assessment.verdict, "INCONCLUSIVE");
    assert.equal(assessment.checks[missing]!.state, "MISSING");
    assert.equal(assessment.checks[missing]!.evidence, null);
    assert.equal(assessment.checks[missing]!.reason.code, "RESULT_MISSING");
    const omitted = evaluateVerdict(
      { ...input, results },
      references.filter((_, index) => index !== missing),
    );
    const optional = input.plan.checks[missing]!.strength === "OPTIONAL";
    assert.equal(omitted.verdict, optional ? "APPROVE" : "INCONCLUSIVE");
    assert.equal(
      omitted.checks[missing]!.reason.code,
      optional ? "OPTIONAL_OMITTED" : "RESULT_MISSING",
    );
    assert.equal(omitted.checks[missing]!.state, "MISSING");
    assert.equal(omitted.checks[missing]!.evidence, null);
    assert.equal(omitted.checks[missing]!.expectedEvidence, null);
  }
  assert.equal(evaluateVerdict({ ...input, results: [] }, []).verdict, "INCONCLUSIVE");
});

void test("empty replay-valid plan has narrow approval, whereas stripping a selected plan rejects", () => {
  const empty = evidenceFixture([], planningFixture(["GENERAL"], { empty: true }));
  const assessment = evaluateVerdict(empty.input, []);
  assert.equal(assessment.verdict, "APPROVE");
  assert.equal(assessment.reason.code, "NO_CHECKS_REQUIRED");
  assert.equal(assessment.checks.length, 0);
  const { input } = evidenceFixture();
  assert.throws(() => evaluateVerdict(altered(input, ["plan", "checks"], []), []));
});

void test("GENERAL and material coverage stay unresolved even when all selected checks pass", () => {
  for (const planning of [
    planningFixture(["GENERAL"]),
    planningFixture(["TEST"], { uncertain: true }),
  ]) {
    const { input, references } = evidenceFixture([], planning);
    const result = evaluateVerdict(input, references);
    assert.equal(result.verdict, "INCONCLUSIVE");
    assert.ok(result.checks.every((check) => check.contribution === "SATISFIED"));
    assert.ok(result.coverage.some((coverage) => coverage.contribution === "INDETERMINATE"));
    assert.deepEqual(
      result.coverage.map((coverage) => coverage.uncertainty),
      input.plan.policy.risk.uncertainties,
    );
  }
  const blocking = evidenceFixture(["FAIL"], planningFixture(["GENERAL"]));
  assert.equal(evaluateVerdict(blocking.input, blocking.references).verdict, "BLOCK");
});

void test("risk never directly decides verdict; ambient classifier uncertainty is informational", () => {
  for (const categories of [["TEST"], ["AUTHORIZATION", "API"]] as const) {
    const { input, references } = evidenceFixture([], planningFixture(categories));
    const result = evaluateVerdict(input, references);
    assert.equal(result.verdict, "APPROVE");
    assert.ok(result.coverage.every((coverage) => coverage.resolution === "INFORMATIONAL"));
  }
});

void test("policy-unavailable mandatory checks contribute inconclusive", () => {
  const fixture = evidenceFixture(
    ["UNSUPPORTED", "UNSUPPORTED", "UNSUPPORTED", "UNSUPPORTED", "UNSUPPORTED"],
    planningFixture(undefined, { availability: "UNSUPPORTED" }),
  );
  const results = fixture.input.results.map((result) => ({
    ...result,
    binding: {
      ...result.binding,
      definition: {
        id: `definition:sha256:${"b".repeat(64)}`,
        version: "fixture-v1",
        maxOutputBytes: 4096,
        timeoutMs: 1000,
      },
    },
    observation: noProcess("POLICY_UNAVAILABLE"),
  }));
  const references = results.map((result) =>
    captureExecutionEvidence(
      fixture.input.planningInput,
      fixture.input.plan,
      result.binding,
      result,
    ),
  );
  assert.equal(evaluateVerdict({ ...fixture.input, results }, references).verdict, "INCONCLUSIVE");
});

void test("process errors, bounded output failure and unconfirmed termination never become valid negative evidence", () => {
  for (const outcome of [
    "START_ERROR",
    "PROCESS_ERROR",
    "EXECUTABLE_UNAVAILABLE",
    "VERIFIER_UNAVAILABLE",
    "WORKSPACE_UNAVAILABLE",
    "OUTPUT_LIMIT",
    "TERMINATION_UNCONFIRMED",
  ] as const) {
    const fixture = evidenceFixture(["ERROR"]);
    let observation = noProcess(outcome);
    if (outcome === "TERMINATION_UNCONFIRMED")
      observation = { ...observation, started: true, terminationConfirmed: false };
    if (outcome === "OUTPUT_LIMIT")
      observation = {
        ...observation,
        started: true,
        diagnostics: {
          ...observation.diagnostics,
          stdout: Buffer.alloc(4096).toString("base64"),
          stdoutBytes: 4096,
          observedBytes: 4097,
          truncated: true,
        },
      };
    const result = { ...fixture.input.results[0]!, observation };
    const reference = captureExecutionEvidence(
      fixture.input.planningInput,
      fixture.input.plan,
      result.binding,
      result,
    );
    const assessment = evaluateVerdict(
      { ...fixture.input, results: [result, ...fixture.input.results.slice(1)] },
      [reference, ...fixture.references.slice(1)],
    );
    assert.equal(assessment.verdict, "INCONCLUSIVE", outcome);
  }
});

void test("zero exit after timeout or cancellation remains uncertain under Phase 7 stop precedence", () => {
  for (const state of ["TIMEOUT", "CANCELLED"] as const) {
    const fixture = evidenceFixture([state]);
    const result = {
      ...fixture.input.results[0]!,
      observation: { ...noProcess(state), started: true, exitCode: 0, durationMs: 1000 },
    };
    const reference = captureExecutionEvidence(
      fixture.input.planningInput,
      fixture.input.plan,
      result.binding,
      result,
    );
    assert.equal(
      evaluateVerdict({ ...fixture.input, results: [result, ...fixture.input.results.slice(1)] }, [
        reference,
        ...fixture.references.slice(1),
      ]).verdict,
      "INCONCLUSIVE",
    );
  }
});

void test("duplicate, extra, unbound, reused-attempt and reused-workspace evidence rejects", () => {
  const { input, references } = evidenceFixture();
  assert.throws(
    () => evaluateVerdict({ ...input, results: [...input.results, input.results[0]!] }, references),
    InvalidInputError,
  );
  assert.throws(() => evaluateVerdict(input, [...references, references[0]!]), InvalidInputError);
  assert.throws(() => evaluateVerdict(input, []), InvalidInputError);
  const other = evidenceFixture([], planningFixture());
  assert.throws(
    () =>
      evaluateVerdict(
        { ...input, results: [...input.results, other.input.results.at(-1)!] },
        references,
      ),
    InvalidInputError,
  );
  for (const path of [["attemptId"], ["binding", "workspace", "id"]]) {
    const duplicate = altered(
      input.results[1]!,
      path,
      path.length === 1 ? input.results[0]!.attemptId : input.results[0]!.binding.workspace.id,
    );
    const reference = captureExecutionEvidence(
      input.planningInput,
      input.plan,
      duplicate.binding,
      duplicate,
    );
    assert.throws(
      () =>
        evaluateVerdict({ ...input, results: [input.results[0]!, duplicate, input.results[2]!] }, [
          references[0]!,
          reference,
          references[2]!,
        ]),
      InvalidInputError,
    );
  }
});

void test("result identity, plan context, definition, protocol and diagnostics are bound independently", () => {
  const { input, references } = evidenceFixture();
  const mutations: readonly [readonly (string | number)[], unknown][] = [
    [["binding", "executorVersion"], "7.0.0"],
    [["binding", "planId"], `plan:sha256:${"f".repeat(64)}`],
    [["binding", "context", "repository"], "another"],
    [["binding", "context", "baseCommit"], "d".repeat(40)],
    [["binding", "context", "targetCommit"], "e".repeat(40)],
    [["binding", "context", "configuration", "hash"], `sha256:${"d".repeat(64)}`],
    [["binding", "authorityId"], `authority:sha256:${"d".repeat(64)}`],
    [["binding", "definition", "id"], `definition:sha256:${"d".repeat(64)}`],
    [["binding", "definition", "version"], "another"],
    [["binding", "definition", "timeoutMs"], 5],
    [["binding", "definition", "maxOutputBytes"], 5],
    [["binding", "workspace", "snapshotSha256"], "e".repeat(64)],
    [["binding", "check", "strategy"], "AUTHORIZATION_VERIFICATION"],
    [["binding", "check", "id"], "unknown"],
    [["observation", "exitCode"], 42],
    [["observation", "started"], false],
    [["observation", "terminationConfirmed"], false],
    [["state"], "SKIPPED"],
    [["observation", "diagnostics", "stdout"], "YQ=="],
    [["observation", "diagnostics", "sensitivity"], "PUBLIC"],
    [["observation", "durationMs"], 11],
    [["attemptId"], "attempt:00000000-0000-4000-8000-000000000009"],
    [
      ["observation", "diagnostics"],
      {
        encoding: "base64",
        stdout: "YQ==",
        stderr: "",
        stdoutBytes: 1,
        stderrBytes: 0,
        observedBytes: 1,
        truncated: false,
        sensitivity: "SENSITIVE",
      },
    ],
  ];
  for (const [path, value] of mutations)
    assert.throws(
      () =>
        evaluateVerdict(
          {
            ...input,
            results: [altered(input.results[0]!, path, value), ...input.results.slice(1)],
          },
          references,
        ),
      InvalidInputError,
      path.join("."),
    );
  assert.throws(
    () => evaluateVerdict(altered(input, ["results", 0, "observation"], undefined), references),
    InvalidInputError,
  );
});

void test("malformed evidence is rejected even when another valid result already establishes BLOCK", () => {
  const { input, references } = evidenceFixture(["FAIL"]);
  assert.throws(
    () =>
      evaluateVerdict(altered(input, ["results", 1, "observation", "exitCode"], 42), references),
    InvalidInputError,
  );
  const assessment = evaluateVerdict({ ...input, results: input.results.slice(0, 1) }, references);
  assert.equal(assessment.verdict, "BLOCK");
  assert.equal(assessment.checks[1]!.state, "MISSING");
});

void test("plan replay rejects weakened, stripped and fabricated handling metadata", () => {
  const { input, references } = evidenceFixture([], planningFixture(["GENERAL"]));
  for (const [path, value] of [
    [["plan", "checks", 0, "strength"], "OPTIONAL"],
    [["plan", "checks", 0, "unavailableBehavior"], "BLOCK"],
    [["plan", "checks", 0, "validFailureBehavior"], "NOT_APPLICABLE"],
    [["plan", "policy", "coverage"], []],
    [["plan", "policy", "risk", "uncertainties"], []],
    [["plan", "checks"], []],
    [["plan", "context", "targetCommit"], "e".repeat(40)],
  ] as const)
    assert.throws(() => evaluateVerdict(altered(input, path, value), references));
});

void test("trusted references have a validated exact binding schema and digest", () => {
  const { input, references } = evidenceFixture();
  for (const [path, value] of [
    [[0, "resultDigest"], "not-a-digest"],
    [[0, "binding", "definition", "maxOutputBytes"], 0],
    [[0, "binding", "definition", "timeoutMs"], 2147483648],
    [[0, "binding", "definition", "version"], ""],
    [[0, "binding", "definition", "version"], "x\n"],
    [[0, "binding", "workspace", "id"], "invalid"],
    [[0, "binding", "authorityId"], "invalid"],
    [[0, "unexpected"], true],
  ] as const)
    assert.throws(
      () => evaluateVerdict(input, altered(references, path, value)),
      InvalidInputError,
    );
  // Even references for missing results must be valid.
  assert.throws(
    () =>
      evaluateVerdict(
        { ...input, results: [] },
        altered(references, [0, "binding", "check", "id"], "unknown"),
      ),
    InvalidInputError,
  );
});

void test("stored assessments reject every inconsistent verdict, reason, contribution, provenance and digest", () => {
  for (const states of [[], ["FAIL"], ["TIMEOUT"]] as const) {
    const { input, references } = evidenceFixture(states);
    const assessment = evaluateVerdict(input, references);
    for (const verdict of ["PASS", "APPROVE", "BLOCK", "INCONCLUSIVE"])
      if (verdict !== assessment.verdict)
        assert.throws(
          () => validateVerdictAssessment(input, references, { ...assessment, verdict }),
          InvalidInputError,
        );
    for (const [path, value] of [
      [["id"], `verdict:sha256:${"0".repeat(64)}`],
      [["verdictVersion"], "8.0.0"],
      [["planId"], "different"],
      [["reason", "code"], "FORGED"],
      [["checks", 0, "contribution"], "invented"],
      [["checks", 0, "reason", "explanation"], "forged"],
      [["checks", 0, "evidence", "resultDigest"], "f".repeat(64)],
      [["checks", 0, "check", "id"], "unknown"],
      [["checks", 0, "check", "validFailureBehavior"], "NOT_APPLICABLE"],
      [["checks"], [...assessment.checks, assessment.checks[0]]],
      [["coverage"], []],
    ] as const)
      assert.throws(
        () => validateVerdictAssessment(input, references, altered(assessment, path, value)),
        InvalidInputError,
      );
  }
  const uncertain = evidenceFixture([], planningFixture(["GENERAL"]));
  const assessment = evaluateVerdict(uncertain.input, uncertain.references);
  assert.throws(
    () =>
      validateVerdictAssessment(uncertain.input, uncertain.references, {
        ...assessment,
        verdict: "APPROVE",
        coverage: [],
      }),
    InvalidInputError,
  );
});

void test("public boundaries reject accessors without calling them, cycles, sparse arrays and non-JSON values", () => {
  const { input, references } = evidenceFixture();
  const assessment = evaluateVerdict(input, references);
  let invoked = false;
  const getter = {
    get results(): typeof input.results {
      invoked = true;
      return input.results;
    },
    plan: input.plan,
    planningInput: input.planningInput,
  };
  assert.throws(() => evaluateVerdict(getter, references), InvalidInputError);
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const sparse = new Array<unknown>(3);
  for (const bad of [
    cycle,
    sparse,
    NaN,
    undefined,
    new Date(0),
    { [Symbol("hidden")]: 1 },
    Object.create({ inherited: true }),
    {
      get id(): string {
        invoked = true;
        return "bad";
      },
    },
  ]) {
    assert.throws(() => validateVerdictAssessment(input, references, bad), InvalidInputError);
    assert.throws(
      () => evaluateVerdict(altered(input, ["results"], bad), references),
      InvalidInputError,
    );
  }
  assert.equal(invoked, false);
  assert.throws(
    () =>
      evaluateVerdict(altered(input, ["results"], Array(11).fill(input.results[0])), references),
    InvalidInputError,
  );
  assert.throws(
    () =>
      validateVerdictAssessment(input, references, { ...assessment, huge: "x".repeat(1500001) }),
    InvalidInputError,
  );
  const hidden = { ...assessment };
  Object.defineProperty(hidden, "secret", { value: 1 });
  assert.throws(() => validateVerdictAssessment(input, references, hidden), InvalidInputError);
});

void test("assessment and evidence are deeply detached and immutable without freezing caller data", () => {
  const { input, references } = evidenceFixture([], planningFixture(["GENERAL"]));
  const mutableInput = structuredClone(input);
  const mutableRefs = structuredClone(references);
  const assessment = evaluateVerdict(mutableInput, mutableRefs);
  const before = JSON.stringify(assessment);
  const walk = (value: unknown): void => {
    if (value && typeof value === "object") {
      assert.ok(Object.isFrozen(value));
      Object.values(value).forEach(walk);
    }
  };
  walk(assessment);
  walk(validateExecutionEvidence(mutableInput, mutableRefs));
  walk(
    captureExecutionEvidence(
      input.planningInput,
      input.plan,
      input.results[0]!.binding,
      input.results[0],
    ),
  );
  assert.ok(!Object.isFrozen(mutableInput));
  assert.ok(!Object.isFrozen(mutableInput.results[0]!.binding));
  assert.ok(!Object.isFrozen(mutableRefs[0]!.binding));
  assert.notEqual(assessment.checks[0]!.evidence!.binding, mutableRefs[0]!.binding);
  Reflect.set(mutableInput.results[0]!.observation, "durationMs", 999);
  Reflect.set(mutableRefs[0]!.binding.workspace, "snapshotSha256", "d".repeat(64));
  assert.equal(JSON.stringify(assessment), before);
  assert.equal(
    Reflect.defineProperty(assessment.checks[0]!.reason, "code", { value: "altered" }),
    false,
  );
  assert.throws(() => Object.assign(assessment.checks[0]!.reason, { code: "altered" }), TypeError);
});

void test("object key insertion order is irrelevant and semantic evidence changes alter assessment identity", () => {
  const { input, references } = evidenceFixture();
  const assessment = evaluateVerdict(input, references);
  const reorder = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reorder)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, item]) => [key, reorder(item)]),
          )
        : value;
  assert.deepEqual(validateVerdictAssessment(input, references, reorder(assessment)), assessment);
  const result = altered(input.results[0]!, ["observation", "durationMs"], 20);
  const reference = captureExecutionEvidence(
    input.planningInput,
    input.plan,
    result.binding,
    result,
  );
  const changed = evaluateVerdict({ ...input, results: [result, ...input.results.slice(1)] }, [
    reference,
    ...references.slice(1),
  ]);
  assert.equal(changed.verdict, assessment.verdict);
  assert.notEqual(changed.id, assessment.id);
});
